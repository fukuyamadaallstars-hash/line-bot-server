'use client';

import { useState, useMemo } from 'react';
import { updateSystemPrompt, addKnowledge, deleteKnowledge, importKnowledgeFromText, importKnowledgeFromFile, logoutTenant, updateApiSettings, updateUserProfile, getUsers } from '../actions';

export default function DashboardClient({ tenant, initialUsers = [] }: { tenant: any, initialUsers?: any[] }) {
    const [activeTab, setActiveTab] = useState<'api' | 'prompt' | 'knowledge' | 'users'>('api');
    const [kbFilter, setKbFilter] = useState('ALL');
    const [users, setUsers] = useState(initialUsers);
    const [selectedUser, setSelectedUser] = useState<any>(null);
    const [userSearch, setUserSearch] = useState('');

    // 権限チェック
    const canEditPrompt = tenant.portal_allow_prompt_edit === true;
    const canEditKnowledge = tenant.portal_allow_knowledge_edit === true;
    // ★ユーザー管理: 全テナントで利用可能に変更
    const canManageUsers = true;

    // トークン設定状態のチェック（暗号化されていれば設定済み）
    const hasAccessToken = !!tenant.line_channel_access_token;
    const hasChannelSecret = !!tenant.line_channel_secret;

    const filteredUsers = useMemo(() => {
        if (!userSearch) return users;
        return users.filter(u =>
            (u.display_name?.toLowerCase().includes(userSearch.toLowerCase())) ||
            (u.user_id?.toLowerCase().includes(userSearch.toLowerCase()))
        );
    }, [users, userSearch]);

    async function handleUserSearch(e: React.FormEvent) {
        e.preventDefault();
        const results = await getUsers(userSearch);
        setUsers(results || []);
    }

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
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '0.75rem', padding: '4px 8px', borderRadius: '4px', background: '#f1f5f9', color: '#475569', fontWeight: 'bold' }}>
                        {tenant.plan} Plan
                    </span>
                    <form action={logoutTenant}>
                        <button type="submit" style={{ background: 'white', border: '1px solid #cbd5e1', padding: '8px 16px', borderRadius: '6px', fontSize: '0.9rem', cursor: 'pointer', color: '#475569' }}>
                            Logout
                        </button>
                    </form>
                </div>
            </header>

            {/* Main Content */}
            <main style={{ maxWidth: '1000px', margin: '32px auto', padding: '0 24px' }}>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: '4px', marginBottom: '0', flexWrap: 'wrap' }}>
                    <TabButton active={activeTab === 'api'} onClick={() => setActiveTab('api')} icon="🔑" label="API設定" />
                    {canEditPrompt && <TabButton active={activeTab === 'prompt'} onClick={() => setActiveTab('prompt')} icon="🤖" label="AI人格" />}
                    {canEditKnowledge && <TabButton active={activeTab === 'knowledge'} onClick={() => setActiveTab('knowledge')} icon="📚" label="ナレッジ" />}
                    {canManageUsers && <TabButton active={activeTab === 'users'} onClick={() => setActiveTab('users')} icon="👥" label="ユーザー管理" />}
                </div>

                <div style={{ background: 'white', borderRadius: '0 8px 8px 8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', padding: '24px', minHeight: '600px' }}>

                    {/* API設定タブ */}
                    {activeTab === 'api' && (
                        <div className="api-section">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '16px', color: '#334155' }}>API接続設定</h2>
                            {/* ... (Previous API Settings Code) ... */}
                            <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '24px' }}>
                                LINE Developers ConsoleからChannel Access TokenとChannel Secretを取得し、ここに入力してください。<br />
                                入力した情報は暗号化して安全に保存されます。
                            </p>

                            <div style={{ display: 'flex', gap: '12px', marginBottom: '24px', flexWrap: 'wrap' }}>
                                <div style={{ padding: '12px 16px', borderRadius: '8px', background: hasAccessToken ? '#f0fdf4' : '#fef2f2', border: `1px solid ${hasAccessToken ? '#bbf7d0' : '#fecaca'}` }}>
                                    <span style={{ fontSize: '0.8rem', color: hasAccessToken ? '#16a34a' : '#dc2626' }}>
                                        {hasAccessToken ? '✅' : '❌'} Channel Access Token
                                    </span>
                                </div>
                                <div style={{ padding: '12px 16px', borderRadius: '8px', background: hasChannelSecret ? '#f0fdf4' : '#fef2f2', border: `1px solid ${hasChannelSecret ? '#bbf7d0' : '#fecaca'}` }}>
                                    <span style={{ fontSize: '0.8rem', color: hasChannelSecret ? '#16a34a' : '#dc2626' }}>
                                        {hasChannelSecret ? '✅' : '❌'} Channel Secret
                                    </span>
                                </div>
                            </div>

                            <form action={updateApiSettings}>
                                <div style={{ display: 'grid', gap: '20px' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 'bold', color: '#334155' }}>
                                            LINE Channel Access Token
                                        </label>
                                        <input type="password" name="line_channel_access_token" placeholder={hasAccessToken ? '（設定済み - 変更する場合のみ入力）' : 'Channel Access Tokenを入力'} style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.95rem' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', fontWeight: 'bold', color: '#334155' }}>
                                            LINE Channel Secret
                                        </label>
                                        <input type="password" name="line_channel_secret" placeholder={hasChannelSecret ? '（設定済み - 変更する場合のみ入力）' : 'Channel Secretを入力'} style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.95rem' }} />
                                    </div>
                                </div>
                                <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
                                    <button type="submit" style={{ background: '#2563eb', color: 'white', border: 'none', padding: '12px 32px', borderRadius: '8px', fontSize: '1rem', cursor: 'pointer', fontWeight: 'bold' }}>🔒 暗号化して保存</button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Prompt Tab */}
                    {activeTab === 'prompt' && canEditPrompt && (
                        <div className="prompt-section">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '16px', color: '#334155' }}>AI人格・指示設定</h2>
                            <form action={updateSystemPrompt}>
                                <input type="hidden" name="tenant_id" value={tenant.tenant_id} />
                                <textarea name="system_prompt" defaultValue={tenant.system_prompt} style={{ width: '100%', height: '450px', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.95rem', lineHeight: '1.6', fontFamily: 'monospace', resize: 'vertical' }} />
                                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                                    <button type="submit" style={{ background: '#2563eb', color: 'white', border: 'none', padding: '10px 24px', borderRadius: '6px', fontSize: '1rem', cursor: 'pointer', fontWeight: 'bold' }}>保存する</button>
                                </div>
                            </form>
                        </div>
                    )}

                    {/* Knowledge Tab */}
                    {activeTab === 'knowledge' && canEditKnowledge && (
                        <div className="kb-section">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '16px', color: '#334155' }}>ナレッジベース (知識管理)</h2>
                            {/* ... (Previous Knowledge Base UI code) ... */}
                            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
                                {['ALL', 'FAQ', 'OFFER', 'PRICE', 'PROCESS', 'POLICY', 'CONTEXT'].map(cat => (
                                    <button key={cat} onClick={() => setKbFilter(cat)} style={{ padding: '6px 14px', borderRadius: '20px', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: '0.85rem', background: kbFilter === cat ? (cat === 'ALL' ? '#3b82f6' : '#eff6ff') : 'white', color: kbFilter === cat ? (cat === 'ALL' ? 'white' : '#1d4ed8') : '#64748b' }}>{cat === 'ALL' ? 'すべて' : cat}</button>
                                ))}
                            </div>

                            <div style={{ background: '#f0fdf4', padding: '16px', borderRadius: '8px', border: '1px dashed #bbf7d0', marginBottom: '24px' }}>
                                <form action={importKnowledgeFromFile}>
                                    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                                        <select name="category" defaultValue="FAQ" style={{ padding: '8px', borderRadius: '6px', border: '1px solid #bbf7d0', flex: 1 }}>
                                            <option value="FAQ">FAQ</option><option value="OFFER">OFFER</option><option value="PRICE">PRICE</option><option value="PROCESS">PROCESS</option>
                                        </select>
                                        <input type="file" name="file" accept=".pdf,.docx,.csv,.txt" style={{ flex: 2, padding: '8px', background: 'white', borderRadius: '6px', border: '1px solid #bbf7d0' }} />
                                    </div>
                                    <button type="submit" style={{ width: '100%', background: '#22c55e', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>インポート実行</button>
                                </form>
                            </div>

                            <div style={{ maxHeight: '400px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', marginBottom: '24px' }}>
                                {tenant.knowledge_base?.filter((kb: any) => kbFilter === 'ALL' || kb.category === kbFilter).map((kb: any) => (
                                    <div key={kb.id} style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '12px' }}>
                                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', background: '#f1f5f9', borderRadius: '4px', height: 'fit-content' }}>{kb.category}</span>
                                        <div style={{ flex: 1, fontSize: '0.85rem' }}>{kb.content}</div>
                                        <form action={deleteKnowledge}><input type="hidden" name="id" value={kb.id} /><button type="submit" style={{ color: '#ccc', border: 'none', background: 'none', cursor: 'pointer' }}>×</button></form>
                                    </div>
                                ))}
                            </div>

                            <form action={addKnowledge} style={{ display: 'flex', gap: '8px' }}>
                                <textarea name="content" placeholder="知識を追加..." style={{ flex: 1, padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', minHeight: '80px' }} required />
                                <button type="submit" style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '0 20px', borderRadius: '8px', cursor: 'pointer' }}>追加</button>
                            </form>
                        </div>
                    )}

                    {/* Users Tab (Personalization Management) */}
                    {activeTab === 'users' && canManageUsers && (
                        <div className="users-section">
                            <h2 style={{ fontSize: '1.2rem', marginBottom: '16px', color: '#334155' }}>👤 ユーザー個別管理</h2>
                            <p style={{ fontSize: '0.9rem', color: '#64748b', marginBottom: '20px' }}>
                                ユーザーごとの特徴やアンケート結果を管理します。ここで設定した内容はAIが回答を生成する際に自動的に参照されます。
                            </p>

                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 1.5fr', gap: '24px' }}>
                                {/* User Selector */}
                                <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', background: '#f8fafc' }}>
                                    <form onSubmit={handleUserSearch} style={{ padding: '12px', borderBottom: '1px solid #e2e8f0', display: 'flex', gap: '4px' }}>
                                        <input
                                            type="text"
                                            value={userSearch}
                                            onChange={(e) => setUserSearch(e.target.value)}
                                            placeholder="ユーザー名/IDで検索..."
                                            style={{ flex: 1, padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                                        />
                                        <button type="submit" style={{ padding: '8px', background: 'white', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer' }}>🔍</button>
                                    </form>
                                    <div style={{ height: '500px', overflowY: 'auto' }}>
                                        {filteredUsers.map((u: any) => (
                                            <div
                                                key={u.user_id}
                                                onClick={() => setSelectedUser(u)}
                                                style={{
                                                    padding: '12px 16px', borderBottom: '1px solid #e2e8f0', cursor: 'pointer',
                                                    background: selectedUser?.user_id === u.user_id ? '#eff6ff' : 'white',
                                                    borderLeft: selectedUser?.user_id === u.user_id ? '4px solid #3b82f6' : '4px solid transparent'
                                                }}
                                            >
                                                <div style={{ fontWeight: 'bold', fontSize: '0.9rem', color: '#1e293b', marginBottom: '4px' }}>{u.display_name || 'No Name'}</div>
                                                <div style={{ fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.user_id}</div>
                                                {u.status === 'attention_required' && <span style={{ fontSize: '0.65rem', color: '#dc2626', background: '#fef2f2', padding: '2px 6px', borderRadius: '4px', marginTop: '4px', display: 'inline-block' }}>要対応</span>}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Editor */}
                                <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                    {selectedUser ? (
                                        <form action={async (formData) => {
                                            try {
                                                await updateUserProfile(formData);
                                                alert('保存しました');
                                            } catch (e: any) { alert(e.message); }
                                        }}>
                                            <input type="hidden" name="user_id" value={selectedUser.user_id} />
                                            <div style={{ marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #f1f5f9' }}>
                                                <h3 style={{ margin: 0, fontSize: '1.1rem' }}>{selectedUser.display_name} の設定</h3>
                                                <code style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{selectedUser.user_id}</code>
                                            </div>

                                            <div style={{ marginBottom: '16px' }}>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#475569', marginBottom: '8px' }}>内部メモ (スタッフ用)</label>
                                                <textarea
                                                    name="internal_memo"
                                                    defaultValue={selectedUser.internal_memo}
                                                    placeholder="スタッフ間での共有事項（ユーザーには見えません）"
                                                    style={{ width: '100%', height: '80px', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem' }}
                                                />
                                            </div>

                                            <div style={{ marginBottom: '24px' }}>
                                                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 'bold', color: '#475569', marginBottom: '8px' }}>パーソナライズ・プロフィール (JSON)</label>
                                                <textarea
                                                    name="profile"
                                                    defaultValue={JSON.stringify(selectedUser.profile || {}, null, 2)}
                                                    placeholder='{"key": "value"}'
                                                    style={{ width: '100%', height: '250px', padding: '12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.9rem', fontFamily: 'monospace' }}
                                                />
                                                <p style={{ margin: '8px 0 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
                                                    ※ 正しいJSON形式で入力してください。例: {"{ \"職業\": \"会社員\", \"悩み\": \"肩こり\" }"}
                                                </p>
                                            </div>

                                            <button type="submit" style={{ width: '100%', padding: '12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer' }}>修正を保存</button>
                                        </form>
                                    ) : (
                                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', textAlign: 'center' }}>
                                            左のリストからユーザーを選択して<br />情報を編集してください。
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                </div>
            </main>
        </div>
    );
}

function TabButton({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: string, label: string }) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '12px 20px', borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem', transition: 'all 0.2s',
                background: active ? 'white' : 'transparent',
                color: active ? '#0f172a' : '#64748b',
                boxShadow: active ? '0 -2px 10px rgba(0,0,0,0.05)' : 'none',
                position: 'relative',
                zIndex: active ? 1 : 0
            }}
        >
            <span style={{ marginRight: '6px' }}>{icon}</span> {label}
            {active && <div style={{ position: 'absolute', bottom: '-2px', left: 0, right: 0, height: '2px', background: 'white', zIndex: 2 }} />}
        </button>
    );
}
