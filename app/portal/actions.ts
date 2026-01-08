'use server';

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import OpenAI from 'openai';
import { revalidatePath } from 'next/cache';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SECRET_KEY = new TextEncoder().encode(process.env.SUPABASE_SERVICE_ROLE_KEY); // Use a proper secret in prod

export async function loginTenant(formData: FormData) {
    const tenant_id = formData.get('tenant_id') as string;
    const password = formData.get('password') as string;

    if (!tenant_id || !password) {
        throw new Error('IDとパスワードを入力してください');
    }

    const { data: tenant } = await supabase
        .from('tenants')
        .select('tenant_id, web_access_password, web_access_enabled')
        .eq('tenant_id', tenant_id)
        .single();

    if (!tenant || !tenant.web_access_enabled) {
        throw new Error('ログインできません（アクセスが無効かIDが間違っています）');
    }

    if (tenant.web_access_password !== password) {
        throw new Error('パスワードが間違っています');
    }

    // Create Session
    const token = await new SignJWT({ tenant_id: tenant.tenant_id, role: 'tenant_admin' })
        .setProtectedHeader({ alg: 'HS256' })
        .setExpirationTime('24h')
        .sign(SECRET_KEY);

    const cookieStore = await cookies();
    cookieStore.set('tenant_session', token, { httpOnly: true, secure: true, path: '/' });

    redirect('/portal/dashboard');
}

export async function logoutTenant() {
    const cookieStore = await cookies();
    cookieStore.delete('tenant_session');
    redirect('/portal/login');
}

export async function getTenantSession() {
    const cookieStore = await cookies();
    const token = cookieStore.get('tenant_session')?.value;
    if (!token) return null;

    try {
        const { payload } = await jwtVerify(token, SECRET_KEY);
        return payload as { tenant_id: string; role: string };
    } catch {
        return null;
    }
}

async function verifyTenant() {
    const session = await getTenantSession();
    if (!session || session.role !== 'tenant_admin') {
        throw new Error('Unauthorized');
    }
    return session.tenant_id;
}

// --- Tenant Actions ---

export async function updateSystemPrompt(formData: FormData) {
    const tenant_id = await verifyTenant();
    const system_prompt = formData.get('system_prompt') as string;

    // Security check: ensure the form submits to the logged-in tenant
    const formTenantId = formData.get('tenant_id') as string;
    if (formTenantId && formTenantId !== tenant_id) throw new Error('Security Mismatch');

    const { error } = await supabase
        .from('tenants')
        .update({ system_prompt })
        .eq('tenant_id', tenant_id);

    if (error) throw new Error('更新エラー');
    revalidatePath('/portal/dashboard');
}

export async function addKnowledge(formData: FormData) {
    const tenant_id = await verifyTenant();
    const content = formData.get('content') as string;
    const category = formData.get('category') as string;

    if (!content.trim()) return;

    const embeddingResponse = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: content,
    });
    const embedding = embeddingResponse.data[0].embedding;

    const { error } = await supabase.from('knowledge_base').insert({
        tenant_id,
        content,
        category,
        embedding
    });
    if (error) throw new Error('保存エラー');
    revalidatePath('/portal/dashboard');
}

export async function deleteKnowledge(formData: FormData) {
    const tenant_id = await verifyTenant();
    const id = formData.get('id') as string;

    const { error } = await supabase
        .from('knowledge_base')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenant_id); // Ensure ownership

    if (error) throw new Error('削除エラー');
    revalidatePath('/portal/dashboard');
}

export async function importKnowledgeFromText(formData: FormData) {
    const tenant_id = await verifyTenant();
    const defaultCategory = formData.get('category') as string || 'FAQ';
    const text = formData.get('text') as string;

    if (!text || !text.trim()) return;

    const lines = text.split('\n');
    const finalChunks: { content: string, category: string }[] = [];

    let currentBuffer = '';
    let currentCategory = defaultCategory;
    const validCategories = ['FAQ', 'OFFER', 'PRICE', 'PROCESS', 'POLICY', 'CONTEXT'];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let detectedCat = null;
        for (const cat of validCategories) {
            const regex = new RegExp(`^(\\[?${cat})`, 'i');
            if (regex.test(trimmed)) {
                detectedCat = cat;
                break;
            }
        }

        if (detectedCat) {
            if (currentBuffer) {
                finalChunks.push({ content: currentBuffer, category: currentCategory });
            }
            currentBuffer = trimmed;
            currentCategory = detectedCat;
        } else {
            if (currentBuffer) {
                currentBuffer += '\n' + trimmed;
            } else {
                currentBuffer = trimmed;
            }
        }
    }
    if (currentBuffer) {
        finalChunks.push({ content: currentBuffer, category: currentCategory });
    }

    const validChunks = finalChunks.filter(c => c.content.length > 10);

    for (let i = 0; i < validChunks.length; i += 5) {
        const batch = validChunks.slice(i, i + 5);
        const inputs = batch.map(c => c.content.replace(/\n/g, ' '));
        const embeddingResponse = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: inputs,
        });

        const records = batch.map((item, idx) => ({
            tenant_id,
            category: item.category,
            content: item.content,
            embedding: embeddingResponse.data[idx].embedding
        }));

        const { error } = await supabase.from('knowledge_base').insert(records);
        if (error) console.error('Batch insert error', error);
    }
    revalidatePath('/portal/dashboard');
}
