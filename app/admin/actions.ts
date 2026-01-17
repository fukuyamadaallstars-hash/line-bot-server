"use server";

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import OpenAI from 'openai';
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import mammoth from 'mammoth';
import Papa from 'papaparse';
import { encrypt, decrypt } from '@/lib/crypto';
// import * as pdfjsLib from 'pdfjs-dist'; // Disabled - causes Vercel serverless issues

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

    // Handle portal permission checkboxes
    if (formData.has('portal_permissions_present')) {
        updates['portal_allow_prompt_edit'] = formData.get('portal_allow_prompt_edit') === 'on';
        updates['portal_allow_knowledge_edit'] = formData.get('portal_allow_knowledge_edit') === 'on';
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

    // Encrypt sensitive fields
    if (updates['line_channel_access_token']) updates['line_channel_access_token'] = encrypt(updates['line_channel_access_token']);
    if (updates['openai_api_key']) updates['openai_api_key'] = encrypt(updates['openai_api_key']);
    if (updates['google_sheet_id']) updates['google_sheet_id'] = encrypt(updates['google_sheet_id']);
    if (updates['line_channel_secret']) updates['line_channel_secret'] = encrypt(updates['line_channel_secret']);

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

// ★テナント停止/再開
export async function toggleTenantActive(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;
    const action = formData.get('action') as string; // 'pause' or 'resume'

    const is_active = action === 'resume';

    const { error } = await supabase.from('tenants').update({ is_active }).eq('tenant_id', tenant_id);
    if (error) throw new Error('ステータス変更エラー');

    revalidatePath('/admin');
}

// ★新規テナント作成
export async function createTenant(formData: FormData) {
    await verifyAdmin();
    const tenant_id = formData.get('tenant_id') as string;
    const display_name = formData.get('display_name') as string;
    const plan = formData.get('plan') as string || 'Lite';

    if (!tenant_id || !display_name) {
        throw new Error('テナントIDと表示名は必須です');
    }

    // 既存チェック
    const { data: existing } = await supabase.from('tenants').select('tenant_id').eq('tenant_id', tenant_id).single();
    if (existing) throw new Error('このテナントIDは既に存在します');

    // デフォルト設定で作成
    const defaultPrompt = `あなたは${display_name}のAIアシスタントです。お客様からの問い合わせに丁寧に対応してください。`;

    const { error } = await supabase.from('tenants').insert({
        tenant_id,
        display_name,
        plan,
        is_active: false, // 初期設定完了まで無効
        monthly_token_limit: 3000000, // デフォルト300万トークン
        system_prompt: defaultPrompt,
        ai_model: 'gpt-4o-mini',
        embedding_model: 'text-embedding-3-small',
        portal_allow_prompt_edit: false,
        portal_allow_knowledge_edit: false,
        created_at: new Date().toISOString(),
    });

    if (error) {
        console.error('[createTenant] Error:', error);
        throw new Error('テナント作成エラー: ' + error.message);
    }

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

    console.log(`[Knowledge Import] 開始: tenant=${tenant_id}, テキスト長=${text?.length || 0}文字`);

    if (!text || !text.trim()) {
        console.log('[Knowledge Import] エラー: テキストが空です');
        return;
    }

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
            // Match pattern: ^\[?CAT (e.g. [OFFER, OFFER)
            // We want to verify it's a header line.
            // Strict regex: Start with optional [, then Category Name
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
            // Start new buffer with this line
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

    console.log(`[Knowledge Import] 初期チャンク数: ${finalChunks.length}`);

    // Filter out very short chunks (likely just headers like "FAQ" or "PROCESS")
    let validChunks = finalChunks.filter(c => c.content.length > 10);
    console.log(`[Knowledge Import] 有効チャンク数 (10文字以上): ${validChunks.length}`);

    // ★ 強制分割: 巨大チャンク（3000文字以上）は事前に分割
    const MAX_CHUNK_SIZE = 3000;
    const preSplitChunks: { content: string, category: string }[] = [];
    for (const chunk of validChunks) {
        if (chunk.content.length <= MAX_CHUNK_SIZE) {
            preSplitChunks.push(chunk);
        } else {
            // 強制分割
            const parts = recursiveSplit(chunk.content, MAX_CHUNK_SIZE, 200);
            console.log(`[Knowledge Import] 巨大チャンク(${chunk.content.length}文字)を${parts.length}個に分割`);
            for (const part of parts) {
                preSplitChunks.push({ content: part, category: chunk.category });
            }
        }
    }
    validChunks = preSplitChunks;
    console.log(`[Knowledge Import] 分割後チャンク数: ${validChunks.length}`);

    // ★ AI自動Q&A生成: タグなしの長文をQ&A形式に変換
    const processedChunks: { content: string, category: string }[] = [];


    for (const chunk of validChunks) {
        // タグ付きで短い（800文字以下）ならそのまま
        if (chunk.content.length <= 800) {
            processedChunks.push(chunk);
            continue;
        }

        // 長文の場合はAIでQ&A生成を試みる
        try {
            console.log(`[AI Q&A生成] 長文を変換中... (${chunk.content.length}文字)`);

            // 長すぎる場合は分割して処理（GPT-4oのコンテキスト制限対策）
            const textParts = chunk.content.length > 6000
                ? recursiveSplit(chunk.content, 5000, 200)
                : [chunk.content];

            for (const textPart of textParts) {
                const qaResponse = await openai.chat.completions.create({
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: `あなたはFAQ生成とカテゴリ分類の専門家です。
与えられたテキストから、ユーザーが質問しそうな内容をQ&A形式で抽出し、適切なカテゴリに分類してください。

カテゴリ一覧：
- FAQ: よくある質問、一般的な疑問
- OFFER: サービス内容、提供価値、特徴
- PRICE: 料金、費用、支払い条件
- PROCESS: 手順、流れ、使い方
- POLICY: 方針、ルール、注意事項
- CONTEXT: 背景情報、補足説明

出力形式（JSON配列）：
[
  {"q": "質問内容", "a": "回答内容", "category": "PRICE"},
  {"q": "質問内容", "a": "回答内容", "category": "OFFER"}
]

ルール：
- 1つのテキストから3〜10個程度のQ&Aを生成
- 具体的で検索しやすい質問を作成
- 抽象的な内容でも「〇〇についての考え方」などQ&A化
- 料金、サービス内容、連絡先は必ずQ&A化
- 必ず有効なJSON配列で出力（それ以外のテキストは不要）`
                        },
                        {
                            role: "user",
                            content: `以下のテキストからQ&Aを生成し、カテゴリ分類してください：\n\n${textPart}`
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 2500,
                    response_format: { type: "json_object" }
                });

                const qaRaw = qaResponse.choices[0]?.message?.content || "{}";
                console.log(`[AI Q&A生成] レスポンス長: ${qaRaw.length}文字, 先頭: ${qaRaw.substring(0, 100)}...`);

                try {
                    // JSONパース
                    let qaData = JSON.parse(qaRaw);
                    console.log(`[AI Q&A生成] パース成功, 型: ${typeof qaData}, isArray: ${Array.isArray(qaData)}`);

                    // 配列でない場合は配列プロパティを探す
                    if (!Array.isArray(qaData)) {
                        // 様々なキー名を試す
                        const possibleKeys = ['qa', 'items', 'questions', 'data', 'results', 'faqs', 'qas', 'content'];
                        for (const key of possibleKeys) {
                            if (qaData[key] && Array.isArray(qaData[key])) {
                                console.log(`[AI Q&A生成] 配列を "${key}" キーから取得`);
                                qaData = qaData[key];
                                break;
                            }
                        }
                        // それでも配列でなければ、Object.valuesから最初の配列を探す
                        if (!Array.isArray(qaData)) {
                            const values = Object.values(qaData);
                            const firstArray = values.find(v => Array.isArray(v));
                            if (firstArray) {
                                console.log(`[AI Q&A生成] Object.valuesから配列を発見`);
                                qaData = firstArray;
                            } else {
                                // 単一Q&Aオブジェクト（配列ではない）の場合
                                if (qaData.q && qaData.a) {
                                    console.log(`[AI Q&A生成] 単一Q&Aオブジェクトを検出`);
                                    qaData = [qaData]; // 配列にラップ
                                } else {
                                    console.log(`[AI Q&A生成] 配列が見つからない, keys: ${Object.keys(qaData).join(', ')}`);
                                    qaData = [];
                                }
                            }
                        }
                    }

                    const beforeCount = processedChunks.length;
                    for (const item of qaData) {
                        if (item.q && item.a) {
                            const validCategories = ['FAQ', 'OFFER', 'PRICE', 'PROCESS', 'POLICY', 'CONTEXT'];
                            const category = validCategories.includes(item.category?.toUpperCase())
                                ? item.category.toUpperCase()
                                : 'FAQ';

                            processedChunks.push({
                                content: `Q: ${item.q}\nA: ${item.a}`,
                                category: category
                            });
                        }
                    }
                    const addedCount = processedChunks.length - beforeCount;

                    // フォールバック: Q&Aが0件の場合、元テキストをそのまま登録
                    if (addedCount === 0) {
                        console.log(`[AI Q&A生成] 0件のため、元テキストをそのまま登録 (${textPart.length}文字)`);
                        processedChunks.push({
                            content: textPart,
                            category: chunk.category
                        });
                    }
                } catch (parseError) {
                    console.error('[JSON Parse Error]', parseError);
                    // フォールバック: テキストとして処理
                    const qaBlocks = qaRaw.split(/\n\n+/).filter(b => b.trim());
                    let found = false;
                    for (const block of qaBlocks) {
                        if (block.includes("Q:") && block.includes("A:")) {
                            processedChunks.push({
                                content: block.trim(),
                                category: 'FAQ'
                            });
                            found = true;
                        }
                    }
                    // それでも見つからなければ元テキストを登録
                    if (!found) {
                        console.log(`[JSON Parse Error] 元テキストをそのまま登録 (${textPart.length}文字)`);
                        processedChunks.push({
                            content: textPart,
                            category: chunk.category
                        });
                    }
                }
            }

            console.log(`[AI Q&A生成] ${processedChunks.length}件のQ&Aを生成`);

        } catch (e: any) {
            console.error('[AI Q&A生成] 失敗、フォールバックで分割:', e.message);
            // フォールバック: 従来の分割方式
            const splitParts = recursiveSplit(chunk.content, 800, 100);
            for (const part of splitParts) {
                processedChunks.push({ content: part, category: chunk.category });
            }
        }
    }

    // Process in batches
    for (let i = 0; i < processedChunks.length; i += 5) {
        const batch = processedChunks.slice(i, i + 5);

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

        // 重複チェック: 既存のナレッジと内容が完全一致するものをスキップ
        const newRecords = [];
        for (const record of records) {
            // DBに同じcontentが存在するか確認
            const { data: existing } = await supabase
                .from('knowledge_base')
                .select('id')
                .eq('tenant_id', tenant_id)
                .eq('content', record.content)
                .maybeSingle();

            if (!existing) {
                newRecords.push(record);
            } else {
                console.log(`[Knowledge Import] 重複スキップ: ${record.content.substring(0, 30)}...`);
            }
        }

        if (newRecords.length > 0) {
            const { error } = await supabase.from('knowledge_base').insert(newRecords);
            if (error) {
                console.error('[Knowledge Import] DB挿入エラー:', error);
            } else {
                console.log(`[Knowledge Import] バッチ ${Math.floor(i / 5) + 1} 完了: ${newRecords.length}/${batch.length}件登録 (重複${batch.length - newRecords.length}件スキップ)`);
            }
        } else {
            console.log(`[Knowledge Import] バッチ ${Math.floor(i / 5) + 1} スキップ: 全て重複済み`);
        }
    }

    console.log(`[Knowledge Import] 完了: 合計 ${processedChunks.length}件のQ&Aを登録`);
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
        // PDF処理 - 現在はサポート外（Vercel環境の制約）
        throw new Error('PDFはWord(.docx)またはテキスト(.txt)に変換してからアップロードしてください。');
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
