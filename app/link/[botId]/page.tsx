import LinkClient from './LinkClient';

export default async function LinkPage({ params, searchParams }: any) {
    const { botId } = await params;
    const resolvedSearchParams = await searchParams;
    const uid = resolvedSearchParams?.uid;

    if (!botId || !uid) {
        return (
            <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
                <div className="bg-red-50 border border-red-200 text-red-600 px-6 py-8 rounded-xl shadow-sm w-full max-w-md">
                    <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <h2 className="text-lg font-bold mb-2">アクセスエラー</h2>
                    <p className="text-sm">公式LINEから開き直してください。<br/>URLを直接入力した場合、連携ができません。</p>
                </div>
            </div>
        );
    }

    return (
        <main className="min-h-screen bg-gray-50 flex flex-col items-center p-6 font-sans">
            <h1 className="text-2xl font-bold mt-12 mb-4 text-gray-800">LINE公式アカウント連携</h1>
            <p className="mb-10 text-sm text-gray-600 text-center max-w-md">
                購入時に使用したメールアドレスを入力して、<br/>
                公式LINEアカウントとの連携を完了してください。
            </p>
            <LinkClient botId={botId} uid={uid} />
        </main>
    );
}
