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
    return { statusCode: 503, body: JSON.stringify({ error: 'Service unavailable' }) };
  }

  // Verify JWT and get user identity
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: supabaseKey,
    },
  });

  if (!userRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }

  const user = await userRes.json();
  const userId = user.id;

  // Fetch the lead record for this user
  const leadRes = await fetch(
    `${supabaseUrl}/rest/v1/leads?user_id=eq.${userId}` +
    `&select=id,business_name,contact_name,phone,email,trade,city,services,service_areas,site_data,status,site_url,created_at` +
    `&limit=1`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    }
  );

  if (!leadRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Database error' }) };
  }

  const leads = await leadRes.json();
  if (!leads.length) {
    return { statusCode: 404, body: JSON.stringify({ error: 'No site found for this account' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lead: leads[0] }),
  };
};
