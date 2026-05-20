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
