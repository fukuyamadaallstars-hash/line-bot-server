import { NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { google } from 'googleapis';

// Supabase初期化
function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase configuration missing');
    return createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

// Google Sheets API クライアント初期化
async function getGoogleSheetsClient() {
    const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (!credentials) return null;

    const auth = new google.auth.GoogleAuth({
        credentials: JSON.parse(credentials),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    return google.sheets({ version: 'v4', auth });
}

// 署名検証関数
function validateSignature(body: string, channelSecret: string, signature: string): boolean {
    const hash = crypto
        .createHmac('SHA256', channelSecret)
        .update(body)
        .digest('base64');
    return hash === signature;
}

// 個人情報・NGキーワードチェック
function checkSensitivy(text: string, customKeywords: string[]): { type: string; found: boolean; level: 'warning' | 'critical' } {
    const piiPatterns = [
        { type: 'Phone', regex: /(\d{2,4}-\d{2,4}-\d{4})|(\d{10,11})/ },
        { type: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ }
    ];
    const defaultKeywords = ['担当者', 'オペレーター', '返金', 'クレーム'];
    const targetKeywords = customKeywords.length > 0 ? customKeywords : defaultKeywords;
    for (const pattern of piiPatterns) {
        if (pattern.regex.test(text)) return { type: 'PII (' + pattern.type + ')', found: true, level: 'warning' };
    }
    for (const word of targetKeywords) {
        if (text.includes(word)) return { type: 'Critical Keyword: ' + word, found: true, level: 'critical' };
    }
    return { type: '', found: false, level: 'warning' };
}

async function sendNotification(webhookUrl: string | null, tenantId: string, message: string) {
    if (!webhookUrl) return;
    try {
        await fetch(webhookUrl, {
            method: 'POST', body: JSON.stringify({ content: `🚨 **[アラート]** ${tenantId}: ${message}` }),
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (e) { console.error(e); }
}

const tools = [
    {
        type: "function" as const,
        function: {
            name: "check_schedule",
            description: "指定された日付のスプレッドシート上の予約状況を確認する",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "確認したい日付 (YYYY/MM/DD)" },
                },
                required: ["date"],
            },
        },
    },
    {
        type: "function" as const,
        function: {
            name: "add_reservation",
            description: "スプレッドシートに新しい予約を追加する",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "日付 (YYYY/MM/DD)" },
                    time: { type: "string", description: "時間 (HH:MM)" },
                    name: { type: "string", description: "予約者名" },
                    details: { type: "string", description: "メニューや備考" },
                },
                required: ["date", "time", "name"],
            },
        },
    },
];

async function handleEvent(event: any, lineClient: any, openaiApiKey: string, tenant: any, supabase: any) {
    if (event.type !== 'message' || event.message.type !== 'text') return;
    const tenantId = tenant.tenant_id;
    const userMessage = event.message.text;
    const userId = event.source.userId;
    const eventId = event.webhookEventId;

    try {
        const { data: existingLog } = await supabase.from('usage_logs').select('id').eq('tenant_id', tenantId).eq('event_id', eventId).maybeSingle();
        if (existingLog) return;

        let { data: user } = await supabase.from('users').select('*').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
        if (!user) user = await supabase.from('users').insert({ tenant_id: tenantId, user_id: userId, display_name: 'LINE User' }).select().single();
        if (user && user.is_handoff_active === true) return;

        const rawKeywords = tenant.handoff_keywords || "";
        const customKeywords = rawKeywords.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
        const check = checkSensitivy(userMessage, customKeywords);

        if (check.found && check.level === 'critical') {
            await supabase.from('users').update({ is_handoff_active: true, status: 'attention_required' }).eq('tenant_id', tenantId).eq('user_id', userId);
            await sendNotification(tenant.notification_webhook_url, tenantId, `有人切替: ${userMessage}`);
            await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '担当者が確認します。AI応答を停止しました。' }] });
            return;
        }

        const { data: usageData } = await supabase.from('usage_logs').select('token_usage').eq('tenant_id', tenantId);
        const currentTotal = usageData?.reduce((s: number, l: any) => s + (l.token_usage || 0), 0) || 0;
        if (tenant.monthly_token_limit > 0 && currentTotal >= tenant.monthly_token_limit) {
            await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '今月のAI利用枠上限です。' }] });
            return;
        }

        // RAG検索
        const openai = new OpenAI({ apiKey: openaiApiKey });
        const embeddingRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: userMessage });
        const { data: matchedKnowledge } = await supabase.rpc('match_knowledge', {
            query_embedding: embeddingRes.data[0].embedding, match_threshold: 0.5, match_count: 3, p_tenant_id: tenantId
        });
        const contextText = matchedKnowledge?.length > 0 ? "\n\n【参考資料】\n" + matchedKnowledge.map((k: any) => `- ${k.content}`).join("\n") : "";

        const messages = [
            { role: "system" as const, content: tenant.system_prompt + contextText + (rawKeywords ? `\n\n【重要】現在有効な「担当者呼び出しパスワード」は『${rawKeywords}』です。ユーザーが担当者との会話を希望した場合のみ、「担当者にお繋ぎしますので『${rawKeywords}』と入力してください」と案内してください。` : "") },
            { role: "user" as const, content: userMessage }
        ];

        const completion = await openai.chat.completions.create({
            messages, model: "gpt-4o-mini", tools: tenant.google_sheet_id ? tools : undefined, tool_choice: "auto",
        });

        const choice = completion.choices[0];
        let aiResponse = choice.message.content;

        if (choice.message.tool_calls) {
            const sheets = await getGoogleSheetsClient();
            const sheetId = tenant.google_sheet_id;

            if (sheets && sheetId) {
                for (const toolCall of choice.message.tool_calls) {
                    const args = JSON.parse(toolCall.function.arguments);
                    let toolResult = "";

                    if (toolCall.function.name === 'check_schedule') {
                        // スプレッドシート読み込み (個人情報保護のため名前は伏せる)
                        const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:D' });
                        const rows = resp.data.values || [];

                        // AIに渡すのは「時間」と「予約済フラグ」のみ。個人名は渡さない。
                        const targeted = rows
                            .filter(row => row[0] === args.date)
                            .map(row => `${row[1]} : 予約済`);

                        toolResult = targeted.length > 0 ? "【現在の予約状況】\n" + targeted.join("\n") : "その日の予約は入っていません。";
                    }
                    else if (toolCall.function.name === 'add_reservation') {
                        await sheets.spreadsheets.values.append({
                            spreadsheetId: sheetId, range: 'Sheet1!A:D', valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [[args.date, args.time, args.name, args.details || '']] }
                        });
                        toolResult = "予約を追加しました。";
                    }

                    messages.push(choice.message);
                    messages.push({ role: "tool", content: toolResult, tool_call_id: toolCall.id });
                }
                const secondResponse = await openai.chat.completions.create({ messages, model: "gpt-4o-mini" });
                aiResponse = secondResponse.choices[0].message.content;
            }
        }

        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: aiResponse || 'エラーが発生しました' }] });
        await supabase.from('usage_logs').insert({
            tenant_id: tenantId, user_id: userId, event_id: eventId,
            message_type: 'text', token_usage: completion.usage?.total_tokens || 0, status: 'success'
        });

    } catch (error: any) {
        console.error(`[${tenantId}] Error:`, error);
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ botId: string }> }) {
    const bodyText = await request.text();
    const signature = request.headers.get('x-line-signature') || '';
    try {
        const supabase = getSupabaseAdmin();
        const { botId } = await params;
        const { data: tenant, error } = await supabase.from('tenants').select('*').eq('tenant_id', botId).single();
        if (error || !tenant || !tenant.is_active) return NextResponse.json({ error: "Unauthorized" }, { status: 404 });
        const openaiApiKey = tenant.openai_api_key || process.env.OPENAI_API_KEY || '';
        const lineClient = new line.messagingApi.MessagingApiClient({ channelAccessToken: tenant.line_channel_access_token });
        const json = JSON.parse(bodyText);
        if (json.events) await Promise.all(json.events.map((e: any) => handleEvent(e, lineClient, openaiApiKey, tenant, supabase)));
        return NextResponse.json({ message: "OK" });
    } catch (error: any) {
        console.error(error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: "OK", message: "Bot Router Active" });
}
