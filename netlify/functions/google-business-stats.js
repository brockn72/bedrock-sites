// google-business-stats.js
// Pulls the contractor's Google Business Profile performance for the portal
// Dashboard's "Your Google Presence" card: star rating, review count, search
// impressions, website clicks, and direction requests (last 28 days).
//
// Defensive by design — every external call is wrapped. If Google returns no
// data (common: a brand-new profile, or the Performance API still warming up)
// this returns has_data:false so the dashboard shows a placeholder, never an
// error. Star rating / review count fall back to the values the contractor
// already typed into their profile if the API can't supply them.
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Requires the oauth_connections table and a connected Google account.

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

async function gget(url, accessToken) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) { console.error('[google-business-stats]', res.status, url); return null; }
  return res.json();
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

  // Identify the contractor.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  const ok = (payload) => ({
    statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });

  // Look up the Google connection.
  const connRes = await fetch(
    `${supabaseUrl}/rest/v1/oauth_connections?user_id=eq.${userId}&provider=eq.google&select=*&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  const connRows = connRes.ok ? await connRes.json() : [];
  if (!connRows.length) return ok({ connected: false });

  // Profile-supplied rating/review count — used as a fallback below.
  let fbRating = null, fbReviews = null;
  try {
    const pRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=extra&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (pRes.ok) {
      const rows = await pRes.json();
      const ex = rows.length && rows[0].extra ? rows[0].extra : {};
      if (ex.review_rating != null) fbRating  = parseFloat(ex.review_rating) || null;
      if (ex.review_count  != null) fbReviews = parseInt(ex.review_count, 10) || null;
    }
  } catch (_) { /* non-fatal */ }

  let accessToken;
  try {
    accessToken = await ensureGoogleToken(connRows[0], supabaseUrl, supabaseKey);
  } catch (e) {
    console.error('[google-business-stats]', e.message);
    // Connected, but the token can't be refreshed — show a placeholder.
    return ok({ connected: true, has_data: false, rating: fbRating, review_count: fbReviews });
  }

  const result = {
    connected: true, has_data: false,
    rating: fbRating, review_count: fbReviews,
    impressions: null, website_clicks: null, direction_requests: null, call_clicks: null,
    location_name: null,
  };

  try {
    // 1. Account → 2. first location.
    const accts = await gget('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', accessToken);
    const account = accts && accts.accounts && accts.accounts[0];
    if (!account) return ok(result);

    const locs = await gget(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=1`,
      accessToken
    );
    const location = locs && locs.locations && locs.locations[0];
    if (!location) return ok(result);
    result.location_name = location.title || null;

    // 3. Performance metrics — last 28 days.
    const end   = new Date();
    const start = new Date(); start.setDate(start.getDate() - 28);
    const dp = (d, label) =>
      `dailyRange.${label}_date.year=${d.getFullYear()}&dailyRange.${label}_date.month=${d.getMonth() + 1}&dailyRange.${label}_date.day=${d.getDate()}`;
    const metrics = ['BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
                     'WEBSITE_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'CALL_CLICKS'];
    const metricQS = metrics.map((m) => 'dailyMetrics=' + m).join('&');
    const perfUrl = `https://businessprofileperformance.googleapis.com/v1/${location.name}:fetchMultiDailyMetricsTimeSeries?${metricQS}&${dp(start, 'start')}&${dp(end, 'end')}`;
    const perf = await gget(perfUrl, accessToken);

    if (perf && perf.multiDailyMetricTimeSeries) {
      const totals = {};
      perf.multiDailyMetricTimeSeries.forEach((mts) => {
        (mts.dailyMetricTimeSeries || []).forEach((dm) => {
          const vals = (dm.timeSeries && dm.timeSeries.datedValues) || [];
          totals[dm.dailyMetric] = vals.reduce((s, v) => s + (parseInt(v.value, 10) || 0), 0);
        });
      });
      result.impressions = (totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0)
                          + (totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0);
      result.website_clicks      = totals.WEBSITE_CLICKS || 0;
      result.direction_requests = totals.BUSINESS_DIRECTION_REQUESTS || 0;
      result.call_clicks        = totals.CALL_CLICKS || 0;
      result.has_data = true;
    }

    // 4. Rating + review count (legacy v4 API — may not be allowlisted; soft-fail).
    const reviews = await gget(
      `https://mybusiness.googleapis.com/v4/${account.name}/${location.name}/reviews`,
      accessToken
    );
    if (reviews) {
      if (typeof reviews.averageRating === 'number') result.rating = reviews.averageRating;
      if (typeof reviews.totalReviewCount === 'number') result.review_count = reviews.totalReviewCount;
    }
  } catch (e) {
    console.error('[google-business-stats] fetch error:', e.message);
    // keep whatever we gathered; has_data flags what's real
  }

  return ok(result);
};
