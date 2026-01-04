import { createClient } from '@supabase/supabase-js';
import './admin.css';
import { updateTenant, addKnowledge, deleteKnowledge, resumeAi } from './actions';

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
    const { data: tenants } = await supabase.from('tenants').select('*, knowledge_base(*)').order('created_at', { ascending: false });
    if (!tenants) return [];
    return await Promise.all(tenants.map(async (tenant) => {
        const { count } = await supabase.from('usage_logs').select('*', { count: 'exact', head: true }).eq('tenant_id', tenant.tenant_id).eq('status', 'success');
        const { data: usage } = await supabase.from('usage_logs').select('token_usage').eq('tenant_id', tenant.tenant_id);
        const totalTokens = usage?.reduce((acc, curr) => acc + (curr.token_usage || 0), 0) || 0;
        const { data: handoffUsers } = await supabase.from('users').select('*').eq('tenant_id', tenant.tenant_id).eq('is_handoff_active', true);
        return { ...tenant, stats: { messageCount: count || 0, totalTokens }, handoffUsers: handoffUsers || [] };
    }));
}

export default async function AdminPage() {
    const tenants = await getTenantsFullData();
    return (
        <div className="dashboard-container">
            <header className="header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '20px', marginBottom: '32px' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h1 style={{ fontSize: '2rem' }}>Bot Management Center</h1>
                        <span style={{ background: '#22c55e', color: 'white', padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 'bold' }}>SYSTEM SECURE</span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', marginTop: '8px' }}>全テナントの監視・更新・ナレッジ管理</p>
                </div>
            </header>

            <div className="bot-grid">
                {tenants.map((tenant) => (
                    <div key={tenant.tenant_id} className="bot-card">
                        {/* 統計 */}
                        <div className="stats-row">
                            <div className="stat-box">
                                <span className="stat-label">累計返信</span>
                                <span className="stat-value">{tenant.stats.messageCount}</span>
                                <span className="stat-unit">msg</span>
                            </div>
                            <div className="stat-box">
                                <span className="stat-label">AI消費</span>
                                <span className="stat-value">{(tenant.stats.totalTokens / 1000).toFixed(1)}</span>
                                <span className="stat-unit">k tokens</span>
                            </div>
                            <div className="stat-box" style={{ background: tenant.handoffUsers.length > 0 ? '#fee2e2' : '#f1f5f9' }}>
                                <span className="stat-label" style={{ color: tenant.handoffUsers.length > 0 ? '#ef4444' : '#64748b' }}>有人対応中</span>
                                <span className="stat-value" style={{ color: tenant.handoffUsers.length > 0 ? '#ef4444' : 'var(--primary)' }}>{tenant.handoffUsers.length}</span>
                                <span className="stat-unit">users</span>
                            </div>
                        </div>

                        {/* 有人対応アラート */}
                        {tenant.handoffUsers.length > 0 && (
                            <div className="handoff-alert-box">
                                <h4 style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: '#b91c1c' }}>⚠️ 要対応のユーザーがいます</h4>
                                <div className="handoff-list">
                                    {tenant.handoffUsers.map((u: any) => (
                                        <div key={u.user_id} className="handoff-user-item">
                                            <span className="user-id-brief">{u.user_id.substring(0, 8)}...</span>
                                            <form action={resumeAi}>
                                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                                <input type="hidden" name="user_id" value={u.user_id} />
                                                <button type="submit" className="resume-btn">AI対応を再開</button>
                                            </form>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '20px 0' }} />

                        {/* 設定フォーム */}
                        <form action={updateTenant}>
                            <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                            <div className="bot-header">
                                <input name="display_name" defaultValue={tenant.display_name} className="bot-name-input" />
                                <div className="toggle-switch">
                                    <input type="checkbox" name="is_active" defaultChecked={tenant.is_active} id={`active-${tenant.tenant_id}`} />
                                    <label htmlFor={`active-${tenant.tenant_id}`}>稼働中</label>
                                </div>
                            </div>

                            {/* AIモデル選択 */}
                            <div style={{ marginBottom: '16px' }}>
                                <label className="input-label" htmlFor={`model-${tenant.tenant_id}`}>AIモデル (等級)</label>
                                <select
                                    name="ai_model"
                                    id={`model-${tenant.tenant_id}`}
                                    defaultValue={tenant.ai_model || 'gpt-4o-mini'}
                                    className="kb-input"
                                    style={{ width: '100%' }}
                                >
                                    <option value="gpt-4o-mini">Standard (GPT-4o mini) - Default</option>
                                    <option value="gpt-4.1-mini">Pro (GPT-4.1 mini) - +¥10,000</option>
                                    <option value="gpt-5-mini">Enterprise (GPT-5 mini) - +¥25,000</option>
                                </select>
                            </div>

                            {/* 上限設定 */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
                                <div>
                                    <label className="input-label">月間トークン上限</label>
                                    <input type="number" name="monthly_token_limit" defaultValue={tenant.monthly_token_limit || 0} className="kb-input" style={{ width: '100%' }} />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'end', fontSize: '0.75rem', color: '#64748b', paddingBottom: '8px' }}>
                                    ※約100万=10ドル相当
                                </div>
                            </div>

                            {/* ★ここに追加: スプレッドシート設定 */}
                            <div style={{ marginBottom: '16px' }}>
                                <label className="input-label">Google Sheet ID (予約連携)</label>
                                <input
                                    name="google_sheet_id"
                                    defaultValue={tenant.google_sheet_id || ''}
                                    className="kb-input"
                                    style={{ width: '100%', fontFamily: 'monospace' }} placeholder="1BxiMVs0XRA5_example_sheet_id"
                                />
                            </div>

                            {/* スタッフ登録パスコード */}
                            <div style={{ marginBottom: '16px' }}>
                                <label className="input-label">スタッフ登録パスコード (#STAFF 1234)</label>
                                <input
                                    name="staff_passcode"
                                    defaultValue={tenant.staff_passcode || ''}
                                    className="kb-input"
                                    style={{ width: '100%', fontFamily: 'monospace' }} placeholder="1234"
                                />
                            </div>

                            {/* 有人切替キーワード */}
                            <div style={{ marginBottom: '16px' }}>
                                <label className="input-label">有人切替キーワード (カンマ区切り)</label>
                                <input
                                    name="handoff_keywords"
                                    defaultValue={tenant.handoff_keywords || '担当者,オペレーター,返金,クレーム'}
                                    className="kb-input"
                                    style={{ width: '100%' }} placeholder="例: 担当者,オペレーター,予約変更"
                                />
                            </div>

                            <textarea name="system_prompt" defaultValue={tenant.system_prompt} className="prompt-textarea" style={{ marginBottom: '12px' }} />
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: '24px' }}>設定を保存</button>
                        </form>

                        {/* ナレッジ管理 */}
                        <div className="kb-section">
                            <h3 className="input-label">学習済みナレッジ ({tenant.knowledge_base?.length || 0}件)</h3>
                            <div className="kb-list">
                                {tenant.knowledge_base?.map((kb: any) => (
                                    <div key={kb.id} className="kb-item">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                            <span style={{
                                                fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold',
                                                background: kb.category === 'OFFER' ? '#e0f2fe' :
                                                    kb.category === 'PRICE' ? '#dcfce7' :
                                                        kb.category === 'PROCESS' ? '#fef9c3' :
                                                            kb.category === 'POLICY' ? '#fee2e2' :
                                                                kb.category === 'CONTEXT' ? '#f3f4f6' : '#fef3c7',
                                                color: '#334155'
                                            }}>
                                                {kb.category || 'FAQ'}
                                            </span>
                                            <span className="kb-content" style={{ flex: 1, margin: 0 }}>{kb.content}</span>
                                        </div>
                                        <form action={deleteKnowledge}>
                                            <input type="hidden" name="id" value={kb.id} />
                                            <button type="submit" className="kb-delete-btn">×</button>
                                        </form>
                                    </div>
                                ))}
                            </div>
                            <form action={addKnowledge} className="kb-add-form" style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '8px' }}>
                                    <select name="category" className="kb-input" style={{ width: '100%', fontSize: '0.85rem' }} required defaultValue="FAQ">
                                        <option value="OFFER">OFFER (提供内容)</option>
                                        <option value="PRICE">PRICE (料金・支払い)</option>
                                        <option value="PROCESS">PROCESS (進め方・手順)</option>
                                        <option value="POLICY">POLICY (ルール・禁止事項)</option>
                                        <option value="CONTEXT">CONTEXT (基本情報・営業時間)</option>
                                        <option value="FAQ">FAQ (その他・Q&A)</option>
                                    </select>
                                    <input name="content" className="kb-input" placeholder="知識の内容を入力..." required style={{ width: '100%' }} />
                                </div>
                                <button type="submit" className="btn btn-outline" style={{ height: 'auto', alignSelf: 'stretch' }}>＋</button>
                            </form>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
