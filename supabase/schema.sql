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
  notes             text
);

create index if not exists leads_status_idx on leads (status);
create index if not exists leads_email_idx  on leads (email);
