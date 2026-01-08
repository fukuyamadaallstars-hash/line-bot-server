'use client';

import { useState } from 'react';
import { updateTenant, addKnowledge, deleteKnowledge, deleteAllKnowledge, resumeAi, quickAddToken, addTokenPurchase, createInvoiceStub, importKnowledgeFromText, importKnowledgeFromFile } from './actions';

export default function TenantCard({ tenant }: { tenant: any }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('basic'); // basic | billing | knowledge
    const [kbFilter, setKbFilter] = useState('ALL');

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
                        {isOpen ? '閉じる' : '設定 ▼'}
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
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                        {[
                            { id: 'basic', label: '基本情報' },
                            { id: 'billing', label: '請求情報' },
                            { id: 'contract', label: '契約管理' },
                            { id: 'purchases', label: '購入履歴' },
                            { id: 'invoices', label: '請求書' },
                            { id: 'knowledge', label: 'ナレッジ' }
                        ].map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                style={{
                                    padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
                                    borderBottom: activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
                                    fontWeight: activeTab === tab.id ? 'bold' : 'normal',
                                    color: activeTab === tab.id ? 'var(--primary)' : '#64748b'
                                }}
                            >
                                {tab.label}
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
                                <select name="ai_model" id={`model-${tenant.tenant_id}`} key={tenant.ai_model} defaultValue={tenant.ai_model || 'gpt-5-mini'} className="kb-input" style={{ width: '100%' }}>
                                    <option value="gpt-5-mini">Lite (GPT-5 mini)</option>
                                    <option value="gpt-5">Standard (GPT-5)</option>
                                    <option value="gpt-5.1">Pro (GPT-5.1)</option>
                                    <option value="gpt-5.2">Consultant (GPT-5.2)</option>
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

                            <div style={{ borderTop: '1px solid #eee', paddingTop: '12px', marginTop: '12px', marginBottom: '12px' }}>
                                <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#64748b' }}>Web Portal Access (テナント管理画面)</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', alignItems: 'center' }}>
                                    <div>
                                        <label className="input-label">Access Password</label>
                                        <input name="web_access_password" defaultValue={tenant.web_access_password} className="kb-input" style={{ width: '100%' }} placeholder="パスワードを設定" />
                                    </div>
                                    <div className="toggle-switch" style={{ marginTop: '18px' }}>
                                        <input type="checkbox" name="web_access_enabled" defaultChecked={tenant.web_access_enabled} id={`web-portal-${tenant.tenant_id}`} />
                                        <input type="hidden" name="web_access_enabled_check" value="true" />
                                        <label htmlFor={`web-portal-${tenant.tenant_id}`}>Enable Portal Access</label>
                                    </div>
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid #eee', paddingTop: '12px', marginTop: '12px' }}>
                                <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#64748b' }}>Billing Contact (宛名)</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                    <div><label className="input-label">会社名/屋号</label><input name="company_name" defaultValue={tenant.company_name} className="kb-input" style={{ width: '100%' }} placeholder="株式会社..." /></div>
                                    <div><label className="input-label">件名 (店舗名など)</label><input name="billing_subject" defaultValue={tenant.billing_subject} className="kb-input" style={{ width: '100%' }} placeholder="〇〇店" /></div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                    <div><label className="input-label">担当者名</label><input name="billing_contact_name" defaultValue={tenant.billing_contact_name} className="kb-input" style={{ width: '100%' }} /></div>
                                    <div><label className="input-label">部署名</label><input name="billing_department" defaultValue={tenant.billing_department} className="kb-input" style={{ width: '100%' }} /></div>
                                </div>
                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label className="input-label">Email (請求先)</label>
                                    <input name="billing_email" defaultValue={tenant.billing_email} className="kb-input" style={{ width: '100%' }} placeholder="bill@..." />
                                </div>
                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label className="input-label">住所</label>
                                    <input name="billing_address" defaultValue={tenant.billing_address} className="kb-input" style={{ width: '100%' }} placeholder="〒..." />
                                </div>
                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label className="input-label">電話番号 (請求用)</label>
                                    <input name="billing_phone" defaultValue={tenant.billing_phone} className="kb-input" style={{ width: '100%' }} placeholder="03-..." />
                                </div>
                            </div>

                            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>基本設定を保存</button>
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
                                        <div><label className="input-label">契約開始日</label><input type="date" name="contract_start_date" defaultValue={tenant.contract_start_date} className="kb-input" style={{ width: '100%' }} /></div>
                                        <div><label className="input-label">次回請求日</label><input type="date" name="next_billing_date" defaultValue={tenant.next_billing_date} className="kb-input" style={{ width: '100%' }} /></div>
                                    </div>

                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                                        <div><label className="input-label">請求日 (締日)</label><input type="number" name="billing_cycle_day" defaultValue={tenant.billing_cycle_day} className="kb-input" style={{ width: '100%' }} placeholder="1" /></div>
                                        <div><label className="input-label">支払期限 (日)</label><input type="number" name="payment_term_days" defaultValue={tenant.payment_term_days} className="kb-input" style={{ width: '100%' }} placeholder="10" /></div>
                                        <div><label className="input-label">ステータス</label><select name="billing_status" defaultValue={tenant.billing_status || 'active'} className="kb-input" style={{ width: '100%' }}><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
                                    </div>
                                    <div style={{ marginBottom: '12px' }}>
                                        <label className="input-label">顧客の振込名義</label>
                                        <input name="bank_transfer_name" defaultValue={tenant.bank_transfer_name} className="kb-input" style={{ width: '100%' }} placeholder="1234-COMPANY" />
                                    </div>

                                    {/* 安全のためHiddenで他情報も送る必要はなくなりました (部分更新対応済み) */}

                                    <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>請求情報を保存</button>
                                </div>
                            </form>

                            <div style={{ marginTop: '16px', textAlign: 'right' }}>
                                <form action={quickAddToken} style={{ display: 'inline-block' }}>
                                    <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                    <button type="submit" style={{ background: '#fff7ed', border: '1px solid #fdba74', color: '#c2410c', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        <span>⚡</span> <strong>緊急 +1M トークン追加</strong>
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                    {/* Contract Tab */}
                    {activeTab === 'contract' && (
                        <form action={updateTenant}>
                            <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                            <input type="hidden" name="__context" value="contract" />

                            <div className="stat-box" style={{ background: '#f0f9ff', border: '1px solid #bae6fd', marginBottom: '16px' }}>
                                <h4 style={{ margin: '0 0 8px 0', color: '#0369a1' }}>契約状況</h4>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.85rem' }}>
                                    <div>Plan: <strong>{tenant.plan || 'Lite'}</strong></div>
                                    <div>Model: <strong>{tenant.model_option || 'None'}</strong></div>
                                    <div>Updates: <strong>{tenant.kb_update_limit || 1}回/月</strong></div>
                                    <div>KB Limit: <strong>{tenant.kb_limit}</strong></div>
                                </div>
                            </div>

                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label className="input-label">次回契約変更予約 (JSON形式)</label>
                                <textarea name="next_contract_changes" defaultValue={JSON.stringify(tenant.next_contract_changes || {}, null, 2)} className="prompt-textarea" style={{ height: '80px', fontFamily: 'monospace' }} />
                                <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{"例: { \"plan\": \"Standard\", \"apply_date\": \"2025-02-01\" }"}</div>
                            </div>

                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label className="input-label">β特典管理 (JSON形式)</label>
                                <textarea name="beta_perks" defaultValue={JSON.stringify(tenant.beta_perks || {}, null, 2)} className="prompt-textarea" style={{ height: '80px', fontFamily: 'monospace' }} />
                            </div>

                            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>契約予約を保存</button>
                        </form>
                    )}

                    {/* Purchases Tab */}
                    {activeTab === 'purchases' && (
                        <div>
                            <div className="kb-list" style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '16px' }}>
                                {(tenant.token_purchases || []).map((p: any) => (
                                    <div key={p.id} className="kb-item">
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 'bold' }}>+{p.amount?.toLocaleString()} Tokens</div>
                                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{new Date(p.purchase_date).toLocaleDateString()} - ¥{p.price?.toLocaleString()}</div>
                                        </div>
                                        <span className={`status-badge ${p.status === 'paid' ? 'status-active' : 'status-inactive'}`}>{p.status}</span>
                                    </div>
                                ))}
                                {(tenant.token_purchases || []).length === 0 && <div style={{ padding: '8px', color: '#94a3b8', fontSize: '0.8rem' }}>No purchases yet.</div>}
                            </div>

                            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
                                <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem' }}>新規購入の記録</h5>
                                <form action={addTokenPurchase}>
                                    <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                                        <input name="amount" type="number" defaultValue={1000000} className="kb-input" placeholder="Amount" />
                                        <input name="price" type="number" defaultValue={4500} className="kb-input" placeholder="Price (¥)" />
                                    </div>
                                    <button type="submit" className="btn btn-outline" style={{ width: '100%', fontSize: '0.8rem' }}>+ 購入を記録</button>
                                </form>
                            </div>
                        </div>
                    )}

                    {/* Invoices Tab */}
                    {activeTab === 'invoices' && (
                        <div>
                            <div className="kb-list" style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                {(tenant.invoices || []).map((inv: any) => (
                                    <div key={inv.id} className="kb-item">
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 'bold' }}>{inv.invoice_number}</div>
                                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{inv.target_month} - ¥{inv.amount_total?.toLocaleString()}</div>
                                        </div>
                                        <span className={`status-badge ${inv.status === 'paid' ? 'status-active' : 'status-inactive'}`}>{inv.status}</span>
                                    </div>
                                ))}
                                {(tenant.invoices || []).length === 0 && <div style={{ padding: '8px', color: '#94a3b8', fontSize: '0.8rem' }}>請求書はありません。</div>}
                            </div>
                            <form action={createInvoiceStub}>
                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                <button type="submit" className="btn btn-outline" style={{ width: '100%', fontSize: '0.8rem' }}>+ 請求書下書きを作成</button>
                            </form>
                        </div>
                    )}
                    {activeTab === 'knowledge' && (
                        <div className="kb-section">
                            {/* Filter Buttons */}
                            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
                                <button
                                    onClick={() => setKbFilter('ALL')}
                                    style={{
                                        padding: '4px 10px', borderRadius: '16px', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '0.75rem',
                                        background: kbFilter === 'ALL' ? 'var(--primary)' : 'white',
                                        color: kbFilter === 'ALL' ? 'white' : '#64748b'
                                    }}
                                >
                                    すべて
                                </button>
                                {['FAQ', 'OFFER', 'PRICE', 'PROCESS', 'POLICY', 'CONTEXT'].map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setKbFilter(cat)}
                                        style={{
                                            padding: '4px 10px', borderRadius: '16px', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '0.75rem',
                                            background: kbFilter === cat ? '#e0f2fe' : 'white',
                                            color: kbFilter === cat ? '#0369a1' : '#64748b',
                                            borderColor: kbFilter === cat ? '#bae6fd' : '#e2e8f0'
                                        }}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>

                            <div className="kb-list" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                {(tenant.knowledge_base || [])
                                    .filter((kb: any) => kbFilter === 'ALL' || (kb.category || 'FAQ') === kbFilter)
                                    .map((kb: any) => (
                                        <div key={kb.id} className="kb-item">
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold', background: '#e0f2fe', color: '#0369a1' }}>{kb.category || 'FAQ'}</span>
                                                <span style={{ flex: 1, fontSize: '0.85rem' }}>{kb.content}</span>
                                                <form action={deleteKnowledge}><input type="hidden" name="id" value={kb.id} /><button type="submit" className="kb-delete-btn">×</button></form>
                                            </div>
                                        </div>
                                    ))}
                                {(tenant.knowledge_base || []).filter((kb: any) => kbFilter === 'ALL' || (kb.category || 'FAQ') === kbFilter).length === 0 && (
                                    <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.85rem' }}>
                                        このカテゴリーのナレッジはありません。
                                    </div>
                                )}
                            </div>

                            <form action={addKnowledge} className="kb-add-form" style={{ display: 'flex', gap: '8px', marginTop: '12px', borderTop: '2px solid #f1f5f9', paddingTop: '16px' }}>
                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <select name="category" className="kb-input" style={{ width: '100%' }} defaultValue={kbFilter !== 'ALL' ? kbFilter : 'FAQ'}>
                                        <option value="FAQ">FAQ (よくある質問)</option>
                                        <option value="OFFER">OFFER (キャンペーン)</option>
                                        <option value="PRICE">PRICE (料金・コース)</option>
                                        <option value="PROCESS">PROCESS (予約・流れ)</option>
                                        <option value="POLICY">POLICY (キャンセル規定)</option>
                                        <option value="CONTEXT">CONTEXT (店舗特徴・こだわり)</option>
                                    </select>
                                    <input name="content" className="kb-input" placeholder="新しいナレッジを追加..." required style={{ width: '100%' }} />
                                </div>
                                <button type="submit" className="btn btn-outline" style={{ height: 'auto' }}>＋</button>
                            </form>

                            <div style={{ marginTop: '24px', paddingTop: '16px', borderTop: '2px dashed #e2e8f0' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <h5 style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>📂 ファイルからインポート (PDF/Word/CSV)</h5>
                                </div>
                                <form action={importKnowledgeFromFile} style={{ background: '#f0fdf4', padding: '12px', borderRadius: '8px', border: '1px solid #bbf7d0', marginBottom: '16px' }}>
                                    <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                    <div style={{ marginBottom: '8px' }}>
                                        <select name="category" className="kb-input" style={{ width: '100%', marginBottom: '8px' }} defaultValue="FAQ">
                                            <option value="FAQ">FAQ (よくある質問)</option>
                                            <option value="OFFER">OFFER (キャンペーン)</option>
                                            <option value="PRICE">PRICE (料金・コース)</option>
                                            <option value="PROCESS">PROCESS (予約・流れ)</option>
                                            <option value="POLICY">POLICY (キャンセル規定)</option>
                                            <option value="CONTEXT">CONTEXT (店舗特徴・こだわり)</option>
                                        </select>
                                        <input type="file" name="file" accept=".pdf,.docx,.csv,.txt" className="kb-input" style={{ width: '100%', background: 'white' }} required />
                                        <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: '4px' }}>
                                            ※ PDF, Word, CSV, Textに対応。最大10MB。<br />
                                            ※ 自動的に適切なサイズに分割(Chunking)されて登録されます。
                                        </div>
                                    </div>
                                    <button type="submit" className="btn btn-primary" style={{ width: '100%', fontSize: '0.85rem', background: '#16a34a', borderColor: '#15803d' }}>📤 ファイルを解析して一括登録</button>
                                </form>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <h5 style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>📝 テキスト貼り付け・一括削除</h5>
                                    <form
                                        action={deleteAllKnowledge}
                                        onSubmit={(e) => {
                                            if (!confirm('本当にすべてのナレッジを削除しますか？\nこの操作は取り消せません。')) {
                                                e.preventDefault();
                                            }
                                        }}
                                    >
                                        <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                        <button type="submit" style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '4px', padding: '4px 8px', fontSize: '0.75rem', cursor: 'pointer' }}>
                                            ⚠️ すべて削除
                                        </button>
                                    </form>
                                </div>
                                <form action={importKnowledgeFromText} style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px' }}>
                                    <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                    <div style={{ marginBottom: '8px' }}>
                                        <select name="category" className="kb-input" style={{ width: '100%', marginBottom: '8px' }} defaultValue="FAQ">
                                            <option value="FAQ">FAQ (よくある質問)</option>
                                            <option value="OFFER">OFFER (キャンペーン)</option>
                                            <option value="PRICE">PRICE (料金・コース)</option>
                                            <option value="PROCESS">PROCESS (予約・流れ)</option>
                                            <option value="POLICY">POLICY (キャンセル規定)</option>
                                            <option value="CONTEXT">CONTEXT (店舗特徴・こだわり)</option>
                                        </select>
                                        <textarea
                                            name="text"
                                            className="prompt-textarea"
                                            placeholder="ここに長文を貼り付けてください。&#13;&#10;・段落ごとに自動分割されます。&#13;&#10;・文頭に [FAQ] や [PRICE] などのカテゴリ名を書くと、自動でそのカテゴリに振り分けられます。&#13;&#10;・カテゴリ指定がない場合は、上のプルダウンで選択したカテゴリが適用されます。"
                                            style={{ height: '120px', width: '100%', fontSize: '0.8rem' }}
                                        />
                                    </div>
                                    <button type="submit" className="btn btn-primary" style={{ width: '100%', fontSize: '0.85rem' }}>🚀 AI自動分割して一括登録</button>
                                </form>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
