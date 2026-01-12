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
            line_channel_access_token, line_channel_secret, google_sheet_id,
            knowledge_base (id, content, category)
        `)
        .eq('tenant_id', session.tenant_id)
        .single();

    if (error || !tenant) {
        console.error('Dashboard error:', error);
        redirect('/portal/login');
    }

    // Try to get permission fields separately (in case they don't exist in DB yet)
    const { data: permissions } = await supabase
        .from('tenants')
        .select('portal_allow_prompt_edit, portal_allow_knowledge_edit')
        .eq('tenant_id', session.tenant_id)
        .single();

    const tenantWithPermissions = {
        ...tenant,
        portal_allow_prompt_edit: permissions?.portal_allow_prompt_edit ?? true,
        portal_allow_knowledge_edit: permissions?.portal_allow_knowledge_edit ?? true,
    };

    return (
        <DashboardClient tenant={tenantWithPermissions} />
    );
}
