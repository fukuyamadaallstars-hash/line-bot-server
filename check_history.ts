
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkHistory() {
    console.log('=== 会話履歴チェック ===\n');

    const { data: history, error } = await supabase
        .from('chat_history')
        .select('*')
        .eq('tenant_id', 'johny')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log(`履歴件数: ${history?.length || 0}`);

    if (history && history.length > 0) {
        console.log('\n--- 直近の会話履歴 ---');
        history.forEach((h, i) => {
            console.log(`${i + 1}. [${h.role}] ${h.content?.substring(0, 80)}...`);
        });
    }
}

checkHistory();
