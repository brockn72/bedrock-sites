// Records a SEO/GEO Optimizer run against the authenticated user's own site,
// so the portal can show score-over-time history.
// SEC9: sanitize the categories + top_issues arrays before write.
const { sanitizeJsonb } = require('../lib/sanitize');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
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

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const score = typeof body.score === 'number' ? body.score : null;
  if (score === null) {
    return { statusCode: 400, body: JSON.stringify({ error: 'score required' }) };
  }

  const row = {
    user_id:    userId,
    site_url:   body.site_url || null,
    score:      score,
    label:      body.label || null,
    categories: Array.isArray(body.categories) ? sanitizeJsonb(body.categories) : null,
    top_issues: Array.isArray(body.top_issues) ? sanitizeJsonb(body.top_issues) : null,
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/site_audits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error(`[save-audit] ${res.status} — ${t}`);
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not save audit' }) };
  }

  const rows = await res.json();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, audit: rows[0] || null }),
  };
};
