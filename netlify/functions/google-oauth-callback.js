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
  // G17a: step-by-step diagnostic logging so Netlify function logs make the failure
  // point obvious. "not set up yet" is usually a redirect URI mismatch or the OAuth
  // app being stuck in Testing mode in Google Cloud Console.
  const mask = (s) => !s ? '' : (String(s).slice(0,6) + '...' + String(s).slice(-4));

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
  console.log('[google-oauth-callback] config check', {
    clientId_set:     !!clientId,
    clientSecret_set: !!clientSecret,
    redirectUri:      redirectUri || '(MISSING)',
    supabaseUrl_set:  !!supabaseUrl,
    supabaseKey_set:  !!supabaseKey,
  });
  if (!clientId || !clientSecret || !redirectUri || !supabaseUrl || !supabaseKey) {
    console.error('[google-oauth-callback] missing env config — set GOOGLE_BUSINESS_CLIENT_ID / SECRET / REDIRECT_URI and SUPABASE_URL / SERVICE_KEY in Netlify.');
    return back('error');
  }

  const q      = event.queryStringParameters || {};
  const code   = q.code;
  const userId = q.state;                 // the user id, set by google-oauth-auth.js
  console.log('[google-oauth-callback] callback hit', {
    code:   mask(code),
    state:  mask(userId),
    error:  q.error || null,
    scope:  q.scope || null,
  });
  if (q.error) { console.error('[google-oauth-callback] google returned error param:', q.error, q.error_description || ''); return back('declined'); }
  if (!code || !userId) { console.error('[google-oauth-callback] missing code or state'); return back('error'); }

  // ── Exchange the authorization code for tokens ────────────────────────────
  let tok;
  try {
    console.log('[google-oauth-callback] exchanging code -> tokens', { redirect_uri: redirectUri });
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
      const errBody = await tokenRes.text();
      console.error('[google-oauth-callback] token exchange FAILED', tokenRes.status, errBody);
      console.error('[google-oauth-callback] common causes: (1) redirect_uri sent ('+redirectUri+') does not exactly match the one registered in Google Cloud Console > Credentials > OAuth Client; (2) the OAuth app is still in Testing mode and the contractor email is not on the test users list; (3) the client_id/secret are for a different project.');
      return back('error');
    }
    tok = await tokenRes.json();
    console.log('[google-oauth-callback] token exchange OK', { has_refresh: !!tok.refresh_token, expires_in: tok.expires_in });
  } catch (e) {
    console.error('[google-oauth-callback] token exchange threw:', e.message);
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
