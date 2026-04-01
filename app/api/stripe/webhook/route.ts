import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

// Supabase初期化
function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase configuration missing');
    return createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

/**
 * Stripe Webhook の署名を検証する関数
 * stripe パッケージを使わず、Node.js の crypto で手動検証する
 */
function verifyStripeSignature(payload: string, sigHeader: string, secret: string): boolean {
    try {
        const parts = sigHeader.split(',');
        let timestamp = '';
        let signature = '';

        for (const part of parts) {
            const [key, value] = part.split('=');
            if (key === 't') timestamp = value;
            if (key === 'v1') signature = value;
        }

        if (!timestamp || !signature) return false;

        // タイムスタンプが5分以内かチェック（リプレイ攻撃対策）
        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - parseInt(timestamp)) > 300) {
            console.error('[StripeWebhook] Timestamp too old');
            return false;
        }

        // HMAC-SHA256 で署名を検証
        const signedPayload = `${timestamp}.${payload}`;
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(signedPayload)
            .digest('hex');

        return crypto.timingSafeEqual(
            Buffer.from(signature, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    } catch (e) {
        console.error('[StripeWebhook] Signature verification error:', e);
        return false;
    }
}

/**
 * Stripe Webhook エンドポイント
 * 決済完了時（checkout.session.completed）に自動で purchasers テーブルにメアドを登録する
 */
export async function POST(request: Request) {
    const body = await request.text();
    const sig = request.headers.get('stripe-signature');

    if (!sig) {
        console.error('[StripeWebhook] No signature header');
        return NextResponse.json({ error: 'No signature' }, { status: 400 });
    }

    // 署名検証
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (webhookSecret) {
        const isValid = verifyStripeSignature(body, sig, webhookSecret);
        if (!isValid) {
            console.error('[StripeWebhook] Invalid signature');
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }
    } else {
        console.warn('[StripeWebhook] STRIPE_WEBHOOK_SECRET not set, skipping verification (NOT SAFE FOR PRODUCTION)');
    }

    try {
        const event = JSON.parse(body);
        console.log(`[StripeWebhook] Event: ${event.type}`);

        // 決済完了イベントのみ処理
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const customerEmail = session.customer_details?.email || session.customer_email;

            if (!customerEmail) {
                console.error('[StripeWebhook] No email found in session');
                return NextResponse.json({ received: true, warning: 'no_email' });
            }

            // テナントIDの決定:
            // 方法1: Stripe決済リンクのメタデータに tenant_id を設定している場合
            // 方法2: デフォルトのテナントIDを使う（単一テナント運用の場合）
            const tenantId = session.metadata?.tenant_id || process.env.DEFAULT_TENANT_ID || 'BizBuddy';

            console.log(`[StripeWebhook] Payment completed: email=${customerEmail}, tenant=${tenantId}`);

            const supabase = getSupabaseAdmin();

            // 重複チェック: 同じメールアドレスが既に登録されていないか確認
            const { data: existing } = await supabase
                .from('purchasers')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('email', customerEmail)
                .eq('is_used', false)
                .maybeSingle();

            if (existing) {
                console.log(`[StripeWebhook] Email already registered (unused): ${customerEmail}`);
                return NextResponse.json({ received: true, status: 'already_exists' });
            }

            // purchasers テーブルに自動登録
            const { error: insertError } = await supabase
                .from('purchasers')
                .insert({
                    tenant_id: tenantId,
                    email: customerEmail,
                    is_used: false,
                });

            if (insertError) {
                console.error('[StripeWebhook] Insert error:', insertError);
                return NextResponse.json({ error: 'DB insert failed' }, { status: 500 });
            }

            console.log(`[StripeWebhook] ✅ Registered: ${customerEmail} -> ${tenantId}`);
        }

        // Stripe は 200 を返さないとリトライし続けるため、必ず 200 を返す
        return NextResponse.json({ received: true });
    } catch (e: any) {
        console.error('[StripeWebhook] Processing error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
