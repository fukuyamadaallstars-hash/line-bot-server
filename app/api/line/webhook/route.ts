import { NextResponse } from 'next/server';
import { MessagingApiClient } from '@line/bot-sdk';
import OpenAI from 'openai';

const channelSecret = process.env.LINE_CHANNEL_SECRET || '';
const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN || '';
const openaiApiKey = process.env.OPENAI_API_KEY || '';

const lineClient = new MessagingApiClient({
    channelAccessToken: channelAccessToken
});

const openai = new OpenAI({
    apiKey: openaiApiKey,
});

export async function POST(request: Request) {
    try {
        const body = await request.text();
        console.log('--- 1. 受信データ ---', body);

        const json = JSON.parse(body);
        const events = json.events;

        if (!events || events.length === 0) {
            return NextResponse.json({ message: "No events" });
        }

        for (const event of events) {
            if (event.type === 'message' && event.message.type === 'text') {
                const userMessage = event.message.text;
                console.log('--- 2. ユーザーの質問 ---', userMessage);

                try {
                    console.log('--- 3. OpenAIに問い合わせ中... ---');
                    const completion = await openai.chat.completions.create({
                        messages: [{ role: "user", content: userMessage }],
                        model: "gpt-3.5-turbo",
                    });

                    const aiResponse = completion.choices[0].message.content || '返答なし';
                    console.log('--- 4. AIの回答 ---', aiResponse);

                    console.log('--- 5. LINEに返信中... ---');
                    await lineClient.replyMessage({
                        replyToken: event.replyToken,
                        messages: [{ type: 'text', text: aiResponse }],
                    });
                    console.log('--- 6. 返信完了！ ---');

                } catch (innerError: any) {
                    console.error('!!! 処理中のエラー !!!', innerError.message);

                    // LINEにエラー内容を返してデバッグする
                    try {
                        await lineClient.replyMessage({
                            replyToken: event.replyToken,
                            messages: [{ type: 'text', text: `ボット内部でエラーが発生しました: ${innerError.message}` }],
                        });
                    } catch (lineErr) {
                        console.error('LINEへのエラー送信にも失敗:', lineErr);
                    }
                }
            }
        }

        return NextResponse.json({ message: "OK" });
    } catch (error: any) {
        console.error('!!! 全体的なエラー !!!', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({ status: "OK", message: "Diagnosis mode is active" });
}
