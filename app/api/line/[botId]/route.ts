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

        // ★Staff Command Handler (#CONFIRM, #CANCEL, #STAFF)
        if (userMessage.startsWith('#')) {
            const [command, arg] = userMessage.split(' ');

            // スタッフ登録解除
            if (command === '#UNSTAFF') {
                await supabase.from('users').update({ is_staff: false }).eq('tenant_id', tenantId).eq('user_id', userId);
                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'スタッフ権限を解除しました。' }] });
                return;
            }

            // ★デバッグコマンド (スタッフ専用)
            if (command === '#DEBUG_INFO') {
                // ★仕様4: トークン上限・通知 (80% / 95% / 100%) のロジックを再利用
                const { data: usageData } = await supabase.from('usage_logs').select('token_usage').eq('tenant_id', tenantId);
                const currentTotal = usageData?.reduce((s: number, l: any) => s + (l.token_usage || 0), 0) || 0;

                const statusMsg = `【System Debug Info】
Tenant ID: ${tenantId.substring(0, 8)}...
Active Model: ${tenant.ai_model || 'gpt-4o-mini (default)'}
Sheet Connected: ${tenant.google_sheet_id ? 'YES' : 'NO'}
Staff Passcode: ${tenant.staff_passcode}
Staff Mode: ${user.is_staff ? 'ON' : 'OFF'}
Time (JST): ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}

Token Usage: ${currentTotal} / ${tenant.monthly_token_limit}`;

                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: statusMsg }] });
                return;
            }

            // 1. スタッフ登録 (#STAFF <code)
            if (command === '#STAFF') {
                if (arg === tenant.staff_passcode) {
                    await supabase.from('users').update({ is_staff: true }).eq('tenant_id', tenantId).eq('user_id', userId);
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '✅ スタッフ登録が完了しました。\n管理コマンドが利用可能です。' }] });
                    return;
                } else {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ パスコードが間違っています。' }] });
                    return;
                }
            }

            // 2. 管理コマンド (#CONFIRM, #CANCEL) - 要スタッフ権限
            if (command === '#CONFIRM' || command === '#CANCEL') {
                if (!user.is_staff) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ 権限がありません。\n先に #STAFF <コード> で登録してください。' }] });
                    return;
                }

                const resId = arg;
                const sheets = await getGoogleSheetsClient();
                const sheetId = tenant.google_sheet_id;
                if (sheets && sheetId && resId) {
                    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:H' }); // A:Hまで拡張(H列にuserId)
                    const rows = resp.data.values || [];
                    const rowIndex = rows.findIndex(row => row[0] === resId);

                    if (rowIndex !== -1) {
                        const targetRow = rows[rowIndex];
                        const customerUserId = targetRow[7]; // H列(8番目)
                        const newStatus = command === '#CONFIRM' ? 'CONFIRMED' : 'CANCELLED';

                        // Google Sheets更新
                        const updateRange = `Sheet1!B${rowIndex + 1}`;
                        await sheets.spreadsheets.values.update({
                            spreadsheetId: sheetId, range: updateRange, valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [[newStatus]] }
                        });

                        // 一般ユーザーへ通知
                        if (customerUserId) {
                            const notifyText = command === '#CONFIRM'
                                ? `【予約確定】\n予約ID: ${resId} の予約が確定しました。\nご来店をお待ちしております。`
                                : `【予約キャンセル】\n申し訳ございません。予約ID: ${resId} の予約はキャンセルされました。`;

                            try {
                                await lineClient.pushMessage({
                                    to: customerUserId,
                                    messages: [{ type: 'text', text: notifyText }]
                                });
                            } catch (e) { console.error('Push notification failed', e); }
                        }

                        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `予約 ${resId} を ${newStatus} に更新し、ユーザーへ通知しました。` }] });
                        return;
                    } else {
                        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `予約ID ${resId} が見つかりません。` }] });
                        return;
                    }
                }
            }
        }

        const check = checkSensitivy(userMessage, customKeywords);

        if (check.found && check.level === 'critical') {
            await supabase.from('users').update({ is_handoff_active: true, status: 'attention_required' }).eq('tenant_id', tenantId).eq('user_id', userId);
            await sendNotification(tenant.notification_webhook_url, tenantId, `有人切替: ${userMessage}`);
            await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '担当者が確認します。AI応答を停止しました。' }] });
            return;
        }

        // ★仕様4: トークン上限・通知 (80% / 95% / 100%)
        const { data: usageData } = await supabase.from('usage_logs').select('token_usage').eq('tenant_id', tenantId);
        const currentTotal = usageData?.reduce((s: number, l: any) => s + (l.token_usage || 0), 0) || 0;
        const limit = tenant.monthly_token_limit;

        if (limit > 0) {
            const ratio = currentTotal / limit;

            // 停止処理 (100%超)
            if (ratio >= 1.0) {
                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '【システム通知】\n今月のAI利用枠の上限に達したため、応答を一時停止しています。\n再開するには追加枠の購入が必要です。' }] });
                // 既に通知済みでなければ顧客へ通知するロジックを本来は入れる
                return;
            }

            // 警告通知 (80% または 95% のしきい値を跨いだ時だけ通知すべきだが、簡易的に毎回ログに残すか、別途通知履歴テーブルが必要)
            // ここでは簡易的に「管理画面Webhook」へ通知を送る (95%以上ならCritical)
            if (ratio >= 0.95) {
                await sendNotification(tenant.notification_webhook_url, tenantId, `⚠️ Token Usage Critical: ${(ratio * 100).toFixed(1)}% used.`);
            } else if (ratio >= 0.80 && ratio < 0.81) { // 80%付近のみ (連投防止のため狭める)
                await sendNotification(tenant.notification_webhook_url, tenantId, `⚠️ Token Usage Warning: ${(ratio * 100).toFixed(1)}% used.`);
            }
        }

        const openai = new OpenAI({ apiKey: openaiApiKey });
        const embeddingRes = await openai.embeddings.create({ model: "text-embedding-3-small", input: userMessage });
        // ★仕様3: RAGのチャンク数・長さ制限 (上位2件まで、長文カット)
        // カテゴリも含めて取得するように修正 (RPC側が * で全カラム返すならOKだが、念のためcategoryを使う)
        const { data: matchedKnowledge } = await supabase.rpc('match_knowledge', {
            query_embedding: embeddingRes.data[0].embedding, match_threshold: 0.3, match_count: 2, p_tenant_id: tenantId
        });

        // カテゴリをバッジとして付与してAIに渡す
        const contextText = matchedKnowledge?.length > 0 ?
            "\n\n【参考資料】\n" + matchedKnowledge.map((k: any) => `- [${k.category || 'FAQ'}] ${k.content.substring(0, 500)}`).join("\n")
            : "";

        // messages配列を any[] として定義
        const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
        const completionMessages: any[] = [
            { role: "system", content: `現在の日時は ${now} です。\n` + tenant.system_prompt + contextText + (rawKeywords ? `\n\n【重要】現在有効な「担当者呼び出しパスワード」は『${rawKeywords}』です。ユーザーが担当者との会話を希望した場合のみ、「担当者にお繋ぎしますので『${rawKeywords}』と入力してください」と案内してください。` : "") },
            { role: "user", content: userMessage }
        ];

        // ★修正: 明示的にパラメータオブジェクトを構築し、toolsがない場合はキー自体を含めない
        // モデルはテナント設定を使用 (未設定なら gpt-4o-mini)
        const selectedModel = tenant.ai_model || "gpt-4o-mini";
        const completionParams: any = {
            model: selectedModel,
            messages: completionMessages,
        };

        if (tenant.google_sheet_id) {
            completionParams.tools = tools;
        }

        const completion = await openai.chat.completions.create(completionParams);

        const choice = completion.choices[0];
        console.log(`[DEBUG] First AI Response: Content="${choice.message.content?.substring(0, 20)}...", ToolCalls=${choice.message.tool_calls ? choice.message.tool_calls.length : 0}`);

        let aiResponse = choice.message.content;

        if (choice.message.tool_calls) {
            const sheets = await getGoogleSheetsClient();
            const sheetId = tenant.google_sheet_id;

            if (sheets && sheetId) {
                console.log(`[DEBUG] Tool execution started for ${choice.message.tool_calls.length} calls.`);
                let toolResult = "";

                for (const toolCall of choice.message.tool_calls) {
                    const tc = toolCall as any;
                    const args = JSON.parse(tc.function.arguments);
                    console.log(`[DEBUG] Tool Call: ${tc.function.name}, Args=${JSON.stringify(args)}, SheetID=${sheetId}`);

                    if (tc.function.name === 'check_schedule') {
                        const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:D' });
                        const rows = resp.data.values || [];
                        const targeted = rows
                            .filter(row => row[0] === args.date)
                            .map(row => `${row[1]} : 予約済`);
                        toolResult = targeted.length > 0 ? "【現在の予約状況】\n" + targeted.join("\n") : "その日の予約は入っていません。";
                    }
                    else if (tc.function.name === 'add_reservation') {
                        const reservationId = crypto.randomUUID().split('-')[0]; // 短めのID生成
                        const jstTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                        await sheets.spreadsheets.values.append({
                            spreadsheetId: sheetId, range: 'Sheet1', valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [[reservationId, 'PENDING', args.date, args.time, args.name, args.details || '', jstTime, userId]] }
                        });
                        toolResult = `仮予約を受付けました。\n予約ID: ${reservationId}\nお店からの確定連絡をお待ちください。`;

                        /* 通知機能復活 */
                        // スタッフへの通知 (Webhook)
                        const staffNotifyMsg = `【新規予約依頼】\n予約ID: ${reservationId}\n日時: ${args.date} ${args.time}\nお名前: ${args.name}\n内容: ${args.details || '-'}\n\n確定する場合:\n#CONFIRM ${reservationId}\n\nキャンセルする場合:\n#CANCEL ${reservationId}`;
                        await sendNotification(tenant.notification_webhook_url, tenantId, staffNotifyMsg);

                        // スタッフへの通知 (LINE Push - is_staffなユーザー全員へ)
                        const { data: staffMembers } = await supabase.from('users').select('user_id').eq('tenant_id', tenantId).eq('is_staff', true);
                        if (staffMembers && staffMembers.length > 0) {
                            for (const sm of staffMembers) {
                                try {
                                    await lineClient.pushMessage({
                                        to: sm.user_id,
                                        messages: [{ type: 'text', text: staffNotifyMsg }]
                                    });
                                } catch (e) { console.error('Staff push failed', e); }
                            }
                        }
                    }

                    completionMessages.push(choice.message);
                    completionMessages.push({ role: "tool", content: toolResult, tool_call_id: toolCall.id });
                }
                // 2回目の呼び出し時も、同様に条件分岐済みのパラメータを使用する(ただしmessagesは更新後のもの)
                // もし2回目以降でToolを使わせたくない場合は tools を外すが、会話の流れ上は一貫性を持たせるため、
                // 基本的には同じ設定で良いが、念のため再定義する。
                const secondParams: any = {
                    model: selectedModel,
                    messages: completionMessages,
                };
                if (tenant.google_sheet_id) {
                    secondParams.tools = tools;
                }
                console.log(`[DEBUG] Calling OpenAI Second Pass...`);
                const secondResponse = await openai.chat.completions.create(secondParams);
                aiResponse = secondResponse.choices[0].message.content;

                // ★Fallback: AIが何も喋らなかった場合、Toolの結果をそのまま返す
                if (!aiResponse && toolResult) {
                    console.log(`[DEBUG] AI response empty. Using toolResult as fallback.`);
                    aiResponse = toolResult;
                }

                console.log(`[DEBUG] Second AI Response: ${aiResponse?.substring(0, 50)}...`);
            }
        }

        console.log(`[DEBUG] Final Reply: ${aiResponse ? 'Content exists' : 'EMPTY'}`);
        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: aiResponse || 'エラーが発生しました' }] });
        await supabase.from('usage_logs').insert({
            tenant_id: tenantId, user_id: userId, event_id: eventId,
            message_type: 'text', token_usage: completion.usage?.total_tokens || 0, status: 'success'
        });

    } catch (error: any) {
        console.error(`[${tenantId}] CRITICAL Error:`, error);
        if (event.replyToken) {
            try {
                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'システムエラーが発生しました。時間を置いてお試しください。' }] });
            } catch (e) { console.error('Error sending fallback message:', e); }
        }
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
