// finance-qbo-fetch.js
// Pulls the contractor's QuickBooks data (invoices, estimates, expenses,
// customers), caches it in finance_qbo_cache, and RETURNS it so the Finance
// dashboard can render real numbers. Called when the Finance tab opens, by the
// manual Refresh button (force=true), and by the nightly scheduled job.
//
// Smart cache: if the cache is fresher than FINANCE_CACHE_TTL_MINUTES (default
// 15) and force isn't set, this returns the cached data without touching the
// QBO API — exactly the "perceived real-time" model in BEDROCK-FINANCE.md.
//
// Shares the one QBO connection (donna_qbo_tokens) with Operations/Donna via
// the qbo-refresh.js shared utility.
//
// ── Request ────────────────────────────────────────────────────────────────
//   POST { force?: true }   — force a fresh QBO pull, ignoring the cache
//
// Donna data is folded in on every response (regardless of QBO connection):
//   • donna_receipts → merged into data.expenses. After OPS1 (2026-05-25)
//     receipts CAN sync to QBO as Purchase records; rows with qbo_purchase_id
//     set are filtered out below so we don't double-count them.
//   • donna_estimates / donna_invoices → returned raw so the Projects page can
//     compute real per-job margins QBO alone can't provide.
//
// ── Returns ────────────────────────────────────────────────────────────────
//   { connected, fetched_at, from_cache, counts,
//     data: { invoices:[], estimates:[], expenses:[], customers:[],
//             donna_estimates:[], donna_invoices:[] } }
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_SANDBOX
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   FINANCE_CACHE_TTL_MINUTES (optional, default 15)

const { getQboConnection } = require('./qbo-refresh');

// QBO data API base — sandbox vs production.
function qboApiBase() {
  return process.env.QBO_SANDBOX === 'false'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

// Run a QBO query and return the QueryResponse object.
async function qboQuery(accessToken, realmId, query) {
  const url = `${qboApiBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (!res.ok) {
    console.error('[finance-qbo-fetch] query failed', res.status, query);
    return {};
  }
  return (await res.json()).QueryResponse || {};
}

const DATASETS = {
  invoices:  'SELECT * FROM Invoice MAXRESULTS 200',
  estimates: 'SELECT * FROM Estimate MAXRESULTS 200',
  expenses:  'SELECT * FROM Purchase MAXRESULTS 200',
  customers: 'SELECT * FROM Customer MAXRESULTS 200',
};

// Pull every QBO dataset for one connected contractor and upsert the cache.
// Shared by this function's handler and finance-sync-nightly.js. `fallback`
// (optional) is a { data_type: rows } map used when a single query fails.
async function pullAndCache(userId, conn, supabaseUrl, supabaseKey, fallback) {
  fallback = fallback || {};
  const fetchedAt = new Date().toISOString();
  const out = {};
  for (const type of Object.keys(DATASETS)) {
    let data = [];
    try {
      const qr = await qboQuery(conn.access_token, conn.realm_id, DATASETS[type]);
      data = qr.Invoice || qr.Estimate || qr.Purchase || qr.Customer || [];
    } catch (e) {
      console.error(`[finance-qbo-fetch] ${type}:`, e.message);
      data = fallback[type] || [];   // keep the last good data for this dataset
    }
    out[type] = data;
  }

  // Upsert one cache row per data type (finance_qbo_cache is UNIQUE(user_id,data_type)).
  const cacheRows = Object.keys(out).map((t) => ({ user_id: userId, data_type: t, data: out[t], fetched_at: fetchedAt }));
  try {
    const cacheRes = await fetch(`${supabaseUrl}/rest/v1/finance_qbo_cache?on_conflict=user_id,data_type`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer:        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(cacheRows),
    });
    if (!cacheRes.ok) console.error('[finance-qbo-fetch] cache upsert', cacheRes.status, await cacheRes.text());
  } catch (e) {
    console.error('[finance-qbo-fetch] cache upsert failed:', e.message);
  }
  return { fetchedAt, out };
}
exports.pullAndCache = pullAndCache;

// Fetch the contractor's Donna-sourced finance data: estimates, invoices, and
// receipts. Receipts are reshaped as QBO-Purchase-like objects so they merge
// straight into the expense dataset the dashboard already understands.
async function getDonnaFinanceData(userId, supabaseUrl, supabaseKey) {
  const hdr = { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } };
  const out = { estimates: [], invoices: [], receiptExpenses: [] };
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/donna_estimates?user_id=eq.${userId}&select=*`, hdr);
    if (r.ok) out.estimates = await r.json();
  } catch (e) { console.error('[finance-qbo-fetch] donna_estimates:', e.message); }
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/donna_invoices?user_id=eq.${userId}&select=*`, hdr);
    if (r.ok) out.invoices = await r.json();
  } catch (e) { console.error('[finance-qbo-fetch] donna_invoices:', e.message); }
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/donna_receipts?user_id=eq.${userId}&select=*`, hdr);
    if (r.ok) {
      const receipts = await r.json();
      // OPS1 dedup: if a receipt has been pushed to QBO (qbo_purchase_id set),
      // the QBO pull above already includes the Purchase — skip the Donna copy.
      out.receiptExpenses = receipts
        .filter((rc) => !rc.qbo_purchase_id)
        .map((rc) => ({
          Id:       'donna-' + rc.id,
          TxnDate:  rc.date || (rc.created_at ? String(rc.created_at).slice(0, 10) : null),
          TotalAmt: Number(rc.amount) || 0,
          _source:  'donna',
          vendor:   rc.vendor || '',
        }));
    }
  } catch (e) { console.error('[finance-qbo-fetch] donna_receipts:', e.message); }
  return out;
}

// Merge Donna data into a QBO data object: receipts into expenses, estimates
// and invoices as their own fields.
function withDonna(qboData, donna) {
  return Object.assign({}, qboData, {
    expenses:        (qboData.expenses || []).concat(donna.receiptExpenses || []),
    donna_estimates: donna.estimates || [],
    donna_invoices:  donna.invoices || [],
  });
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }
  if (!process.env.QBO_CLIENT_ID || !process.env.QBO_CLIENT_SECRET) {
    return { statusCode: 503, body: JSON.stringify({ error: 'QuickBooks not configured yet — set the QBO_* env vars.' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (_) { /* GET / empty body */ }
  const force = body.force === true || (event.queryStringParameters || {}).force === 'true';

  // Identify the contractor from their Supabase session.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  const ok = (payload) => ({
    statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });

  // Donna-sourced finance data — folded into every response below, with or
  // without a QBO connection.
  const donna = await getDonnaFinanceData(userId, supabaseUrl, supabaseKey);

  // ── Read the existing cache ───────────────────────────────────────────────
  let cacheRowsExisting = [];
  try {
    const cRes = await fetch(
      `${supabaseUrl}/rest/v1/finance_qbo_cache?user_id=eq.${userId}&select=data_type,data,fetched_at`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (cRes.ok) cacheRowsExisting = await cRes.json();
  } catch (_) { /* non-fatal */ }

  const cacheData = {};
  let cacheFetchedAt = null;
  cacheRowsExisting.forEach((r) => {
    cacheData[r.data_type] = r.data || [];
    if (!cacheFetchedAt || new Date(r.fetched_at) > new Date(cacheFetchedAt)) cacheFetchedAt = r.fetched_at;
  });

  // ── Serve from cache when it's fresh and a refresh wasn't forced ──────────
  const ttlMin = parseInt(process.env.FINANCE_CACHE_TTL_MINUTES || '15', 10) || 15;
  const cacheAgeMs = cacheFetchedAt ? (Date.now() - new Date(cacheFetchedAt).getTime()) : Infinity;
  if (!force && cacheFetchedAt && cacheAgeMs < ttlMin * 60 * 1000) {
    return ok({
      connected:  true,
      from_cache: true,
      fetched_at: cacheFetchedAt,
      counts:     Object.keys(DATASETS).reduce((a, k) => { a[k] = (cacheData[k] || []).length; return a; }, {}),
      data:       withDonna(Object.keys(DATASETS).reduce((a, k) => { a[k] = cacheData[k] || []; return a; }, {}), donna),
    });
  }

  // ── Need fresh data — make sure QBO is connected ──────────────────────────
  let conn;
  try {
    conn = await getQboConnection(userId, supabaseUrl, supabaseKey);
  } catch (e) {
    console.error('[finance-qbo-fetch] connection error:', e.message);
    conn = { connected: false };
  }
  if (!conn.connected) {
    // Not connected — hand back whatever cache exists (may be empty) so the
    // dashboard can decide between "show stale" and "show the connect prompt".
    return ok({
      connected:  false,
      from_cache: !!cacheFetchedAt,
      fetched_at: cacheFetchedAt,
      message:    'QuickBooks not connected — connect it in Operations or My Integrations.',
      data:       withDonna(Object.keys(DATASETS).reduce((a, k) => { a[k] = cacheData[k] || []; return a; }, {}), donna),
    });
  }

  // ── Pull fresh data from QBO and refresh the cache ────────────────────────
  const { fetchedAt, out } = await pullAndCache(userId, conn, supabaseUrl, supabaseKey, cacheData);

  return ok({
    connected:  true,
    from_cache: false,
    fetched_at: fetchedAt,
    counts:     Object.keys(out).reduce((a, k) => { a[k] = out[k].length; return a; }, {}),
    data:       withDonna(out, donna),
  });
};
