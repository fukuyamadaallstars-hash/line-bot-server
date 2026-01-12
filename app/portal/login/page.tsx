'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PortalLogin() {
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError('');
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const tenant_id = formData.get('tenant_id') as string;
        const password = formData.get('password') as string;

        try {
            const res = await fetch('/api/portal/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tenant_id, password }),
                credentials: 'include',
            });

            const data = await res.json();

            if (!res.ok) {
                setError(data.error || 'ログインに失敗しました');
                setLoading(false);
                return;
            }

            // ログイン成功 - ダッシュボードへ
            router.push('/portal/dashboard');
            router.refresh();
        } catch (e: any) {
            setError('ネットワークエラーが発生しました');
            setLoading(false);
        }
    }

    return (
        <div style={{
            minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)', fontFamily: '"Inter", sans-serif'
        }}>
            <div style={{
                width: '100%', maxWidth: '400px', background: 'white', padding: '32px',
                borderRadius: '16px', boxShadow: '0 4px 24px rgba(0,0,0,0.05)'
            }}>
                <h1 style={{ textAlign: 'center', fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '24px', color: '#0f172a' }}>
                    Tenant Portal
                </h1>

                {error && (
                    <div style={{
                        padding: '12px', background: '#fee2e2', color: '#dc2626',
                        borderRadius: '8px', fontSize: '0.85rem', marginBottom: '16px',
                        textAlign: 'center'
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#475569', marginBottom: '8px' }}>
                            Tenant ID (Bot ID)
                        </label>
                        <input
                            name="tenant_id"
                            required
                            placeholder="johny"
                            style={{
                                width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1',
                                fontSize: '1rem'
                            }}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#475569', marginBottom: '8px' }}>
                            Access Password
                        </label>
                        <input
                            name="password"
                            type="password"
                            required
                            placeholder="••••••••"
                            style={{
                                width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #cbd5e1',
                                fontSize: '1rem'
                            }}
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        style={{
                            marginTop: '8px', padding: '12px', borderRadius: '8px', border: 'none',
                            background: loading ? '#94a3b8' : '#0ea5e9', color: 'white', fontWeight: 'bold', fontSize: '1rem',
                            cursor: loading ? 'not-allowed' : 'pointer', boxShadow: '0 2px 8px rgba(14, 165, 233, 0.3)'
                        }}
                    >
                        {loading ? 'ログイン中...' : 'Login'}
                    </button>
                    <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#94a3b8', marginTop: '16px' }}>
                        IDが不明な場合は管理者にお問い合わせください
                    </p>
                </form>
            </div>
        </div>
    );
}
