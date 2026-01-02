import { createClient } from '@supabase/supabase-js';
import './admin.css';
import { updateTenant, addKnowledge, deleteKnowledge } from './actions';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return null;
    return createClient(supabaseUrl, supabaseKey);
}

async function getTenantsWithStats() {
    const supabase = getSupabaseAdmin();
    if (!supabase) return [];

    const { data: tenants } = await supabase.from('tenants').select('*, knowledge_base(*)').order('created_at', { ascending: false });
    if (!tenants) return [];

    return await Promise.all(tenants.map(async (tenant) => {
        const { count } = await supabase.from('usage_logs').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.tenant_id).eq('status', 'success');
        const { data: usage } = await supabase.from('usage_logs').select('token_usage').eq('tenant_id', tenant.tenant_id);
        const totalTokens = usage?.reduce((acc, curr) => acc + (curr.token_usage || 0), 0) || 0;

        return { ...tenant, stats: { messageCount: count || 0, totalTokens } };
    }));
}

export default async function AdminPage(props: {
    searchParams: Promise<{ key?: string }>
}) {
    const searchParams = await props.searchParams;
    const key = searchParams.key;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminPassword || key !== adminPassword) {
        return (
            <div style={{ padding: '100px 20px', textAlign: 'center', fontFamily: 'sans-serif' }}>
                <h1>401 Unauthorized</h1>
                <p>正しい管理用URLからアクセスしてください。</p>
            </div>
        );
    }

    const tenants = await getTenantsWithStats();

    return (
        <div className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Bot Admin Console</h1>
                    <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>運用状況の見える化 ＆ 設定</p>
                </div>
            </header>

            <div className="bot-grid">
                {tenants.map((tenant) => (
                    <div key={tenant.tenant_id} className="bot-card">
                        {/* 1. 統計セクション (見える化) */}
                        <div className="stats-row">
                            <div className="stat-box">
                                <span className="stat-label">累計返信数</span>
                                <span className="stat-value">{tenant.stats.messageCount}</span>
                                <span className="stat-unit">messages</span>
                            </div>
                            <div className="stat-box">
                                <span className="stat-label">AI消費量</span>
                                <span className="stat-value">{(tenant.stats.totalTokens / 1000).toFixed(1)}</span>
                                <span className="stat-unit">k tokens</span>
                            </div>
                            <div className="stat-box">
                                <span className="stat-label">学習済み知識</span>
                                <span className="stat-value">{tenant.knowledge_base?.length || 0}</span>
                                <span className="stat-unit">items</span>
                            </div>
                        </div>

                        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0' }} />

                        {/* 2. 基本設定フォーム */}
                        <form action={updateTenant}>
                            <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                            <input type="hidden" name="admin_key" value={key} />
                            <div className="bot-header">
                                <input name="display_name" defaultValue={tenant.display_name} className="bot-name-input" />
                                <div className="toggle-switch">
                                    <input type="checkbox" name="is_active" defaultChecked={tenant.is_active} id={`active-${tenant.tenant_id}`} />
                                    <label htmlFor={`active-${tenant.tenant_id}`}>稼働</label>
                                </div>
                            </div>
                            <textarea name="system_prompt" defaultValue={tenant.system_prompt} className="prompt-textarea" style={{ marginBottom: '12px' }} />
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '24px' }}>設定を保存</button>
                        </form>

                        {/* 3. ナレッジ管理 */}
                        <div className="kb-section">
                            <h3 className="input-label">KNOWLEDGE BASE</h3>
                            <div className="kb-list">
                                {tenant.knowledge_base?.map((kb: any) => (
                                    <div key={kb.id} className="kb-item">
                                        <span className="kb-content">{kb.content}</span>
                                        <form action={deleteKnowledge}>
                                            <input type="hidden" name="id" value={kb.id} />
                                            <input type="hidden" name="admin_key" value={key} />
                                            <button type="submit" className="kb-delete-btn">×</button>
                                        </form>
                                    </div>
                                ))}
                            </div>
                            <form action={addKnowledge} className="kb-add-form">
                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                <input type="hidden" name="admin_key" value={key} />
                                <input name="content" className="kb-input" placeholder="知識を追加..." required />
                                <button type="submit" className="btn btn-outline">＋</button>
                            </form>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
