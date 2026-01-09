
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function diagnose() {
    console.log('=== ナレッジ診断開始 ===\n');

    // 1. テナント確認
    const { data: tenants } = await supabase.from('tenants').select('tenant_id').limit(1);
    if (!tenants || tenants.length === 0) {
        console.log('[ERROR] テナントが見つかりません');
        return;
    }
    const tenantId = tenants[0].tenant_id;
    console.log(`[OK] テナントID: ${tenantId}`);

    // 2. ナレッジ件数確認
    const { data: knowledge, error: kbError } = await supabase
        .from('knowledge_base')
        .select('id, content, embedding, category')
        .eq('tenant_id', tenantId);

    if (kbError) {
        console.log(`[ERROR] ナレッジ取得エラー: ${kbError.message}`);
        return;
    }

    console.log(`[INFO] ナレッジ件数: ${knowledge?.length || 0}`);

    if (knowledge && knowledge.length > 0) {
        // 3. Embedding有無確認
        const withEmbedding = knowledge.filter(k => k.embedding && k.embedding.length > 0);
        const withoutEmbedding = knowledge.filter(k => !k.embedding || k.embedding.length === 0);

        console.log(`[INFO] Embedding有り: ${withEmbedding.length}件`);
        console.log(`[INFO] Embedding無し: ${withoutEmbedding.length}件`);

        if (withoutEmbedding.length > 0) {
            console.log('[WARNING] Embeddingが欠落しているナレッジがあります！');
            withoutEmbedding.forEach(k => console.log(`  - ID: ${k.id}, Content: ${k.content?.substring(0, 30)}...`));
        }

        // サンプル表示
        console.log('\n--- 最初のナレッジ (サンプル) ---');
        console.log(`Category: ${knowledge[0].category}`);
        console.log(`Content: ${knowledge[0].content?.substring(0, 100)}...`);
        console.log(`Embedding Length: ${knowledge[0].embedding?.length || 0}`);
    }

    // 4. OpenAI Embedding テスト
    console.log('\n--- OpenAI Embedding テスト ---');
    try {
        const testResponse = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: 'テスト'
        });
        console.log(`[OK] OpenAI Embedding成功: ${testResponse.data[0].embedding.length}次元`);
    } catch (e: any) {
        console.log(`[ERROR] OpenAI Embedding失敗: ${e.message}`);
    }

    // 5. 検索RPC テスト
    console.log('\n--- 検索RPC テスト ---');
    try {
        const queryVector = (await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: '分身AI'
        })).data[0].embedding;

        const { data: searchResult, error: searchError } = await supabase.rpc('match_knowledge_hybrid', {
            query_text: '分身AI',
            query_embedding: queryVector,
            match_threshold: 0.3,
            match_count: 3,
            p_tenant_id: tenantId
        });

        if (searchError) {
            console.log(`[ERROR] 検索RPC失敗: ${searchError.message}`);
        } else {
            console.log(`[OK] 検索結果: ${searchResult?.length || 0}件ヒット`);
            if (searchResult && searchResult.length > 0) {
                searchResult.forEach((r: any, i: number) => {
                    console.log(`  ${i + 1}. [${r.category}] ${r.content?.substring(0, 50)}...`);
                });
            } else {
                console.log('[WARNING] 検索結果0件 - ナレッジが正しく登録されていないか、検索がヒットしていません');
            }
        }
    } catch (e: any) {
        console.log(`[ERROR] 検索テスト失敗: ${e.message}`);
    }

    console.log('\n=== 診断終了 ===');
}

diagnose();
