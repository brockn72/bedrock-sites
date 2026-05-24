// donna-crud.js
// Persistence for Donna's customer / project / job / note records. Replaces the
// in-memory STORE in bedrock-donna-v1.html so data survives a page refresh.
//
// All rows are scoped to the signed-in contractor (auth.uid()). The function
// uses the Supabase service key and filters every query by user_id.
//
// ── Request body ───────────────────────────────────────────────────────────
//   { action:'load' }
//       → { customers:[…], projects:[…], jobs:[…], notes:[…] }
//   { action:'save', entity:<entity>, id?, record:{…} }   → { row:{…} }
//   { action:'delete', entity:<entity>, id }              → { success:true }
//
//   entity is one of: customer, project, job, note  (shown in the Donna lists)
//   or:               receipt, estimate, invoice    (write-only — logged on
//                     approval, not loaded into a UI list)
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Tables: donna_customers, donna_projects, donna_jobs, donna_notes,
//         donna_receipts, donna_estimates, donna_invoices.

// entity → { table, columns the client may write }
const ENTITIES = {
  customer: { table: 'donna_customers', cols: ['name', 'email', 'phone', 'address', 'city', 'notes', 'status', 'qbo_customer_id', 'spouse', 'source'] },
  project:  { table: 'donna_projects',  cols: ['name', 'customer_id', 'trade', 'description', 'status', 'notes'] },
  job:      { table: 'donna_jobs',      cols: ['name', 'customer_id', 'project_id', 'amount', 'status', 'job_date', 'notes', 'trade'] },
  note:     { table: 'donna_notes',     cols: ['customer_id', 'project_id', 'job_id', 'text', 'note_date'] },
  // Write-only documents — persisted when the contractor approves a draft in Donna.
  receipt:  { table: 'donna_receipts',  cols: ['project_id', 'vendor', 'amount', 'date', 'category', 'description', 'status', 'qbo_expense_id'] },
  estimate: { table: 'donna_estimates', cols: ['project_id', 'line_items', 'subtotal', 'tax_rate', 'total', 'notes', 'status', 'qbo_estimate_id'] },
  invoice:  { table: 'donna_invoices',  cols: ['project_id', 'estimate_id', 'invoice_number', 'line_items', 'subtotal', 'tax_rate', 'total', 'due_date', 'notes', 'status', 'qbo_invoice_id'] },
};

// The four entities surfaced in Donna's UI lists (loaded by action:'load').
const LOAD_ENTITIES = { customer: 'customers', project: 'projects', job: 'jobs', note: 'notes' };

function sb(url, key, path, opts) {
  return fetch(`${url}/rest/v1/${path}`, Object.assign({
    headers: Object.assign({
      apikey:         key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    }, (opts && opts.headers) || {}),
  }, opts || {}));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // Identify the contractor from their Supabase session.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  const action = body.action || 'load';

  // ── LOAD: the UI-list entities for this contractor in one round-trip ──────
  if (action === 'load') {
    const out = { customers: [], projects: [], jobs: [], notes: [] };
    for (const key of Object.keys(LOAD_ENTITIES)) {
      try {
        const res = await sb(supabaseUrl, supabaseKey,
          `${ENTITIES[key].table}?user_id=eq.${userId}&select=*&order=created_at.asc`);
        if (res.ok) out[LOAD_ENTITIES[key]] = await res.json();
      } catch (e) {
        console.error('[donna-crud] load', key, e.message);
      }
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(out) };
  }

  // ── SAVE / DELETE need a valid entity ─────────────────────────────────────
  const entity = ENTITIES[body.entity];
  if (!entity) {
    return { statusCode: 400, body: JSON.stringify({ error: 'entity must be one of: ' + Object.keys(ENTITIES).join(', ') }) };
  }

  if (action === 'delete') {
    if (!body.id) return { statusCode: 400, body: JSON.stringify({ error: 'id required' }) };
    const res = await sb(supabaseUrl, supabaseKey,
      `${entity.table}?id=eq.${body.id}&user_id=eq.${userId}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!res.ok) {
      console.error('[donna-crud] delete', res.status, await res.text());
      return { statusCode: 500, body: JSON.stringify({ error: 'Delete failed' }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
  }

  if (action === 'save') {
    // Allow-list the writable columns; ignore anything else the client sends.
    const rec = {};
    const incoming = body.record || {};
    for (const c of entity.cols) {
      if (c in incoming) {
        let v = incoming[c];
        if (v === '') v = null;                       // empty string → NULL
        rec[c] = v;
      }
    }
    rec.user_id = userId;

    let res;
    if (body.id) {
      // UPDATE — scoped to this contractor's row.
      res = await sb(supabaseUrl, supabaseKey,
        `${entity.table}?id=eq.${body.id}&user_id=eq.${userId}`,
        { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rec) });
    } else {
      // INSERT
      res = await sb(supabaseUrl, supabaseKey, entity.table,
        { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(rec) });
    }
    if (!res.ok) {
      console.error('[donna-crud] save', body.entity, res.status, await res.text());
      return { statusCode: 500, body: JSON.stringify({ error: 'Save failed' }) };
    }
    const rows = await res.json();
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ row: rows[0] || null }) };
  }

  return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };
};
