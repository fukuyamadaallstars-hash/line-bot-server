import { NextResponse } from 'next/server';
import * as line from '@line/bot-sdk';
import OpenAI from 'openai';

// 環境変数の取得
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';

// LINEクライアントの初期化（最新の書き方に修正）
const lineConfig = {
    channelAccessToken: channelAccessToken,
};

const lineClient = new line.messagingApi.MessagingApiClient(lineConfig);

const openai = new OpenAI({
    apiKey: openaiApiKey,
});

export async function POST(request: Request) {
    try {
        const body = await request.text();
        const json = JSON.parse(body);
        const events = json.events;

        if (!events || events.length === 0) {
            return NextResponse.json({ message: "No events" });
        }

        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const userMessage = event.message.text;

                // OpenAIで返答生成
                const completion = await openai.chat.completions.create({
                    messages: [{ role: "user", content: userMessage }],
                    model: "gpt-3.5-turbo",
                });

                const aiResponse = completion.choices[0].message.content || '返答を作成できませんでした。';

                // LINEに返信
                await lineClient.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: aiResponse }],
                });
            }
        }

        return NextResponse.json({ message: "OK" });
    } catch (error: any) {
        console.error('Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: "OK", message: "AI Bot logic updated!" });
}
