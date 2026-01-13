import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';
import { cookies, headers } from 'next/headers';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rateLimit';

export async function POST(request: Request) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get request metadata for logging
    const headersList = await headers();
    const ip = headersList.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    const userAgent = headersList.get('user-agent') || 'unknown';

    // Rate Limiting: 5 login attempts per IP per minute (prevent brute force)
    const rateLimitKey = `portal_login:${ip}`;
    const rateCheck = checkRateLimit(rateLimitKey, RATE_LIMITS.PORTAL_LOGIN);
    if (!rateCheck.allowed) {
        console.log(`[Rate Limit] IP ${ip} exceeded login attempt limit`);
        return NextResponse.json({
            error: 'ログイン試行回数が上限に達しました。1分後に再度お試しください。'
        }, { status: 429 });
    }

    let tenant_id = 'unknown';

    try {
        const SECRET_KEY = new TextEncoder().encode(process.env.SUPABASE_SERVICE_ROLE_KEY);

        const body = await request.json();
        tenant_id = body.tenant_id || 'unknown';
        const password = body.password;

        if (!tenant_id || tenant_id === 'unknown' || !password) {
            await logLoginAttempt(supabase, tenant_id, 'failed', 'missing_credentials', ip, userAgent);
            return NextResponse.json({ error: 'IDとパスワードを入力してください' }, { status: 400 });
        }

        const { data: tenant, error } = await supabase
            .from('tenants')
            .select('tenant_id, web_access_password, web_access_enabled')
            .eq('tenant_id', tenant_id)
            .single();

        if (error || !tenant) {
            await logLoginAttempt(supabase, tenant_id, 'failed', 'tenant_not_found', ip, userAgent);
            return NextResponse.json({ error: 'テナントが見つかりません' }, { status: 404 });
        }

        if (!tenant.web_access_enabled) {
            await logLoginAttempt(supabase, tenant_id, 'failed', 'portal_disabled', ip, userAgent);
            return NextResponse.json({ error: 'ポータルアクセスが無効になっています' }, { status: 403 });
        }

        if (tenant.web_access_password !== password) {
            await logLoginAttempt(supabase, tenant_id, 'failed', 'wrong_password', ip, userAgent);
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

        // Log successful login
        await logLoginAttempt(supabase, tenant_id, 'success', null, ip, userAgent);

        return NextResponse.json({ success: true });
    } catch (e: any) {
        console.error('Portal login error:', e);
        await logLoginAttempt(supabase, tenant_id, 'error', e.message?.substring(0, 100), ip, userAgent);
        return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
    }
}

// Helper function to log login attempts
async function logLoginAttempt(
    supabase: any,
    tenant_id: string,
    status: 'success' | 'failed' | 'error',
    reason: string | null,
    ip: string,
    user_agent: string
) {
    try {
        await supabase.from('portal_login_logs').insert({
            tenant_id,
            status,
            reason,
            ip_address: ip,
            user_agent: user_agent.substring(0, 500),
            created_at: new Date().toISOString()
        });
    } catch (e) {
        // Don't fail login if logging fails, just console.error
        console.error('Failed to log login attempt:', e);
    }
}
