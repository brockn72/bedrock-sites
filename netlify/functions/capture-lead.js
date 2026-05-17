exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    businessName, contactName, phone, email,
    trade, city, services, serviceAreas, siteData, source
  } = body;

  if (!businessName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'businessName required' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const resendKey   = process.env.RESEND_API_KEY;

  let leadId = null;

  // Save to Supabase
  if (supabaseUrl && supabaseKey) {
    const res = await fetch(`${supabaseUrl}/rest/v1/leads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        business_name: businessName,
        contact_name:  contactName || null,
        phone:         phone       || null,
        email:         email       || null,
        trade:         trade       || null,
        city:          city        || null,
        services:      services    || [],
        service_areas: serviceAreas || [],
        site_data:     siteData    || null,
        source:        source      || 'unknown',
        status:        source === 'claim' ? 'claim' : 'new',
      }),
    });

    if (res.ok) {
      const rows = await res.json();
      leadId = rows[0]?.id || null;
    }
  }

  // Email Brock only when the customer clicks "Claim My Site" (not on every preview)
  if (source === 'claim' && resendKey) {
    const fromEmail = process.env.RESEND_FROM || 'onboarding@resend.dev';
    const toEmail   = process.env.NOTIFY_EMAIL || 'brockniederer@gmail.com';

    const servicesList = (services || []).join(', ') || '—';
    const html = `
      <div style="font-family:sans-serif;max-width:540px">
        <h2 style="color:#111">New claim: ${businessName}</h2>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:6px 12px 6px 0;color:#666;width:120px">Contact</td><td style="padding:6px 0"><strong>${contactName || '—'}</strong></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666">Phone</td><td style="padding:6px 0"><a href="tel:${phone}">${phone || '—'}</a></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td style="padding:6px 0"><a href="mailto:${email}">${email || '—'}</a></td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666">Trade</td><td style="padding:6px 0">${trade || '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666">City</td><td style="padding:6px 0">${city || '—'}</td></tr>
          <tr><td style="padding:6px 12px 6px 0;color:#666">Services</td><td style="padding:6px 0">${servicesList}</td></tr>
        </table>
        <p style="margin-top:20px;color:#888;font-size:12px">
          Lead ID: ${leadId || 'not saved'}<br>
          View all leads in your <a href="${supabaseUrl ? supabaseUrl.replace('/rest/v1','').replace('https://','https://app.supabase.com/project/') : '#'}">Supabase dashboard</a>.
        </p>
      </div>
    `;

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    fromEmail,
        to:      [toEmail],
        subject: `New claim: ${businessName} — ${city || trade || 'unknown'}`,
        html,
      }),
    });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, leadId }),
  };
};
