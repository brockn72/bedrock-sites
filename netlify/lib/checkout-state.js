// netlify/lib/checkout-state.js
// SEC5: one-time state tokens for Stripe Checkout sessions. Replaces the
// previous pattern of passing the customer's lead_id / user_id directly in
// metadata, which the client could tamper with.
//
// Flow:
//   1. create-checkout.js               → createCheckoutState({ kind: 'site',  lead_id, ... }) → token
//   2. create-subscription-checkout.js  → createCheckoutState({ kind: 'tools', user_id, tools }) → token
//   3. Pass `token` in Stripe metadata[state] (and subscription_data[metadata][state]).
//   4. stripe-webhook.js receives the event and calls consumeCheckoutState(token)
//      to get back the trusted server-side mapping. Token is single-use.
//
// ── One-time migration (run in Supabase SQL editor) ────────────────────────
//   create table if not exists checkout_states (
//     state_token   text primary key,
//     kind          text not null,
//     lead_id       uuid,
//     user_id       uuid,
//     business_name text,
//     email         text,
//     tools         text[],
//     billing       text,         -- G1 (Batch G, 2026-05-26): 'monthly' | 'annual'
//     referral_code text,         -- G8 (Batch G, 2026-05-26): captured for reward firing
//     created_at    timestamptz not null default now(),
//     expires_at    timestamptz not null,
//     consumed_at   timestamptz
//   );
//   create index if not exists idx_checkout_states_expires on checkout_states(expires_at);
//   -- If the table already exists from an earlier deploy, run instead:
//   --   alter table checkout_states add column if not exists billing text;
//   --   alter table checkout_states add column if not exists referral_code text;
//   -- optional cleanup: delete from checkout_states where expires_at < now() - interval '1 day';

const { randomBytes } = require('crypto');

const TOKEN_BYTES = 24;          // 192 bits — plenty of entropy
const TTL_MINUTES = 30;          // a Stripe Checkout session typically completes well within this

function newToken() { return randomBytes(TOKEN_BYTES).toString('hex'); }

async function createCheckoutState(payload) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { ok: false, error: 'Supabase not configured' };
  }
  const token = newToken();
  const now = new Date();
  const expires = new Date(now.getTime() + TTL_MINUTES * 60 * 1000);
  const row = {
    state_token:   token,
    kind:          payload.kind,
    lead_id:       payload.lead_id || null,
    user_id:       payload.user_id || null,
    business_name: payload.business_name || null,
    email:         payload.email || null,
    tools:         payload.tools || null,
    billing:       payload.billing || null,         // G1 (Batch G)
    referral_code: payload.referral_code || null,   // G8 (Batch G)
    created_at:    now.toISOString(),
    expires_at:    expires.toISOString(),
  };
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/checkout_states`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer:        'return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      console.warn('[checkout-state] insert status', r.status);
      return { ok: false, error: 'Could not create checkout session — try again.' };
    }
    return { ok: true, token };
  } catch (e) {
    console.warn('[checkout-state] insert error:', e && e.message);
    return { ok: false, error: 'Could not create checkout session — try again.' };
  }
}

// Look up + mark consumed. Returns the row, or { ok: false, error } if
// missing / expired / already consumed.
async function consumeCheckoutState(token) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey || !token) {
    return { ok: false, error: 'state lookup unavailable' };
  }
  const hdr = { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` };

  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/checkout_states?state_token=eq.${encodeURIComponent(token)}&select=*&limit=1`,
      { headers: hdr }
    );
    if (!r.ok) return { ok: false, error: 'state lookup failed' };
    const rows = await r.json();
    if (!rows.length) return { ok: false, error: 'state not found' };

    const row = rows[0];
    if (row.consumed_at) return { ok: false, error: 'state already consumed' };
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return { ok: false, error: 'state expired' };
    }

    // Mark consumed (best effort — even if this PATCH fails, we already returned
    // the row, so a duplicate webhook would only repeat its idempotent work).
    fetch(`${supabaseUrl}/rest/v1/checkout_states?state_token=eq.${encodeURIComponent(token)}`, {
      method: 'PATCH',
      headers: { ...hdr, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ consumed_at: new Date().toISOString() }),
    }).catch(() => {});

    return { ok: true, state: row };
  } catch (e) {
    return { ok: false, error: 'state lookup error' };
  }
}

module.exports = { createCheckoutState, consumeCheckoutState };
