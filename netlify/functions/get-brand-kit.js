// Looks up a brand_kits row by email (MVP — no auth required).
exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const email = (event.queryStringParameters && event.queryStringParameters.email || '').trim().toLowerCase();
  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email required' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  const res = await fetch(
    `${supabaseUrl}/rest/v1/brand_kits?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );

  if (!res.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Lookup failed' }) };
  }

  const rows = await res.json();
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand_kit: rows[0] || null }),
  };
};
