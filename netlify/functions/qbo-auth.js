// Starts the QuickBooks Online OAuth 2.0 flow.
//
// The signed-in contractor's tool (Operations) calls this with their Supabase
// bearer token. It returns the Intuit consent URL; the frontend redirects the
// contractor there. After they consent, Intuit redirects to qbo-callback.js.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   QBO_CLIENT_ID        — from the Intuit developer console
//   QBO_REDIRECT_URI     — https://bedrock-sites.com/.netlify/functions/qbo-callback
//   SUPABASE_URL / SUPABASE_SERVICE_KEY — already set
// (QBO_CLIENT_SECRET and QBO_SANDBOX are used by qbo-callback / qbo-sync.)

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const clientId    = process.env.QBO_CLIENT_ID;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

  if (!clientId || !redirectUri) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'QuickBooks isn’t configured yet — set QBO_CLIENT_ID and QBO_REDIRECT_URI in Netlify.' }),
    };
  }

  // Identify the contractor from their Supabase session token.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token || !supabaseUrl || !supabaseKey) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required to connect QuickBooks.' }) };
  }
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session.' }) };
  }
  const user = await userRes.json();

  // `state` carries the user id so qbo-callback knows whose tokens to store.
  // HARDENING TODO: HMAC-sign this so a forged callback can't bind QBO tokens
  // to someone else's account.
  const params = new URLSearchParams({
    client_id:     clientId,
    scope:         'com.intuit.quickbooks.accounting',
    redirect_uri:  redirectUri,
    response_type: 'code',
    state:         user.id,
  });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'https://appcenter.intuit.com/connect/oauth2?' + params.toString() }),
  };
};
