// Lists the authenticated user's saved assets with signed URLs.
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

  const kind = (event.queryStringParameters && event.queryStringParameters.kind) || '';
  const limit = parseInt((event.queryStringParameters && event.queryStringParameters.limit) || '50', 10);

  let url = `${supabaseUrl}/rest/v1/assets?user_id=eq.${userId}&order=created_at.desc&limit=${limit}`;
  if (kind) url += `&kind=eq.${encodeURIComponent(kind)}`;

  const res = await fetch(url, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'List failed' }) };
  }
  const rows = await res.json();

  // Generate signed URLs for each asset (in parallel)
  const signed = await Promise.all(rows.map(async function(r){
    try {
      const signRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/${r.bucket}/${r.path}?expiresIn=3600`, {
        method: 'POST',
        headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      if (signRes.ok) {
        const s = await signRes.json();
        if (s.signedURL || s.signedUrl) return `${supabaseUrl}/storage/v1${s.signedURL || s.signedUrl}`;
      }
    } catch (_) {}
    return null;
  }));

  const out = rows.map(function(r, i){ return Object.assign({}, r, { signed_url: signed[i] }); });

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assets: out }),
  };
};
