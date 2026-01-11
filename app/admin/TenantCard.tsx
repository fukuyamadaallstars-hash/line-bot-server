'use client';

import { useState, useEffect, useRef } from 'react';
import { updateTenant, addKnowledge, deleteKnowledge, deleteAllKnowledge, resumeAi, quickAddToken, addTokenPurchase, createInvoiceStub, importKnowledgeFromText, importKnowledgeFromFile, reEmbedAllKnowledge, toggleTenantActive, createTenant } from './actions';

// PDF.js を動的に読み込むためのグローバル宣言
declare global {
    interface Window {
        pdfjsLib: any;
    }
}

export default function TenantCard({ tenant }: { tenant: any }) {
    const [isOpen, setIsOpen] = useState(false);
    const [activeTab, setActiveTab] = useState('basic'); // basic | billing | knowledge
    const [kbFilter, setKbFilter] = useState('ALL');
    const [pdfStatus, setPdfStatus] = useState<string>('');
    const [pdfText, setPdfText] = useState<string>('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // PDF.js ライブラリを動的にロード
    useEffect(() => {
        if (typeof window !== 'undefined' && !window.pdfjsLib) {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.async = true;
            script.onload = () => {
                if (window.pdfjsLib) {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                }
            };
            document.head.appendChild(script);
        }
    }, []);

    // PDF ファイルからテキストを抽出する関数
    const extractTextFromPdf = async (file: File): Promise<string> => {
        return new Promise(async (resolve, reject) => {
            try {
                if (!window.pdfjsLib) {
                    reject(new Error('PDF.js がまだ読み込まれていません。少し待ってから再度お試しください。'));
                    return;
                }

                setPdfStatus('📄 PDFを解析中...');
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;

                let fullText = '';
                for (let i = 1; i <= pdf.numPages; i++) {
                    setPdfStatus(`📄 ページ ${i}/${pdf.numPages} を処理中...`);
                    const page = await pdf.getPage(i);
                    const textContent = await page.getTextContent();
                    const pageText = textContent.items.map((item: any) => item.str).join(' ');
                    fullText += pageText + '\n\n';
                }

                setPdfStatus('');
                resolve(fullText.trim());
            } catch (error: any) {
                setPdfStatus('');
                reject(error);
            }
        });
    };

    // ファイル選択時のハンドラ
    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // PDFの場合はクライアントサイドで処理
        if (file.name.endsWith('.pdf') || file.type === 'application/pdf') {
            try {
                const text = await extractTextFromPdf(file);
                setPdfText(text);
                // テキストエリアに自動入力（テキストインポートフォームを使う）
                alert(`✅ PDFから ${text.length} 文字を抽出しました。\n\n下の「テキストから一括登録」エリアにテキストが入力されました。内容を確認してSaveボタンを押してください。`);
            } catch (error: any) {
                alert('❌ PDF解析エラー: ' + error.message);
            }
            // ファイル入力をリセット
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
        // PDF以外は従来通りサーバーで処理（フォーム送信）
    };

    return (
        <div className="bot-card" style={{ transition: 'all 0.3s ease', opacity: tenant.is_active ? 1 : 0.6 }}>
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

            {/* トークン消費率プログレスバー */}
            {(() => {
                const limit = tenant.monthly_token_limit || 1;
                const used = tenant.stats?.totalTokens || 0;
                const ratio = Math.min(used / limit, 1);
                const percent = (ratio * 100).toFixed(1);
                const barColor = ratio >= 0.95 ? '#ef4444' : ratio >= 0.80 ? '#f59e0b' : '#22c55e';

                return (
                    <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b', marginBottom: '4px' }}>
                            <span>Token: {(used / 1000).toFixed(0)}k / {(limit / 1000).toFixed(0)}k</span>
                            <span style={{ color: barColor, fontWeight: ratio >= 0.80 ? 'bold' : 'normal' }}>
                                {percent}%
                                {ratio >= 0.95 && ' ⚠️危険'}
                                {ratio >= 0.80 && ratio < 0.95 && ' ⚠️警告'}
                            </span>
                        </div>
                        <div style={{ background: '#e2e8f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
                            <div style={{ background: barColor, width: `${percent}%`, height: '100%', transition: 'width 0.3s ease' }} />
                        </div>
                    </div>
                );
            })()}

            {/* 統計エリア（常に表示） */}
            <div className="stats-row" style={{ marginBottom: isOpen ? '24px' : '0' }}>
                <div className="stat-box">
                    <span className="stat-label">返信数</span>
                    <span className="stat-value">{tenant.stats.messageCount}</span>
                </div>
                <div className="stat-box">
                    <span className="stat-label">プラン</span>
                    <span className="stat-value" style={{ fontSize: '0.9rem' }}>{tenant.plan || 'Lite'}</span>
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

            {/* クイック操作ボタン */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', flexWrap: 'wrap' }}>
                {tenant.is_active ? (
                    <form action={toggleTenantActive}>
                        <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                        <input type="hidden" name="action" value="pause" />
                        <button type="submit" style={{ padding: '4px 12px', fontSize: '0.75rem', border: '1px solid #f59e0b', borderRadius: '4px', background: '#fffbeb', color: '#b45309', cursor: 'pointer' }}>
                            ⏸️ 停止
                        </button>
                    </form>
                ) : (
                    <form action={toggleTenantActive}>
                        <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                        <input type="hidden" name="action" value="resume" />
                        <button type="submit" style={{ padding: '4px 12px', fontSize: '0.75rem', border: '1px solid #22c55e', borderRadius: '4px', background: '#f0fdf4', color: '#16a34a', cursor: 'pointer' }}>
                            ▶️ 再開
                        </button>
                    </form>
                )}

                {/* 次回請求日 */}
                {tenant.contract_start_date && (
                    <div style={{ fontSize: '0.75rem', color: '#64748b', display: 'flex', alignItems: 'center', marginLeft: 'auto' }}>
                        📅 次回請求: {(() => {
                            const start = new Date(tenant.contract_start_date);
                            const cycleDay = tenant.billing_cycle_day || start.getDate();
                            const now = new Date();
                            let nextBilling = new Date(now.getFullYear(), now.getMonth(), cycleDay);
                            if (nextBilling <= now) {
                                nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, cycleDay);
                            }
                            const daysUntil = Math.ceil((nextBilling.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                            return (
                                <span style={{ marginLeft: '4px', color: daysUntil <= 7 ? '#ef4444' : '#64748b', fontWeight: daysUntil <= 7 ? 'bold' : 'normal' }}>
                                    {nextBilling.toLocaleDateString('ja-JP')} {daysUntil <= 7 && `(${daysUntil}日後)`}
                                </span>
                            );
                        })()}
                    </div>
                )}
            </div>

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
                                <select name="ai_model" id={`model-${tenant.tenant_id}`} key={tenant.ai_model} defaultValue={tenant.ai_model || 'gpt-4o-mini'} className="kb-input" style={{ width: '100%' }}>
                                    <optgroup label="店舗・予約自動化用">
                                        <option value="gpt-4o-mini">Standard (GPT-4o mini)</option>
                                        <option value="gpt-4.1">Pro (GPT-4.1)</option>
                                    </optgroup>
                                    <optgroup label="コンサルタント用">
                                        <option value="gpt-5-mini">Consultant Lite (GPT-5 mini)</option>
                                        <option value="gpt-5.1">Consultant Pro (GPT-5.1)</option>
                                        <option value="gpt-5.2">Consultant Ultra (GPT-5.2)</option>
                                    </optgroup>
                                </select>
                            </div>

                            <div className="form-group" style={{ marginBottom: '12px' }}>
                                <label className="input-label" htmlFor={`embed-model-${tenant.tenant_id}`}>Embedding Model (Search Accuracy)</label>
                                <div style={{ background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '6px', padding: '8px', marginBottom: '8px', fontSize: '0.8rem', color: '#92400e' }}>
                                    ⚠️ <strong>注意:</strong> モデルを変更した後は、必ず下部の「Knowledge Base」タブにある「全ナレッジ再埋め込み」を実行してください。実行しないと検索が機能しません。
                                </div>
                                <select name="embedding_model" id={`embed-model-${tenant.tenant_id}`} key={tenant.embedding_model} defaultValue={tenant.embedding_model || 'text-embedding-3-small'} className="kb-input" style={{ width: '100%' }}>
                                    <option value="text-embedding-3-small">Standard (Small - 1536 dim)</option>
                                    <option value="text-embedding-3-large">High Accuracy (Large - 3072 dim)</option>
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

                                {/* ポータル権限設定 */}
                                <div style={{ marginTop: '12px', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                    <h5 style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: '#64748b' }}>🔐 ポータル機能の権限</h5>
                                    <input type="hidden" name="portal_permissions_present" value="true" />
                                    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
                                            <input type="checkbox" name="portal_allow_prompt_edit" defaultChecked={tenant.portal_allow_prompt_edit} />
                                            プロンプト編集を許可
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
                                            <input type="checkbox" name="portal_allow_knowledge_edit" defaultChecked={tenant.portal_allow_knowledge_edit} />
                                            ナレッジ編集を許可
                                        </label>
                                    </div>
                                    <p style={{ margin: '8px 0 0 0', fontSize: '0.7rem', color: '#94a3b8' }}>
                                        ※ API設定（トークン入力）は常に許可されます
                                    </p>
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
                                <div style={{ marginBottom: '20px', padding: '12px', background: '#fff7ed', borderRadius: '8px', border: '1px solid #fed7aa' }}>
                                    <h5 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#c2410c' }}>🔄 データ整合性ツール (モデル変更時用)</h5>
                                    <p style={{ margin: '0 0 12px 0', fontSize: '0.75rem', color: '#9a3412' }}>
                                        Embeddingモデルを変更した場合、既存のナレッジは検索できなくなります。<br />
                                        モデル切り替え後は必ずここで「再埋め込み」を実行してください。
                                    </p>
                                    <form action={reEmbedAllKnowledge}>
                                        <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                        <button type="submit" className="btn" style={{ width: '100%', fontSize: '0.85rem', background: '#f97316', color: 'white', border: '1px solid #ea580c' }}>
                                            ⚠️ 現在の設定で全データを再埋め込み (Re-Embed All)
                                        </button>
                                    </form>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                    <h5 style={{ margin: 0, fontSize: '0.9rem', color: '#64748b' }}>📂 ファイルからインポート (PDF/Word/CSV)</h5>
                                </div>

                                {/* PDF処理ステータス表示 */}
                                {pdfStatus && (
                                    <div style={{ background: '#dbeafe', padding: '12px', borderRadius: '8px', marginBottom: '12px', color: '#1e40af', fontSize: '0.9rem' }}>
                                        {pdfStatus}
                                    </div>
                                )}

                                {/* PDFはクライアントサイドで処理、他はサーバーで処理 */}
                                <div style={{ background: '#f0fdf4', padding: '12px', borderRadius: '8px', border: '1px solid #bbf7d0', marginBottom: '16px' }}>
                                    <div style={{ marginBottom: '8px' }}>
                                        <input
                                            type="file"
                                            ref={fileInputRef}
                                            accept=".pdf,.docx,.csv,.txt"
                                            className="kb-input"
                                            style={{ width: '100%', background: 'white' }}
                                            onChange={handleFileChange}
                                        />
                                        <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: '4px' }}>
                                            ※ <strong>PDF</strong>: ブラウザで解析 → 下のテキストエリアに自動入力<br />
                                            ※ <strong>Word/CSV/Text</strong>: 選択後にボタンでサーバー処理
                                        </div>
                                    </div>
                                    <form action={importKnowledgeFromFile}>
                                        <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                        <input type="hidden" name="category" value="FAQ" />
                                        <input type="hidden" name="file" value="" />
                                        <button
                                            type="submit"
                                            className="btn btn-primary"
                                            style={{ width: '100%', fontSize: '0.85rem', background: '#16a34a', borderColor: '#15803d' }}
                                            onClick={(e) => {
                                                const fileInput = fileInputRef.current;
                                                if (!fileInput?.files?.[0]) {
                                                    e.preventDefault();
                                                    alert('ファイルを選択してください');
                                                    return;
                                                }
                                                const file = fileInput.files[0];
                                                if (file.name.endsWith('.pdf')) {
                                                    e.preventDefault();
                                                    alert('PDFは自動的に下のテキストエリアに入力されます。\nテキストエリアの内容を確認して「AI自動分割して一括登録」ボタンを押してください。');
                                                    return;
                                                }
                                                // PDF以外はフォーム送信（サーバー処理）
                                                const formData = new FormData();
                                                formData.append('tenant_id', tenant.tenant_id);
                                                formData.append('category', 'FAQ');
                                                formData.append('file', file);
                                                importKnowledgeFromFile(formData);
                                                e.preventDefault();
                                            }}
                                        >
                                            📤 Word/CSV/Textを解析して一括登録
                                        </button>
                                    </form>
                                </div>

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
                                            placeholder="ここに長文を貼り付けてください。&#13;&#10;・段落ごとに自動分割されます。&#13;&#10;・文頭に [FAQ] や [PRICE] などのカテゴリ名を書くと、自動でそのカテゴリに振り分けられます。&#13;&#10;・カテゴリ指定がない場合は、上のプルダウンで選択したカテゴリが適用されます。&#13;&#10;・PDFを選択すると、ここに自動入力されます。"
                                            style={{ height: '120px', width: '100%', fontSize: '0.8rem' }}
                                            defaultValue={pdfText}
                                            key={pdfText} // pdfTextが変わったら再レンダリング
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
