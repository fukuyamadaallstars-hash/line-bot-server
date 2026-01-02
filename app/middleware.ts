import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

export async function middleware(request: NextRequest) {
    // /admin で始まるページだけを監視
    if (request.nextUrl.pathname.startsWith('/admin')) {
        const token = request.cookies.get('admin_session')?.value;
        const secret = new TextEncoder().encode(process.env.ADMIN_PASSWORD);

        if (!token) {
            // トークンがない -> ログイン画面へ
            return NextResponse.redirect(new URL('/login', request.url));
        }

        try {
            // トークンが本物か検証
            await jwtVerify(token, secret);
            return NextResponse.next(); // 通過許可
        } catch (error) {
            // 偽造または期限切れ -> ログイン画面へ
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: '/admin/:path*',
};
