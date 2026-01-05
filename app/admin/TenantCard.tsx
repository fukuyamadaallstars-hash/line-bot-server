'use client';

import { useState } from 'react';
import { updateTenant, addKnowledge, deleteKnowledge, resumeAi, quickAddToken } from './actions';

export default function TenantCard({ tenant }: { tenant: any }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('basic'); // basic | billing | knowledge

    return (
        <div className="bot-card" style={{ transition: 'all 0.3s ease' }}>
            {/* ヘッダーエリア（常に表示） */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                    <h3 style={{ margin: '0 0 4px 0', fontSize: '1.1rem' }}>{tenant.display_name || 'No Name'}</h3>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {tenant.tenant_id.substring(0, 8)}...
                        <button
                            onClick={() => navigator.clipboard.writeText(tenant.tenant_id)}
                            style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '2px', fontSize: '0.8rem', filter: 'grayscale(100%)', transition: 'filter 0.2s' }}
                            title="Copy UUID"
                            onMouseOver={(e) => e.currentTarget.style.filter = 'none'}
                            onMouseOut={(e) => e.currentTarget.style.filter = 'grayscale(100%)'}
                        >
                            📋
                        </button>
                    </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 'bold', color: tenant.is_active ? '#22c55e' : '#94a3b8' }}>
                        {tenant.is_active ? '● Active' : '● Inactive'}
                    </div>
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: '0.85rem' }}
                    >
                        {isOpen ? 'Close' : 'Settings ▼'}
                    </button>
                </div>
            </div>

            {/* 統計エリア（常に表示） */}
            <div className="stats-row" style={{ marginBottom: isOpen ? '24px' : '0' }}>
                <div className="stat-box">
                    <span className="stat-label">返信数</span>
                    <span className="stat-value">{tenant.stats.messageCount}</span>
                </div>
                <div className="stat-box">
                    <span className="stat-label">Token消費</span>
                    <span className="stat-value">{(tenant.stats.totalTokens / 1000).toFixed(1)}k</span>
                </div>
                <div className="stat-box" style={{ background: tenant.handoffUsers.length > 0 ? '#fee2e2' : '#f1f5f9' }}>
                    <span className="stat-label" style={{ color: tenant.handoffUsers.length > 0 ? '#ef4444' : '#64748b' }}>有人対応</span>
                    <span className="stat-value" style={{ color: tenant.handoffUsers.length > 0 ? '#ef4444' : 'var(--primary)' }}>{tenant.handoffUsers.length}</span>
                </div>
            </div>

            {/* 有人対応アラート (重要なので閉じている時も出す) */}
            {tenant.handoffUsers.length > 0 && (
                <div className="handoff-alert-box" style={{ marginTop: '12px' }}>
                    <h4 style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: '#b91c1c' }}>⚠️ 要対応のユーザーがいます</h4>
                    <div className="handoff-list">
                        {tenant.handoffUsers.map((u: any) => (
                            <div key={u.user_id} className="handoff-user-item">
                                <span className="user-id-brief" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    {u.user_id.substring(0, 8)}...
                                    <button onClick={() => navigator.clipboard.writeText(u.user_id)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: '0.7rem' }} title="Copy ID">📋</button>
                                </span>
                                <form action={resumeAi}><input type="hidden" name="tenant_id" value={tenant.tenant_id} /><input type="hidden" name="user_id" value={u.user_id} /><button type="submit" className="resume-btn">再開</button></form>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 展開エリア */}
            {isOpen && (
                <div style={{ marginTop: '24px', borderTop: '1px solid #e2e8f0', paddingTop: '16px' }}>
                    {/* タブメニュー */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #e2e8f0' }}>
                        {['basic', 'billing', 'knowledge'].map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                                    borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                                    fontWeight: activeTab === tab ? 'bold' : 'normal',
                                    color: activeTab === tab ? 'var(--primary)' : '#64748b'
                                }}
                            >
                                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                            </button>
                        ))}
                    </div>

                    {/* Basic タブ */}
                    {activeTab === 'basic' && (
                        <form action={updateTenant}>
                            <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                            <input type="hidden" name="__context" value="basic" />

                            <div className="form-group" style={{ marginBottom: '12px' }}>
                                <label className="input-label">Display Name</label>
                                <input name="display_name" defaultValue={tenant.display_name} className="kb-input" style={{ width: '100%' }} />
                            </div>

                            <div className="form-group" style={{ marginBottom: '12px' }}>
                                <label className="input-label" htmlFor={`model-${tenant.tenant_id}`}>AI Model</label>
                                <select name="ai_model" id={`model-${tenant.tenant_id}`} key={tenant.ai_model} defaultValue={tenant.ai_model || 'gpt-4o-mini'} className="kb-input" style={{ width: '100%' }}>
                                    <option value="gpt-4o-mini">Standard (GPT-4o mini)</option>
                                    <option value="gpt-4.1-mini">Pro (GPT-4.1 mini)</option>
                                    <option value="gpt-5-mini">Enterprise (GPT-5 mini)</option>
                                </select>
                            </div>

                            <div className="form-group" style={{ marginBottom: '12px' }}>
                                <label className="input-label">System Prompt</label>
                                <textarea name="system_prompt" defaultValue={tenant.system_prompt} className="prompt-textarea" style={{ height: '120px' }} />
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                <div><label className="input-label">Google Sheet ID</label><input name="google_sheet_id" defaultValue={tenant.google_sheet_id} className="kb-input" style={{ width: '100%' }} placeholder="Sheet ID" /></div>
                                <div><label className="input-label">Staff Passcode</label><input name="staff_passcode" defaultValue={tenant.staff_passcode} className="kb-input" style={{ width: '100%' }} placeholder="1234" /></div>
                            </div>

                            <div className="toggle-switch" style={{ marginBottom: '20px' }}>
                                <input type="checkbox" name="is_active" defaultChecked={tenant.is_active} id={`active-${tenant.tenant_id}`} />
                                <label htmlFor={`active-${tenant.tenant_id}`}>Bot Active</label>
                            </div>

                            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Save Basic Settings</button>
                        </form>
                    )}

                    {/* Billing タブ */}
                    {activeTab === 'billing' && (
                        <div>
                            <form action={updateTenant}>
                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                <input type="hidden" name="__context" value="billing" />
                                <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                                        <div><label className="input-label">Plan</label><select name="plan" defaultValue={tenant.plan || 'Lite'} className="kb-input" style={{ width: '100%' }}><option value="Lite">Lite</option><option value="Standard">Standard</option></select></div>
                                        <div><label className="input-label">Model Opt</label><select name="model_option" defaultValue={tenant.model_option || 'None'} className="kb-input" style={{ width: '100%' }}><option value="None">None</option><option value="ModelA">Model A</option><option value="ModelB">Model B</option></select></div>
                                    </div>

                                    <div style={{ marginBottom: '12px' }}><label className="input-label">Token Limit Update</label><input type="number" name="monthly_token_limit" defaultValue={tenant.monthly_token_limit} className="kb-input" style={{ width: '100%' }} /></div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
                                        <div><label className="input-label">Contract Start</label><input type="date" name="contract_start_date" defaultValue={tenant.contract_start_date} className="kb-input" style={{ width: '100%' }} /></div>
                                        <div><label className="input-label">Next Billing</label><input type="date" name="next_billing_date" defaultValue={tenant.next_billing_date} className="kb-input" style={{ width: '100%' }} /></div>
                                    </div>

                                    {/* 安全のためHiddenで他情報も送る必要はなくなりました (部分更新対応済み) */}

                                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Save Billing Info</button>
                                </div>
                            </form>

                            <div style={{ marginTop: '16px', textAlign: 'right' }}>
                                <form action={quickAddToken} style={{ display: 'inline-block' }}>
                                    <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                    <button type="submit" style={{ background: '#fff7ed', border: '1px solid #fdba74', color: '#c2410c', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span>⚡</span> <strong>Emergency +1M Token</strong>
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {/* Knowledge タブ */}
                    {activeTab === 'knowledge' && (
                        <div className="kb-section">
                            <div className="kb-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                {tenant.knowledge_base?.map((kb: any) => (
                                    <div key={kb.id} className="kb-item">
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', background: '#e0f2fe', color: '#0369a1' }}>{kb.category || 'FAQ'}</span>
                                            <span style={{ flex: 1, fontSize: '0.85rem' }}>{kb.content}</span>
                                            <form action={deleteKnowledge}><input type="hidden" name="id" value={kb.id} /><button type="submit" className="kb-delete-btn">×</button></form>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <form action={addKnowledge} className="kb-add-form" style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <select name="category" className="kb-input" style={{ width: '100%' }}><option value="FAQ">FAQ</option><option value="OFFER">OFFER</option><option value="PRICE">PRICE</option><option value="PROCESS">PROCESS</option><option value="POLICY">POLICY</option><option value="CONTEXT">CONTEXT</option></select>
                                    <input name="content" className="kb-input" placeholder="Knowledge content..." required style={{ width: '100%' }} />
                                </div>
                                <button type="submit" className="btn btn-outline" style={{ height: 'auto' }}>＋</button>
                            </form>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
