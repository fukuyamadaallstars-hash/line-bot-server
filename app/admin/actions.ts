"use server";

import { createClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function updateTenant(formData: FormData) {
    const tenant_id = formData.get('tenant_id') as string;
    const display_name = formData.get('display_name') as string;
    const system_prompt = formData.get('system_prompt') as string;
    const is_active = formData.get('is_active') === 'on';

    const { error } = await supabase
        .from('tenants')
        .update({
            display_name,
            system_prompt,
            is_active,
            updated_at: new Date().toISOString()
        })
        .eq('tenant_id', tenant_id);

    if (error) {
        console.error('Update error:', error);
        throw new Error('更新に失敗しました');
    }

    // 画面を再読み込みして最新データを反映させる
    revalidatePath('/admin');
}
