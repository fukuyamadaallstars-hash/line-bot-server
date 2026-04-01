"use client";
import { useState } from 'react';
import { linkPurchase } from '../actions';

export default function LinkClient({ botId, uid }: { botId: string; uid: string }) {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
    const [message, setMessage] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) return;

        setStatus('loading');
        setMessage('');

        try {
            const res = await linkPurchase(botId, uid, email);
            if (res.success) {
                setStatus('success');
                setMessage('連携が完了しました！\nこの画面を閉じて、LINEのチャット画面へ戻ってください。');
            } else {
                setStatus('error');
                setMessage(res.error || '連携に失敗しました。メールアドレスを確認してください。');
            }
        } catch (error: any) {
            setStatus('error');
            setMessage('システムエラーが発生しました。時間を置いて再度お試しください。');
        }
    };

    if (status === 'success') {
        return (
            <div className="bg-green-50 border border-green-200 p-8 rounded-xl shadow-sm text-center w-full max-w-md">
                <div className="text-green-500 mb-4">
                    <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                </div>
                <h2 className="text-xl font-bold text-green-800 mb-2">認証が完了しました</h2>
                <p className="text-green-700 whitespace-pre-wrap">{message}</p>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-md bg-white p-8 rounded-xl shadow-lg border border-gray-100">
            {status === 'error' && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
                    {message}
                </div>
            )}
            
            <div className="mb-6">
                <label className="block text-gray-700 text-sm font-bold mb-2">
                    購入時のメールアドレス
                </label>
                <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="appearance-none border border-gray-300 rounded-lg w-full py-3 px-4 text-gray-700 leading-tight focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                    placeholder="example@example.com"
                    disabled={status === 'loading'}
                    required
                />
                <p className="text-xs text-gray-500 mt-2">※決済時に入力した正確なメールアドレスをご入力ください。</p>
            </div>
            
            <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg focus:outline-none focus:shadow-outline disabled:opacity-50 transition-colors flex items-center justify-center"
            >
                {status === 'loading' ? (
                    <>
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        確認中...
                    </>
                ) : '連携する'}
            </button>
        </form>
    );
}
