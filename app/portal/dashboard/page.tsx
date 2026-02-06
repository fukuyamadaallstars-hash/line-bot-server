import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { getTenantSession, logoutTenant } from '../actions';
import DashboardClient from './DashboardClient';

export default async function DashboardPage() {
    const session = await getTenantSession();
    if (!session) {
        redirect('/portal/login');
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: tenant, error } = await supabase
        .from('tenants')
        .select(`
            tenant_id, display_name, system_prompt,
            portal_allow_prompt_edit, portal_allow_knowledge_edit,
            line_channel_access_token, line_channel_secret, google_sheet_id,
            plan, model_option,
            knowledge_base (id, content, category)
        `)
        .eq('tenant_id', session.tenant_id)
        .single();

    if (error || !tenant) {
        console.error('Dashboard error:', error);
        redirect('/portal/login');
    }

    // ユーザーリストの取得 (パーソナライズ管理用)
    const { data: users } = await supabase
        .from('users')
        .select('user_id, display_name, internal_memo, profile, status, is_handoff_active, created_at')
        .eq('tenant_id', session.tenant_id)
        .order('created_at', { ascending: false })
        .limit(50);

    return (
        <DashboardClient tenant={tenant} initialUsers={users || []} />
    );
}
