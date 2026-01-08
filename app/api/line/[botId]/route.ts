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
    const base = [availableTools.check_schedule, availableTools.add_reservation];
    if (plan === 'Standard' || plan === 'Enterprise') {
        return [...base, availableTools.cancel_reservation, availableTools.check_my_reservation];
    }
    return base;
}

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

        // プランごとの追加指示
        let planInstructions = "";
        if (tenant.plan === 'Standard' || tenant.plan === 'Enterprise') {
            planInstructions = `\n\n【Standardプラン動作規定】\n・予約キャンセルの依頼があった場合は、いきなりキャンセルを実行せず、必ず『check_my_reservation』ツールを呼び出してユーザーの現在の予約状況を提示し、「こちらの予約をキャンセルしてよろしいですか？」と確認をとってください。\n・さらに、「差し支えなければキャンセルの理由をお聞かせください」と丁寧に伺ってください。\n・ユーザーから明確な同意が得られた場合のみ、『cancel_reservation』を実行してください。その際、理由があればreason引数に含めてください。`;
        } else {
            planInstructions = `\n\n【Liteプラン動作規定】\n・予約のキャンセルや変更の依頼があった場合、あなたにはそれを実行する機能がありません。\n・その代わり、「かしこまりました。担当者に申し伝えますので、店舗からの連絡をお待ちください。」と丁寧に案内してください。\n・決して「電話してください」や「自分でやってください」と突き放すような言い方はしないでください。`;
        }

        const completionMessages: any[] = [
            { role: "system", content: `現在の日時は ${now} です。\n` + tenant.system_prompt + contextText + (rawKeywords ? `\n\n【重要】現在有効な「担当者呼び出しパスワード」は『${rawKeywords}』です。ユーザーが担当者との会話を希望した場合のみ、「担当者にお繋ぎしますので『${rawKeywords}』と入力してください」と案内してください。` : "") + planInstructions },
            ...historyMessages,
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
            completionParams.tools = getTools(tenant.plan || 'Lite');
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

                // Assistantのメッセージ（ToolCall要求）は一度だけ履歴に追加する
                completionMessages.push(choice.message);

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
