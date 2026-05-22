// admin-stats.js
// Read-only aggregation for the internal admin dashboard at /admin.html.
// Password-gated by the ADMIN_PASSWORD env var (constant-time comparison so
// timing doesn't leak the secret). Reads from Supabase with the service key —
// every other safeguard already lives in /admin.html (sessionStorage gate,
// noindex meta).
//
// Returns one big snapshot so the page can render the whole dashboard from a
// single round-trip:
//   profiles, subscriptions, sites, counts, failed_payments, recent_activity
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY

const crypto = require('crypto');

function timingSafeMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Admin dashboard not configured — set ADMIN_PASSWORD in Netlify env vars.' }) };
  }

  // Password comes from a custom header so the client never leaks it as a URL.
  const headers = event.headers || {};
  const provided = headers['x-admin-password'] || headers['X-Admin-Password'] || '';
  if (!timingSafeMatch(provided, expected)) {
    return { statusCode: 401, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Incorrect password' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  const sb = (path) => fetch(`${supabaseUrl}/rest/v1/${path}`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });

  // ── Pull every table the dashboard needs in parallel ─────────────────────
  const [profilesRes, subsRes, sitesRes, estRes, invRes] = await Promise.all([
    sb('profiles?select=user_id,business_name,contact_name,trade,city,email,phone,created_at,is_admin&order=created_at.desc').catch(()=>null),
    sb('subscriptions?select=user_id,tool,status,stripe_customer_id,stripe_subscription_id,created_at,updated_at').catch(()=>null),
    sb('sites?select=*&order=created_at.desc&limit=200').catch(()=>null),
    sb('donna_estimates?select=id,user_id,total,status,notes,created_at&order=created_at.desc&limit=10').catch(()=>null),
    sb('donna_invoices?select=id,user_id,total,status,notes,created_at&order=created_at.desc&limit=10').catch(()=>null),
  ]);

  const safeJson = async (r) => (r && r.ok) ? await r.json() : [];
  const profiles      = await safeJson(profilesRes);
  const subscriptions = await safeJson(subsRes);
  const sites         = await safeJson(sitesRes);
  const estimates     = await safeJson(estRes);
  const invoices      = await safeJson(invRes);

  // ── Aggregations ─────────────────────────────────────────────────────────
  const now    = Date.now();
  const day7   = now - 7  * 86400000;
  const day30  = now - 30 * 86400000;

  const inWindow = (ts, since) => ts && new Date(ts).getTime() >= since;
  const newWeek  = profiles.filter((p) => inWindow(p.created_at, day7)).length;
  const newMonth = profiles.filter((p) => inWindow(p.created_at, day30)).length;

  // Tool subscriber counts — active and past_due both count as "still paying."
  const activeByTool = {};
  subscriptions.forEach((s) => {
    if (s.status === 'active' || s.status === 'past_due') {
      activeByTool[s.tool] = (activeByTool[s.tool] || 0) + 1;
    }
  });
  const activePayingTotal = subscriptions
    .filter((s) => s.status === 'active' || s.status === 'past_due').length;

  // Failed-payment cohort — past_due (card retry pending) + canceled (locked).
  const failedPayments = subscriptions.filter((s) => s.status === 'past_due' || s.status === 'canceled');

  // Recent activity feed across all contractors.
  const recentActivity = []
    .concat(estimates.map((e) => Object.assign({}, e, { type: 'estimate' })))
    .concat(invoices.map((i) => Object.assign({}, i, { type: 'invoice' })))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profiles:        profiles,
      subscriptions:   subscriptions,
      sites:           sites,
      counts: {
        total_contractors:    profiles.length,
        new_week:             newWeek,
        new_month:            newMonth,
        active_paying_total:  activePayingTotal,
        active_by_tool:       activeByTool,
        failed_count:         failedPayments.length,
        sites_total:          sites.length,
      },
      failed_payments: failedPayments,
      recent_activity: recentActivity,
    }),
  };
};
