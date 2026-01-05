-- Phase 3: Finance & Contract Management

-- 1. Tenants Table Updates (Billing, Cycle, Contract)
alter table public.tenants
add column if not exists company_name text, -- 会社/屋号名（請求書の宛名）
add column if not exists billing_contact_name text, -- 請求書の宛先担当者名
add column if not exists billing_email text, -- 請求書送付先メールアドレス
add column if not exists billing_phone text, -- 電話番号（未払い連絡用）
add column if not exists billing_address text, -- 請求書送付先住所
add column if not exists billing_department text, -- 支払担当部署名
add column if not exists billing_subject text, -- 請求書の件名表記（〇〇店など）

add column if not exists billing_cycle_day integer default 1, -- 毎月の請求日(1-28)
add column if not exists payment_term_days integer default 10, -- 支払期限（請求日+X日）
add column if not exists contract_start_date date, -- 契約開始日（既にあるかもだが再定義）
add column if not exists next_billing_date date, -- 次回請求日（既にある）
add column if not exists billing_status text default 'active', -- active, suspended, cancelled
add column if not exists bank_transfer_name text, -- 振込名義（顧客側）

add column if not exists kb_limit integer default 50, -- KB登録上限
add column if not exists kb_update_limit integer default 1, -- KB更新回数上限
add column if not exists reservation_enabled boolean default false, -- 予約連携機能の有無

-- JSONB fields for flexible data
add column if not exists next_contract_changes jsonb default '{}'::jsonb, -- 次回請求日に適用する変更予約 { plan: 'Standard', model_option: 'A', ... }
add column if not exists beta_perks jsonb default '{}'::jsonb; -- β特典情報 { is_beta: true, type: 'Lite_FreeMonth', consumed: false, ... }

-- 2. Token Purchases Table (One-time additions)
create table if not exists public.token_purchases (
    id uuid default uuid_generate_v4() primary key,
    tenant_id text references public.tenants(tenant_id) not null,
    
    amount integer not null default 1000000, -- 追加トークン量
    price integer not null default 4500, -- 金額
    purchase_date timestamp with time zone default now(), -- 購入日
    valid_until timestamp with time zone, -- 有効期限（次回請求日など）
    
    status text default 'pending', -- pending, paid, applied
    applied_at timestamp with time zone, -- 反映日時
    
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. Invoices Table (Billing history)
create table if not exists public.invoices (
    id uuid default uuid_generate_v4() primary key,
    tenant_id text references public.tenants(tenant_id) not null,
    
    invoice_number text not null, -- 請求番号（ユニーク）
    target_month text, -- YYYY-MM
    
    amount_total integer not null default 0,
    details jsonb default '[]'::jsonb, -- 内訳リスト
    
    status text default 'draft', -- draft, sent, paid, overdue
    sent_at timestamp with time zone,
    paid_at timestamp with time zone,
    
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Policies
alter table public.token_purchases enable row level security;
alter table public.invoices enable row level security;

create policy "Service role has full access to token_purchases"
    on public.token_purchases for all
    using ( true )
    with check ( true );

create policy "Service role has full access to invoices"
    on public.invoices for all
    using ( true )
    with check ( true );
