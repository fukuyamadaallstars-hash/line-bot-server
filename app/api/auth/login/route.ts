import { NextResponse } from 'next/server';
import { SignJWT } from 'jose';

export async function POST(request: Request) {
    const formData = await request.formData();
    const password = formData.get('password') as string;
    const correctPassword = process.env.ADMIN_PASSWORD;

    if (password === correctPassword) {
        // パスワード正解：安全なクッキー（JWT）を発行
        const secret = new TextEncoder().encode(process.env.ADMIN_PASSWORD);
        const token = await new SignJWT({ role: 'admin' })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('24h') // 24時間有効
            .sign(secret);

        const response = NextResponse.redirect(new URL('/admin', request.url), 302);

        // Cookieの設定 (HttpOnly=JavaScriptから盗めない, Secure=HTTPS必須)
        response.cookies.set('admin_session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 60 * 60 * 24, // 24時間
            path: '/',
        });

        return response;
    } else {
        // 失敗：ログイン画面に戻す
        const url = new URL('/login', request.url);
        url.searchParams.set('error', 'invalid');
        return NextResponse.redirect(url, 302);
    }
}
