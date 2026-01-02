import { createClient } from '@supabase/supabase-js';
import './admin.css';

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
                    <h1>Bot Dashboard</h1>
                    <p style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                        管理中のボット: {tenants.length}件
                    </p>
                </div>
                <button className="btn btn-primary">+ 新規ボット追加</button>
            </header>

            <div className="bot-grid">
                {tenants.map((tenant) => (
                    <div key={tenant.tenant_id} className="bot-card">
                        <div className="bot-header">
                            <div>
                                <div className="bot-name">{tenant.display_name}</div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                    ID: {tenant.tenant_id}
                                </div>
                            </div>
                            <span className={`status-badge ${tenant.is_active ? 'status-active' : 'status-inactive'}`}>
                                {tenant.is_active ? '稼働中' : '停止中'}
                            </span>
                        </div>

                        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', height: '2.5rem' }}>
                            {tenant.system_prompt || 'システムプロンプト未設定'}
                        </p>

                        <div className="action-row">
                            <button className="btn btn-outline">詳細・設定</button>
                            <button className="btn btn-outline">ログ確認</button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
