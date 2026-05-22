// finance-sync-nightly.js
// Netlify scheduled function. Runs nightly and refreshes finance_qbo_cache for
// every contractor who has connected QuickBooks, so the Finance dashboard stays
// current even for contractors who don't open the tool every day.
//
// The schedule is configured in netlify.toml:
//   [functions."finance-sync-nightly"]  schedule = "0 8 * * *"
// 08:00 UTC ≈ 2:00 AM US Central. Netlify cron runs in UTC.
//
// Reuses the QBO pull/cache logic from finance-qbo-fetch.js (pullAndCache) and
// the shared token utility (qbo-refresh.js).
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_SANDBOX
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

const { getQboConnection } = require('./qbo-refresh');
const { pullAndCache }     = require('./finance-qbo-fetch');

exports.handler = async () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey || !process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
    console.error('[finance-sync-nightly] missing env config — skipping');
    return { statusCode: 200, body: 'skipped — not configured' };
  }

  // Every contractor who has connected QuickBooks (one token row per user).
  let tokenRows = [];
  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/donna_qbo_tokens?select=user_id`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (r.ok) tokenRows = await r.json();
    else console.error('[finance-sync-nightly] token list', r.status, await r.text());
  } catch (e) {
    console.error('[finance-sync-nightly] token list failed:', e.message);
    return { statusCode: 200, body: 'error listing QBO tokens' };
  }

  let refreshed = 0, failed = 0;
  for (const row of tokenRows) {
    if (!row.user_id) continue;
    try {
      // getQboConnection refreshes the access token first if it's near expiry.
      const conn = await getQboConnection(row.user_id, supabaseUrl, supabaseKey);
      if (!conn.connected) { failed++; continue; }
      await pullAndCache(row.user_id, conn, supabaseUrl, supabaseKey);
      refreshed++;
    } catch (e) {
      failed++;
      console.error('[finance-sync-nightly] user', row.user_id, e.message);
    }
  }

  console.log(`[finance-sync-nightly] refreshed ${refreshed}, failed ${failed}, total ${tokenRows.length}`);
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshed, failed, total: tokenRows.length }),
  };
};
