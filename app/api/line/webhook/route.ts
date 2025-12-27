import { NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import OpenAI from 'openai';

export async function POST(request: Request) {
    try {
        // 実行時に環境変数を取得するように修正（ビルド時のキャッシュを回避）
        const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
        const openaiApiKey = process.env.OPENAI_API_KEY || '';

        // デバッグ用ログ
        if (!openaiApiKey) {
            console.error('--- OPENAI_API_KEY is missing in process.env ---');
        }

        const lineClient = new line.messagingApi.MessagingApiClient({
            channelAccessToken: channelAccessToken
        });

        const openai = new OpenAI({
            apiKey: openaiApiKey,
        });

        const body = await request.text();
        const json = JSON.parse(body);
        const events = json.events;

        if (!events || events.length === 0) {
            return NextResponse.json({ message: "No events" });
        }

        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const userMessage = event.message.text;

                const completion = await openai.chat.completions.create({
                    messages: [{ role: "user", content: userMessage }],
                    model: "gpt-3.5-turbo",
                });

                const aiResponse = completion.choices[0].message.content || '返答を作成できませんでした。';

                await lineClient.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: aiResponse }],
                });
            }
        }

        return NextResponse.json({ message: "OK" });
    } catch (error: any) {
        console.error('Error detail:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: "OK", message: "Environment test version active" });
}
