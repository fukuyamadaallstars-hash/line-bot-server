import { NextResponse } from 'next/server';

export async function GET() {
    return NextResponse.json({ status: "OK", message: "Webhook URL is working!" });
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        console.log('Received LINE event:', body);
        return NextResponse.json({ message: "Received" });
    } catch (error) {
        return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
}
