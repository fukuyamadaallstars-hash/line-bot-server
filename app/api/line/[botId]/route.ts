import { NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import OpenAI from 'openai';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

// AI Logic (Reusable function)
async function handleEvent(event: any, lineClient: line.messagingApi.MessagingApiClient, openaiApiKey: string, tenantId: string, systemPrompt: string) {
    if (event.type !== 'message' || event.message.type !== 'text') {
        return;
    }

    const openai = new OpenAI({ apiKey: openaiApiKey });
    const userMessage = event.message.text;

    try {
        // Log Usage (Start)
        const startTime = Date.now();

        const completion = await openai.chat.completions.create({
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userMessage }
            ],
            model: "gpt-3.5-turbo",
        });

        const aiResponse = completion.choices[0].message.content || '返答を作成できませんでした。';
        const usedTokens = completion.usage?.total_tokens || 0;

        await lineClient.replyMessage({
            replyToken: event.replyToken,
            messages: [{ type: 'text', text: aiResponse }],
        });

        // Log Usage (End) - DBに記録
        await supabaseAdmin.from('usage_logs').insert({
            tenant_id: tenantId,
            user_id: event.source.userId,
            message_type: 'text',
            token_usage: usedTokens,
            status: 'success'
        });

    } catch (error: any) {
        console.error('AI Processing Error:', error);

        // Log Error
        await supabaseAdmin.from('usage_logs').insert({
            tenant_id: tenantId,
            user_id: event.source.userId || 'unknown',
            message_type: 'text',
            status: 'error',
            error_message: error.message
        });
    }
}

// DB-Driven Dynamic Webhook Handler
export async function POST(
    request: Request,
    { params }: { params: Promise<{ botId: string }> }
) {
    try {
        const { botId } = await params;

        // 1. Fetch Tenant Config from Database
        const { data: tenant, error } = await supabaseAdmin
            .from('tenants')
            .select('*')
            .eq('tenant_id', botId)
            .single();

        if (error || !tenant) {
            console.error(`[${botId}] Error fetching tenant:`, error);
            return NextResponse.json({ error: "Tenant not found or inactive" }, { status: 404 });
        }

        if (!tenant.is_active) {
            return NextResponse.json({ error: "Tenant is inactive" }, { status: 403 });
        }

        // 2. Load Credentials from Tenant Data
        const channelAccessToken = tenant.line_channel_access_token;
        // OpenAI Key: Use Tenant's Own Key OR System Fallback
        const openaiApiKey = tenant.openai_api_key || process.env.OPENAI_API_KEY;

        if (!channelAccessToken) {
            console.error(`[${botId}] Missing LINE Token`);
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }
        if (!openaiApiKey) {
            console.error(`[${botId}] Missing OpenAI Key`);
            return NextResponse.json({ error: "Configuration Error" }, { status: 500 });
        }

        const lineClient = new line.messagingApi.MessagingApiClient({
            channelAccessToken: channelAccessToken
        });

        const body = await request.text();
        const json = JSON.parse(body);
        const events = json.events;

        if (!events || events.length === 0) {
            return NextResponse.json({ message: "No events" });
        }

        // Process all events
        await Promise.all(events.map((event: any) =>
            handleEvent(event, lineClient, openaiApiKey, botId, tenant.system_prompt)
        ));

        return NextResponse.json({ message: "OK" });

    } catch (error: any) {
        console.error('Webhook Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: "OK", message: "DB-Driven Multi-Bot Router Active" });
}
