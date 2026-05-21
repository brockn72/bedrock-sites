// Looks up a brand_kits row by email. If none exists AND a Bearer token is
// present, falls back to building a brand kit from the user's profiles row
// (for the cross-product sync case: portal user fills profile first, then
// opens marketing tool — should see their profile data already populated).
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

  // Direct lookup by email
  const res = await fetch(
    `${supabaseUrl}/rest/v1/brand_kits?email=eq.${encodeURIComponent(email)}&select=*&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );

  if (!res.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Lookup failed' }) };
  }

  const rows = await res.json();
  if (rows.length) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brand_kit: rows[0], source: 'brand_kits' }),
    };
  }

  // Fallback: derive from profile when authenticated
  const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
    });
    if (userRes.ok) {
      const user = await userRes.json();
      const userId = user.id;
      const profRes = await fetch(
        `${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=*&limit=1`,
        { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
      );
      if (profRes.ok) {
        const profs = await profRes.json();
        if (profs.length) {
          const p = profs[0];
          // Synthesize a brand_kit-shaped object from profile fields
          const derived = {
            id: null,
            email: email,
            business_name:   p.business_name || null,
            tagline:         p.slogan || null,
            trade:           p.trade || null,
            city:            p.city || null,
            phone:           p.phone || null,
            website:         null,
            logo_url:        null,
            color_primary:   (p.brand_colors && p.brand_colors.primary)   || null,
            color_secondary: (p.brand_colors && p.brand_colors.secondary) || null,
            color_accent:    (p.brand_colors && p.brand_colors.accent)    || null,
            font_style:      null,
            tone:            p.brand_tone || null,
            target_customer: p.target_customer || null,
            service_area:    Array.isArray(p.service_areas) && p.service_areas.length ? p.service_areas.join(', ') : null,
            raw_data:        null,
            _derived:        true,
          };
          return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ brand_kit: derived, source: 'profile_fallback' }),
          };
        }
      }
    }
  }

  // Fallback: derive from leads if there's a lead row with this email (so a
  // contractor who used the builder but never opened Marketing still gets
  // a populated brand kit on first visit).
  const leadRes = await fetch(
    `${supabaseUrl}/rest/v1/leads?email=eq.${encodeURIComponent(email)}&select=business_name,trade,city,phone&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (leadRes.ok) {
    const leads = await leadRes.json();
    if (leads.length) {
      const l = leads[0];
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand_kit: {
            email: email,
            business_name: l.business_name,
            trade: l.trade, city: l.city, phone: l.phone,
            tagline: null, color_primary: null, color_secondary: null, color_accent: null,
            font_style: null, tone: null, target_customer: null, service_area: null,
            logo_url: null, website: null, raw_data: null, _derived: true,
          },
          source: 'lead_fallback',
        }),
      };
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand_kit: null }),
  };
};
