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
    const criticalKeywords = ['返金', 'クレーム', '訴える', '弁護士', '消費者センター'];
    const handoffKeywords = ['担当者', 'オペレーター', '人間', 'わかってない'];

    for (const pattern of piiPatterns) {
        if (pattern.regex.test(text)) return { type: 'PII (' + pattern.type + ')', found: true, level: 'warning' };
    }
    for (const word of criticalKeywords) {
        if (text.includes(word)) return { type: 'Critical Keyword: ' + word, found: true, level: 'critical' };
    }
    for (const word of handoffKeywords) {
        if (text.includes(word)) return { type: 'Handoff Request', found: true, level: 'critical' };
    }

    return { type: '', found: false, level: 'warning' };
}

// 通知送信 (Slack/Webhook)
async function sendNotification(webhookUrl: string | null, tenantId: string, message: string) {
    if (!webhookUrl) return;
    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: `[${tenantId}] ${message}` }),
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

        // 2. ユーザー登録・状態取得
        let { data: user } = await supabase.from('users').select('*').eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle();
        if (!user) {
            const { data: newUser } = await supabase.from('users').insert({ tenant_id: tenantId, user_id: userId, display_name: 'LINE User' }).select().single();
            user = newUser;
        }

        // 3. 有人切替チェック (Handoff中ならAIは無視)
        if (user.is_handoff_active) {
            console.log(`[${tenantId}] Human handling for user: ${userId}. AI silent.`);
            return;
        }

        // 4. 感性・NGチェック
        const check = checkSensitivy(userMessage);
        if (check.found && check.level === 'critical') {
            // 有人切替をONにする
            await supabase.from('users').update({ is_handoff_active: true, status: 'attention_required' }).eq('tenant_id', tenantId).eq('user_id', userId);
            // チケット作成
            await supabase.from('tickets').insert({ tenant_id: tenantId, user_id: userId, last_message_summary: userMessage, priority: 'high' });
            // 通知
            await sendNotification(tenant.notification_webhook_url, tenantId, `有人切替が必要なメッセージを受信しました: ${userMessage}`);

            await lineClient.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '内容を承知いたしました。より詳しい対応のため、ここからは担当者が直接確認し、折り返しご連絡させていただきます。少々お待ちください。' }],
            });
            return;
        }

        // 5. レート制限
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
        const { count } = await supabase.from('usage_logs').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('user_id', userId).gt('created_at', oneMinuteAgo);
        if (count && count >= 5) {
            await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: '少し時間をおいてから話しかけてね！' }] });
            return;
        }

        // 6. AI返答
        const openai = new OpenAI({ apiKey: openaiApiKey });
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: tenant.system_prompt }, { role: "user", content: userMessage }],
            model: "gpt-4o-mini",
        });

        const aiResponse = completion.choices[0].message.content || '返答を作成できませんでした。';
        await lineClient.replyMessage({ replyToken: event.replyToken, messages: [{ type: 'text', text: aiResponse }] });

        // 成功ログ
        await supabase.from('usage_logs').insert({
            tenant_id: tenantId, user_id: userId, event_id: eventId,
            message_type: 'text', token_usage: completion.usage?.total_tokens || 0,
            status: 'success'
        });

    } catch (error: any) {
        console.error('Error:', error);
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
    return NextResponse.json({ status: "OK", message: "Handoff Enabled Router Active" });
}
