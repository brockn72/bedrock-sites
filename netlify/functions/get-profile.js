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
      body: JSON.stringify({
        profile: profiles[0],
        subscriptions,
        connections,
        completion_pct: computeCompletionPct(profiles[0]),
      }),
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
      completion_pct: 0,
    }),
  };
};

// Profile completeness — same field set the portal's stage UI counts, mirrored
// here so every tool can read one canonical number (used for <50% nudges and
// the dashboard meter). Keep these lists in sync with portal.html STAGE_*_FIELDS.
function computeCompletionPct(profile) {
  if (!profile) return 0;
  const TOP = [
    'business_name','contact_name','phone','trade','city',
    'service_areas','about_copy','certifications',
    'slogan','brand_tone','brand_colors','target_customer',
    'target_keywords','service_radius_mi',
    'employee_count','ops_notes',
  ];
  const EXTRA = [
    'year_founded','street','state','zip','owner_title','website',
    'license','insurance','hours','emergency','services',
    'fb','ig','gbiz','img_style',
    'best_service','competitors','review_count','review_rating','gbiz_url',
    'avg_ticket','acct_software','payroll','bid_close','subs',
  ];
  function filled(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'number') return true;
    if (typeof v === 'object') {
      // brand_colors default sentinel — treat as unfilled
      const d = { primary:'#1B3557', secondary:'#FFFFFF', accent:'#C9922A' };
      return v.primary !== d.primary || v.secondary !== d.secondary || v.accent !== d.accent;
    }
    return false;
  }
  let total = TOP.length + EXTRA.length, hits = 0;
  for (const k of TOP) if (filled(profile[k])) hits++;
  const ex = (profile.extra && typeof profile.extra === 'object') ? profile.extra : {};
  for (const k of EXTRA) if (filled(ex[k])) hits++;
  return total ? Math.round(100 * hits / total) : 0;
}
