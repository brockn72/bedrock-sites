// dashboard-snapshot.js
// Powers the portal Dashboard's at-a-glance cards: the contractor's recent
// Donna activity (latest estimates/invoices) and a current-month finance
// summary (revenue + outstanding) built from donna_invoices.
//
// Keeps the dashboard's snapshot independent of QBO so it works for any
// contractor using Donna, with or without QuickBooks connected.
//
// ── Returns ────────────────────────────────────────────────────────────────
//   { recent: [{ type, id, total, status, notes, created_at, line_items }],
//     month_revenue, outstanding,
//     counts: { estimates, invoices } }
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_KEY

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  const hdr = { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } };
  let estimates = [], invoices = [];
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/donna_estimates?user_id=eq.${userId}&select=id,total,status,notes,created_at&order=created_at.desc&limit=10`, hdr);
    if (r.ok) estimates = await r.json();
  } catch (e) { console.error('[dashboard-snapshot] estimates:', e.message); }
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/donna_invoices?user_id=eq.${userId}&select=id,total,status,notes,created_at&order=created_at.desc&limit=10`, hdr);
    if (r.ok) invoices = await r.json();
  } catch (e) { console.error('[dashboard-snapshot] invoices:', e.message); }

  // Current-month revenue from Donna invoices.
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthRevenue = invoices
    .filter((iv) => iv.created_at && new Date(iv.created_at) >= monthStart)
    .reduce((s, iv) => s + (Number(iv.total) || 0), 0);
  // Donna doesn't track payment status — every invoice counts as money owed
  // until the contractor reconciles in QuickBooks.
  const outstanding = invoices.reduce((s, iv) => s + (Number(iv.total) || 0), 0);

  // Latest three items, mixed estimates + invoices.
  const recent = []
    .concat(estimates.map((e) => Object.assign({}, e, { type: 'estimate' })))
    .concat(invoices.map((i) => Object.assign({}, i, { type: 'invoice' })))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recent: recent,
      month_revenue: monthRevenue,
      outstanding: outstanding,
      counts: { estimates: estimates.length, invoices: invoices.length },
    }),
  };
};
