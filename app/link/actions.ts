"use server";
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error('Supabase configuration missing');
    return createClient(supabaseUrl, supabaseKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });
}

export async function linkPurchase(tenantId: string, userId: string, email: string) {
    try {
        const supabase = getSupabaseAdmin();
        
        // 1. purchasersテーブルで該当メールアドレスが未消費で存在するか確認
        const { data: purchaser, error: pError } = await supabase
            .from('purchasers')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('email', email)
            .eq('is_used', false)
            .maybeSingle();
            
        if (pError || !purchaser) {
            return { 
                success: false, 
                error: '有効な購入履歴が見つからないか、既に別のLINEアカウントと連携されています。' 
            };
        }
        
        // 2. purchasersテーブルのフラグを更新
        const { error: upError } = await supabase
            .from('purchasers')
            .update({ is_used: true })
            .eq('id', purchaser.id);
            
        if (upError) {
            console.error('Purchaser update error:', upError);
            return { success: false, error: '処理中にエラーが発生しました。' };
        }
        
        // 3. usersテーブルで該当ユーザーを認証済みにする
        const { error: uError } = await supabase
            .from('users')
            .update({ 
                is_authenticated: true,
                purchase_email: email
            })
            .eq('tenant_id', tenantId)
            .eq('user_id', userId);
            
        if (uError) {
            // ロールバック
            console.error('User update error:', uError);
            await supabase.from('purchasers').update({ is_used: false }).eq('id', purchaser.id);
            return { success: false, error: 'LINE連携に失敗しました。' };
        }
        
        return { success: true };
    } catch (e: any) {
        console.error('Link process error:', e);
        return { success: false, error: 'システムエラーが発生しました。' };
    }
}
