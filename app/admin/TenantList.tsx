'use client';

import { useState } from 'react';
import TenantCard from './TenantCard';
import { createTenant } from './actions';

export default function TenantList({ tenants }: { tenants: any[] }) {
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all'); // 'all' | 'handoff' | 'active'
    const [showNewForm, setShowNewForm] = useState(false);

    const filteredTenants = tenants.filter(t => {
        // Search filter
        const query = search.toLowerCase();
        const matchesSearch =
            (t.display_name || '').toLowerCase().includes(query) ||
            t.tenant_id.includes(query) ||
            t.google_sheet_id?.includes(query);

        if (!matchesSearch) return false;

        // Status filter
        if (filter === 'handoff') {
            return t.handoffUsers && t.handoffUsers.length > 0;
        }
        if (filter === 'active') {
            return t.is_active;
        }
        return true;
    });

    return (
        <div>
            <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input
                    type="text"
                    placeholder="検索 (店名, ID, Sheet)..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                        padding: '10px 16px',
                        borderRadius: '8px',
                        border: '1px solid var(--border)',
                        width: '300px',
                        fontSize: '0.9rem'
                    }}
                />

                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setFilter('all')}
                        className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-outline'}`}
                    >
                        すべて
                    </button>
                    <button
                        onClick={() => setFilter('handoff')}
                        className={`btn ${filter === 'handoff' ? 'btn-primary' : 'btn-outline'}`}
                        style={{ borderColor: filter === 'handoff' ? '#ef4444' : 'var(--border)', background: filter === 'handoff' ? '#ef4444' : 'white', color: filter === 'handoff' ? 'white' : '#ef4444' }}
                    >
                        ⚠️ 要対応 ({tenants.filter(t => t.handoffUsers?.length > 0).length})
                    </button>
                    <button
                        onClick={() => setFilter('active')}
                        className={`btn ${filter === 'active' ? 'btn-primary' : 'btn-outline'}`}
                    >
                        稼働中のみ
                    </button>
                </div>

                <button
                    onClick={() => setShowNewForm(!showNewForm)}
                    className="btn btn-primary"
                    style={{ marginLeft: 'auto', background: '#8b5cf6', borderColor: '#7c3aed' }}
                >
                    ➕ 新規テナント
                </button>
            </div>

            {/* 新規テナント作成フォーム */}
            {showNewForm && (
                <div style={{ marginBottom: '24px', padding: '20px', background: '#faf5ff', borderRadius: '12px', border: '1px solid #e9d5ff' }}>
                    <h4 style={{ margin: '0 0 16px 0', color: '#7c3aed' }}>🆕 新規テナント作成</h4>
                    <form action={createTenant} style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>テナントID（英数字）</label>
                            <input type="text" name="tenant_id" required placeholder="salon_yamada" style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', width: '180px' }} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>表示名</label>
                            <input type="text" name="display_name" required placeholder="山田サロン" style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', width: '180px' }} />
                        </div>
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>プラン</label>
                            <select name="plan" defaultValue="Lite" style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                                <option value="Lite">Lite</option>
                                <option value="Standard">Standard</option>
                                <option value="Enterprise">Enterprise</option>
                            </select>
                        </div>
                        <button type="submit" className="btn btn-primary" style={{ background: '#8b5cf6', borderColor: '#7c3aed' }}>
                            作成
                        </button>
                        <button type="button" onClick={() => setShowNewForm(false)} className="btn btn-outline" style={{ color: '#64748b' }}>
                            キャンセル
                        </button>
                    </form>
                    <p style={{ margin: '12px 0 0 0', fontSize: '0.75rem', color: '#64748b' }}>
                        ※ テナント作成後、LINE Channel Access TokenやGoogle Sheet IDを設定してください。
                    </p>
                </div>
            )}


            <div className="bot-grid">
                {filteredTenants.length > 0 ? (
                    filteredTenants.map((tenant) => (
                        <TenantCard key={tenant.tenant_id} tenant={tenant} />
                    ))
                ) : (
                    <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                        条件に一致するテナントが見つかりません。
                    </div>
                )}
            </div>
        </div>
    );
}
