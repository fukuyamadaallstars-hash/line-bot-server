-- Portal Login Logs Table
-- ログイン履歴を記録してセキュリティ監査に使用

CREATE TABLE portal_login_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'error')),
    reason TEXT,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for efficient querying by tenant and time
CREATE INDEX idx_portal_login_logs_tenant ON portal_login_logs(tenant_id, created_at DESC);

-- Index for failed attempts monitoring
CREATE INDEX idx_portal_login_logs_status ON portal_login_logs(status, created_at DESC) WHERE status != 'success';

-- RLS Policy (optional, admin-only access)
ALTER TABLE portal_login_logs ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (for server-side logging)
CREATE POLICY "Service role can manage login logs"
    ON portal_login_logs
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Comment for documentation
COMMENT ON TABLE portal_login_logs IS 'Records all portal login attempts for security auditing';
