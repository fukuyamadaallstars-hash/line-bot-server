import { NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Supabase初期化
function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase configuration missing');
    return createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

// 署名検証関数
function validateSignature(body: string, channelSecret: string, signature: string): boolean {
    const hash = crypto
        .createHmac('SHA256', channelSecret)
        .update(body)
        .digest('base64');
    return hash === signature;
}

// 個人情報・NGキーワードチェック (DBからの動的リスト対応)
function checkSensitivy(text: string, customKeywords: string[]): { type: string; found: boolean; level: 'warning' | 'critical' } {
    const piiPatterns = [
        { type: 'Phone', regex: /(\d{2,4}-\d{2,4}-\d{4})|(\d{10,11})/ },
        { type: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ }
    ];

    // デフォルト（DBが空の場合の安全策）
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

// 通知送信
async function sendNotification(webhookUrl: string | null, tenantId: string, message: string) {
    if (!webhookUrl) return;
    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: `🚨 **[有人切替アラート]**\n**対象テナント:** ${tenantId}\n**内容:** ${message}`
            }),
        });
    } catch (error) {
        console.error('Notification error:', error);
    }
}

async function handleEvent(event: any, lineClient: any, openaiApiKey: string, tenant: any, supabase: any) {
    if (event.type !== 'message' || event.message.type !== 'text') return;

    const tenantId = tenant.tenant_id;
    const userMessage = event.message.text;
    const userId = event.source.userId;
    const eventId = event.webhookEventId;

    try {
        // 1. 重複チェック
        const { data: existingLog } = await supabase.from('usage_logs').select('id').eq('tenant_id', tenantId).eq('event_id', eventId).maybeSingle();
        if (existingLog) return;

        // 2. ユーザー状態取得
        let { data: user } = await supabase.from('users').select('*').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
        if (!user) {
            const { data: newUser } = await supabase.from('users').insert({ tenant_id: tenantId, user_id: userId, display_name: 'LINE User' }).select().single();
            user = newUser;
        }

        if (user.is_handoff_active === true) {
            console.log(`[${tenantId}] 有人対応中のため沈黙: ${userId}`);
            return;
        }

        // ★ DBからキーワードリストを取得（カンマ区切りを配列に変換）
        const rawKeywords = tenant.handoff_keywords || "";
        const customKeywords = rawKeywords.split(',').map((k: string) => k.trim()).filter((k: string) => k.length > 0);

        // 3. 有人切替チェック (動的リスト使用)
        const check = checkSensitivy(userMessage, customKeywords);

        if (check.found && check.level === 'critical') {
            await supabase.from('users').update({ is_handoff_active: true, status: 'attention_required' }).eq('tenant_id', tenantId).eq('user_id', userId);
            await supabase.from('tickets').insert({ tenant_id: tenantId, user_id: userId, last_message_summary: userMessage, priority: 'high' });
            await sendNotification(tenant.notification_webhook_url, tenantId, `有人切替トリガー: ${userMessage}`);
            await lineClient.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '担当者が直接確認するため、AIの自動回答を停止しました。折り返しご連絡いたしますので、少々お待ちください。' }],
            });
            return;
        }

        // 4. トークン使用量の上限チェック
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const { data: usageData } = await supabase.from('usage_logs').select('token_usage').eq('tenant_id', tenantId).gte('created_at', startOfMonth);
        const currentTotal = usageData?.reduce((sum: number, log: any) => sum + (log.token_usage || 0), 0) || 0;
        const limit = tenant.monthly_token_limit || 0;

        if (limit > 0 && currentTotal >= limit) {
            await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '今月のAI利用枠が上限に達しました。' }] });
            return;
        }

        // 5. ナレッジベース（RAG）の検索
        const openai = new OpenAI({ apiKey: openaiApiKey });
        const embeddingRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: userMessage });
        const queryEmbedding = embeddingRes.data[0].embedding;

        const { data: matchedKnowledge } = await supabase.rpc('match_knowledge', {
            query_embedding: queryEmbedding, match_threshold: 0.5, match_count: 3, p_tenant_id: tenantId
        });

        let contextText = "";
        if (matchedKnowledge && matchedKnowledge.length > 0) {
            contextText = "\n\n【参考資料】\n" + matchedKnowledge.map((k: any) => `- ${k.content}`).join("\n");
        }

        // 6. AI返答処理
        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: tenant.system_prompt + "\n参考資料がある場合はそれに基づいて答えてください。" + contextText },
                { role: "user", content: userMessage }
            ],
            model: "gpt-4o-mini",
        });

        const aiResponse = completion.choices[0].message.content || '返答を作成できませんでした。';
        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: aiResponse }] });

        // 成功ログ保存
        await supabase.from('usage_logs').insert({
            tenant_id: tenantId, user_id: userId, event_id: eventId,
            message_type: 'text', token_usage: completion.usage?.total_tokens || 0,
            status: 'success'
        });

    } catch (error: any) {
        console.error(`[${tenantId}] 処理エラー:`, error);
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
        if (!validateSignature(bodyText, tenant.line_channel_secret, signature)) return NextResponse.json({ error: "Invalid Signature" }, { status: 401 });

        const openaiApiKey = tenant.openai_api_key || process.env.OPENAI_API_KEY || '';
        const lineClient = new line.messagingApi.MessagingApiClient({ channelAccessToken: tenant.line_channel_access_token });
        const json = JSON.parse(bodyText);
        if (json.events && json.events.length > 0) {
            await Promise.all(json.events.map((event: any) => handleEvent(event, lineClient, openaiApiKey, tenant, supabase)));
        }
        return NextResponse.json({ message: "OK" });
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: "OK", message: "Pro SaaS Router Active" });
}
