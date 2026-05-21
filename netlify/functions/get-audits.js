// Returns the authenticated user's SEO/GEO Optimizer run history, newest first.
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  const user = await userRes.json();
  const userId = user.id;

  const limit = parseInt((event.queryStringParameters && event.queryStringParameters.limit) || '20', 10);

  const res = await fetch(
    `${supabaseUrl}/rest/v1/site_audits?user_id=eq.${userId}&order=created_at.desc&limit=${limit}` +
    `&select=id,created_at,site_url,score,label,categories,top_issues`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!res.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load audit history' }) };
  }
  const audits = await res.json();

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audits }),
  };
};
