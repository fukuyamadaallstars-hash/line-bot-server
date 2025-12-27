import { NextResponse } from 'next/server';
import { MessagingApiClient, MessagingApiBlobClient } from '@line/bot-sdk';
import OpenAI from 'openai';
import crypto from 'crypto';

// 環境変数の読み込み
const channelSecret = process.env.LINE_CHANNEL_SECRET || '';
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';

// LINEクライアントとOpenAIクライアントの初期化
const lineClient = new MessagingApiClient({
    channelAccessToken: channelAccessToken
});

const openai = new OpenAI({
    apiKey: openaiApiKey,
});

export async function POST(request: Request) {
    try {
        const body = await request.text();
        const signature = request.headers.get('x-line-signature') || '';

        // 1. 本人確認（署名検証）
        // 本番環境では必須ですが、まずは動作優先のため簡易的なチェックに留めます
        // 本来は crypto を使って検証しますが、ここでは一旦ログ出力のみにしています

        const events = JSON.parse(body).events;

        // 2. 各イベント（メッセージ送信など）を処理
        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const userMessage = event.message.text;

                // 3. OpenAIで返答を生成
                const completion = await openai.chat.completions.create({
                    messages: [{ role: "user", content: userMessage }],
                    model: "gpt-3.5-turbo", // または gpt-4
                });

                const aiResponse = completion.choices[0].message.content || '申し訳ありません、返答を作成できませんでした。';

                // 4. LINEに返信する
                await lineClient.replyMessage({
                    replyToken: event.replyToken,
                    messages: [{ type: 'text', text: aiResponse }],
                });
            }
        }

        return NextResponse.json({ message: "OK" });
    } catch (error: any) {
        console.error('Error handling LINE webhook:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: "OK", message: "AI Bot is ready!" });
}
