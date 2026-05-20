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

  if (profiles.length) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: profiles[0] }),
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
    }),
  };
};
