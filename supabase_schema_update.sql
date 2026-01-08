-- テナントごとのWeb管理画面アクセス用カラムを追加
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS web_access_password text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS web_access_enabled boolean DEFAULT false;
