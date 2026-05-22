// netlify/lib/google-token.js
// Shared Google OAuth helpers for the Netlify functions that call Google APIs
// on a contractor's behalf (gmail-send, calendar-create). Reads the token from
// oauth_connections (provider='google'), refreshes it if it's near expiry, and
// reports which Google scopes the contractor granted.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET

// Refresh the Google access token if it's expired or within 5 min of expiry.
async function ensureGoogleToken(row, supabaseUrl, supabaseKey) {
  const expMs = row.token_expires_at ? new Date(row.token_expires_at).getTime() : 0;
  if (expMs && Date.now() < expMs - 5 * 60 * 1000) return row.access_token;
  if (!row.refresh_token) throw new Error('No Google refresh token on file');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_BUSINESS_CLIENT_ID,
      client_secret: process.env.GOOGLE_BUSINESS_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type:    'refresh_token',
    }).toString(),
  });
  if (!res.ok) throw new Error('Google token refresh failed (' + res.status + ')');
  const fresh = await res.json();
  const expiresAt = new Date(Date.now() + ((fresh.expires_in || 3600) * 1000)).toISOString();

  await fetch(`${supabaseUrl}/rest/v1/oauth_connections?user_id=eq.${row.user_id}&provider=eq.google`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey:         supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer:        'return=minimal',
    },
    body: JSON.stringify({ access_token: fresh.access_token, token_expires_at: expiresAt, updated_at: new Date().toISOString() }),
  });
  return fresh.access_token;
}

// Look up a contractor's Google connection and return a guaranteed-fresh token.
// Returns { connected:false } when there's no Google row — never throws for a
// missing connection, only for an actual refresh failure.
async function getGoogleConnection(userId, supabaseUrl, supabaseKey) {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/oauth_connections?user_id=eq.${userId}&provider=eq.google&select=*&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const rows = res.ok ? await res.json() : [];
  if (!rows.length || !rows[0].refresh_token) return { connected: false };
  const accessToken = await ensureGoogleToken(rows[0], supabaseUrl, supabaseKey);
  return {
    connected:     true,
    access_token:  accessToken,
    scopes:        rows[0].scopes || '',
    account_email: rows[0].account_email || '',
  };
}

module.exports = { ensureGoogleToken, getGoogleConnection };
