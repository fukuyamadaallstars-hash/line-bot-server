-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- 1. Tenants Table (Manage multiple bots)
create table public.tenants (
    tenant_id text primary key, -- e.g. "main-bot", "client-a"
    display_name text not null,
    
    -- LINE Credentials (Encrypted typically, but for now we store raw or assume App-level encryption logic)
    line_channel_secret text not null,
    line_channel_access_token text not null,
    
    -- AI Settings
    openai_api_key text, -- Optional: if null, use system default
    system_prompt text default 'あなたは親切なAIアシスタントです。',
    use_rag boolean default false,
    
    -- Status & Plan
    is_active boolean default true,
    plan_tier text default 'lite', -- 'lite', 'standard', 'pro'
    
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2. Usage Logs (For billing and analytics)
create table public.usage_logs (
    id uuid default uuid_generate_v4() primary key,
    tenant_id text references public.tenants(tenant_id),
    user_id text, -- LINE User ID
    message_type text, -- 'text', 'image', etc.
    token_usage int default 0, -- OpenAI token estimate
    status text, -- 'success', 'error'
    error_message text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3. RLS Policies (Row Level Security) - Basic Setup
alter table public.tenants enable row level security;
alter table public.usage_logs enable row level security;

-- Allow Service Role (Server-side) full access
create policy "Service role has full access to tenants"
    on public.tenants for all
    using ( true )
    with check ( true );

create policy "Service role has full access to usage_logs"
    on public.usage_logs for all
    using ( true )
    with check ( true );
