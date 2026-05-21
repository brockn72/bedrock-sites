// Pulls rating + review count from Google Places API given a Maps URL or Place ID.
// Stores the result on the user's profile (extra.gbiz_*) for future reference.
// Requires env var: GOOGLE_PLACES_API_KEY (Google Cloud → Maps Platform → Places API)
const PLACES_API = 'https://maps.googleapis.com/maps/api/place/details/json';
const FINDPLACE_API = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';

// Extract a Place ID from a Google Maps URL. Several URL formats exist:
//   https://maps.google.com/?cid=12345  → use cid lookup
//   https://goo.gl/maps/...              → would require expanding the redirect
//   https://www.google.com/maps/place/Smith+Plumbing/@.../data=!3m1!4b1!4m6!3m5!1s0x88...!8m2!...
//   https://www.google.com/maps/place/?q=place_id:ChIJ...
// For URLs that don't already contain a place_id, we fall back to FindPlaceFromText
// with the URL text as the query.
function extractPlaceId(input) {
  if (!input) return null;
  const placeIdMatch = input.match(/place_id[:=]([A-Za-z0-9_-]+)/);
  if (placeIdMatch) return { type: 'id', value: placeIdMatch[1] };
  // Direct Place ID input (ChIJ... or similar — starts with capital letter)
  if (/^[A-Z][A-Za-z0-9_-]{10,}$/.test(input.trim())) {
    return { type: 'id', value: input.trim() };
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Google Places sync not configured yet — type the rating manually.' }),
    };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }
  const userUrl = (body.url || '').trim();
  if (!userUrl) return { statusCode: 400, body: JSON.stringify({ error: 'url required' }) };

  // Auth (so we know who to update on success)
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  let userId = null;
  const auth = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token && supabaseUrl && supabaseKey) {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
    });
    if (userRes.ok) {
      const u = await userRes.json();
      userId = u.id || null;
    }
  }

  // Find the Place ID
  let placeId = null;
  const extracted = extractPlaceId(userUrl);
  if (extracted) {
    placeId = extracted.value;
  } else {
    // Fall back to Find Place From Text (works for raw business names + URLs)
    const fpUrl = `${FINDPLACE_API}?input=${encodeURIComponent(userUrl)}&inputtype=textquery&fields=place_id,name&key=${apiKey}`;
    const fpRes = await fetch(fpUrl);
    if (!fpRes.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Google API unreachable' }) };
    const fp = await fpRes.json();
    if (fp.status !== 'OK' || !fp.candidates || !fp.candidates.length) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not find that business on Google. Try pasting the Place ID directly (Google search "find Place ID").' }) };
    }
    placeId = fp.candidates[0].place_id;
  }

  // Place Details — fetch the rating + review count
  const dUrl = `${PLACES_API}?place_id=${encodeURIComponent(placeId)}&fields=name,rating,user_ratings_total,formatted_address,url&key=${apiKey}`;
  const dRes = await fetch(dUrl);
  if (!dRes.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Google API unreachable' }) };
  const d = await dRes.json();
  if (d.status !== 'OK') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Google returned status ' + d.status + ' for that place.' }) };
  }
  const r = d.result || {};
  const result = {
    success: true,
    place_id: placeId,
    name: r.name || null,
    rating: r.rating != null ? r.rating : null,
    review_count: r.user_ratings_total != null ? r.user_ratings_total : null,
    address: r.formatted_address || null,
    maps_url: r.url || null,
  };

  // Persist to profile.extra if authenticated
  if (userId) {
    // Fetch existing extra so we don't clobber other fields
    const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=extra,email&limit=1`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    let existingExtra = {};
    let userEmail = '';
    if (profRes.ok) {
      const rows = await profRes.json();
      if (rows.length) {
        existingExtra = rows[0].extra || {};
        userEmail = rows[0].email || '';
      }
    }
    const newExtra = {
      ...existingExtra,
      gbiz_place_id:    result.place_id,
      gbiz_name:        result.name,
      gbiz_address:     result.address,
      gbiz_maps_url:    result.maps_url,
      review_rating:    result.rating,
      review_count:     result.review_count,
      gbiz_synced_at:   new Date().toISOString(),
    };
    await fetch(`${supabaseUrl}/rest/v1/profiles?on_conflict=user_id`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify({
        user_id: userId,
        email: userEmail || null,
        extra: newExtra,
        updated_at: new Date().toISOString(),
      }),
    });
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result),
  };
};
