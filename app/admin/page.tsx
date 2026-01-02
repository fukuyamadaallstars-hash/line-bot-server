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

export default async function AdminPage() {
    const tenants = await getTenants();

    return (
        <div className="dashboard-container">
            <header className="header">
                <div>
                    <h1>Bot Admin Console</h1>
                    <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                        あなた専用のボット管理リモコン
                    </p>
                </div>
            </header>

            <div className="bot-grid">
                {tenants.map((tenant) => (
                    <form key={tenant.tenant_id} action={updateTenant} className="bot-card">
                        <input type="hidden" name="tenant_id" value={tenant.tenant_id} />

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
