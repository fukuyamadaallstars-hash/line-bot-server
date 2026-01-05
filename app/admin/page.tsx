import { createClient } from '@supabase/supabase-js';
import './admin.css';
import { updateTenant, addKnowledge, deleteKnowledge, resumeAi, quickAddToken } from './actions';
import TenantCard from './TenantCard';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return null;
    return createClient(supabaseUrl, supabaseKey);
}

async function getTenantsFullData() {
    const supabase = getSupabaseAdmin();
    if (!supabase) return [];

    // テナント全取得
    const { data: tenants } = await supabase.from('tenants')
        .select('*, knowledge_base(*), token_purchases(*), invoices(*)')
        .order('created_at', { ascending: false });

    if (!tenants) return [];

    // 各種統計データの集計
    return await Promise.all(tenants.map(async (tenant) => {
        // 返信数（usage_logsの件数）
        const { count } = await supabase.from('usage_logs')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', tenant.tenant_id)
            .eq('status', 'success');

        // トークン総消費量
        const { data: usage } = await supabase.from('usage_logs')
            .select('token_usage')
            .eq('tenant_id', tenant.tenant_id);
        const totalTokens = usage?.reduce((acc, curr) => acc + (curr.token_usage || 0), 0) || 0;

        // 有人対応が必要なユーザー
        const { data: handoffUsers } = await supabase.from('users')
            .select('*')
            .eq('tenant_id', tenant.tenant_id)
            .eq('is_handoff_active', true);

        return {
            ...tenant,
            stats: {
                messageCount: count || 0,
                totalTokens
            },
            handoffUsers: handoffUsers || []
        };
    }));
}

import TenantList from './TenantList';

// ... (existing imports)

export default async function AdminPage() {
    const tenants = await getTenantsFullData();

    return (
        <div className="dashboard-container">
            <header className="header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '20px', marginBottom: '32px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h1 style={{ fontSize: '2rem' }}>Bot 管理センター</h1>
                        <span style={{ background: '#22c55e', color: 'white', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 'bold' }}>SYSTEM SECURE</span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>全テナントの監視・契約管理・ナレッジ更新</p>
                </div>
            </header>

            <TenantList tenants={tenants} />
        </div>
    );
}
