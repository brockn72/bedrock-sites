// Saves or updates the contractor's profile (progressive enrichment per
// BEDROCK-ECOSYSTEM-VISION). Auth required — operates on auth.uid().
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
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  // Verify the token → user
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  }
  const user = await userRes.json();
  const userId = user.id;
  const email  = (user.email || '').toLowerCase();

  // Allow-list the fields a client can update; ignore anything else
  const ALLOWED = [
    'business_name', 'contact_name', 'phone', 'trade', 'city',
    'service_areas', 'years_in_business', 'about_copy', 'certifications',
    'brand_colors', 'brand_tone', 'slogan', 'target_customer',
    'target_keywords', 'service_radius_mi',
    'employee_count', 'ops_notes', 'extra',
  ];
  const patch = {};
  for (const key of ALLOWED) {
    if (key in body) patch[key] = body[key];
  }

  // Server-side MERGE of `extra` JSONB. Without this, a per-stage save that
  // includes only its own extra fields would wipe the other stages' extras.
  if (patch.extra && typeof patch.extra === 'object' && !Array.isArray(patch.extra)) {
    const existingRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=extra&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    let existingExtra = {};
    if (existingRes.ok) {
      const rows = await existingRes.json();
      if (rows.length && rows[0].extra && typeof rows[0].extra === 'object') {
        existingExtra = rows[0].extra;
      }
    }
    // Filter out null/empty values from the incoming patch so blanks don't
    // overwrite previously-saved data unless the client explicitly clears them.
    const incomingExtra = {};
    for (const k of Object.keys(patch.extra)) {
      const v = patch.extra[k];
      if (v !== null && v !== undefined && !(typeof v === 'string' && v === '') && !(Array.isArray(v) && v.length === 0)) {
        incomingExtra[k] = v;
      }
    }
    patch.extra = { ...existingExtra, ...incomingExtra };
  }

  patch.updated_at = new Date().toISOString();
  patch.email = email;
  patch.user_id = userId;

  // Upsert by user_id (unique constraint)
  const res = await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(patch),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[save-profile] ${res.status} — ${errText}`);
    return { statusCode: 500, body: JSON.stringify({ error: 'Save failed' }) };
  }

  const rows = await res.json();
  const profile = rows[0] || null;

  // ── CROSS-PRODUCT SYNC: mirror profile fields into brand_kits ─────────────
  // So when the contractor fills the profile in the portal, the marketing
  // tool already sees their business name, colors, slogan, voice, etc.
  // Only set fields the user actually provided in this patch (no overwriting
  // with blanks unless they explicitly typed nothing where there used to be
  // something).
  const brandPatch = { email: email, user_id: userId, updated_at: new Date().toISOString() };
  if (patch.business_name) brandPatch.business_name   = patch.business_name;
  if (patch.trade)         brandPatch.trade           = patch.trade;
  if (patch.city)          brandPatch.city            = patch.city;
  if (patch.phone)         brandPatch.phone           = patch.phone;
  if (patch.slogan)        brandPatch.tagline         = patch.slogan;
  if (patch.brand_tone)    brandPatch.tone            = patch.brand_tone;
  if (patch.target_customer) brandPatch.target_customer = patch.target_customer;
  if (Array.isArray(patch.service_areas) && patch.service_areas.length) {
    brandPatch.service_area = patch.service_areas.join(', ');
  }
  if (patch.brand_colors && typeof patch.brand_colors === 'object') {
    if (patch.brand_colors.primary)   brandPatch.color_primary   = patch.brand_colors.primary;
    if (patch.brand_colors.secondary) brandPatch.color_secondary = patch.brand_colors.secondary;
    if (patch.brand_colors.accent)    brandPatch.color_accent    = patch.brand_colors.accent;
  }

  // Only call the brand_kits upsert if there's at least one meaningful field
  if (Object.keys(brandPatch).length > 3) {
    const bkRes = await fetch(`${supabaseUrl}/rest/v1/brand_kits?on_conflict=email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(brandPatch),
    });
    if (!bkRes.ok) {
      const t = await bkRes.text();
      console.error(`[save-profile] brand_kits sync ${bkRes.status} — ${t}`);
      // do not fail the profile save just because brand_kits sync failed
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, profile: profile, synced_brand_kit: Object.keys(brandPatch).length > 3 }),
  };
};
