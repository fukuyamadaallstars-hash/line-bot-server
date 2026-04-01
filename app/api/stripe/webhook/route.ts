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

        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - parseInt(timestamp)) > 300) {
            console.error('[StripeWebhook] Timestamp too old');
            return false;
        }

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
 * 決済完了時に自動で purchasers テーブルにメアドを登録する
 */
export async function POST(request: Request) {
    console.log('[StripeWebhook] === Webhook received ===');

    const body = await request.text();
    const sig = request.headers.get('stripe-signature');

    console.log(`[StripeWebhook] Has signature: ${!!sig}`);
    console.log(`[StripeWebhook] Body length: ${body.length}`);

    if (!sig) {
        console.error('[StripeWebhook] No signature header');
        return NextResponse.json({ error: 'No signature' }, { status: 400 });
    }

    // 署名検証
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    console.log(`[StripeWebhook] Has webhook secret: ${!!webhookSecret}`);

    if (webhookSecret) {
        const isValid = verifyStripeSignature(body, sig, webhookSecret);
        console.log(`[StripeWebhook] Signature valid: ${isValid}`);
        if (!isValid) {
            console.error('[StripeWebhook] Invalid signature - rejecting');
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }
    } else {
        console.warn('[StripeWebhook] STRIPE_WEBHOOK_SECRET not set, skipping verification');
    }

    try {
        const event = JSON.parse(body);
        console.log(`[StripeWebhook] Event type: "${event.type}"`);

        // 決済完了イベントのみ処理
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;

            // メールアドレスを複数の場所から探す（Stripeのバージョンによって格納場所が異なる）
            const customerEmail = 
                session.customer_details?.email || 
                session.customer_email || 
                session.receipt_email ||
                session.customer?.email ||
                null;

            console.log(`[StripeWebhook] Session ID: ${session.id}`);
            console.log(`[StripeWebhook] customer_details: ${JSON.stringify(session.customer_details)}`);
            console.log(`[StripeWebhook] customer_email: ${session.customer_email}`);
            console.log(`[StripeWebhook] Extracted email: ${customerEmail}`);
            console.log(`[StripeWebhook] Payment status: ${session.payment_status}`);

            if (!customerEmail) {
                console.error('[StripeWebhook] ❌ No email found anywhere in session object');
                console.log(`[StripeWebhook] Full session keys: ${Object.keys(session).join(', ')}`);
                return NextResponse.json({ received: true, warning: 'no_email' });
            }

            const tenantId = session.metadata?.tenant_id || process.env.DEFAULT_TENANT_ID || 'BizBuddy';
            console.log(`[StripeWebhook] Tenant ID: ${tenantId}`);

            const supabase = getSupabaseAdmin();

            // 重複チェック
            const { data: existing, error: checkError } = await supabase
                .from('purchasers')
                .select('id')
                .eq('tenant_id', tenantId)
                .eq('email', customerEmail)
                .eq('is_used', false)
                .maybeSingle();

            if (checkError) {
                console.error('[StripeWebhook] ❌ DB check error:', checkError);
                return NextResponse.json({ error: 'DB check failed' }, { status: 500 });
            }

            if (existing) {
                console.log(`[StripeWebhook] ⏭️ Already registered (unused): ${customerEmail}`);
                return NextResponse.json({ received: true, status: 'already_exists' });
            }

            // purchasers テーブルに自動登録
            const { data: insertData, error: insertError } = await supabase
                .from('purchasers')
                .insert({
                    tenant_id: tenantId,
                    email: customerEmail,
                    is_used: false,
                })
                .select();

            if (insertError) {
                console.error('[StripeWebhook] ❌ Insert error:', insertError);
                return NextResponse.json({ error: 'DB insert failed' }, { status: 500 });
            }

            console.log(`[StripeWebhook] ✅ Successfully registered: ${customerEmail} -> ${tenantId}`, insertData);
        } else {
            console.log(`[StripeWebhook] ⏭️ Ignoring event type: ${event.type}`);
        }

        return NextResponse.json({ received: true });
    } catch (e: any) {
        console.error('[StripeWebhook] ❌ Processing error:', e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
