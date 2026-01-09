
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function clearHistory() {
    console.log('=== 会話履歴クリア ===\n');

    const { error } = await supabase
        .from('chat_history')
        .delete()
        .eq('tenant_id', 'johny');

    if (error) {
        console.error('Error:', error);
        return;
    }

    console.log('[OK] 会話履歴を削除しました。');
    console.log('これで新しいナレッジに基づいた回答が生成されるはずです。');
}

clearHistory();
