// finance-qbo-fetch.js
// Pulls the contractor's QuickBooks data (invoices, estimates, expenses,
// customers) and caches it in finance_qbo_cache. Called when the Finance tab
// opens, by the manual Refresh button, and (later) by a nightly scheduled job.
//
// Requires the contractor has connected QBO (a donna_qbo_tokens row — created
// by qbo-callback.js). Shares that one QBO connection with Operations/Donna.
//
// ── Env vars ────────────────────────────────────────────────────────────────
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET — for token refresh
//   QBO_SANDBOX                      — 'false' for production, anything else = sandbox
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Requires the finance_qbo_cache table (see BEDROCK-FINANCE.md schema).

// QBO data API base — sandbox vs production. (The OAuth endpoints are the same
// for both; only the data API differs.)
function qboApiBase() {
  return process.env.QBO_SANDBOX === 'false'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

// Return a valid access token, refreshing it first if it's expired or within
// 5 minutes of expiry. QBO access tokens last ~60 min; refresh tokens ~100 days
// and Intuit rotates them on each refresh, so we persist whatever comes back.
async function ensureFreshToken(tok, supabaseUrl, supabaseKey) {
  const expMs = tok.token_expires_at ? new Date(tok.token_expires_at).getTime() : 0;
  if (Date.now() < expMs - 5 * 60 * 1000) return tok.access_token;

  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept:         'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }).toString(),
  });
  if (!res.ok) throw new Error('QBO token refresh failed (' + res.status + ')');
  const fresh = await res.json();
  const expiresAt = new Date(Date.now() + ((fresh.expires_in || 3600) * 1000)).toISOString();

  await fetch(`${supabaseUrl}/rest/v1/donna_qbo_tokens?user_id=eq.${tok.user_id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey:         supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer:        'return=minimal',
    },
    body: JSON.stringify({
      access_token:     fresh.access_token,
      refresh_token:    fresh.refresh_token || tok.refresh_token,
      token_expires_at: expiresAt,
      updated_at:       new Date().toISOString(),
    }),
  });
  return fresh.access_token;
}

// Run a QBO query and return the QueryResponse object.
async function qboQuery(accessToken, realmId, query) {
  const url = `${qboApiBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (!res.ok) {
    console.error('[finance-qbo-fetch] query failed', res.status, query);
    return {};
  }
  const j = await res.json();
  return j.QueryResponse || {};
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

  // Identify the contractor from their Supabase session.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  // Look up this contractor's QBO connection (shared with Operations/Donna).
  const tokRes = await fetch(
    `${supabaseUrl}/rest/v1/donna_qbo_tokens?user_id=eq.${userId}&select=*&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const tokRows = tokRes.ok ? await tokRes.json() : [];
  if (!tokRows.length) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connected: false, message: 'QuickBooks not connected — connect it in Operations.' }),
    };
  }
  const tok = tokRows[0];

  let accessToken;
  try {
    accessToken = await ensureFreshToken(tok, supabaseUrl, supabaseKey);
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }

  // Pull the four datasets Finance reads. Each query returns one entity type.
  const datasets = {
    invoices:  'SELECT * FROM Invoice MAXRESULTS 200',
    estimates: 'SELECT * FROM Estimate MAXRESULTS 200',
    expenses:  'SELECT * FROM Purchase MAXRESULTS 200',
    customers: 'SELECT * FROM Customer MAXRESULTS 200',
  };
  const fetchedAt = new Date().toISOString();
  const cacheRows = [];
  for (const type of Object.keys(datasets)) {
    let data = [];
    try {
      const qr = await qboQuery(accessToken, tok.realm_id, datasets[type]);
      data = qr.Invoice || qr.Estimate || qr.Purchase || qr.Customer || [];
    } catch (e) {
      console.error(`[finance-qbo-fetch] ${type}:`, e.message);
    }
    cacheRows.push({ user_id: userId, data_type: type, data, fetched_at: fetchedAt });
  }

  // Upsert one cache row per data type (finance_qbo_cache is UNIQUE(user_id,data_type)).
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
  if (!cacheRes.ok) {
    console.error('[finance-qbo-fetch] cache upsert', cacheRes.status, await cacheRes.text());
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not cache QuickBooks data' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      connected:  true,
      fetched_at: fetchedAt,
      counts:     cacheRows.reduce((a, r) => { a[r.data_type] = r.data.length; return a; }, {}),
    }),
  };
};
