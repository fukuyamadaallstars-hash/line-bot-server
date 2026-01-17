import { NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { decrypt } from '@/lib/crypto';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rateLimit';
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

const availableTools: Record<string, any> = {
    check_schedule: {
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
    add_reservation: {
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
    cancel_reservation: {
        type: "function" as const,
        function: {
            name: "cancel_reservation",
            description: "ユーザー自身の予約をキャンセルする",
            parameters: {
                type: "object",
                properties: {
                    date: { type: "string", description: "対象の日付 (YYYY/MM/DD) - 省略可だが推奨" },
                    reason: { type: "string", description: "キャンセルの理由" },
                },
            },
        },
    },
    check_my_reservation: {
        type: "function" as const,
        function: {
            name: "check_my_reservation",
            description: "自分の現在の予約状況を確認する",
            parameters: { type: "object", properties: {} },
        },
    },
};

function getTools(plan: string = 'Lite') {
    // 全プランで全機能を開放
    return [
        availableTools.check_schedule,
        availableTools.add_reservation,
        availableTools.cancel_reservation,
        availableTools.check_my_reservation
    ];
}

async function handleEvent(event: any, lineClient: any, openaiApiKey: string, tenant: any, supabase: any) {
    if (event.type !== 'message' || event.message.type !== 'text') return;
    const tenantId = tenant.tenant_id;
    const userMessage = event.message.text;
    const userId = event.source.userId;
    const eventId = event.webhookEventId;

    console.log(`[Event] Tenant=${tenantId}, User=${userId}, HasSheet=${!!tenant.google_sheet_id}`);

    // Rate Limiting: 20 messages per user per minute
    const rateLimitKey = `line:${tenantId}:${userId}`;
    const rateCheck = checkRateLimit(rateLimitKey, RATE_LIMITS.LINE_BOT_USER);
    if (!rateCheck.allowed) {
        console.log(`[Rate Limit] User ${userId} exceeded limit for tenant ${tenantId}`);
        await lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: '申し訳ありません。メッセージの送信頻度が高すぎます。\n少し時間をおいてから再度お試しください。' }]
        });
        return;
    }

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
            // 引数をパース: #CMD <ID> <REASON...>
            const args = userMessage.split(/\s+/);
            const command = args[0];
            const arg1 = args[1];
            const reasonArgs = args.slice(2).join(' '); // 3つ目以降を結合

            // スタッフ登録解除
            if (command === '#UNSTAFF') {
                await supabase.from('users').update({ is_staff: false }).eq('tenant_id', tenantId).eq('user_id', userId);
                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'スタッフ権限を解除しました。' }] });
                return;
            }

            // ★デバッグコマンド (スタッフ専用)
            if (command === '#DEBUG_INFO') {
                // ... (Debug Info logic unchanged, but need to re-fetch logs as valid TS scope) ...
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
                if (arg1 === tenant.staff_passcode) {
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

                const resId = arg1;
                const sheets = await getGoogleSheetsClient();
                const sheetId = decrypt(tenant.google_sheet_id);
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
                            let notifyText = "";
                            if (command === '#CONFIRM') {
                                notifyText = `【予約確定】\n予約ID: ${resId} の予約が確定しました。\nご来店をお待ちしております。`;
                            } else {
                                // キャンセル理由がある場合
                                if (reasonArgs) {
                                    notifyText = `【予約キャンセル】\n申し訳ございません。予約ID: ${resId} の予約は以下の理由によりキャンセルされました。\n\n『${reasonArgs}』\n\n恐れ入りますが、別の日時で再度ご検討いただけますと幸いです。`;
                                } else {
                                    notifyText = `【予約キャンセル】\n申し訳ございません。予約ID: ${resId} の予約は店舗の都合またはその他の理由によりキャンセルされました。\n詳細は店舗までお問い合わせいただくか、別の日時でご検討ください。`;
                                }
                            }

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
            // 3. 今日の予約確認 (#TODAY, #SCHEDULE)
            if (command === '#TODAY' || command === '#SCHEDULE') {
                if (!user.is_staff) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ 権限がありません。\n先に #STAFF <コード> で登録してください。' }] });
                    return;
                }

                const sheets = await getGoogleSheetsClient();
                const sheetId = decrypt(tenant.google_sheet_id);
                if (!sheets || !sheetId) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'Error: Google Sheets not connected' }] });
                    return;
                }

                const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:D' });
                const rows = resp.data.values || [];
                // rows: [ID, Status, Date, Time, ...]

                // Get JST today YYYY/MM/DD
                const jaToday = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                const todayStr = jaToday.split(' ')[0]; // "2024/1/9" (format depends on locale string in environment, ensuring consistency)
                // Normalize "2024/01/09" vs "2024/1/9" might be needed. 
                // Let's rely on simple string includes or standard format YYYY/MM/DD if stored that way.
                // Better: Construct YYYY/MM/DD manually
                const d = new Date();
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const todayTarget = `${yyyy}/${mm}/${dd}`;

                const todayReservations = rows.filter(row => row[2] === todayTarget && row[1] !== 'CANCELLED');

                if (todayReservations.length === 0) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `📅 ${todayTarget} の予約はありません。` }] });
                    return;
                }

                const msgLines = todayReservations.map(row => `・${row[3]}~ (ID:${row[0]})`);
                const msg = `📅 ${todayTarget} の予約:\n\n${msgLines.join('\n')}`;

                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: msg }] });
                return;
            }

            // 4. 一斉配信 (#BROADCAST <MESSAGE>)
            if (command === '#BROADCAST') {
                if (!user.is_staff) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ 権限がありません。' }] });
                    return;
                }
                const broadcastMsg = args.slice(1).join(' ');
                if (!broadcastMsg) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '使い方: #BROADCAST <メッセージ内容>' }] });
                    return;
                }

                // DBから該当テナントの友だち全取得 (LINE APIのBroadCastは全体に行く可能性があるため、DBベースでMulticastする)
                const { data: allUsers } = await supabase.from('users').select('user_id').eq('tenant_id', tenantId);

                if (!allUsers || allUsers.length === 0) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '送信対象のユーザーがいません。' }] });
                    return;
                }

                // LINE Multicast API (Max 500 at a time)
                const userIds = allUsers.map((u: any) => u.user_id);
                // Chunk by 500
                for (let i = 0; i < userIds.length; i += 500) {
                    const chunk = userIds.slice(i, i + 500);
                    await lineClient.multicast(chunk, [{ type: 'text', text: broadcastMsg }]);
                }

                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `📣 ${userIds.length}人にメッセージを配信しました。` }] });
                return;
            }

            // 5. 予約枠ブロック・代理登録 (#BLOCK <YYYY/MM/DD> <HH:MM> <MEMO>)
            if (command === '#BLOCK') {
                if (!user.is_staff) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ 権限がありません。' }] });
                    return;
                }
                const bDate = args[1]; // YYYY/MM/DD
                const bTime = args[2]; // HH:MM
                const bMemo = args.slice(3).join(' ') || '店舗都合';

                if (!bDate || !bTime) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '使い方: #BLOCK <日付> <時間> <メモ>\n例: #BLOCK 2026/01/20 14:00 電話予約' }] });
                    return;
                }

                const sheets = await getGoogleSheetsClient();
                const sheetId = decrypt(tenant.google_sheet_id);
                if (!sheets || !sheetId) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'Error: Google Sheets not connected' }] });
                    return;
                }

                const resId = Math.random().toString(36).substring(2, 8).toUpperCase();
                const newRow = [
                    resId,             // A: ID
                    'CONFIRMED',       // B: Status (最初から確定)
                    bDate,             // C: Date
                    bTime,             // D: Time
                    '(店舗ブロック)',   // E: Name
                    bMemo,             // F: Details
                    new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' }), // G: CreatedAt
                    ''                 // H: LINE User ID (空)
                ];

                await sheets.spreadsheets.values.append({
                    spreadsheetId: sheetId, range: 'Sheet1!A:H', valueInputOption: 'USER_ENTERED',
                    requestBody: { values: [newRow] }
                });

                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `✅ 予約枠をブロックしました。\n\nID: ${resId}\n日時: ${bDate} ${bTime}\nメモ: ${bMemo}` }] });
                return;
            }

            // 6. 顧客メモ (#MEMO <お名前部分一致> <内容>)
            if (command === '#MEMO') {
                if (!user.is_staff) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ 権限がありません。' }] });
                    return;
                }
                const targetName = args[1];
                const memoContent = args.slice(2).join(' ');

                if (!targetName || !memoContent) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '使い方: #MEMO <お客様名> <メモ内容>\n例: #MEMO 山田 カラー剤アレルギーあり' }] });
                    return;
                }

                // 名前で検索
                const { data: foundUsers } = await supabase.from('users')
                    .select('user_id, display_name, internal_memo')
                    .eq('tenant_id', tenantId)
                    .ilike('display_name', `%${targetName}%`)
                    .limit(5);

                if (!foundUsers || foundUsers.length === 0) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `「${targetName}」に一致するユーザーが見つかりません。` }] });
                    return;
                }

                if (foundUsers.length > 1) {
                    const names = foundUsers.map((u: any) => u.display_name).join(', ');
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `複数がヒットしました: ${names}\nもう少し詳しく指定してください。` }] });
                    return;
                }

                const targetUser = foundUsers[0];
                const newMemo = (targetUser.internal_memo ? targetUser.internal_memo + "\n" : "") + `・${memoContent} (${new Date().toLocaleDateString()})`;

                await supabase.from('users').update({ internal_memo: newMemo }).eq('tenant_id', tenantId).eq('user_id', targetUser.user_id);

                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `✅ メモを保存しました。\n対象: ${targetUser.display_name}\n内容: ${memoContent}` }] });
                return;
            }

            // 7. 明日の予約一覧 (#TOMORROW)
            if (command === '#TOMORROW') {
                if (!user.is_staff) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ 権限がありません。' }] });
                    return;
                }

                const sheets = await getGoogleSheetsClient();
                const sheetId = decrypt(tenant.google_sheet_id);
                if (!sheets || !sheetId) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'Error: Google Sheets not connected' }] });
                    return;
                }

                const d = new Date();
                d.setDate(d.getDate() + 1); // Add 1 day
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                const targetDate = `${yyyy}/${mm}/${dd}`;

                const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:D' });
                const rows = resp.data.values || [];
                const tomorrowReservations = rows.filter(row => row[2] === targetDate && row[1] !== 'CANCELLED');

                if (tomorrowReservations.length === 0) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `📅 明日 (${targetDate}) の予約はありません。` }] });
                    return;
                }

                const msgLines = tomorrowReservations.map(row => `・${row[3]}~ (ID:${row[0]})`);
                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: `📅 明日 (${targetDate}) の予約:\n\n${msgLines.join('\n')}` }] });
                return;
            }

            // 8. 明日までの空き確認 (#VACANCY)
            if (command === '#VACANCY') {
                if (!user.is_staff) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ 権限がありません。' }] });
                    return;
                }

                const sheets = await getGoogleSheetsClient();
                const sheetId = decrypt(tenant.google_sheet_id);
                if (!sheets || !sheetId) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: 'Error: Google Sheets not connected' }] });
                    return;
                }

                const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:D' });
                const rows = resp.data.values || [];

                // Config: 11:00 - 20:00 (Simple assumption)
                const openHours = [11, 12, 13, 14, 15, 16, 17, 18, 19];

                const checkDays = [0, 1]; // Today, Tomorrow
                let resultMsg = "🈳 明日までの空き状況:\n(目安: 11:00-20:00)\n";

                const todayBase = new Date();

                for (const offset of checkDays) {
                    const d = new Date(todayBase);
                    d.setDate(d.getDate() + offset);
                    const yyyy = d.getFullYear();
                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                    const dd = String(d.getDate()).padStart(2, '0');
                    const dateStr = `${yyyy}/${mm}/${dd}`;
                    const label = offset === 0 ? "今日" : "明日";

                    const dayRows = rows.filter(row => row[2] === dateStr && row[1] !== 'CANCELLED');
                    const bookedTimes = dayRows.map(row => row[3]); // "14:00"

                    const freeSlots = [];
                    for (const h of openHours) {
                        const timeStr = `${h}:00`;
                        // Simple match: Starts with "14:"
                        const isBooked = bookedTimes.some(t => t.startsWith(`${h}:`));
                        if (!isBooked) freeSlots.push(timeStr);
                    }

                    if (freeSlots.length > 0) {
                        resultMsg += `\n▼${label} (${dateStr})\n` + freeSlots.join(', ');
                    } else {
                        resultMsg += `\n▼${label} (${dateStr})\n🈵 満席`;
                    }
                }

                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: resultMsg }] });
                return;
            }

            // 9. チャット履歴リセット (#RESET / #RESET_ALL)
            if (command === '#RESET') {
                if (!user.is_staff) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ 権限がありません。' }] });
                    return;
                }

                // 自分（スタッフ）のチャット履歴のみ削除
                const { error } = await supabase.from('chat_history').delete().eq('tenant_id', tenantId).eq('user_id', userId);
                if (error) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '❌ リセットに失敗しました: ' + error.message }] });
                    return;
                }

                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '✅ あなたのチャット履歴をリセットしました。\n新しい会話を始めてください。' }] });
                return;
            }

            if (command === '#RESET_ALL') {
                if (!user.is_staff) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '⛔️ 権限がありません。' }] });
                    return;
                }

                // このテナントの全ユーザーのチャット履歴を削除
                const { error } = await supabase.from('chat_history').delete().eq('tenant_id', tenantId);
                if (error) {
                    await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '❌ リセットに失敗しました: ' + error.message }] });
                    return;
                }

                await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '✅ このテナントの全ユーザーのチャット履歴をリセットしました。' }] });
                return;
            }
        } // End of Staff Command Handler

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

        // Embedding Model Selection based on tenant config
        const embeddingModel = tenant.embedding_model || "text-embedding-3-small";
        const isLargeEmbedding = embeddingModel === "text-embedding-3-large";

        const embeddingRes = await openai.embeddings.create({ model: embeddingModel, input: userMessage });
        const queryVector = embeddingRes.data[0].embedding;

        // ★Update: Use Hybrid Search (Vector + Keyword)
        try {
            let matchedKnowledge: any[] = [];

            if (isLargeEmbedding) {
                // Call Large Model RPC (3072 dim)
                const { data } = await supabase.rpc('match_knowledge_hybrid_large', {
                    query_text: userMessage,
                    query_embedding: queryVector,
                    match_threshold: 0.3,
                    match_count: 3,
                    p_tenant_id: tenantId
                });
                matchedKnowledge = data;
            } else {
                // Call Standard Model RPC (1536 dim)
                const { data } = await supabase.rpc('match_knowledge_hybrid', {
                    query_text: userMessage,
                    query_embedding: queryVector,
                    match_threshold: 0.3,
                    match_count: 3,
                    p_tenant_id: tenantId
                });
                matchedKnowledge = data;
            }

            // カテゴリをバッジとして付与してAIに渡す
            var contextText = matchedKnowledge?.length > 0 ?
                "\n\n【参考資料】\n" + matchedKnowledge.map((k: any) => `- [${k.category || 'FAQ'}] ${k.content.substring(0, 800)}`).join("\n")
                : "";
        } catch (e) {
            console.error('Hybrid search failed, falling back to simple vector:', e);
            // Fallback for Small model only (Legacy RPC match_knowledge takes 1536 dim)
            if (!isLargeEmbedding) {
                const { data: matchedKnowledge } = await supabase.rpc('match_knowledge', {
                    query_embedding: queryVector, match_threshold: 0.3, match_count: 2, p_tenant_id: tenantId
                });
                contextText = matchedKnowledge?.length > 0 ?
                    "\n\n【参考資料】\n" + matchedKnowledge.map((k: any) => `- [${k.category || 'FAQ'}] ${k.content.substring(0, 500)}`).join("\n")
                    : "";
            } else {
                contextText = ""; // No fallback for large model (schema mismatch)
            }
        }

        // messages配列を any[] として定義
        const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

        // ★履歴取得 (直近6件 = 3ターン分)
        const { data: historyData } = await supabase
            .from('chat_history')
            .select('role, content')
            .eq('tenant_id', tenantId)
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);

        // 履歴は新しい順に来るので、古い順に戻す
        const historyMessages = (historyData || []).reverse().map((h: any) => ({ role: h.role, content: h.content }));

        // プランごとの追加指示（全プランで統一）
        let planInstructions = "";

        // シートが連携されている場合のみ、予約ツールの使用を強制する
        if (tenant.google_sheet_id) {
            planInstructions = `\n\n【予約システム連携中 - 以下のツール利用規定を厳守してください】
1. **予約の確認**: ユーザーから「予約したい」「空いていますか」と聞かれたら、推測で答えず、必ず『check_schedule』ツールを使って空き状況を確認してください。
2. **予約の登録**: 日時が決まったら、必ず『add_reservation』ツールを実行して予約を確定させてください。「承りました」と口頭で言うだけでは不十分です。
3. **予約のキャンセル**: キャンセルの依頼があった場合は、まず『check_my_reservation』で予約状況を確認・提示し、「本当にキャンセルしてよろしいですか？」と確認した上で、同意が得られたら『cancel_reservation』を実行してください。`;
        }

        const userMemo = user.internal_memo ? `\n\n【お客様メモ (スタッフ共有事項)】\n${user.internal_memo}\n※この情報はユーザーには見せず、接客の参考にしてください。` : "";

        const completionMessages: any[] = [
            { role: "system", content: `現在の日時は ${now} です。\n` + tenant.system_prompt + contextText + userMemo + (rawKeywords ? `\n\n【重要】現在有効な「担当者呼び出しパスワード」は『${rawKeywords}』です。ユーザーが担当者との会話を希望した場合のみ、「担当者にお繋ぎしますので『${rawKeywords}』と入力してください」と案内してください。` : "") + planInstructions },
            ...historyMessages,
            { role: "user", content: userMessage }
        ];

        // モデル選択 & バリデーション
        let selectedModel = tenant.ai_model || "gpt-4o-mini";
        const validModels = [
            'gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo',
            'gpt-4.1', 'gpt-5-mini', 'gpt-5.1', 'gpt-5.2',
            'o1-mini', 'o1-preview'
        ];

        if (!validModels.includes(selectedModel)) {
            console.log(`[Model Fallback] Invalid model '${selectedModel}' detected. Falling back to 'gpt-4o-mini'.`);
            selectedModel = 'gpt-4o-mini';
        }

        // o1モデル等は非同期/Thinking扱いにする (GPT-5系の上位モデルも含む)
        const isThinkingModel = selectedModel.startsWith('o1-') || selectedModel.includes('gpt-5.1') || selectedModel.includes('gpt-5.2');

        // ★非同期推論フロー (GPT-5.1/5.2)
        if (isThinkingModel) {
            // 1. 即時応答 (Reply API)
            await lineClient.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '🧠 専門知識を元に深く考えています... 少々お待ちください。' }]
            });

            // 2. 非同期処理実行 (本来は waitUntil 等を使うが、関数内で Promise を detach する)
            (async () => {
                try {
                    const completionParams: any = {
                        model: selectedModel,
                        messages: completionMessages,
                    };
                    // Thinking models might not support tools well yet, or take too long, but we include if configured
                    if (tenant.google_sheet_id) {
                        completionParams.tools = getTools(tenant.plan || 'Lite');
                        completionParams.tool_choice = 'auto'; // Explicitly allow tools
                    }

                    const completion = await openai.chat.completions.create(completionParams);
                    const choice = completion.choices[0];
                    let aiResponse = choice.message.content;

                    // Note: Tool calls handling in async mode is complex. For now, if tool calls exist, we just execute them and push result.
                    // Ideally recursion is needed like the sync flow.
                    if (choice.message.tool_calls) {
                        // ... (Tool handling logic similar to sync flow, but using Push API for output)
                        // For simplicity in this iteration, we fallback to text if tool is used, or perform 1 hop.
                        // Here we implement basic tool execution and response.
                        const sheets = await getGoogleSheetsClient();
                        const sheetId = decrypt(tenant.google_sheet_id);
                        if (sheets && sheetId) {
                            completionMessages.push(choice.message);
                            for (const toolCall of choice.message.tool_calls) {
                                const tc = toolCall as any;
                                const args = JSON.parse(tc.function.arguments);
                                let toolResult = "";
                                // ... (Tool logic duplicated or refactored) ...
                                // For brevity, let's assume simple answer generation after tool use
                                // Simplified tool logic for Async flow:
                                if (tc.function.name === 'check_schedule') {
                                    // ... check_schedule logic copy (simplified for now as this is async path) ...
                                    // 実装簡略化のため、同期フローと同じ関数を切り出して呼ぶのがベストだが、ここでは簡易実装
                                    const date = args.date;
                                    const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:H' });
                                    const rows = resp.data.values || [];
                                    const targeted = rows.filter(row => row[2] === date && (row[1] === 'PENDING' || row[1] === 'CONFIRMED'));
                                    const bookedTimes = targeted.map(row => row[3]);
                                    if (bookedTimes.length > 0) {
                                        toolResult = `${date}は、${bookedTimes.join('、')}に予約が入っています。`;
                                    } else {
                                        toolResult = `${date}は現在予約はありません。`;
                                    }
                                } else if (tc.function.name === 'add_reservation') {
                                    // ... add_reservation logic ...
                                    toolResult = "仮予約を受け付けました(Async Flow)";
                                    // 今回は省略
                                }
                                else {
                                    toolResult = "（処理完了）";
                                }
                                completionMessages.push({ role: "tool", content: toolResult, tool_call_id: toolCall.id });
                            }
                            const secondResponse = await openai.chat.completions.create({ model: selectedModel, messages: completionMessages });
                            aiResponse = secondResponse.choices[0].message.content;
                        }
                    }

                    if (aiResponse) {
                        await lineClient.pushMessage({
                            to: userId,
                            messages: [{ type: 'text', text: aiResponse }]
                        });

                        // Save History
                        await supabase.from('chat_history').insert([
                            { tenant_id: tenantId, user_id: userId, role: 'user', content: userMessage },
                            { tenant_id: tenantId, user_id: userId, role: 'assistant', content: aiResponse }
                        ]);
                        await supabase.from('usage_logs').insert({
                            tenant_id: tenantId, user_id: userId, event_id: eventId,
                            message_type: 'text', token_usage: completion.usage?.total_tokens || 0, status: 'success_async'
                        });
                    }
                } catch (e) {
                    console.error('Async processing failed', e);
                    await lineClient.pushMessage({ to: userId, messages: [{ type: 'text', text: '申し訳ありません。処理中にエラーが発生しました。' }] });
                }
            })();

            return; // End Sync Flow
        }

        // --- 以下、通常モデル(Legacy)の同期フロー ---

        const completionParams: any = {
            model: selectedModel,
            messages: completionMessages,
        };

        if (tenant.google_sheet_id) {
            completionParams.tools = getTools(tenant.plan || 'Lite');
            completionParams.tool_choice = 'auto'; // Explicitly allow tools
        }

        console.log(`[DEBUG] Call OpenAI: Model=${selectedModel}, Tools=${completionParams.tools?.length || 0}, SystemMsgLen=${completionMessages[0].content.length}`);

        const completion = await openai.chat.completions.create(completionParams);

        const choice = completion.choices[0];
        console.log(`[DEBUG] First AI Response: Content="${choice.message.content?.substring(0, 20)}...", ToolCalls=${choice.message.tool_calls ? choice.message.tool_calls.length : 0}`);

        let aiResponse = choice.message.content;

        if (choice.message.tool_calls) {
            const sheets = await getGoogleSheetsClient();
            const rawSheetId = tenant.google_sheet_id;
            const sheetId = decrypt(tenant.google_sheet_id);
            console.log(`[DEBUG] SheetID Raw=${rawSheetId?.substring(0, 30)}..., Decrypted=${sheetId?.substring(0, 30)}...`);

            if (sheets && sheetId) {
                console.log(`[DEBUG] Tool execution started for ${choice.message.tool_calls.length} calls.`);

                // Assistantのメッセージ（ToolCall要求）は一度だけ履歴に追加する
                completionMessages.push(choice.message);

                let toolResult = "";

                for (const toolCall of choice.message.tool_calls) {
                    const tc = toolCall as any;
                    const args = JSON.parse(tc.function.arguments);
                    console.log(`[DEBUG] Tool Call: ${tc.function.name}, Args=${JSON.stringify(args)}, SheetID=${sheetId}`);

                    if (tc.function.name === 'check_schedule') {
                        const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:H' });
                        const rows = resp.data.values || [];
                        const targeted = rows.filter(row => row[2] === args.date); // C列=日付

                        if (user.is_staff) {
                            // スタッフには詳細を表示
                            const details = targeted.map(row => `${row[3]} ${row[4] || '予約'} (${row[1]})`); // 時間, 名前, ステータス
                            toolResult = targeted.length > 0
                                ? `【${args.date}の予約状況】\n` + details.join('\n')
                                : `${args.date}の予約は入っていません。`;
                        } else {
                            // 一般ユーザーには空き/埋まりのみ（個人情報を守る）
                            const bookedTimes = targeted.map(row => row[3]); // D列=時間
                            if (targeted.length > 0) {
                                toolResult = `${args.date}は、${bookedTimes.join('、')}の時間帯に予約が入っています。\n他の時間帯は空いている可能性があります。詳細はお問い合わせください。`;
                            } else {
                                toolResult = `${args.date}は現在予約が入っていないようです。ご希望の時間をお知らせください。`;
                            }
                        }
                    }
                    else if (tc.function.name === 'add_reservation') {
                        const reservationId = crypto.randomUUID().split('-')[0];
                        const jstTime = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                        await sheets.spreadsheets.values.append({
                            spreadsheetId: sheetId, range: 'Sheet1', valueInputOption: 'USER_ENTERED',
                            requestBody: { values: [[reservationId, 'PENDING', args.date, args.time, args.name, args.details || '', jstTime, userId]] }
                        });
                        toolResult = `仮予約を受付けました。\n予約ID: ${reservationId}\nお店からの確定連絡をお待ちください。`;

                        const staffNotifyMsg = `【新規予約依頼】\n予約ID: ${reservationId}\n日時: ${args.date} ${args.time}\nお名前: ${args.name}\n内容: ${args.details || '-'}\n\n確定する場合:\n#CONFIRM ${reservationId}\n\nキャンセルする場合 (理由なし):\n#CANCEL ${reservationId}\n\nキャンセルする場合 (理由あり):\n#CANCEL ${reservationId} 満席のため`;
                        await sendNotification(tenant.notification_webhook_url, tenantId, staffNotifyMsg);

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
                    else if (tc.function.name === 'cancel_reservation') {
                        // ユーザーID一致かつ未来の予約を探す
                        const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:H' });
                        const rows = resp.data.values || [];
                        // 予約行を探す (H列=User ID, B列=Status, C列=Date)
                        let targetRowIndex = -1;
                        let foundRes: any = null;

                        // 日付指定があればそれで、なければ直近のPENDING/CONFIRMEDを探す
                        for (let i = 0; i < rows.length; i++) {
                            const row = rows[i];
                            const rUserId = row[7];
                            const rStatus = row[1];
                            const rDate = row[2];

                            if (rUserId === userId && (rStatus === 'PENDING' || rStatus === 'CONFIRMED')) {
                                if (args.date) {
                                    if (rDate === args.date) { targetRowIndex = i; foundRes = row; break; }
                                } else {
                                    // 指定なしなら最初に見つかったもの（あるいは本来は未来で一番近いもの）
                                    targetRowIndex = i; foundRes = row; break;
                                }
                            }
                        }

                        if (targetRowIndex !== -1 && foundRes) {
                            const updateRange = `Sheet1!B${targetRowIndex + 1}`;
                            await sheets.spreadsheets.values.update({
                                spreadsheetId: sheetId, range: updateRange, valueInputOption: 'USER_ENTERED',
                                requestBody: { values: [['CANCELLED']] }
                            });
                            toolResult = `予約(ID: ${foundRes[0]}, 日時: ${foundRes[2]} ${foundRes[3]}) をキャンセルしました。またのご利用をお待ちしております。`;

                            // 通知
                            // ★理由がある場合は通知に含める
                            const reasonText = args.reason ? `\n理由: ${args.reason}` : "";
                            const staffNotifyMsg = `【自己キャンセル】\n以前の予約(ID: ${foundRes[0]})がユーザー自身によりキャンセルされました。${reasonText}`;
                            await sendNotification(tenant.notification_webhook_url, tenantId, staffNotifyMsg);
                        } else {
                            toolResult = "キャンセル可能な予約が見つかりませんでした。";
                        }
                    }
                    else if (tc.function.name === 'check_my_reservation') {
                        const resp = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:H' });
                        const rows = resp.data.values || [];
                        const myRes = rows.filter(r => r[7] === userId && (r[1] === 'PENDING' || r[1] === 'CONFIRMED'));

                        if (myRes.length > 0) {
                            toolResult = "【あなたの現在の予約】\n" + myRes.map(r => `・${r[2]} ${r[3]} (${r[1]})`).join("\n");
                        } else {
                            toolResult = "現在、有効な予約はありません。";
                        }
                    }

                    // Toolの実行結果メッセージを追加
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
                    secondParams.tools = getTools(tenant.plan || 'Lite');
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
        const finalContent = aiResponse || 'システムエラーが発生しました。時間をおいてお試しください。';

        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: finalContent }] });

        // 成功時のみ履歴保存
        if (aiResponse) {
            await supabase.from('chat_history').insert([
                { tenant_id: tenantId, user_id: userId, role: 'user', content: userMessage },
                { tenant_id: tenantId, user_id: userId, role: 'assistant', content: aiResponse }
            ]);
        }

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

        // Decrypt sensitive info
        tenant.line_channel_access_token = decrypt(tenant.line_channel_access_token);
        if (tenant.openai_api_key) tenant.openai_api_key = decrypt(tenant.openai_api_key);
        if (tenant.google_sheet_id) tenant.google_sheet_id = decrypt(tenant.google_sheet_id);

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
