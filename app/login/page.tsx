import './login.css';

export default function LoginPage() {
    return (
        <div className="login-container">
            <div className="login-card">
                <h1>Admin Access</h1>
                <p>管理パスワードを入力してください</p>

                <form action="/api/auth/login" method="POST">
                    <input
                        type="password"
                        name="password"
                        placeholder="Passcode"
                        required
                        autoFocus
                    />
                    <button type="submit">Unlock</button>
                </form>
            </div>
        </div>
    );
}
