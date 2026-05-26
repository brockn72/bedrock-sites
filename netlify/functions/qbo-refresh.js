// qbo-refresh.js
// Shared QuickBooks Online token utility. QBO access tokens expire after ~60
// minutes; refresh tokens last ~100 days and Intuit rotates them on every use.
//
// Used two ways:
//   1. As a Netlify endpoint — POST/GET with a Supabase bearer token. Refreshes
//      the caller's QBO token if it's near expiry and reports connection status.
//   2. As a shared module — qbo-sync.js and finance functions require() this
//      file and call getQboConnection() to obtain a guaranteed-fresh token.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET — from the Intuit developer console
//   SUPABASE_URL, SUPABASE_SERVICE_KEY — already set
//
// Requires the donna_qbo_tokens table (see BEDROCK-DONNA.md schema).

const REFRESH_WINDOW_MS = 5 * 60 * 1000; // refresh if within 5 min of expiry

// Refresh a donna_qbo_tokens row if its access token is expired or within 5
// minutes of expiring. Returns the row with a guaranteed-fresh access_token
// and a `refreshed` flag. Throws only on an actual refresh failure.
async function ensureFreshToken(tok, supabaseUrl, supabaseKey) {
  const expMs = tok.token_expires_at ? new Date(tok.token_expires_at).getTime() : 0;
  if (expMs && Date.now() < expMs - REFRESH_WINDOW_MS) {
    return Object.assign({}, tok, { refreshed: false });
  }

  const clientId     = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('QuickBooks credentials not configured');

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept:         'application/json',
    },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tok.refresh_token }).toString(),
  });
  if (!res.ok) {
    throw new Error('QBO token refresh failed (' + res.status + '): ' + (await res.text()));
  }
  const fresh = await res.json();
  const expiresAt = new Date(Date.now() + ((fresh.expires_in || 3600) * 1000)).toISOString();

  // Persist the rotated tokens so the next call starts fresh. Intuit rotates
  // the refresh token periodically, so we keep whatever it returns.
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

  return Object.assign({}, tok, {
    access_token:     fresh.access_token,
    refresh_token:    fresh.refresh_token || tok.refresh_token,
    token_expires_at: expiresAt,
    refreshed:        true,
  });
}

// Look up a contractor's QBO connection and return a guaranteed-fresh token.
// Returns { connected:false } if they haven't connected QBO — never throws for
// a missing connection, only for an actual refresh failure.
async function getQboConnection(userId, supabaseUrl, supabaseKey) {
  const tokRes = await fetch(
    `${supabaseUrl}/rest/v1/donna_qbo_tokens?user_id=eq.${userId}&select=*&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const rows = tokRes.ok ? await tokRes.json() : [];
  if (!rows.length) return { connected: false };
  const row = rows[0];
  const fresh = await ensureFreshToken(row, supabaseUrl, supabaseKey);
  return {
    connected:        true,
    access_token:     fresh.access_token,
    realm_id:         fresh.realm_id,
    token_expires_at: fresh.token_expires_at,
    refreshed:        fresh.refreshed,
    // OPS6 + reusable-items setup cache (populated by lib/qbo-setup.js on connect).
    bedrock_item_ids: row.bedrock_item_ids || null,
    expense_accounts: row.expense_accounts || null,
  };
}

exports.ensureFreshToken  = ensureFreshToken;
exports.getQboConnection  = getQboConnection;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
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

  try {
    const conn = await getQboConnection(userId, supabaseUrl, supabaseKey);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connected:        conn.connected,
        refreshed:        !!conn.refreshed,
        token_expires_at: conn.token_expires_at || null,
      }),
    };
  } catch (e) {
    console.error('[qbo-refresh]', e.message);
    // The connection exists but the refresh token is dead — report disconnected
    // so the UI prompts a reconnect rather than showing a stale green dot.
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connected: false, error: 'QuickBooks needs to be reconnected.' }),
    };
  }
};
