import { NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
        throw new Error('Supabase URL or Key is missing');
    }

    return createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

async function handleEvent(event: any, lineClient: any, openaiApiKey: string, tenantId: string, systemPrompt: string, supabase: any) {
    if (event.type !== 'message' || event.message.type !== 'text') return;

    const openai = new OpenAI({ apiKey: openaiApiKey });
    const userMessage = event.message.text;

    try {
        const completion = await openai.chat.completions.create({
            messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userMessage }],
            model: "gpt-4o-mini",
        });

        const aiResponse = completion.choices[0].message.content || '返答を作成できませんでした。';

        await lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: aiResponse }],
        });

        await supabase.from('usage_logs').insert({
            tenant_id: tenantId,
            user_id: event.source.userId,
            message_type: 'text',
            token_usage: completion.usage?.total_tokens || 0,
            status: 'success'
        });
    } catch (error: any) {
        console.error('AI Error:', error);
        await supabase.from('usage_logs').insert({
            tenant_id: tenantId,
            user_id: event.source.userId || 'unknown',
            status: 'error',
            error_message: error.message
        });
    }
}

export async function POST(request: Request, { params }: { params: Promise<{ botId: string }> }) {
    try {
        const supabase = getSupabaseAdmin();
        const { botId } = await params;

        const { data: tenant, error } = await supabase.from('tenants').select('*').eq('tenant_id', botId).single();

        if (error || !tenant || !tenant.is_active) {
            return NextResponse.json({ error: "Tenant not found or inactive" }, { status: 404 });
        }

        const channelAccessToken = tenant.line_channel_access_token;

        // 【診断モード】DBの設定を無視して、Vercelの環境変数だけを使う
        const openaiApiKey = process.env.OPENAI_API_KEY || '';

        // どのキーを使っているかログを出す
        const maskedKey = openaiApiKey ? `${openaiApiKey.substring(0, 10)}...` : 'NOT FOUND IN ENV';
        console.log(`[DIAGNOSIS] Using Vercel ENV Key: ${maskedKey}`);

        const lineClient = new line.messagingApi.MessagingApiClient({ channelAccessToken });
        const json = await request.json();
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
    return NextResponse.json({ status: "OK", message: "Diagnosis Mode: Vercel Env Only" });
}
