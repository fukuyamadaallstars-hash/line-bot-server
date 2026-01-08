"use server";

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import OpenAI from 'openai';
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
const pdf = require('pdf-parse-new');
import mammoth from 'mammoth';
import Papa from 'papaparse';

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
        'embedding_model',
        'contract_start_date', 'next_billing_date',
        // Finance & Contact Info
        'company_name', 'billing_contact_name', 'billing_email',
        'billing_phone', 'billing_address', 'billing_department', 'billing_subject',
        'billing_status', 'bank_transfer_name',
        'web_access_password'
    ];

    const numberFields = [
        'monthly_token_limit', 'billing_cycle_day', 'payment_term_days',
        'kb_limit', 'kb_update_limit'
    ];

    stringFields.forEach(field => {
        if (formData.has(field)) {
            updates[field] = formData.get(field) as string;
        }
    });

    if (formData.has('web_access_enabled_check')) {
        updates['web_access_enabled'] = formData.get('web_access_enabled') === 'on';
    }


    numberFields.forEach(field => {
        if (formData.has(field)) {
            updates[field] = parseInt(formData.get(field) as string) || 0;
        }
    });

    // Handle checkboxes safely using context
    if (context === 'basic') {
        updates['is_active'] = formData.get('is_active') === 'on';
    }

    // Handle booleans (reservation_enabled)
    if (formData.has('reservation_enabled_present')) { // Check helper field to know if checkbox was visible
        updates['reservation_enabled'] = formData.get('reservation_enabled') === 'on';
    }

    // Handle JSON fields (if sent as JSON strings)
    if (formData.has('next_contract_changes')) {
        try {
            updates['next_contract_changes'] = JSON.parse(formData.get('next_contract_changes') as string);
        } catch (e) { console.error('JSON parse error', e); }
    }
    if (formData.has('beta_perks')) {
        try {
            updates['beta_perks'] = JSON.parse(formData.get('beta_perks') as string);
        } catch (e) { console.error('JSON parse error', e); }
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

export async function deleteAllKnowledge(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;
    // Safety check: ensure tenant_id is provided
    if (!tenant_id) return;

    const { error } = await supabase.from('knowledge_base').delete().eq('tenant_id', tenant_id);
    if (error) throw new Error('一括削除エラー: ' + error.message);
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

export async function addTokenPurchase(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;
    const amount = parseInt(formData.get('amount') as string) || 1000000;
    const price = parseInt(formData.get('price') as string) || 4500;
    const status = formData.get('status') as string || 'pending';

    const { error } = await supabase.from('token_purchases').insert({
        tenant_id,
        amount,
        price,
        status,
        purchase_date: new Date().toISOString()
    });

    if (error) throw new Error('購入記録の追加に失敗: ' + error.message);
    revalidatePath('/admin');
}

// TODO: Implement Invoice Actions properly
export async function createInvoiceStub(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;

    // Simple draft generation
    const target_month = new Date().toISOString().slice(0, 7); // YYYY-MM
    const invoice_number = `INV-${target_month}-${Math.floor(Math.random() * 1000)}`;

    const { error } = await supabase.from('invoices').insert({
        tenant_id,
        invoice_number,
        target_month,
        amount_total: 0,
        status: 'draft',
        details: []
    });

    // ...existing code...
    if (error) throw new Error('請求書作成エラー: ' + error.message);
    revalidatePath('/admin');
}

export async function importKnowledgeFromText(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;
    const defaultCategory = formData.get('category') as string || 'FAQ';
    const text = formData.get('text') as string;

    if (!text || !text.trim()) return;

    // Split line by line to support strict separation based on headers
    const lines = text.split('\n');

    const finalChunks: { content: string, category: string }[] = [];

    let currentBuffer = '';
    let currentCategory = defaultCategory;
    const validCategories = ['FAQ', 'OFFER', 'PRICE', 'PROCESS', 'POLICY', 'CONTEXT'];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Detect if this line looks like a start of a new item
        // e.g. "FAQ", "[FAQ]", "[FAQ-01]", "FAQ:", "【FAQ】"
        let detectedCat = null;

        for (const cat of validCategories) {
            // Check if line STARTS with category (ignoring brackets, case insensitive)
            // ^\[?CAT matches "CAT", "[CAT", "[CAT-01]"
            const regex = new RegExp(`^(\\[?${cat})`, 'i');
            if (regex.test(trimmed)) {
                detectedCat = cat;
                break;
            }
        }

        if (detectedCat) {
            // Found a start of a new block -> Flush previous buffer
            if (currentBuffer) {
                finalChunks.push({ content: currentBuffer, category: currentCategory });
            }
            // Start new buffer
            currentBuffer = trimmed;
            currentCategory = detectedCat;
        } else {
            // Continuation of previous block
            if (currentBuffer) {
                // Append with newline
                currentBuffer += '\n' + trimmed;
            } else {
                // No header yet (start of file?), just start buffering
                currentBuffer = trimmed;
            }
        }
    }

    // Flush remaining buffer
    if (currentBuffer) {
        finalChunks.push({ content: currentBuffer, category: currentCategory });
    }

    // Filter out very short chunks (likely just headers like "FAQ" or "PROCESS")
    // Use 15 chars to be safe (e.g. "[FAQ-01] Title" is usually longer than 10-15)
    // "[PROCESS]" is 9 chars. "[FAQ-01]" is 8 chars.
    // User content "[FAQ-01] 1分デモ" is > 10 chars.
    const validChunks = finalChunks.filter(c => c.content.length > 10);

    // Process in batches
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

    revalidatePath('/admin');
}

// ★ヘルパー: テキスト分割 (Recursive Character Text Splitter 相当)
function recursiveSplit(text: string, chunkSize: number = 800, overlap: number = 200): string[] {
    if (text.length <= chunkSize) return [text];

    const separators = ["\n\n", "\n", "。", "、", " ", ""];
    let finalValidChunks: string[] = [];
    let currentChunk = "";

    // Step 1: Split by paragraphs
    const paragraphs = text.split(/\n\n+/);

    for (const paragraph of paragraphs) {
        if ((currentChunk.length + paragraph.length) < chunkSize) {
            currentChunk += (currentChunk ? "\n\n" : "") + paragraph;
        } else {
            if (currentChunk) finalValidChunks.push(currentChunk);

            if (paragraph.length > chunkSize) {
                let tempPara = paragraph;
                while (tempPara.length > 0) {
                    if (tempPara.length <= chunkSize) {
                        currentChunk = tempPara;
                        tempPara = "";
                    } else {
                        let splitIndex = chunkSize;
                        const puncs = ["。", "！", "？", "．", "\n", "、"];
                        for (let i = chunkSize; i > chunkSize - 200; i--) {
                            if (puncs.includes(tempPara[i])) {
                                splitIndex = i + 1;
                                break;
                            }
                        }
                        finalValidChunks.push(tempPara.substring(0, splitIndex));
                        tempPara = tempPara.substring(splitIndex);
                    }
                }
            } else {
                currentChunk = paragraph;
            }
        }
    }
    if (currentChunk) finalValidChunks.push(currentChunk);

    return finalValidChunks;
}

export async function importKnowledgeFromFile(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;
    const category = formData.get('category') as string || 'FAQ';
    const file = formData.get('file') as File;

    if (!file || file.size === 0) throw new Error('File is required');

    let textData = "";

    // File type detection
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
            if (error) console.error('CSV Batch Error', error);
        }
        revalidatePath('/admin');
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
            model: "text-embedding-3-small",
            input: inputs,
        });

        const records = batch.map((content, idx) => ({
            tenant_id,
            category,
            content,
            embedding: embeddingResponse.data[idx].embedding
        }));

        const { error } = await supabase.from('knowledge_base').insert(records);
        if (error) console.error('Batch insert error', error);
    }

    revalidatePath('/admin');
}

export async function reEmbedAllKnowledge(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;

    // 1. Get current setting
    const { data: tenant } = await supabase.from('tenants').select('embedding_model').eq('tenant_id', tenant_id).single();
    const model = tenant?.embedding_model || 'text-embedding-3-small';

    // 2. Fetch all knowledge
    const { data: kbList, error: fetchError } = await supabase
        .from('knowledge_base')
        .select('id, content')
        .eq('tenant_id', tenant_id);

    if (fetchError || !kbList || kbList.length === 0) return; // Nothing to do

    console.log(`[Re-Embed] Starting for ${tenant_id} with ${model}. Count: ${kbList.length}`);

    // 3. Process in batches
    const BATCH_SIZE = 10;
    for (let i = 0; i < kbList.length; i += BATCH_SIZE) {
        const batch = kbList.slice(i, i + BATCH_SIZE);
        const inputs = batch.map(item => item.content.replace(/\n/g, ' '));

        try {
            const embeddingResponse = await openai.embeddings.create({
                model: model,
                input: inputs,
            });

            // Update each record individually
            for (let j = 0; j < batch.length; j++) {
                const item = batch[j];
                const vec = embeddingResponse.data[j].embedding;

                const updates: any = {};
                if (model === 'text-embedding-3-large') {
                    updates.embedding_large = vec;
                    // clean up small? maybe not strictly required but safer to leave null or update logic
                    // updates.embedding = null; 
                } else {
                    updates.embedding = vec;
                    // updates.embedding_large = null;
                }

                await supabase.from('knowledge_base').update(updates).eq('id', item.id);
            }
        } catch (e) {
            console.error('[Re-Embed] Error in batch', e);
        }
    }
    console.log('[Re-Embed] Complete');
    revalidatePath('/admin');
}
