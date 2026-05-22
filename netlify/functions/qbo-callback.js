// QuickBooks Online OAuth callback. Intuit redirects the contractor here after
// they consent. Exchanges the authorization code for tokens and stores them in
// donna_qbo_tokens, then redirects the contractor back to the Operations tool.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET — from the Intuit developer console
//   QBO_REDIRECT_URI                 — must match qbo-auth.js exactly
//   SITE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY — already set
//
// Requires the `donna_qbo_tokens` table (see BEDROCK-DONNA.md schema).

exports.handler = async (event) => {
  const siteUrl = process.env.SITE_URL || 'https://bedrock-sites.com';
  // Always end by sending the contractor back to Operations with a status flag.
  const back = (status) => ({
    statusCode: 302,
    headers: { Location: `${siteUrl}/bedrock-donna-v1.html?qbo=${status}` },
    body: '',
  });

  const clientId     = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri  = process.env.QBO_REDIRECT_URI;
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!clientId || !clientSecret || !redirectUri || !supabaseUrl || !supabaseKey) {
    console.error('[qbo-callback] missing env config');
    return back('error');
  }

  const q       = event.queryStringParameters || {};
  const code    = q.code;
  const realmId = q.realmId;          // the QBO company id, supplied by Intuit
  const userId  = q.state;            // the user id, set by qbo-auth.js
  if (q.error) { console.error('[qbo-callback] intuit error:', q.error); return back('declined'); }
  if (!code || !realmId || !userId) return back('error');

  // Exchange the authorization code for access + refresh tokens.
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  let tok;
  try {
    const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
      method: 'POST',
      headers: {
        Authorization:  `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept:         'application/json',
      },
      body: new URLSearchParams({
        grant_type:   'authorization_code',
        code:         code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!tokenRes.ok) {
      console.error('[qbo-callback] token exchange', tokenRes.status, await tokenRes.text());
      return back('error');
    }
    tok = await tokenRes.json();
  } catch (e) {
    console.error('[qbo-callback] token exchange failed:', e.message);
    return back('error');
  }

  // QBO access tokens last ~60 minutes; qbo-refresh handles renewal after that.
  const expiresAt = new Date(Date.now() + ((tok.expires_in || 3600) * 1000)).toISOString();

  // Upsert one token row per contractor (donna_qbo_tokens.user_id is UNIQUE).
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/donna_qbo_tokens?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer:        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id:          userId,
        realm_id:         realmId,
        access_token:     tok.access_token,
        refresh_token:    tok.refresh_token,
        token_expires_at: expiresAt,
        updated_at:       new Date().toISOString(),
      }),
    });
    if (!r.ok) {
      console.error('[qbo-callback] token store', r.status, await r.text());
      return back('error');
    }
  } catch (e) {
    console.error('[qbo-callback] token store failed:', e.message);
    return back('error');
  }

  return back('connected');
};
