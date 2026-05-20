// Saves or updates a brand_kits row. MVP: keyed by email (no auth required).
// When a Bearer token is present we also associate the row with the user_id
// AND patch the user's profiles row so Marketing/Identity fields stay in sync.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    email, business_name, tagline, trade, city, phone, website,
    logo_url, color_primary, color_secondary, color_accent,
    font_style, tone, target_customer, service_area, raw_data,
  } = body;

  if (!email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'email required' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  // Optional auth: if a session token is sent we'll attach user_id and sync profile
  let userId = null;
  const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
    });
    if (userRes.ok) {
      const u = await userRes.json();
      userId = u.id || null;
    }
  }

  const lowerEmail = email.toLowerCase();
  const payload = {
    email: lowerEmail,
    business_name: business_name || null,
    tagline: tagline || null,
    trade: trade || null,
    city: city || null,
    phone: phone || null,
    website: website || null,
    logo_url: logo_url || null,
    color_primary: color_primary || null,
    color_secondary: color_secondary || null,
    color_accent: color_accent || null,
    font_style: font_style || null,
    tone: tone || null,
    target_customer: target_customer || null,
    service_area: service_area || null,
    raw_data: raw_data || null,
    updated_at: new Date().toISOString(),
    ...(userId ? { user_id: userId } : {}),
  };

  // Upsert brand_kits by email
  const res = await fetch(`${supabaseUrl}/rest/v1/brand_kits?on_conflict=email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[save-brand-kit] ${res.status} — ${errText}`);
    return { statusCode: 500, body: JSON.stringify({ error: 'Save failed' }) };
  }

  const rows = await res.json();
  const brandKit = rows[0] || null;

  // If authenticated, ALSO patch the profiles row so brand info shows up in My Profile.
  // We treat brand_kit fields as authoritative for the Marketing stage fields and
  // for the Identity fields that overlap. Existing profile values for non-conflicting
  // fields (about_copy, certifications, target_keywords, employee_count, etc.) are left alone.
  if (userId) {
    const profilePatch = {
      user_id: userId,
      email: lowerEmail,
      updated_at: new Date().toISOString(),
    };
    if (business_name) profilePatch.business_name   = business_name;
    if (trade)         profilePatch.trade           = trade;
    if (city)          profilePatch.city            = city;
    if (phone)         profilePatch.phone           = phone;
    if (tagline)       profilePatch.slogan          = tagline;
    if (tone)          profilePatch.brand_tone      = tone;
    if (target_customer) profilePatch.target_customer = target_customer;
    if (color_primary || color_secondary || color_accent) {
      profilePatch.brand_colors = {
        primary:   color_primary   || null,
        secondary: color_secondary || null,
        accent:    color_accent    || null,
      };
    }

    const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(profilePatch),
    });
    if (!profRes.ok) {
      const t = await profRes.text();
      console.error(`[save-brand-kit] profile sync ${profRes.status} — ${t}`);
      // do not fail the brand kit save just because profile sync failed
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, brand_kit: brandKit, synced_profile: !!userId }),
  };
};
