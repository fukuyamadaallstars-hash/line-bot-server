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

    const { data: tenant } = await supabase
        .from('tenants')
        .select(`
            tenant_id, display_name, system_prompt, 
            knowledge_base (id, content, category)
        `)
        .eq('tenant_id', session.tenant_id)
        .single();

    if (!tenant) {
        redirect('/portal/login');
    }

    return (
        <DashboardClient tenant={tenant} />
    );
}
