import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import { cookies } from 'next/headers';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SECRET_KEY = new TextEncoder().encode(process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function POST(request: Request) {
    try {
        const { tenant_id, password } = await request.json();

        if (!tenant_id || !password) {
            return NextResponse.json({ error: 'IDとパスワードを入力してください' }, { status: 400 });
        }

        const { data: tenant, error } = await supabase
            .from('tenants')
            .select('tenant_id, web_access_password, web_access_enabled')
            .eq('tenant_id', tenant_id)
            .single();

        if (error || !tenant) {
            return NextResponse.json({ error: 'テナントが見つかりません' }, { status: 404 });
        }

        if (!tenant.web_access_enabled) {
            return NextResponse.json({ error: 'ポータルアクセスが無効になっています' }, { status: 403 });
        }

        if (tenant.web_access_password !== password) {
            return NextResponse.json({ error: 'パスワードが間違っています' }, { status: 401 });
        }

        // Create Session Token
        const token = await new SignJWT({ tenant_id: tenant.tenant_id, role: 'tenant_admin' })
            .setProtectedHeader({ alg: 'HS256' })
            .setExpirationTime('24h')
            .sign(SECRET_KEY);

        // Set Cookie
        const cookieStore = await cookies();
        cookieStore.set('tenant_session', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            path: '/',
            maxAge: 60 * 60 * 24, // 24 hours
            sameSite: 'lax'
        });

        return NextResponse.json({ success: true });
    } catch (e: any) {
        console.error('Portal login error:', e);
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
}
