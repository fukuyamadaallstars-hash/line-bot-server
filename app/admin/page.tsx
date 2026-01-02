import { createClient } from '@supabase/supabase-js';
import './admin.css';
import { updateTenant } from './actions';

// このページを常に動的（最新）にする設定
export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return null;
    return createClient(supabaseUrl, supabaseKey);
}

async function getTenants() {
    const supabase = getSupabaseAdmin();
    if (!supabase) return [];
    const { data, error } = await supabase.from('tenants').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export default async function AdminPage(props: {
    searchParams: Promise<{ key?: string }>
}) {
    const searchParams = await props.searchParams;
    const key = searchParams.key;
    const adminPassword = process.env.ADMIN_PASSWORD;

    // デバッグ用：パスワードが一致しない場合に原因を表示
    if (!adminPassword || key !== adminPassword) {
        console.log(`[Admin Access Denied] Recv Key: ${key}, Password Set: ${!!adminPassword}`);

        return (
            <div style={{ padding: '100px 20px', textAlign: 'center', fontFamily: 'sans-serif', color: '#64748b' }}>
                <h1 style={{ fontSize: '3rem', color: '#0f172a', marginBottom: '16px' }}>401 Unauthorized</h1>
                <p style={{ fontSize: '1.1rem' }}>アクセス権限がありません。</p>

                <div style={{ marginTop: '24px', padding: '16px', background: '#f1f5f9', borderRadius: '8px', display: 'inline-block', textAlign: 'left', fontSize: '0.85rem' }}>
                    <strong>【診断情報】</strong><br />
                    ・Password Setup on Vercel: {adminPassword ? '✅ OK' : '❌ NOT SET'}<br />
                    ・Your key: {key ? '********' : '(empty)'}<br />
                    {adminPassword && key && (
                        <span style={{ color: 'red' }}>⚠️ パスワードが一致していません</span>
                    )}
                </div>

                <p style={{ fontSize: '0.9rem', marginTop: '16px' }}>
                    Vercelで「Redeploy」したか、URLの `?key=パスワード` が正しいか確認してください。
                </p>
            </div>
        );
    }

    const tenants = await getTenants();

    return (
        <div className="dashboard-container">
            <header className="header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <h1>Bot Admin Console</h1>
                    <span style={{ background: '#e2e8f0', padding: '2px 8px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 'bold' }}>SECURE</span>
                </div>
            </header>

            <div className="bot-grid">
                {tenants.map((tenant) => (
                    <form key={tenant.tenant_id} action={updateTenant} className="bot-card">
                        <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                        <input type="hidden" name="admin_key" value={key} />

                        <div className="bot-header">
                            <input name="display_name" defaultValue={tenant.display_name} className="bot-name-input" />
                            <div className="toggle-switch">
                                <input type="checkbox" name="is_active" defaultChecked={tenant.is_active} id={`active-${tenant.tenant_id}`} />
                                <label htmlFor={`active-${tenant.tenant_id}`}>稼働</label>
                            </div>
                        </div>

                        <textarea name="system_prompt" defaultValue={tenant.system_prompt} className="prompt-textarea" />

                        <div className="action-row">
                            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>保存</button>
                        </div>
                    </form>
                ))}
            </div>
        </div>
    );
}
