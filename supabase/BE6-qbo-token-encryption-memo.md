# BE6 — QBO Refresh Token Encryption

**Date:** 2026-05-26
**Status:** Recommendation only — no schema changes applied.

## Current state

- `donna_qbo_tokens.refresh_token` is stored **in plaintext** in Postgres.
- Access path: only the service-role key reads/writes the column (see
  `qbo-callback.js`, `qbo-refresh.js`, `get-profile.js`,
  `finance-qbo-fetch.js`, `finance-sync-nightly.js`).
- The table is in the Supabase project — same-tenant as the rest of the
  app. RLS policy presumed to deny anon/auth roles (it lives outside
  `schema.sql`, in `BEDROCK-DONNA.md`).
- QBO is in sandbox (`QBO_SANDBOX=true`), so today's tokens grant access
  to test data, not real books.

## The two options

### A) pgcrypto column-level encryption (the "right" long-term answer)
Use `pgp_sym_encrypt(refresh_token, key)` on write and
`pgp_sym_decrypt(refresh_token, key)` on read. The symmetric key lives
in Netlify env as `QBO_TOKEN_ENCRYPTION_KEY` and is passed into the
query.

- **Pros:** A leaked DB dump alone can't reveal tokens. True
  defense-in-depth.
- **Cons:** Every read/write needs the key; PostgREST does NOT pass
  arbitrary GUCs through, so you'd either (a) move the QBO calls to a
  Postgres function that takes the key as a parameter, or (b) decrypt
  in the Netlify function after pulling the ciphertext (and re-encrypt
  on save). Adds non-trivial code + key-rotation policy.

### B) Service-key + RLS-only (interim) — **recommended for now**
Don't encrypt yet. Instead:

1. Verify the RLS policy on `donna_qbo_tokens` denies `anon` and
   `authenticated` roles (only `service_role` can SELECT).
2. Document that the service-role key is the single secret protecting
   these tokens — treat any leak as a "rotate everything" incident.
3. Ensure no function logs the refresh token (a quick grep across
   `netlify/functions` shows none today; keep it that way).
4. Add a TODO to revisit this **before** any of:
   - flipping `QBO_SANDBOX=false` (production QBO data),
   - onboarding the 5th paying customer,
   - storing any other long-lived OAuth refresh token alongside.

## Why B over A today

- Bedrock has zero production QBO connections. The blast radius of
  the current plaintext storage is one sandbox token.
- Doing pgcrypto wrong (e.g. key checked into env without a rotation
  policy, or decryption logic that logs plaintext) is worse than
  doing nothing.
- The biggest token-protection lever today is **service-key hygiene**:
  rotate if exposed, never log it, scope writes through the Netlify
  function layer only.

## When to flip to A

Trigger any one of:
- `QBO_SANDBOX=false` is about to ship.
- ≥ 3 paying customers have linked real QBO (production) accounts.
- A security review (paid pentest, SOC 2 scoping, etc.) flags it.

When the trigger hits, the implementation looks like:

```sql
-- One-time: ensure extension is present.
create extension if not exists pgcrypto;

-- Migrate the column to ciphertext (run during maintenance window).
alter table donna_qbo_tokens add column refresh_token_enc bytea;
update donna_qbo_tokens
  set refresh_token_enc = pgp_sym_encrypt(refresh_token, current_setting('app.qbo_key'));
alter table donna_qbo_tokens drop column refresh_token;
alter table donna_qbo_tokens rename column refresh_token_enc to refresh_token;
```

Then expose a Postgres function `qbo_get_refresh_token(p_user_id uuid)`
that takes the key from a SECURITY DEFINER context, and have Netlify
functions call that function instead of selecting the column directly.

## Action for Brock today

- **Verify RLS** on `donna_qbo_tokens` in Supabase UI: confirm `anon`
  and `authenticated` cannot SELECT/UPDATE. If they can, lock that
  down first (10-minute fix, biggest gain).
- **Service-key audit:** confirm the value in Netlify env is not the
  same key used anywhere client-side, and that no committed file
  contains it (`grep -ri "$SUPABASE_SERVICE_KEY_first_8_chars" .`).
- **Defer pgcrypto** until one of the triggers above hits.
