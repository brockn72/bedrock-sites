// Stores a generated marketing asset (or uploaded image) in Supabase Storage
// scoped to the authenticated user, and records metadata in the `assets` table.
// Bucket must exist: 'assets' (private, with RLS based on auth.uid()).
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
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

  // Verify user
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired token' }) };
  const user = await userRes.json();
  const userId = user.id;

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    image_base64, filename, kind,       // kind: 'marketing_asset' | 'logo' | 'reference' | 'photo'
    template, format, copy, campaign,   // marketing context (optional)
  } = body;
  if (!image_base64 || !filename) {
    return { statusCode: 400, body: JSON.stringify({ error: 'image_base64 and filename required' }) };
  }
  const m = image_base64.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return { statusCode: 400, body: JSON.stringify({ error: 'image_base64 must be a base64 data URL' }) };
  const mediaType = m[1];
  const b64       = m[2];
  const bytes = Buffer.from(b64, 'base64');

  // Storage path is user-scoped
  const safeName = filename.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 80);
  const path = `${userId}/${Date.now()}-${safeName}`;
  const bucket = 'assets';

  // Upload to Supabase Storage
  const upRes = await fetch(`${supabaseUrl}/storage/v1/object/${bucket}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': mediaType,
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'x-upsert': 'true',
    },
    body: bytes,
  });
  if (!upRes.ok) {
    const t = await upRes.text();
    console.error(`[upload-asset] storage upload ${upRes.status} — ${t}`);
    return { statusCode: 500, body: JSON.stringify({ error: 'Upload to storage failed. Make sure the "assets" bucket exists in your Supabase project.' }) };
  }

  // Record metadata row
  const insRes = await fetch(`${supabaseUrl}/rest/v1/assets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      user_id: userId,
      bucket: bucket,
      path: path,
      filename: filename,
      media_type: mediaType,
      bytes: bytes.length,
      kind: kind || 'marketing_asset',
      template: template || null,
      format: format || null,
      campaign: campaign || null,
      copy: copy || null,
    }),
  });
  if (!insRes.ok) {
    const t = await insRes.text();
    console.error(`[upload-asset] metadata insert ${insRes.status} — ${t}`);
    // Don't fail outright — the file is in storage
  }
  const rows = insRes.ok ? await insRes.json() : [];

  // Generate a short-lived signed URL so the client can preview
  const signRes = await fetch(`${supabaseUrl}/storage/v1/object/sign/${bucket}/${path}?expiresIn=3600`, {
    method: 'POST',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  let signedUrl = null;
  if (signRes.ok) {
    const s = await signRes.json();
    if (s.signedURL || s.signedUrl) signedUrl = `${supabaseUrl}/storage/v1${s.signedURL || s.signedUrl}`;
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      success: true,
      asset: rows[0] || null,
      signed_url: signedUrl,
    }),
  };
};
