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
    trade, city, services, serviceAreas, siteData, source,
    password,       // only present when source === 'claim'
    selectedDomain, // domain picked in Step 2
  } = body;

  // Merge selected domain into site_data so deploy-site can access it
  const mergedSiteData = selectedDomain
    ? { ...(siteData || {}), _selectedDomain: selectedDomain }
    : (siteData || null);

  if (!businessName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'businessName required' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const resendKey   = process.env.RESEND_API_KEY;

  let leadId = null;
  let userId = null;

  // Deduplicate: if a lead with this email already exists and hasn't paid yet,
  // update it instead of creating a duplicate (handles double-click on "Claim My Site").
  if (email && supabaseUrl && supabaseKey) {
    const checkRes = await fetch(
      `${supabaseUrl}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&status=in.(new,claim)&select=id,user_id&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (existing.length) {
        leadId = existing[0].id;
        userId = existing[0].user_id || null;
        // Patch the existing lead with latest data and return early
        await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            business_name: businessName,
            contact_name:  contactName || null,
            phone:         phone       || null,
            trade:         trade       || null,
            city:          city        || null,
            services:      services    || [],
            service_areas: serviceAreas || [],
            site_data:     mergedSiteData,
            source:        source      || 'unknown',
            status:        source === 'claim' ? 'claim' : 'new',
          }),
        });
        return {
          statusCode: 200,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ success: true, leadId }),
        };
      }
    }
  }

  // Create a Supabase Auth account when the customer signs up (new account step
  // between builder Step 2 and Step 3) or claims their site. Either path that
  // supplies an email + password gets a real portal login created.
  if ((source === 'signup' || source === 'claim') && email && password && supabaseUrl && supabaseKey) {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,  // skip email confirmation — they already provided it in the builder
        user_metadata: { business_name: businessName, contact_name: contactName || '' },
      }),
    });

    if (authRes.ok) {
      const authData = await authRes.json();
      userId = authData.id || null;
    } else {
      const authErr = await authRes.text();
      console.error(`[capture-lead] Auth user creation failed: ${authRes.status} — ${authErr}`);
    }
    // If account creation fails (e.g. email already exists), we continue anyway
    // so the claim and payment still go through. Brock can manually link accounts if needed.

    // Seed the shared business profile at signup so every tool reads/writes the same row.
    // Upserts on user_id — safe if a profile already exists from a prior visit.
    if (userId) {
      const profilePayload = {
        user_id:        userId,
        email,
        business_name:  businessName,
        contact_name:   contactName || null,
      };
      if (phone)         profilePayload.phone = phone;
      if (trade)         profilePayload.trade = trade;
      if (city)          profilePayload.city  = city;
      if (Array.isArray(serviceAreas) && serviceAreas.length) profilePayload.service_areas = serviceAreas;
      const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=user_id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(profilePayload),
      });
      if (!profRes.ok) {
        console.error(`[capture-lead] Profile upsert failed: ${profRes.status} — ${await profRes.text()}`);
      }
    }
  }

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
        site_data:     mergedSiteData || null,
        source:        source      || 'unknown',
        status:        source === 'claim' ? 'claim' : 'new',
        user_id:       userId      || null,
      }),
    });

    if (res.ok) {
      const rows = await res.json();
      leadId = rows[0]?.id || null;
    } else {
      const leadErr = await res.text();
      console.error(`[capture-lead] Lead insert failed: ${res.status} — ${leadErr}`);
    }
  }

  // Email Brock only when the customer clicks "Claim My Site" (not on every preview)
  if (source === 'claim' && resendKey) {
    const fromEmail = process.env.RESEND_FROM || 'hello@bedrock-sites.com';
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
          <tr><td style="padding:6px 12px 6px 0;color:#666">Portal account</td><td style="padding:6px 0">${userId ? '✓ Created' : '✗ Not created (check email/password)'}</td></tr>
        </table>
        <p style="margin-top:20px;color:#888;font-size:12px">
          Lead ID: ${leadId || 'not saved'}<br>
          View all leads in your <a href="${supabaseUrl ? supabaseUrl.replace('https://','https://app.supabase.com/project/').split('.supabase.co')[0] : '#'}">Supabase dashboard</a>.
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
