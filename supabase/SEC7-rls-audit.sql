-- SEC7 — RLS audit for the subscriptions + donna_* tables.
--
-- HOW TO USE
--   1. Open Supabase → SQL editor (LIVE project).
--   2. Paste + run STEP 1. Note which table names come back in the "policies"
--      column with NULL or an empty list — those are the tables with NO
--      row-level security policy.
--   3. For each table that is missing RLS, run the matching block in STEP 2.
--      Skip any table that already has an "client_*"/"_own" policy.
--   4. (Optional) Re-run STEP 1 afterwards — every table below should now show
--      at least one policy.
--
-- Brock — none of this runs automatically. Read step 1 results before pasting
-- step 2; the templates assume each table has a `user_id` column linking to
-- auth.users(id). If a table uses a different column (e.g. `owner_id`), edit
-- the policy bodies to match before applying.

------------------------------------------------------------------------------
-- STEP 1 — list what already exists
------------------------------------------------------------------------------

-- (a) Every policy currently attached to the tables we care about
select
    schemaname,
    tablename,
    policyname,
    cmd                 as command,
    permissive,
    roles,
    qual                as using_expr,
    with_check          as with_check_expr
from pg_policies
where tablename = 'subscriptions'
   or tablename like 'donna\_%' escape '\'
order by tablename, policyname;

-- (b) For each suspected table, is RLS actually ENABLED on it?
-- (RLS can be "enabled" with zero policies — that effectively blocks all
-- non-service-key reads. RLS can also be "disabled" with policies present —
-- in that case the policies are inert and the service key still works but the
-- anon key can read everything. We want enabled = true AND at least one policy.)
select
    n.nspname  as schema,
    c.relname  as table,
    c.relrowsecurity as rls_enabled,
    coalesce((select count(*) from pg_policies p
              where p.schemaname = n.nspname and p.tablename = c.relname), 0) as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r'
  and n.nspname = 'public'
  and (c.relname = 'subscriptions' or c.relname like 'donna\_%' escape '\')
order by c.relname;

------------------------------------------------------------------------------
-- STEP 2 — templates to fix any table that came back with rls_enabled = false
--          OR policy_count = 0.
--
-- Run ONLY the block(s) for tables that are actually missing protection.
-- Each block: (1) turn RLS on; (2) add owner-read; (3) add owner-write;
-- (4) add owner-delete. Service-role calls (our Netlify functions using
-- SUPABASE_SERVICE_KEY) always bypass RLS, so this won't break the backend.
------------------------------------------------------------------------------

-- subscriptions ---------------------------------------------------------------
-- Used by stripe-webhook.js to record one row per active tool per contractor.
alter table subscriptions enable row level security;
create policy "subscriptions_read_own"
  on subscriptions for select
  using (auth.uid() = user_id);
create policy "subscriptions_write_own"
  on subscriptions for insert
  with check (auth.uid() = user_id);
create policy "subscriptions_update_own"
  on subscriptions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- donna_customers -------------------------------------------------------------
alter table donna_customers enable row level security;
create policy "donna_customers_read_own"
  on donna_customers for select using (auth.uid() = user_id);
create policy "donna_customers_insert_own"
  on donna_customers for insert with check (auth.uid() = user_id);
create policy "donna_customers_update_own"
  on donna_customers for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "donna_customers_delete_own"
  on donna_customers for delete using (auth.uid() = user_id);

-- donna_projects --------------------------------------------------------------
alter table donna_projects enable row level security;
create policy "donna_projects_read_own"
  on donna_projects for select using (auth.uid() = user_id);
create policy "donna_projects_insert_own"
  on donna_projects for insert with check (auth.uid() = user_id);
create policy "donna_projects_update_own"
  on donna_projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "donna_projects_delete_own"
  on donna_projects for delete using (auth.uid() = user_id);

-- donna_jobs ------------------------------------------------------------------
alter table donna_jobs enable row level security;
create policy "donna_jobs_read_own"
  on donna_jobs for select using (auth.uid() = user_id);
create policy "donna_jobs_insert_own"
  on donna_jobs for insert with check (auth.uid() = user_id);
create policy "donna_jobs_update_own"
  on donna_jobs for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "donna_jobs_delete_own"
  on donna_jobs for delete using (auth.uid() = user_id);

-- donna_notes -----------------------------------------------------------------
alter table donna_notes enable row level security;
create policy "donna_notes_read_own"
  on donna_notes for select using (auth.uid() = user_id);
create policy "donna_notes_insert_own"
  on donna_notes for insert with check (auth.uid() = user_id);
create policy "donna_notes_update_own"
  on donna_notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "donna_notes_delete_own"
  on donna_notes for delete using (auth.uid() = user_id);

-- donna_receipts --------------------------------------------------------------
alter table donna_receipts enable row level security;
create policy "donna_receipts_read_own"
  on donna_receipts for select using (auth.uid() = user_id);
create policy "donna_receipts_insert_own"
  on donna_receipts for insert with check (auth.uid() = user_id);
create policy "donna_receipts_update_own"
  on donna_receipts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "donna_receipts_delete_own"
  on donna_receipts for delete using (auth.uid() = user_id);

-- donna_estimates -------------------------------------------------------------
alter table donna_estimates enable row level security;
create policy "donna_estimates_read_own"
  on donna_estimates for select using (auth.uid() = user_id);
create policy "donna_estimates_insert_own"
  on donna_estimates for insert with check (auth.uid() = user_id);
create policy "donna_estimates_update_own"
  on donna_estimates for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "donna_estimates_delete_own"
  on donna_estimates for delete using (auth.uid() = user_id);

-- donna_invoices --------------------------------------------------------------
alter table donna_invoices enable row level security;
create policy "donna_invoices_read_own"
  on donna_invoices for select using (auth.uid() = user_id);
create policy "donna_invoices_insert_own"
  on donna_invoices for insert with check (auth.uid() = user_id);
create policy "donna_invoices_update_own"
  on donna_invoices for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "donna_invoices_delete_own"
  on donna_invoices for delete using (auth.uid() = user_id);

-- donna_qbo_tokens ------------------------------------------------------------
-- Holds QuickBooks OAuth tokens. Lock down HARD — anon must never read these.
alter table donna_qbo_tokens enable row level security;
create policy "donna_qbo_tokens_read_own"
  on donna_qbo_tokens for select using (auth.uid() = user_id);
create policy "donna_qbo_tokens_insert_own"
  on donna_qbo_tokens for insert with check (auth.uid() = user_id);
create policy "donna_qbo_tokens_update_own"
  on donna_qbo_tokens for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "donna_qbo_tokens_delete_own"
  on donna_qbo_tokens for delete using (auth.uid() = user_id);
