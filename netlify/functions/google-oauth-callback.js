// google-oauth-callback.js
// Google redirects the contractor here after they consent. Exchanges the auth
// code for tokens, looks up which Google account they connected, and upserts
// the row into oauth_connections (provider='google'). Then sends them back to
// the portal with ?google=connected.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET
//   GOOGLE_BUSINESS_REDIRECT_URI — must match google-oauth-auth.js exactly
//   SITE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Requires the oauth_connections table (see SQL in the session summary).

exports.handler = async (event) => {
  const siteUrl = process.env.SITE_URL || 'https://bedrock-sites.com';
  // Always end by sending the contractor back to the portal with a status flag.
  const back = (status) => ({
    statusCode: 302,
    headers: { Location: `${siteUrl}/portal.html?google=${status}#integrations` },
    body: '',
  });

  const clientId     = process.env.GOOGLE_BUSINESS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET;
  const redirectUri  = process.env.GOOGLE_BUSINESS_REDIRECT_URI;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!clientId || !clientSecret || !redirectUri || !supabaseUrl || !supabaseKey) {
    console.error('[google-oauth-callback] missing env config');
    return back('error');
  }

  const q      = event.queryStringParameters || {};
  const code   = q.code;
  const userId = q.state;                 // the user id, set by google-oauth-auth.js
  if (q.error) { console.error('[google-oauth-callback] google error:', q.error); return back('declined'); }
  if (!code || !userId) return back('error');

  // ── Exchange the authorization code for tokens ────────────────────────────
  let tok;
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code:          code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  redirectUri,
        grant_type:    'authorization_code',
      }).toString(),
    });
    if (!tokenRes.ok) {
      console.error('[google-oauth-callback] token exchange', tokenRes.status, await tokenRes.text());
      return back('error');
    }
    tok = await tokenRes.json();
  } catch (e) {
    console.error('[google-oauth-callback] token exchange failed:', e.message);
    return back('error');
  }

  // ── Which Google account did they connect? ────────────────────────────────
  let accountEmail = null;
  try {
    const infoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (infoRes.ok) accountEmail = (await infoRes.json()).email || null;
  } catch (_) { /* non-fatal — the email is a nicety */ }

  const expiresAt = new Date(Date.now() + ((tok.expires_in || 3600) * 1000)).toISOString();

  // ── Upsert one row per contractor per provider ────────────────────────────
  // oauth_connections is UNIQUE(user_id, provider). If a refresh_token isn't
  // returned (e.g. a re-consent), keep the one already on file.
  const row = {
    user_id:          userId,
    provider:         'google',
    access_token:     tok.access_token,
    token_expires_at: expiresAt,
    scopes:           tok.scope || '',
    account_email:    accountEmail,
    updated_at:       new Date().toISOString(),
  };
  if (tok.refresh_token) row.refresh_token = tok.refresh_token;

  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/oauth_connections?on_conflict=user_id,provider`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer:        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
    });
    if (!r.ok) {
      console.error('[google-oauth-callback] token store', r.status, await r.text());
      return back('error');
    }
  } catch (e) {
    console.error('[google-oauth-callback] token store failed:', e.message);
    return back('error');
  }

  return back('connected');
};
