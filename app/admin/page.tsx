import { createClient } from '@supabase/supabase-js';
import './admin.css';
import { updateTenant } from './actions';

async function getTenants() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data, error } = await supabase
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
}

export default async function AdminPage(props: {
    searchParams: Promise<{ key?: string }>
}) {
    const searchParams = await props.searchParams;
    const key = searchParams.key;
    const adminPassword = process.env.ADMIN_PASSWORD;

    // パスワードが未設定、または合言葉が違う場合は拒否
    if (!adminPassword || key !== adminPassword) {
        return (
            <div style={{ padding: '100px 20px', textAlign: 'center', fontFamily: 'sans-serif', color: '#64748b' }}>
                <h1 style={{ fontSize: '3rem', color: '#0f172a', marginBottom: '16px' }}>401</h1>
                <p style={{ fontSize: '1.1rem' }}>アクセス権限がありません。</p>
                <p style={{ fontSize: '0.9rem', marginTop: '8px' }}>正しい管理用URLからアクセスしてください。</p>
            </div>
        );
    }

    const tenants = await getTenants();

    return (
        <div className="dashboard-container">
            <header className="header">
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <h1>Bot Admin Console</h1>
                        <span style={{ background: '#e2e8f0', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold' }}>SECURE MODE</span>
                    </div>
                    <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                        あなた専用のボット管理リモコン
                    </p>
                </div>
            </header>

            <div className="bot-grid">
                {tenants.map((tenant) => (
                    <form key={tenant.tenant_id} action={updateTenant} className="bot-card">
                        <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                        <input type="hidden" name="admin_key" value={key} />

                        <div className="bot-header">
                            <input
                                name="display_name"
                                defaultValue={tenant.display_name}
                                className="bot-name-input"
                                placeholder="ボット名"
                            />
                            <div className="toggle-switch">
                                <input
                                    type="checkbox"
                                    name="is_active"
                                    defaultChecked={tenant.is_active}
                                    id={`active-${tenant.tenant_id}`}
                                />
                                <label htmlFor={`active-${tenant.tenant_id}`}>稼働中</label>
                            </div>
                        </div>

                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>
                                SYSTEM PROMPT (AIの性格・教える知識)
                            </label>
                            <textarea
                                name="system_prompt"
                                defaultValue={tenant.system_prompt}
                                className="prompt-textarea"
                                placeholder="AIへの指示をここに入力..."
                            />
                        </div>

                        <div className="action-row">
                            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                                この内容で保存（反映）
                            </button>
                        </div>
                    </form>
                ))}
            </div>
        </div>
    );
}
