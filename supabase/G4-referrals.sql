-- G4 (Batch G, 2026-05-26): referral program schema.
--
-- Per bedrock-vault/07-REFERRAL-PROGRAM.md, with the additions Brock
-- confirmed in Batch G:
--   • Reward = 2 months free to the REFERRER ONLY (one-sided — matches spec).
--   • Trigger = the referred contractor's first paid subscription.
--   • Mechanism = Stripe customer account balance credit (handled in
--     stripe-webhook.js, not here).
--
-- This file is idempotent (uses `if not exists` everywhere). Brock to run in
-- the Supabase SQL editor when ready. Don't run via service-role from the
-- repo — this is the canonical place to apply schema changes.

------------------------------------------------------------------------------
-- 1) profiles columns — referral code + earned/applied credit counters
------------------------------------------------------------------------------
alter table profiles add column if not exists referral_code text;
alter table profiles add column if not exists referral_credits_earned int default 0;
alter table profiles add column if not exists referral_credits_applied int default 0;

-- Unique index on referral_code (case-insensitive). Codes are stored uppercase
-- (SMITH10 not smith10) so a plain unique constraint is sufficient.
create unique index if not exists profiles_referral_code_idx
  on profiles (referral_code)
  where referral_code is not null;

------------------------------------------------------------------------------
-- 2) leads.referral_code — captured when a referred lead enters the funnel
------------------------------------------------------------------------------
alter table leads add column if not exists referral_code text;

------------------------------------------------------------------------------
-- 3) referrals table — one row per attribution event
------------------------------------------------------------------------------
create table if not exists referrals (
  id                    uuid         primary key default gen_random_uuid(),
  referrer_user_id      uuid         not null references auth.users(id) on delete cascade,
  referred_lead_id      uuid                  references leads(id)      on delete set null,
  referred_user_id      uuid                  references auth.users(id) on delete set null,
  referred_email        text,
  referral_code         text         not null,
  -- pending  = lead captured, not paid yet
  -- paid     = referred contractor's subscription confirmed
  -- credited = referrer's Stripe balance was credited
  -- voided   = referred cancelled before paying; no reward
  status                text         not null default 'pending',
  -- prevents double-rewarding even if the webhook fires twice
  credited_stripe_txn   text,
  credited_amount_cents int,
  created_at            timestamptz  default now(),
  credited_at           timestamptz,
  voided_at             timestamptz
);

create index if not exists referrals_referrer_idx on referrals (referrer_user_id, created_at desc);
create index if not exists referrals_code_idx     on referrals (referral_code);
create index if not exists referrals_email_idx    on referrals (lower(referred_email));

-- A given referred email can only be successfully credited ONCE across the
-- whole platform. Partial unique index — only enforces uniqueness for rows
-- that actually got credited. Pending rows can collide (someone enters two
-- referral codes before paying) without breaking the constraint.
create unique index if not exists referrals_email_credited_uniq
  on referrals (lower(referred_email))
  where status = 'credited' and referred_email is not null;

------------------------------------------------------------------------------
-- 4) RLS — referrer can read their own referrals; nothing else from the client
------------------------------------------------------------------------------
alter table referrals enable row level security;

drop policy if exists "referrals_read_own"  on referrals;
create policy "referrals_read_own"
  on referrals for select
  using (auth.uid() = referrer_user_id);

-- No insert/update/delete policies for client tokens — only the service role
-- (Netlify functions) writes to referrals. RLS denies anon/auth writes by
-- default once enabled, which is what we want.

------------------------------------------------------------------------------
-- 5) checkout_states — new optional columns for billing + referral_code
--     (so the trusted state token can carry these new fields, not just the
--      Stripe metadata mirror). Safe to run repeatedly.
------------------------------------------------------------------------------
alter table checkout_states add column if not exists billing       text;
alter table checkout_states add column if not exists referral_code text;

------------------------------------------------------------------------------
-- 6) Notes for Brock
------------------------------------------------------------------------------
-- • Run this file once in Supabase SQL editor.
-- • Verify the indexes exist by re-running — every statement is `if not exists`
--   so it's safe to re-run.
-- • The `voided` status isn't used by webhook code yet; reserved for a future
--   cleanup job that ages out unpaid referrals (e.g. > 90 days pending).
