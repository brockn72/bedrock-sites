# DEC11 — Function-Grouping Candidates

**Date:** 2026-05-26
**Scope:** Survey only. No consolidation performed.
**Total functions:** 46 in `netlify/functions/*.js`.

## Recommendation

**Do not consolidate at this time.** Reasoning:

1. **Cold-start cost is per-invocation, not per-file** — bundling
   functions doesn't save Netlify Function runtime cost or improve
   latency.
2. **External URL contracts** — Stripe webhooks, QBO OAuth callbacks,
   Google OAuth callbacks, and the deploy endpoint all have URLs that
   external systems are configured against. Renaming = breaking them.
3. **The cognitive cost of 46 small files is low** — each file is
   easy to grep, lint, and deploy independently.
4. **The biggest cost (per-file boilerplate) is solved by a shared
   util module**, not by combining endpoints. (Already partially done
   via `netlify/lib/*`.)

## If we ever do consolidate, the three SAFE pairs

These are pure same-domain CRUD with no external URL contracts. Merging
each saves one file and adds one branch on `event.httpMethod`. Defer
until/unless the function count starts hurting deploy times.

| Merge into | From | Why it's safe |
|---|---|---|
| `profile.js` | `get-profile.js` + `save-profile.js` | Internal only; both called from portal.html with `fetch('/.netlify/functions/get-profile')` / `save-profile`. URLs are ours to change. |
| `brand-kit.js` | `get-brand-kit.js` + `save-brand-kit.js` | Internal only; same pattern. |
| `audits.js` | `get-audits.js` + `save-audit.js` | Internal only. **Do NOT pull `audit-site.js` into this** — it has different perf characteristics (external PageSpeed call) and may want to scale separately. |

That's it. The other apparent pairs are either external-URL bound or
cross-domain:

- `qbo-auth` / `qbo-callback` / `qbo-refresh` — callback URL is
  registered in the Intuit developer console.
- `google-oauth-auth` / `google-oauth-callback` /
  `google-business-callback` — callback URL is registered in Google
  Cloud. (The `-business-callback` is already a compatibility shim;
  removing it would break old Google app configs.)
- `stripe-webhook` — registered URL in the Stripe dashboard.
- `create-checkout` / `create-subscription-checkout` /
  `create-billing-portal` — payment logic; per project rules, do not
  touch.
- `list-assets` / `upload-asset` — different content-types (JSON vs
  multipart) and different RLS paths; cleanest to keep apart.

## What WOULD help right now

Instead of consolidation, the higher-leverage refactor is:

1. **Extract a shared `supabase-fetch.js` helper** — at least a dozen
   functions repeat the `fetch(${supabaseUrl}/rest/v1/...)` pattern
   with the same headers and error handling. A single helper makes
   security fixes one-touch.
2. **Single `cors.js` middleware** — most functions hand-roll the same
   CORS headers. Extract once.
3. **Single Stripe + Supabase client init** — `lib/stripe.js` and
   `lib/supabase.js` so cold-start cost is shared via module cache.

These would shrink line count and harden behavior **without** touching
URLs that external systems depend on. Defer until Batch G or later.

## Survey notes (raw)

The 46 functions group thematically as:

- **Auth/Profile (4):** portal-auth, get-profile, save-profile, get-portal
- **Brand & Files (4):** get-brand-kit, save-brand-kit, upload-asset, list-assets
- **Stripe (4):** create-checkout, create-subscription-checkout, create-billing-portal, stripe-webhook
- **Domain & Deploy (3):** check-domain, deploy-customer-site, update-site
- **QBO (6):** qbo-auth, qbo-callback, qbo-refresh, qbo-attach, qbo-sync, get-qbo-meta
- **Finance (2):** finance-qbo-fetch, finance-sync-nightly
- **Donna (2):** donna-conversation, donna-crud
- **Google integrations (5):** google-oauth-auth, google-oauth-callback, google-business-callback, google-business-stats, gmail-send, calendar-create — well, 6
- **Audits (3):** audit-site, save-audit, get-audits
- **Marketing/AI (3):** generate-marketing-copy, analyze-brand-materials, vision-ocr
- **Email/Onboarding (3):** send-desktop-link, send-onboarding-sequence, onboarding-email-scheduler
- **Misc (4):** capture-lead, log-time-event, submit-feedback, dashboard-snapshot, admin-stats, get-config
