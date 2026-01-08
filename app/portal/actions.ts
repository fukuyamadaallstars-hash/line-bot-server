'use server';

import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import OpenAI from 'openai';
import { revalidatePath } from 'next/cache';
const pdf = require('pdf-parse');
import mammoth from 'mammoth';
import Papa from 'papaparse';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SECRET_KEY = new TextEncoder().encode(process.env.SUPABASE_SERVICE_ROLE_KEY); // Use a proper secret in prod

function recursiveSplit(text: string, maxLength: number = 500): string[] {
    if (text.length <= maxLength) return [text];
    const splitPoints = ["\n\n", "\n", "。", "、", " ", ""];
    for (const splitPoint of splitPoints) {
        if (text.includes(splitPoint)) {
            const parts = text.split(splitPoint);
            let currentChunk = "";
            const chunks = [];
            for (const part of parts) {
                if ((currentChunk + splitPoint + part).length > maxLength) {
                    if (currentChunk) chunks.push(currentChunk);
                    currentChunk = part;
                } else {
                    currentChunk += (currentChunk ? splitPoint : "") + part;
                }
            }
            if (currentChunk) chunks.push(currentChunk);
            // Check if any chunk is still too big
            if (chunks.some(c => c.length > maxLength)) continue;
            return chunks;
        }
    }
    const chunks = [];
    for (let i = 0; i < text.length; i += maxLength) {
        chunks.push(text.substring(i, i + maxLength));
    }
    return chunks;
}

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

    // Fetch tenant's model preference (Read-only for tenant)
    const { data: tenant } = await supabase.from('tenants').select('embedding_model').eq('tenant_id', tenant_id).single();
    const model = tenant?.embedding_model || 'text-embedding-3-small';

    const embeddingResponse = await openai.embeddings.create({
        model: model,
        input: content,
    });
    const vec = embeddingResponse.data[0].embedding;

    const data: any = {
        tenant_id,
        content,
        category,
    };
    if (model === 'text-embedding-3-large') {
        data.embedding_large = vec;
    } else {
        data.embedding = vec;
    }

    const { error } = await supabase.from('knowledge_base').insert(data);
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

    // Fetch tenant's model preference (Read-only for tenant)
    const { data: tenant } = await supabase.from('tenants').select('embedding_model').eq('tenant_id', tenant_id).single();
    const model = tenant?.embedding_model || 'text-embedding-3-small';

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
            model: model,
            input: inputs,
        });

        const records = batch.map((item, idx) => {
            const r: any = {
                tenant_id,
                category: item.category,
                content: item.content
            };
            if (model === 'text-embedding-3-large') {
                r.embedding_large = embeddingResponse.data[idx].embedding;
            } else {
                r.embedding = embeddingResponse.data[idx].embedding;
            }
            return r;
        });

        const { error } = await supabase.from('knowledge_base').insert(records);
        if (error) console.error('Batch insert error', error);
    }
    revalidatePath('/portal/dashboard');
}

export async function importKnowledgeFromFile(formData: FormData) {
    const tenant_id = await verifyTenant(); // Tenant Auth
    const category = formData.get('category') as string || 'FAQ';
    const file = formData.get('file') as File;

    if (!file || file.size === 0) throw new Error('File is required');

    // Fetch tenant's model preference (Read-only for tenant)
    const { data: tenant } = await supabase.from('tenants').select('embedding_model').eq('tenant_id', tenant_id).single();
    const model = tenant?.embedding_model || 'text-embedding-3-small';

    let textData = "";

    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const data = await pdf(buffer);
        textData = data.text;
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const result = await mammoth.extractRawText({ buffer });
        textData = result.value;
    } else if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true });
        const rows = parsed.data as any[];
        const chunks: { content: string, category: string }[] = [];

        for (const row of rows) {
            const q = row['Question'] || row['question'] || row['質問'] || row['Q'];
            const a = row['Answer'] || row['answer'] || row['回答'] || row['A'];
            const cat = row['Category'] || row['category'] || row['カテゴリ'] || category;
            if (q && a) {
                chunks.push({ content: `Q: ${q}\nA: ${a}`, category: cat });
            } else {
                const content = Object.values(row).join('\n');
                if (content.trim()) chunks.push({ content, category: cat });
            }
        }

        for (let i = 0; i < chunks.length; i += 5) {
            const batch = chunks.slice(i, i + 5);
            const inputs = batch.map(c => c.content.replace(/\n/g, ' '));
            const embeddingResponse = await openai.embeddings.create({
                model: model,
                input: inputs,
            });
            const records = batch.map((item, idx) => {
                const r: any = {
                    tenant_id,
                    category: item.category,
                    content: item.content
                };
                if (model === 'text-embedding-3-large') {
                    r.embedding_large = embeddingResponse.data[idx].embedding;
                } else {
                    r.embedding = embeddingResponse.data[idx].embedding;
                }
                return r;
            });
            const { error } = await supabase.from('knowledge_base').insert(records);
            if (error) console.error('CSV Batch Error', error);
        }
        revalidatePath('/portal/dashboard');
        return;
    } else {
        textData = await file.text();
    }

    if (!textData.trim()) throw new Error('No text extracted from file');
    const chunks = recursiveSplit(textData);

    for (let i = 0; i < chunks.length; i += 5) {
        const batch = chunks.slice(i, i + 5);
        const inputs = batch.map(c => c.replace(/\n/g, ' '));

        const embeddingResponse = await openai.embeddings.create({
            model: model,
            input: inputs,
        });

        const records = batch.map((content, idx) => {
            const r: any = {
                tenant_id,
                category,
                content
            };
            if (model === 'text-embedding-3-large') {
                r.embedding_large = embeddingResponse.data[idx].embedding;
            } else {
                r.embedding = embeddingResponse.data[idx].embedding;
            }
            return r;
        });

        const { error } = await supabase.from('knowledge_base').insert(records);
        if (error) console.error('Batch insert error', error);
    }
    revalidatePath('/portal/dashboard');
}
// ... (existing functions)

export async function importKnowledgeFromFile(formData: FormData) {
    const tenant_id = await verifyTenant(); // Tenant Auth
    const category = formData.get('category') as string || 'FAQ';
    const file = formData.get('file') as File;

    if (!file || file.size === 0) throw new Error('File is required');

    // Fetch tenant's model preference (Read-only for tenant)
    const { data: tenant } = await supabase.from('tenants').select('embedding_model').eq('tenant_id', tenant_id).single();
    const model = tenant?.embedding_model || 'text-embedding-3-small';

    let textData = "";

    if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const data = await pdf(buffer);
        textData = data.text;
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const result = await mammoth.extractRawText({ buffer });
        textData = result.value;
    } else if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
        const text = await file.text();
        const parsed = Papa.parse(text, { header: true });
        const rows = parsed.data as any[];
        const chunks: { content: string, category: string }[] = [];

        for (const row of rows) {
            const q = row['Question'] || row['question'] || row['質問'] || row['Q'];
            const a = row['Answer'] || row['answer'] || row['回答'] || row['A'];
            const cat = row['Category'] || row['category'] || row['カテゴリ'] || category;
            if (q && a) {
                chunks.push({ content: `Q: ${q}\nA: ${a}`, category: cat });
            } else {
                const content = Object.values(row).join('\n');
                if (content.trim()) chunks.push({ content, category: cat });
            }
        }

        for (let i = 0; i < chunks.length; i += 5) {
            const batch = chunks.slice(i, i + 5);
            const inputs = batch.map(c => c.content.replace(/\n/g, ' '));
            const embeddingResponse = await openai.embeddings.create({
                model: model,
                input: inputs,
            });
            const records = batch.map((item, idx) => {
                const r: any = {
                    tenant_id,
                    category: item.category,
                    content: item.content
                };
                if (model === 'text-embedding-3-large') {
                    r.embedding_large = embeddingResponse.data[idx].embedding;
                } else {
                    r.embedding = embeddingResponse.data[idx].embedding;
                }
                return r;
            });
            const { error } = await supabase.from('knowledge_base').insert(records);
            if (error) console.error('CSV Batch Error', error);
        }
        revalidatePath('/portal/dashboard');
        return;
    } else {
        textData = await file.text();
    }

    if (!textData.trim()) throw new Error('No text extracted from file');
    const chunks = recursiveSplit(textData);

    for (let i = 0; i < chunks.length; i += 5) {
        const batch = chunks.slice(i, i + 5);
        const inputs = batch.map(c => c.replace(/\n/g, ' '));

        const embeddingResponse = await openai.embeddings.create({
            model: model,
            input: inputs,
        });

        const records = batch.map((content, idx) => {
            const r: any = {
                tenant_id,
                category,
                content
            };
            if (model === 'text-embedding-3-large') {
                r.embedding_large = embeddingResponse.data[idx].embedding;
            } else {
                r.embedding = embeddingResponse.data[idx].embedding;
            }
            return r;
        });

        const { error } = await supabase.from('knowledge_base').insert(records);
        if (error) console.error('Batch insert error', error);
    }
    revalidatePath('/portal/dashboard');
}

