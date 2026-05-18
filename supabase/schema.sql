-- Run this in your Supabase project: SQL Editor → New Query → paste → Run

create table if not exists leads (
  id                uuid         default gen_random_uuid() primary key,
  created_at        timestamptz  default now(),
  business_name     text         not null,
  contact_name      text,
  phone             text,
  email             text,
  trade             text,
  city              text,
  services          text[],
  service_areas     text[],
  site_data         jsonb,
  source            text         default 'unknown',
  status            text         default 'new',  -- new | claim | paid | deployed
  stripe_session_id text,
  site_url          text,
  subdomain_url     text,
  notes             text,
  user_id           uuid         references auth.users(id) on delete set null
);

create index if not exists leads_status_idx  on leads (status);
create index if not exists leads_email_idx   on leads (email);
create index if not exists leads_user_idx    on leads (user_id);

-- Row-level security: each client can only read and update their own record.
-- The service role (used by Netlify functions with SUPABASE_SERVICE_KEY) bypasses RLS automatically.
alter table leads enable row level security;

-- Drop policies before recreating so this script is safe to re-run
drop policy if exists "client_read_own"   on leads;
drop policy if exists "client_update_own" on leads;

create policy "client_read_own" on leads
  for select
  using (auth.uid() = user_id);

create policy "client_update_own" on leads
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
