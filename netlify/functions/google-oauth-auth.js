// google-oauth-auth.js
// Starts the Google OAuth 2.0 flow for the Integrations Hub. ONE consent screen
// requests all three Google services the contractor needs — Gmail send,
// Calendar, and Business Profile — so they connect Google once.
//
// The signed-in contractor's portal calls this with their Supabase bearer
// token. It returns the Google consent URL; the frontend redirects there.
// After consent, Google redirects to google-oauth-callback.js.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   GOOGLE_BUSINESS_CLIENT_ID      — Google Cloud OAuth client
//   GOOGLE_BUSINESS_REDIRECT_URI   — must match the callback + a registered URI
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
// (GOOGLE_BUSINESS_CLIENT_SECRET is used by google-oauth-callback.js.)
//
// ── G17b: REDIRECT URI VERIFICATION ──────────────────────────────────────────
// The URI that GOOGLE_BUSINESS_REDIRECT_URI is set to MUST be registered in
// Google Cloud Console -> APIs & Services -> Credentials -> the OAuth 2.0
// Client -> "Authorized redirect URIs". Exact match — including https vs http,
// trailing slash, and the path. The production value should look like:
//
//   https://bedrock-sites.com/.netlify/functions/google-oauth-callback
//
// IMPORTANT: localhost:8888 and bedrock-sites.com are completely separate
// origins as far as Google is concerned. If you're testing the OAuth flow
// locally with `netlify dev`, you must ALSO register:
//
//   http://localhost:8888/.netlify/functions/google-oauth-callback
//
// (both URIs in the same OAuth Client; Google supports multiple). Without
// the local URI registered, the local flow will fail with redirect_uri_mismatch
// even though production works. Until you publish the OAuth consent screen,
// any contractor whose email isn't on the Testing-mode test-users list will
// also see "not set up yet" / access_denied — publish or add their email.
// See google-oauth-callback.js for the diagnostic logs that show the exact
// URI being sent on each token exchange.

// One consent screen, every scope the ecosystem uses.
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/business.manage',
].join(' ');

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const clientId    = process.env.GOOGLE_BUSINESS_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_BUSINESS_REDIRECT_URI;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!clientId || !redirectUri) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Google isn’t configured yet — set GOOGLE_BUSINESS_CLIENT_ID and GOOGLE_BUSINESS_REDIRECT_URI in Netlify.' }) };
  }

  // Identify the contractor from their Supabase session token.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !supabaseUrl || !supabaseKey) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required to connect Google.' }) };
  }
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session.' }) };
  }
  const user = await userRes.json();

  // `state` carries the user id so the callback knows whose tokens to store.
  // access_type=offline + prompt=consent guarantees a refresh token comes back.
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         SCOPES,
    access_type:   'offline',
    include_granted_scopes: 'true',
    prompt:        'consent',
    state:         user.id,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params.toString() }),
  };
};
