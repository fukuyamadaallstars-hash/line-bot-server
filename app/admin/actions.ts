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
    if (!tenant_id) throw new Error('Tenant ID required');

    const context = formData.get('__context') as string;

    const updates: any = {
        updated_at: new Date().toISOString()
    };

    // List of text/select fields to check
    const stringFields = [
        'display_name', 'system_prompt', 'handoff_keywords',
        'google_sheet_id', 'staff_passcode', 'ai_model',
        'plan', 'model_option', 'additional_token_plan',
        'contract_start_date', 'next_billing_date'
    ];

    stringFields.forEach(field => {
        if (formData.has(field)) {
            const value = formData.get(field);
            // Input type="date" returns empty string if not set, which we might want to treat as null for DB date fields
            if ((field === 'contract_start_date' || field === 'next_billing_date') && value === '') {
                updates[field] = null;
            } else {
                updates[field] = value as string;
            }
        }
    });

    if (formData.has('monthly_token_limit')) {
        updates['monthly_token_limit'] = parseInt(formData.get('monthly_token_limit') as string) || 0;
    }

    // Handle checkboxes safely using context
    if (context === 'basic') {
        updates['is_active'] = formData.get('is_active') === 'on';
    }

    console.log('[Admin Update] Tenant:', tenant_id, 'Context:', context, 'Updates:', updates);

    const { error } = await supabase
        .from('tenants')
        .update(updates)
        .eq('tenant_id', tenant_id);

    if (error) {
        console.error('[Admin Update] DB Error:', error);
        throw new Error('更新に失敗しました: ' + error.message);
    }

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
