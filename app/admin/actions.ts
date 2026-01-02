"use server";

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import OpenAI from 'openai';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// テナント基本情報の更新
export async function updateTenant(formData: FormData) {
    const adminKey = formData.get('admin_key') as string;
    const correctPassword = process.env.ADMIN_PASSWORD;

    if (!correctPassword || adminKey !== correctPassword) {
        throw new Error('Unauthorized');
    }

    const tenant_id = formData.get('tenant_id') as string;
    const display_name = formData.get('display_name') as string;
    const system_prompt = formData.get('system_prompt') as string;
    const is_active = formData.get('is_active') === 'on';
    const monthly_token_limit = parseInt(formData.get('monthly_token_limit') as string) || 0;

    const { error } = await supabase
        .from('tenants')
        .update({
            display_name,
            system_prompt,
            is_active,
            monthly_token_limit,
            updated_at: new Date().toISOString()
        })
        .eq('tenant_id', tenant_id);

    if (error) throw new Error('更新に失敗しました');
    revalidatePath('/admin');
}

// ナレッジ（知識）の追加
export async function addKnowledge(formData: FormData) {
    const adminKey = formData.get('admin_key') as string;
    const correctPassword = process.env.ADMIN_PASSWORD;
    if (!correctPassword || adminKey !== correctPassword) throw new Error('Unauthorized');

    const tenant_id = formData.get('tenant_id') as string;
    const content = formData.get('content') as string;
    const category = formData.get('category') as string;

    if (!content.trim()) return;

    const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: content,
    });

    const embedding = embeddingResponse.data[0].embedding;

    const { error } = await supabase
        .from('knowledge_base')
        .insert({ tenant_id, content, category, embedding });

    if (error) throw new Error('ナレッジの保存に失敗しました');
    revalidatePath('/admin');
}

// ナレッジの削除
export async function deleteKnowledge(formData: FormData) {
    const adminKey = formData.get('admin_key') as string;
    const correctPassword = process.env.ADMIN_PASSWORD;
    if (!correctPassword || adminKey !== correctPassword) throw new Error('Unauthorized');

    const id = formData.get('id') as string;
    const { error } = await supabase.from('knowledge_base').delete().eq('id', id);
    if (error) throw new Error('削除に失敗しました');
    revalidatePath('/admin');
}

// AI対応の再開（有人モード終了）
export async function resumeAi(formData: FormData) {
    const adminKey = formData.get('admin_key') as string;
    const correctPassword = process.env.ADMIN_PASSWORD;
    if (!correctPassword || adminKey !== correctPassword) throw new Error('Unauthorized');

    const tenant_id = formData.get('tenant_id') as string;
    const user_id = formData.get('user_id') as string;

    const { error } = await supabase
        .from('users')
        .update({ is_handoff_active: false, status: 'normal' })
        .eq('tenant_id', tenant_id)
        .eq('user_id', user_id);

    if (error) throw new Error('再開に失敗しました');
    revalidatePath('/admin');
}
