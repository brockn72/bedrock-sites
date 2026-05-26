// get-qbo-meta.js
// Returns the contractor's cached QBO setup metadata — the reusable Bedrock
// Item IDs and the expense-account list — so Donna's UI can populate dropdowns
// (e.g. the receipt category) without hitting QBO on every page load.
//
// OPS6: the receipt category dropdown reads expense_accounts from here.
//
// ── Request ────────────────────────────────────────────────────────────────
//   GET (Authorization: Bearer <supabase access token>)
// ── Returns ────────────────────────────────────────────────────────────────
//   { connected, bedrock_item_ids, expense_accounts }

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  const ok = (body) => ({
    statusCode: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=60' },
    body: JSON.stringify(body),
  });

  try {
    const r = await fetch(
      `${supabaseUrl}/rest/v1/donna_qbo_tokens?user_id=eq.${userId}&select=bedrock_item_ids,expense_accounts&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (!r.ok) return ok({ connected: false, bedrock_item_ids: {}, expense_accounts: [] });
    const rows = await r.json();
    if (!rows.length) return ok({ connected: false, bedrock_item_ids: {}, expense_accounts: [] });
    const row = rows[0];
    return ok({
      connected:        true,
      bedrock_item_ids: row.bedrock_item_ids || {},
      expense_accounts: row.expense_accounts || [],
    });
  } catch (e) {
    console.warn('[get-qbo-meta] status=', (e && e.code) || 'unknown');
    return ok({ connected: false, bedrock_item_ids: {}, expense_accounts: [] });
  }
};
