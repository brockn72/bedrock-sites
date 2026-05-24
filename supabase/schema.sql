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

-- ─────────────────────────────────────────────────────────────────────────────
-- brand_kits: per BEDROCK-MARKETING-TECH spec. Linked by email for MVP.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists brand_kits (
  id              uuid         default gen_random_uuid() primary key,
  created_at      timestamptz  default now(),
  updated_at      timestamptz  default now(),
  email           text         not null,
  business_name   text,
  tagline         text,
  trade           text,
  city            text,
  phone           text,
  website         text,
  logo_url        text,
  color_primary   text,
  color_secondary text,
  color_accent    text,
  font_style      text,
  tone            text,
  target_customer text,
  service_area    text,
  raw_data        jsonb,
  user_id         uuid         references auth.users(id) on delete set null
);

create unique index if not exists brand_kits_email_idx on brand_kits (lower(email));
create index if not exists brand_kits_user_idx on brand_kits (user_id);

alter table brand_kits enable row level security;
drop policy if exists "brand_kit_read_own"   on brand_kits;
drop policy if exists "brand_kit_update_own" on brand_kits;

create policy "brand_kit_read_own" on brand_kits
  for select using (auth.uid() = user_id);
create policy "brand_kit_update_own" on brand_kits
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- profiles: progressive enrichment per BEDROCK-ECOSYSTEM-VISION.
-- One row per user. Fields fill in as the contractor uses more Bedrock tools.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists profiles (
  id                  uuid         default gen_random_uuid() primary key,
  user_id             uuid         references auth.users(id) on delete cascade unique,
  email               text         not null,
  created_at          timestamptz  default now(),
  updated_at          timestamptz  default now(),
  -- Identity (stage 1 — initial signup)
  business_name       text,
  contact_name        text,
  phone               text,
  trade               text,
  city                text,
  -- Sites (stage 2)
  service_areas       text[],
  years_in_business   int,
  about_copy          text,
  certifications      text[],
  -- Marketing (stage 3)
  brand_colors        jsonb,        -- {primary, secondary, accent}
  brand_tone          text,
  slogan              text,
  target_customer     text,
  -- SEO (stage 4)
  target_keywords     text[],
  service_radius_mi   int,
  -- CFO (stage 5)
  employee_count      int,
  ops_notes           text,
  -- overflow / future-proofing
  extra               jsonb
);

create index if not exists profiles_email_idx on profiles (lower(email));

alter table profiles enable row level security;
drop policy if exists "profile_read_own"   on profiles;
drop policy if exists "profile_update_own" on profiles;
drop policy if exists "profile_insert_own" on profiles;

create policy "profile_read_own" on profiles
  for select using (auth.uid() = user_id);
create policy "profile_update_own" on profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "profile_insert_own" on profiles
  for insert with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- assets: per-user asset library for marketing materials, logos, uploads.
-- Files live in Supabase Storage bucket 'assets' (see manual setup note below).
-- This table tracks metadata + path so we can list assets with signed URLs.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists assets (
  id           uuid         default gen_random_uuid() primary key,
  user_id      uuid         not null references auth.users(id) on delete cascade,
  created_at   timestamptz  default now(),
  bucket       text         not null default 'assets',
  path         text         not null,
  filename     text,
  media_type   text,
  bytes        integer,
  kind         text         default 'marketing_asset', -- marketing_asset | logo | reference | photo
  template     text,
  format       text,
  campaign     text,
  copy         jsonb
);
create index if not exists assets_user_idx on assets (user_id, created_at desc);
create index if not exists assets_kind_idx on assets (kind);

alter table assets enable row level security;
drop policy if exists "assets_read_own"   on assets;
drop policy if exists "assets_insert_own" on assets;
drop policy if exists "assets_delete_own" on assets;
create policy "assets_read_own"   on assets for select using (auth.uid() = user_id);
create policy "assets_insert_own" on assets for insert with check (auth.uid() = user_id);
create policy "assets_delete_own" on assets for delete using (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- MANUAL STEP: create a Supabase Storage bucket named 'assets' for the actual
-- file blobs. In Supabase dashboard → Storage → New bucket → Name: assets →
-- Private (do NOT make public) → Create. The Netlify functions use the
-- service role key to upload/sign URLs, so RLS on the bucket itself isn't
-- strictly required, but you can add RLS later if you want client-side reads.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- site_audits: history of SEO/GEO Optimizer runs on a client's own site,
-- so the portal can show score-over-time tracking. One row per audit run.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists site_audits (
  id          uuid         default gen_random_uuid() primary key,
  user_id     uuid         not null references auth.users(id) on delete cascade,
  created_at  timestamptz  default now(),
  site_url    text,
  score       int,
  label       text,
  categories  jsonb,        -- [{name, pct}]
  top_issues  jsonb         -- [{label, result, tier}]
);
create index if not exists site_audits_user_idx on site_audits (user_id, created_at desc);

alter table site_audits enable row level security;
drop policy if exists "site_audits_read_own"   on site_audits;
drop policy if exists "site_audits_insert_own" on site_audits;
create policy "site_audits_read_own"   on site_audits for select using (auth.uid() = user_id);
create policy "site_audits_insert_own" on site_audits for insert with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- bedrock_time_log: every real action that saves the contractor time gets
-- logged here so the portal "Time saved with Bedrock" card has an auditable
-- backing store (B3a). action_type maps to a minute credit in the front-end.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists bedrock_time_log (
  id                uuid         default gen_random_uuid() primary key,
  user_id           uuid         not null references auth.users(id) on delete cascade,
  created_at        timestamptz  default now(),
  action_type       text         not null,  -- estimate_created | invoice_created | receipt_scanned | …
  minutes_credited  int          not null,
  ref_id            text,                   -- optional pointer to the source record (job/customer id, asset id, etc.)
  metadata          jsonb                   -- optional context — kept open so we don't migrate every time we add a credit type
);
create index if not exists bedrock_time_log_user_idx on bedrock_time_log (user_id, created_at desc);
create index if not exists bedrock_time_log_action_idx on bedrock_time_log (user_id, action_type);

alter table bedrock_time_log enable row level security;
drop policy if exists "time_log_read_own"   on bedrock_time_log;
drop policy if exists "time_log_insert_own" on bedrock_time_log;
create policy "time_log_read_own"   on bedrock_time_log for select using (auth.uid() = user_id);
create policy "time_log_insert_own" on bedrock_time_log for insert with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- Donna additive columns shipped in Session B (safe to run on an existing
-- install — `add column if not exists` is a no-op when the column is there).
-- ─────────────────────────────────────────────────────────────────────────────
alter table if exists donna_jobs  add column if not exists trade text;
alter table if exists donna_notes add column if not exists project_id uuid references donna_projects(id) on delete set null;
alter table if exists donna_notes add column if not exists job_id     uuid references donna_jobs(id)     on delete set null;
