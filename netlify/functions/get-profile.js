// Fetches the authenticated user's profile. If none exists yet, seeds one from
// their leads row (so the contractor sees their existing biz info pre-filled).
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }
  const user = await userRes.json();
  const userId = user.id;
  const email  = (user.email || '').toLowerCase();

  // Look up existing profile
  const profRes = await fetch(
    `${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=*&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!profRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Lookup failed' }) };
  }
  const profiles = await profRes.json();

  // The contractor's tool subscriptions (Marketing / Finance & Operations).
  // Returned alongside the profile so each tool can gate real actions.
  let subscriptions = [];
  try {
    const subRes = await fetch(
      `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${userId}&select=tool,status`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (subRes.ok) subscriptions = await subRes.json();
  } catch (_) { /* subscriptions table may not exist yet — non-fatal */ }

  // Integration connection status — read from the database so Donna, Finance,
  // and the portal show a green dot ONLY when a connection actually exists.
  // A QBO/Google connection row carries a refresh token (the durable
  // credential); access tokens auto-refresh, so a row = genuinely connected.
  const connections = { qbo: false, google: false, google_scopes: '' };
  try {
    const qboRes = await fetch(
      `${supabaseUrl}/rest/v1/donna_qbo_tokens?user_id=eq.${userId}&select=user_id,refresh_token&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (qboRes.ok) {
      const rows = await qboRes.json();
      connections.qbo = rows.length > 0 && !!rows[0].refresh_token;
    }
  } catch (_) { /* table may not exist yet — non-fatal */ }
  try {
    const gRes = await fetch(
      `${supabaseUrl}/rest/v1/oauth_connections?user_id=eq.${userId}&provider=eq.google&select=refresh_token,scopes&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (gRes.ok) {
      const rows = await gRes.json();
      if (rows.length && rows[0].refresh_token) {
        connections.google = true;
        connections.google_scopes = rows[0].scopes || '';
      }
    }
  } catch (_) { /* table may not exist yet — non-fatal */ }

  if (profiles.length) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profiles[0], subscriptions, connections }),
    };
  }

  // No profile yet → seed from the user's lead (if any) so we don't make them
  // re-type info they already gave us. Returned as a draft (not yet persisted).
  const leadRes = await fetch(
    `${supabaseUrl}/rest/v1/leads?user_id=eq.${userId}&select=business_name,contact_name,phone,trade,city,service_areas&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  let seed = {};
  if (leadRes.ok) {
    const leads = await leadRes.json();
    if (leads.length) seed = leads[0];
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: null,
      draft: { email, user_id: userId, ...seed },
      subscriptions,
      connections,
    }),
  };
};
