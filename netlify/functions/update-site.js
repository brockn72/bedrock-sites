exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const resendKey   = process.env.RESEND_API_KEY;

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

  // Build update payload — only include fields that were sent
  const { siteData, businessName, phone, email, city, trade, services, serviceAreas } = body;
  const patch = {};
  if (siteData     !== undefined) patch.site_data     = siteData;
  if (businessName !== undefined) patch.business_name = businessName;
  if (phone        !== undefined) patch.phone         = phone;
  if (email        !== undefined) patch.email         = email;
  if (city         !== undefined) patch.city          = city;
  if (trade        !== undefined) patch.trade         = trade;
  if (services     !== undefined) patch.services      = services;
  if (serviceAreas !== undefined) patch.service_areas = serviceAreas;

  if (!Object.keys(patch).length) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Nothing to update' }) };
  }

  // Update the lead — user_id filter ensures a client can only update their own record
  const updateRes = await fetch(`${supabaseUrl}/rest/v1/leads?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(patch),
  });

  if (!updateRes.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Update failed' }) };
  }

  const rows = await updateRes.json();
  const lead = rows[0];

  // Notify Brock so he can rebuild and redeploy the site
  if (resendKey && lead) {
    const fromEmail = process.env.RESEND_FROM  || 'onboarding@resend.dev';
    const toEmail   = process.env.NOTIFY_EMAIL || 'brockniederer@gmail.com';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    fromEmail,
        to:      [toEmail],
        subject: `Site update ready to deploy: ${lead.business_name}`,
        html: `
          <div style="font-family:sans-serif;max-width:540px">
            <h2 style="color:#111">${lead.business_name} updated their site</h2>
            <p style="color:#555">Their site data has been saved to Supabase. Rebuild and redeploy when ready.</p>
            <table style="border-collapse:collapse;width:100%;margin-top:12px">
              <tr><td style="padding:6px 12px 6px 0;color:#888;width:120px">Lead ID</td><td>${lead.id}</td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#888">Business</td><td>${lead.business_name}</td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#888">Status</td><td>${lead.status}</td></tr>
              <tr><td style="padding:6px 12px 6px 0;color:#888">Site URL</td><td>${lead.site_url || '—'}</td></tr>
            </table>
          </div>
        `,
      }),
    });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true }),
  };
};
