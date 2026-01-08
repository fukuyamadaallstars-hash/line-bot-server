'use client';

import { useState } from 'react';
import { updateSystemPrompt, addKnowledge, deleteKnowledge, importKnowledgeFromText, importKnowledgeFromFile, logoutTenant } from '../actions';

export default function DashboardClient({ tenant }: { tenant: any }) {
    const [activeTab, setActiveTab] = useState<'prompt' | 'knowledge'>('prompt');
    const [kbFilter, setKbFilter] = useState('ALL');

    return (
        <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: '"Inter", sans-serif' }}>
            {/* Header */}
            <header style={{ background: 'white', borderBottom: '1px solid #e2e8f0', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '40px', height: '40px', background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold' }}>
                        AI
                    </div>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 'bold', color: '#0f172a' }}>{tenant.display_name}</h1>
                        <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Tenant Portal</span>
                    </div>
                </div>
                <form action={logoutTenant}>
                    <button type="submit" style={{ background: 'white', border: '1px solid #cbd5e1', padding: '8px 16px', borderRadius: '6px', fontSize: '0.9rem', cursor: 'pointer', color: '#475569' }}>
                        Logout
                    </button>
                </form>
            </header>

            {/* Main Content */}
            <main style={{ maxWidth: '1000px', margin: '32px auto', padding: '0 24px' }}>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <button
                        onClick={() => setActiveTab('prompt')}
                        style={{
                            padding: '10px 20px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem',
                            background: activeTab === 'prompt' ? 'white' : 'transparent',
                            color: activeTab === 'prompt' ? '#0f172a' : '#64748b',
                            boxShadow: activeTab === 'prompt' ? '0 -2px 10px rgba(0,0,0,0.02)' : 'none'
                        }}
                    >
                        🤖 AI Personality (Prompt)
                    </button>
                    <button
                        onClick={() => setActiveTab('knowledge')}
                        style={{
                            padding: '10px 20px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem',
                            background: activeTab === 'knowledge' ? 'white' : 'transparent',
                            color: activeTab === 'knowledge' ? '#0f172a' : '#64748b',
                            boxShadow: activeTab === 'knowledge' ? '0 -2px 10px rgba(0,0,0,0.02)' : 'none'
                        }}
                    >
                        📚 Knowledge Base
                    </button>
                </div>

                <div style={{ background: 'white', borderRadius: '0 8px 8px 8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', padding: '24px', minHeight: '600px' }}>

                    {/* Prompt Tab */}
                    {activeTab === 'prompt' && (
                        <div className="prompt-section">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '16px', color: '#334155' }}>AI人格・指示設定</h2>
                            <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '16px' }}>
                                AIの振る舞い、口調、役割などを定義します。ここでの設定が全ての応答の基礎となります。
                            </p>
                            <form action={updateSystemPrompt}>
                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                <textarea
                                    name="system_prompt"
                                    defaultValue={tenant.system_prompt}
                                    style={{
                                        width: '100%', height: '400px', padding: '16px', borderRadius: '8px',
                                        border: '1px solid #e2e8f0', fontSize: '0.95rem', lineHeight: '1.6',
                                        fontFamily: 'monospace', resize: 'vertical'
                                    }}
                                />
                                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                                    <button type="submit" style={{ background: '#2563eb', color: 'white', border: 'none', padding: '10px 24px', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer', fontWeight: 'bold' }}>
                                        保存する
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Knowledge Tab */}
                    {activeTab === 'knowledge' && (
                        <div className="kb-section">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '16px', color: '#334155' }}>ナレッジベース (知識管理)</h2>
                            <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '16px' }}>
                                AIに教えたい店舗情報やQAを登録します。自動的に検索され、回答に使用されます。
                            </p>

                            {/* Filters */}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                                <button
                                    onClick={() => setKbFilter('ALL')}
                                    style={{
                                        padding: '6px 14px', borderRadius: '20px', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '0.85rem',
                                        background: kbFilter === 'ALL' ? '#3b82f6' : 'white',
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
                                            padding: '6px 14px', borderRadius: '20px', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '0.85rem',
                                            background: kbFilter === cat ? '#eff6ff' : 'white',
                                            color: kbFilter === cat ? '#1d4ed8' : '#64748b',
                                            borderColor: kbFilter === cat ? '#bfdbfe' : '#e2e8f0'
                                        }}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>

                            {/* List */}
                            <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '24px' }}>
                                {(tenant.knowledge_base || [])
                                    .filter((kb: any) => kbFilter === 'ALL' || (kb.category || 'FAQ') === kbFilter)
                                    .map((kb: any) => (
                                        <div key={kb.id} style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '12px', alignItems: 'start' }}>
                                            <span style={{
                                                fontSize: '0.7rem', padding: '4px 8px', borderRadius: '4px', fontWeight: 'bold',
                                                background: '#f1f5f9', color: '#475569', whiteSpace: 'nowrap', marginTop: '2px'
                                            }}>
                                                {kb.category || 'FAQ'}
                                            </span>
                                            <div style={{ flex: 1, fontSize: '0.9rem', color: '#334155', whiteSpace: 'pre-wrap' }}>{kb.content}</div>
                                            <form action={deleteKnowledge}>
                                                <input type="hidden" name="id" value={kb.id} />
                                                <button type="submit" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#cbd5e1', fontSize: '1.2rem', padding: '0 4px' }}>
                                                    ×
                                                </button>
                                            </form>
                                        </div>
                                    ))}
                                {(tenant.knowledge_base || []).filter((kb: any) => kbFilter === 'ALL' || (kb.category || 'FAQ') === kbFilter).length === 0 && (
                                    <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>
                                        アイテムがありません
                                    </div>
                                )}
                            </div>

                            {/* Add Single */}
                            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#64748b' }}>📝 1件ずつ追加</h4>
                                <form action={addKnowledge} style={{ display: 'flex', gap: '8px' }}>
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <select name="category" defaultValue={kbFilter === 'ALL' ? 'FAQ' : kbFilter} style={{ padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}>
                                            <option value="FAQ">FAQ (よくある質問)</option>
                                            <option value="OFFER">OFFER (キャンペーン)</option>
                                            <option value="PRICE">PRICE (料金・コース)</option>
                                            <option value="PROCESS">PROCESS (予約・流れ)</option>
                                            <option value="POLICY">POLICY (キャンセル規定)</option>
                                            <option value="CONTEXT">CONTEXT (店舗特徴・こだわり)</option>
                                        </select>
                                        <textarea name="content" placeholder="内容を入力..." required style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', minHeight: '60px' }} />
                                    </div>
                                    <button type="submit" style={{ height: 'fit-content', background: 'white', border: '1px solid #cbd5e1', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}>追加</button>
                                </form>
                            </div>


                            {/* File Import */}
                            <div style={{ background: '#f0fdf4', padding: '16px', borderRadius: '8px', border: '1px dashed #bbf7d0', marginBottom: '24px' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#15803d' }}>📂 ファイルからインポート (PDF/Word/CSV)</h4>
                                <form action={importKnowledgeFromFile}>
                                    <div style={{ marginBottom: '12px' }}>
                                        <select name="category" defaultValue="FAQ" style={{ padding: '8px', borderRadius: '6px', border: '1px solid #bbf7d0', width: '100%', marginBottom: '8px' }}>
                                            <option value="FAQ">FAQ (よくある質問)</option>
                                            <option value="OFFER">OFFER (キャンペーン)</option>
                                            <option value="PRICE">PRICE (料金・コース)</option>
                                            <option value="PROCESS">PROCESS (予約・流れ)</option>
                                            <option value="POLICY">POLICY (キャンセル規定)</option>
                                            <option value="CONTEXT">CONTEXT (店舗特徴・こだわり)</option>
                                        </select>
                                        <input type="file" name="file" accept=".pdf,.docx,.csv,.txt" style={{ width: '100%', padding: '8px', background: 'white', borderRadius: '6px', border: '1px solid #bbf7d0' }} required />
                                        <div style={{ fontSize: '0.75rem', color: '#166534', marginTop: '6px' }}>
                                            ※ PDF, Word(.docx), CSV, Textに対応。<br />
                                            ※ 自動的に適切なサイズに分割され、現在のAIモデル設定に基づいて登録されます。
                                        </div>
                                    </div>
                                    <button type="submit" style={{ width: '100%', background: '#22c55e', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                                        ファイルを解析して登録
                                    </button>
                                </form>
                            </div>

                            {/* Bulk Import */}
                            <div style={{ background: '#f0f9ff', padding: '16px', borderRadius: '8px', border: '1px dashed #bae6fd' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#0369a1' }}>🚀 テキスト一括インポート (長文対応)</h4>
                                <form action={importKnowledgeFromText}>
                                    <div style={{ marginBottom: '12px' }}>
                                        <select name="category" defaultValue="FAQ" style={{ padding: '8px', borderRadius: '6px', border: '1px solid #bae6fd', width: '100%', marginBottom: '8px' }}>
                                            <option value="FAQ">FAQ (よくある質問)</option>
                                            <option value="OFFER">OFFER (キャンペーン)</option>
                                            <option value="PRICE">PRICE (料金・コース)</option>
                                            <option value="PROCESS">PROCESS (予約・流れ)</option>
                                            <option value="POLICY">POLICY (キャンセル規定)</option>
                                            <option value="CONTEXT">CONTEXT (店舗特徴・こだわり)</option>
                                        </select>
                                        <textarea
                                            name="text"
                                            placeholder={`[FAQ] 質問...&#13;&#10;回答...&#13;&#10;&#13;&#10;[PRICE]...&#13;&#10;&#13;&#10;のように、ヘッダー行をつけることで自動分類されます。`}
                                            style={{ width: '100%', padding: '12px', borderRadius: '6px', border: '1px solid #bae6fd', minHeight: '120px', fontSize: '0.9rem' }}
                                        />
                                    </div>
                                    <button type="submit" style={{ width: '100%', background: '#0ea5e9', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                                        AI自動分割して登録
                                    </button>
                                </form>
                            </div>
                        </div>
                    )}

                </div>
            </main>
        </div>
    );
}
