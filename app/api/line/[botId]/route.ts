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

// 個人情報・NGキーワードチェック
function checkSensitivy(text: string): { type: string; found: boolean; level: 'warning' | 'critical' } {
    const piiPatterns = [
        { type: 'Phone', regex: /(\d{2,4}-\d{2,4}-\d{4})|(\d{10,11})/ },
        { type: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ }
    ];
    const criticalKeywords = ['担当者', 'オペレーター', '人間', 'わかってない', '返金', 'クレーム', '弁護士'];

    for (const pattern of piiPatterns) {
        if (pattern.regex.test(text)) return { type: 'PII (' + pattern.type + ')', found: true, level: 'warning' };
    }
    for (const word of criticalKeywords) {
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
        // 1. 重複チェック (Idempotency)
        // LINEは返信が遅いと再送してくるので、同じeventIdならスキップする機能
        const { data: existingLog } = await supabase.from('usage_logs').select('id').eq('tenant_id', tenantId).eq('event_id', eventId).maybeSingle();
        if (existingLog) {
            console.log(`[${tenantId}] 重複リクエストのためスキップ: ${eventId}`);
            return;
        }

        // 2. ユーザーの状態を取得 (なければ作成)
        let { data: user, error: fetchError } = await supabase
            .from('users')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('user_id', userId)
            .maybeSingle();

        if (fetchError) {
            console.error(`[${tenantId}] ユーザー取得エラー:`, fetchError);
            return;
        }

        if (!user) {
            console.log(`[${tenantId}] 新規ユーザー登録: ${userId}`);
            const { data: newUser, error: insertError } = await supabase
                .from('users')
                .insert({ tenant_id: tenantId, user_id: userId, display_name: 'LINE User', is_handoff_active: false })
                .select()
                .single();

            if (insertError) {
                console.error(`[${tenantId}] ユーザー登録エラー:`, insertError);
                return;
            }
            user = newUser;
        }

        console.log(`[${tenantId}] ユーザー状態確認 - ID: ${userId}, 有人モード: ${user.is_handoff_active}`);

        // 3. 有人切替中（Handoff）ならAIは完全沈黙
        if (user.is_handoff_active === true) {
            console.log(`[${tenantId}] 有人対応中のためAI回答をスキップします: ${userId}`);
            return;
        }

        // 4. 有人切替キーワードの検知
        const check = checkSensitivy(userMessage);
        if (check.found && check.level === 'critical') {
            console.log(`[${tenantId}] 有人切替トリガー検知: ${userMessage}`);

            // DBを有人モードに更新
            await supabase.from('users').update({ is_handoff_active: true, status: 'attention_required' }).eq('tenant_id', tenantId).eq('user_id', userId);
            // チケット作成 & 通知
            await supabase.from('tickets').insert({ tenant_id: tenantId, user_id: userId, last_message_summary: userMessage, priority: 'high' });
            await sendNotification(tenant.notification_webhook_url, tenantId, `有人切替が必要です: ${userMessage}`);

            await lineClient.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '内容を承知いたしました。担当者が直接確認するため、AIの自動回答を停止しました。折り返しご連絡いたしますので、少々お待ちください。' }],
            });
            return;
        }

        // 5. AI返答処理 (通常モード)
        const openai = new OpenAI({ apiKey: openaiApiKey });
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: tenant.system_prompt }, { role: "user", content: userMessage }],
            model: "gpt-4o-mini",
        });

        const aiResponse = completion.choices[0].message.content || '返答を作成できませんでした。';
        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: aiResponse }] });

        // 成功ログ保存 (eventIdを保存することで次回の重複を防止)
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
    return NextResponse.json({ status: "OK", message: "Handoff Logic Debuggable Active" });
}
