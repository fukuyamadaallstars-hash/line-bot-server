"use server";

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import OpenAI from 'openai';
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 共通認証関数 (Cookieチェック)
async function verifyAdmin() {
    const cookieStore = await cookies();
    const token = cookieStore.get('admin_session')?.value;
    if (!token) throw new Error('Unauthorized');

    const secret = new TextEncoder().encode(process.env.ADMIN_PASSWORD);
    try {
        await jwtVerify(token, secret);
    } catch (e) {
        throw new Error('Unauthorized');
    }
}

export async function updateTenant(formData: FormData) {
    await verifyAdmin();

    const tenant_id = formData.get('tenant_id') as string;
    const display_name = formData.get('display_name') as string;
    const system_prompt = formData.get('system_prompt') as string;
    const is_active = formData.get('is_active') === 'on';
    const monthly_token_limit = parseInt(formData.get('monthly_token_limit') as string) || 0;
    const handoff_keywords = formData.get('handoff_keywords') as string;
    const google_sheet_id = formData.get('google_sheet_id') as string;
    const staff_passcode = formData.get('staff_passcode') as string;
    const ai_model = formData.get('ai_model') as string;

    // 契約・請求情報
    const plan = formData.get('plan') as string;
    const model_option = formData.get('model_option') as string;
    const additional_token_plan = formData.get('additional_token_plan') as string;
    const contract_start_date = formData.get('contract_start_date') as string || null;
    const next_billing_date = formData.get('next_billing_date') as string || null;

    console.log('[Admin Update] Received:', { tenant_id, ai_model, plan, contract_start_date }); // ★受信データ確認ログ

    const { error } = await supabase
        .from('tenants')
        .update({
            display_name,
            system_prompt,
            is_active,
            monthly_token_limit,
            handoff_keywords,
            google_sheet_id,
            staff_passcode,
            ai_model,
            // 契約情報
            plan,
            model_option,
            additional_token_plan,
            contract_start_date,
            next_billing_date,
            updated_at: new Date().toISOString()
        })
        .eq('tenant_id', tenant_id);

    if (error) {
        console.error('[Admin Update] DB Error:', error); // ★DBエラー詳細ログ
        throw new Error('更新に失敗しました: ' + error.message);
    }

    console.log('[Admin Update] Success');
    revalidatePath('/admin');
}

// ★緊急用: トークン単発追加 (+1M)
export async function quickAddToken(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;

    // 現在の設定を取得
    const { data: tenant } = await supabase.from('tenants').select('monthly_token_limit').eq('tenant_id', tenant_id).single();
    if (!tenant) throw new Error('Tenant not found');

    const newLimit = (tenant.monthly_token_limit || 0) + 1000000;

    const { error } = await supabase.from('tenants').update({ monthly_token_limit: newLimit }).eq('tenant_id', tenant_id);
    if (error) throw new Error('追加エラー');

    revalidatePath('/admin');
}

export async function addKnowledge(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;
    const content = formData.get('content') as string;
    const category = formData.get('category') as string;
    if (!content.trim()) return;

    const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: content,
    });
    const embedding = embeddingResponse.data[0].embedding;

    const { error } = await supabase.from('knowledge_base').insert({ tenant_id, content, category, embedding });
    if (error) throw new Error('保存エラー');
    revalidatePath('/admin');
}

export async function deleteKnowledge(formData: FormData) {
    await verifyAdmin();
    const id = formData.get('id') as string;
    const { error } = await supabase.from('knowledge_base').delete().eq('id', id);
    if (error) throw new Error('削除エラー');
    revalidatePath('/admin');
}

export async function resumeAi(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;
    const user_id = formData.get('user_id') as string;
    const { error } = await supabase.from('users').update({ is_handoff_active: false, status: 'normal' }).eq('tenant_id', tenant_id).eq('user_id', user_id);
    if (error) throw new Error('再開エラー');
    revalidatePath('/admin');
}
