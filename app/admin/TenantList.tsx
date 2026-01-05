'use client';

import { useState } from 'react';
import TenantCard from './TenantCard';

export default function TenantList({ tenants }: { tenants: any[] }) {
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all'); // 'all' | 'handoff' | 'active'

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
            <div style={{ marginBottom: '24px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
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
            </div>

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
