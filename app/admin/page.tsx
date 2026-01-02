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

async function getTenantsWithKB() {
    const supabase = getSupabaseAdmin();
    if (!supabase) return [];

    // テナントと、それに紐づくナレッジをまとめて取得
    const { data: tenants } = await supabase.from('tenants').select('*, knowledge_base(*)').order('created_at', { ascending: false });
    return tenants || [];
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
                <p>正し管理用URLからアクセスしてください。</p>
            </div>
        );
    }

    const tenants = await getTenantsWithKB();

    return (
        <div className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Bot Admin Console</h1>
                    <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>知識（RAG）と設定の管理</p>
                </div>
            </header>

            <div className="bot-grid">
                {tenants.map((tenant) => (
                    <div key={tenant.tenant_id} className="bot-card">
                        {/* 基本設定フォーム */}
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

                            <div style={{ marginBottom: '16px' }}>
                                <label className="input-label">SYSTEM PROMPT</label>
                                <textarea name="system_prompt" defaultValue={tenant.system_prompt} className="prompt-textarea" />
                            </div>

                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '24px' }}>基本設定を保存</button>
                        </form>

                        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '24px 0' }} />

                        {/* ナレッジベース管理 */}
                        <div className="kb-section">
                            <h3 className="input-label">KNOWLEDGE BASE (AIの追加知識)</h3>

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

                            {/* ナレッジ追加フォーム */}
                            <form action={addKnowledge} className="kb-add-form">
                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                <input type="hidden" name="admin_key" value={key} />
                                <input name="content" className="kb-input" placeholder="新しい知識を追加... (例: 当店の営業時間は10時〜19時です)" required />
                                <button type="submit" className="btn btn-outline" style={{ whiteSpace: 'nowrap' }}>追加</button>
                            </form>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
