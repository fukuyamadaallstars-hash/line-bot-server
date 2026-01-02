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

// NGワード・個人情報チェック（簡易版）
function containsSensitiveInfo(text: string): { type: string; found: boolean } {
    const piiPatterns = [
        { type: 'Phone', regex: /(\d{2,4}-\d{2,4}-\d{4})|(\d{10,11})/ },
        { type: 'Card', regex: /\d{4}-\d{4}-\d{4}-\d{4}/ },
        { type: 'Email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ }
    ];

    const ngKeywords = ['返金', 'クレーム', '訴える', '死ね', 'バカ'];

    for (const pattern of piiPatterns) {
        if (pattern.regex.test(text)) return { type: 'PII (' + pattern.type + ')', found: true };
    }
    for (const word of ngKeywords) {
        if (text.includes(word)) return { type: 'NG Keyword', found: true };
    }

    return { type: '', found: false };
}

async function handleEvent(event: any, lineClient: any, openaiApiKey: string, tenantId: string, systemPrompt: string, supabase: any) {
    if (event.type !== 'message' || event.message.type !== 'text') return;

    const userMessage = event.message.text;
    const userId = event.source.userId;
    const eventId = event.webhookEventId;

    try {
        // 1. 重複チェック (Idempotency)
        const { data: existingLog } = await supabase
            .from('usage_logs')
            .select('id')
            .eq('tenant_id', tenantId)
            .eq('event_id', eventId) // SQLでevent_id列を追加する必要があります
            .maybeSingle();

        if (existingLog) {
            console.log(`[${tenantId}] Skipping duplicate event: ${eventId}`);
            return;
        }

        // 2. レート制限チェック (直近1分間に5通以上なら制限)
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
        const { count } = await supabase
            .from('usage_logs')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenantId)
            .eq('user_id', userId)
            .gt('created_at', oneMinuteAgo);

        if (count && count >= 5) {
            await lineClient.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '少し時間をおいてから話しかけてね！' }],
            });
            return;
        }

        // 3. PII/NGフィルタ
        const checkResult = containsSensitiveInfo(userMessage);
        if (checkResult.found) {
            await lineClient.replyMessage({
                replyToken: event.replyToken,
                messages: [{ type: 'text', text: '申し訳ございません。セキュリティ保護のため、個人情報の送信や不適切な言葉が含まれるお問い合わせには自動回答を制限しております。担当へお繋ぎしますか？' }],
            });
            // ログには「NG検知」として残す
            await supabase.from('usage_logs').insert({
                tenant_id: tenantId, user_id: userId, event_id: eventId,
                message_type: 'text', status: 'filtered', error_message: checkResult.type
            });
            return;
        }

        // 4. OpenAI呼び出し
        const openai = new OpenAI({ apiKey: openaiApiKey });
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
            model: "gpt-4o-mini",
        });

        const aiResponse = completion.choices[0].message.content || '返答を作成できませんでした。';

        await lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: aiResponse }],
        });

        // 成功ログ保存
        await supabase.from('usage_logs').insert({
            tenant_id: tenantId, user_id: userId, event_id: eventId,
            message_type: 'text', token_usage: completion.usage?.total_tokens || 0,
            status: 'success'
        });

    } catch (error: any) {
        console.error('Processing Error:', error);
        await lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: 'すみません、考えがまとまりませんでした。少し後でもう一度話しかけてください！' }],
        });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ botId: string }> }) {
    const bodyText = await request.text();
    const signature = request.headers.get('x-line-signature') || '';

    try {
        const supabase = getSupabaseAdmin();
        const { botId } = await params;

        // テナント取得
        const { data: tenant, error } = await supabase.from('tenants').select('*').eq('tenant_id', botId).single();
        if (error || !tenant || !tenant.is_active) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 404 });
        }

        // 5. 署名検証
        if (!validateSignature(bodyText, tenant.line_channel_secret, signature)) {
            console.error(`[${botId}] Invalid Signature`);
            return NextResponse.json({ error: "Invalid Signature" }, { status: 401 });
        }

        const openaiApiKey = tenant.openai_api_key || process.env.OPENAI_API_KEY || '';
        const lineClient = new line.messagingApi.MessagingApiClient({ channelAccessToken: tenant.line_channel_access_token });

        const json = JSON.parse(bodyText);
        const events = json.events;

        if (events && events.length > 0) {
            await Promise.all(events.map((event: any) => handleEvent(event, lineClient, openaiApiKey, botId, tenant.system_prompt, supabase)));
        }

        return NextResponse.json({ message: "OK" });
    } catch (error: any) {
        console.error('Webhook Error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: "OK", message: "Production Ready Router Active" });
}
