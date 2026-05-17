# Database Schema — Supabase

**Project name:** bedrock  
**Project URL:** https://vkzkzteewfoqrdwktgae.supabase.co  
**Region:** US East  
**Dashboard:** https://supabase.com/dashboard/project/vkzkzteewfoqrdwktgae

---

## Tables

### leads
Primary table. Created via `supabase/schema.sql` in the repo.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key, auto-generated |
| created_at | timestamptz | Auto-set on insert |
| business_name | text | Required |
| contact_name | text | |
| phone | text | |
| email | text | |
| trade | text | plumber, electrician, etc. |
| city | text | |
| services | text | |
| service_areas | text | |
| site_data | jsonb | Full builder state as JSON |
| status | text | 'new', 'paid', 'deployed' |
| stripe_session_id | text | Set by webhook on payment |
| lead_source | text | 'builder', 'claim', etc. |

### clients (secondary)
Separate table for confirmed paying clients.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| name | text | |
| email | text | |
| phone | text | |
| business_name | text | |
| business_type | text | |
| created_at | timestamptz | |

### sites (secondary)
Stores deployed site data per client.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| client_id | UUID | FK → clients.id |
| subdomain | text | Unique |
| site_data | jsonb | Full site builder state |
| status | text | 'draft', 'live' |
| netlify_site_id | text | |
| live_url | text | |
| created_at / updated_at | timestamptz | |

---

## RLS (Row Level Security)
**Disabled** — intentionally. Only Netlify backend functions access the DB using the service_role key, which bypasses RLS anyway. No end users touch the DB directly.

---

## Key Note on Service Role Key
The key currently in Netlify env vars is the `sb_secret_...` format (Supabase's newer short-format key). If lead saves start failing, go back to Supabase → Settings → API → Project API keys and confirm the `service_role` key is set correctly. The format changed recently.

---

## SQL to Run (if rebuilding)
Located at `/supabase/schema.sql` in the GitHub repo.
Steps: Supabase → SQL Editor → New Query → paste → Run without RLS
