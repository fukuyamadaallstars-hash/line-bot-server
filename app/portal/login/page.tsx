'use client';

import { useState } from 'react';
import { loginTenant } from '../actions';

export default function PortalLogin() {
    const [error, setError] = useState('');

    async function handleSubmit(formData: FormData) {
        try {
            await loginTenant(formData);
        } catch (e: any) {
            setError(e.message);
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

                <form action={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#475569', marginBottom: '8px' }}>
                            Tenant ID (Bot ID)
                        </label>
                        <input
                            name="tenant_id"
                            required
                            placeholder="Uxxxxxxxx..."
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
                        style={{
                            marginTop: '8px', padding: '12px', borderRadius: '8px', border: 'none',
                            background: '#0ea5e9', color: 'white', fontWeight: 'bold', fontSize: '1rem',
                            cursor: 'pointer', boxShadow: '0 2px 8px rgba(14, 165, 233, 0.3)'
                        }}
                    >
                        Login
                    </button>
                    <p style={{ textAlign: 'center', fontSize: '0.8rem', color: '#94a3b8', marginTop: '16px' }}>
                        IDが不明な場合は管理者にお問い合わせください
                    </p>
                </form>
            </div>
        </div>
    );
}
