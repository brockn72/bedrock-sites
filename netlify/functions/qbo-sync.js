// qbo-sync.js
// Pushes an approved Donna entity (customer, estimate, or invoice) into the
// contractor's QuickBooks Online company. Called AFTER the contractor approves
// a draft in Donna — never before (the approval gate is non-negotiable).
//
// Graceful by design: if the contractor hasn't connected QBO, this returns
// { synced:false, skipped:true } with HTTP 200, so Donna's own Supabase record
// still saves. QuickBooks is an enhancement, not a hard dependency.
//
// ── Request body ───────────────────────────────────────────────────────────
//   { entity: 'customer' | 'estimate' | 'invoice',
//     record: { ... },        // the donna_* row being synced (line_items, total…)
//     customer: { name, email, phone, qbo_customer_id } }  // estimate/invoice
//
// ── Returns ────────────────────────────────────────────────────────────────
//   { synced, skipped?, qbo_id, qbo_customer_id }
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_SANDBOX
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//
// Shares the contractor's one QBO connection (donna_qbo_tokens) with Finance.

const { getQboConnection } = require('./qbo-refresh');

// QBO data API base — sandbox vs production. (OAuth endpoints are shared; only
// the data API host differs.)
function qboApiBase() {
  return process.env.QBO_SANDBOX === 'false'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

// POST a JSON entity to the QBO API and return the created object.
async function qboPost(accessToken, realmId, entity, payload) {
  const url = `${qboApiBase()}/v3/company/${realmId}/${entity}?minorversion=65`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept:         'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('QBO ' + entity + ' write failed (' + res.status + '): ' + (await res.text()));
  return res.json();
}

// Run a QBO query and return the QueryResponse object.
async function qboQuery(accessToken, realmId, query) {
  const url = `${qboApiBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
  if (!res.ok) return {};
  return (await res.json()).QueryResponse || {};
}

// Ensure the customer exists in QBO. Reuses qbo_customer_id when present,
// otherwise creates the customer and returns the new id.
async function ensureQboCustomer(accessToken, realmId, customer) {
  if (customer && customer.qbo_customer_id) return customer.qbo_customer_id;
  const name = (customer && customer.name) ? String(customer.name).trim() : 'Customer';
  const payload = { DisplayName: name };
  if (customer && customer.email) payload.PrimaryEmailAddr = { Address: customer.email };
  if (customer && customer.phone) payload.PrimaryPhone     = { FreeFormNumber: customer.phone };
  const created = await qboPost(accessToken, realmId, 'customer', payload);
  return created.Customer && created.Customer.Id;
}

// Find a Service item to attach to estimate/invoice lines. QBO requires every
// SalesItemLine to reference an Item; sandbox companies ship with defaults.
async function findServiceItemRef(accessToken, realmId) {
  const qr = await qboQuery(accessToken, realmId, "SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1");
  const item = (qr.Item || [])[0];
  return item ? { value: item.Id, name: item.Name } : { value: '1' };
}

// Convert Donna line_items into QBO SalesItemLine objects.
function buildLines(lineItems, itemRef) {
  const items = Array.isArray(lineItems) && lineItems.length ? lineItems : [];
  if (!items.length) return null;
  return items.map((li) => {
    const qty   = Number(li.qty) || 1;
    const price = Number(li.unit_price);
    const amount = Number(li.total) || (isFinite(price) ? price * qty : 0);
    const detail = { ItemRef: itemRef, Qty: qty };
    if (isFinite(price)) detail.UnitPrice = price;
    return {
      DetailType:          'SalesItemLineDetail',
      Amount:              Number(amount.toFixed(2)),
      Description:         String(li.description || 'Line item'),
      SalesItemLineDetail: detail,
    };
  });
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

  const entity = (body.entity || '').toLowerCase();
  if (['customer', 'estimate', 'invoice'].indexOf(entity) === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'entity must be customer, estimate, or invoice' }) };
  }

  // Identify the contractor from their Supabase session.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  // Look up the QBO connection. If there's none, skip silently — Donna's own
  // record still saves; QBO sync is best-effort.
  let conn;
  try {
    conn = await getQboConnection(userId, supabaseUrl, supabaseKey);
  } catch (e) {
    console.error('[qbo-sync] connection error:', e.message);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ synced: false, skipped: true, reason: 'QuickBooks needs reconnecting.' }) };
  }
  if (!conn.connected) {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ synced: false, skipped: true, reason: 'QuickBooks not connected.' }) };
  }

  const { access_token: accessToken, realm_id: realmId } = conn;
  const record   = body.record   || {};
  const customer = body.customer || record.customer || {};

  try {
    if (entity === 'customer') {
      const qboId = await ensureQboCustomer(accessToken, realmId, customer.name ? customer : record);
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synced: true, qbo_id: qboId, qbo_customer_id: qboId }) };
    }

    // estimate / invoice — make sure the customer exists first.
    const qboCustomerId = await ensureQboCustomer(accessToken, realmId, customer);
    if (!qboCustomerId) throw new Error('Could not resolve a QBO customer');

    const itemRef = await findServiceItemRef(accessToken, realmId);
    let lines = buildLines(record.line_items, itemRef);
    if (!lines) {
      // No itemized lines — fall back to a single line for the total.
      const total = Number(record.total) || 0;
      lines = [{
        DetailType:          'SalesItemLineDetail',
        Amount:              Number(total.toFixed(2)),
        Description:         String(record.description || (entity === 'invoice' ? 'Invoice' : 'Estimate')),
        SalesItemLineDetail: { ItemRef: itemRef, Qty: 1, UnitPrice: total },
      }];
    }

    const payload = { CustomerRef: { value: qboCustomerId }, Line: lines };
    if (record.notes) payload.CustomerMemo = { value: String(record.notes) };
    if (entity === 'invoice' && record.due_date) payload.DueDate = record.due_date;

    const created = await qboPost(accessToken, realmId, entity, payload);
    const qboObj  = created.Estimate || created.Invoice || {};
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ synced: true, qbo_id: qboObj.Id || null, qbo_customer_id: qboCustomerId }) };
  } catch (e) {
    console.error('[qbo-sync]', entity, e.message);
    // Don't fail the whole approval — report the sync miss so Donna can tell
    // the contractor their record saved but QuickBooks didn't update.
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ synced: false, skipped: false, error: 'QuickBooks didn’t accept that — saved in Bedrock only.' }) };
  }
};
