// qbo-sync.js
// Pushes an approved Donna entity (customer, estimate, invoice, or receipt)
// into the contractor's QuickBooks Online company. Called AFTER the contractor
// approves a draft in Donna — never before (the approval gate is non-negotiable).
//
// Graceful by design: if the contractor hasn't connected QBO, this returns
// { synced:false, skipped:true } with HTTP 200, so Donna's own Supabase record
// still saves. QuickBooks is an enhancement, not a hard dependency.
//
// OPS1 2026-05-25: receipts now sync as QBO `purchase` records (expense), using
// the contractor's default bank/CC asset account and default expense account.
//
// ── Request body ───────────────────────────────────────────────────────────
//   { entity: 'customer' | 'estimate' | 'invoice' | 'receipt',
//     record: { ... },        // the donna_* row being synced (line_items/total/vendor/amount/date)
//     customer: { name, email, phone, qbo_customer_id } }  // estimate/invoice only
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

// OPS1: receipts need a bank/CC asset account (the "paid from" account on a
// QBO Purchase) and an expense category account. We pick sensible defaults
// from the sandbox if the contractor hasn't customized; either choice is
// always editable later inside QuickBooks.
async function findPaymentAccountRef(accessToken, realmId) {
  // Prefer Checking, then any Bank/Cash, then any CreditCard.
  let qr = await qboQuery(accessToken, realmId,
    "SELECT * FROM Account WHERE AccountType IN ('Bank','Other Current Asset') ORDER BY Name MAXRESULTS 5");
  let acc = (qr.Account || [])[0];
  if (!acc) {
    qr = await qboQuery(accessToken, realmId, "SELECT * FROM Account WHERE AccountType = 'Credit Card' MAXRESULTS 1");
    acc = (qr.Account || [])[0];
  }
  return acc ? { value: acc.Id, name: acc.Name } : null;
}
async function findExpenseAccountRef(accessToken, realmId) {
  // Prefer "Job Expenses" / "Materials" / "Supplies"; otherwise any Expense account.
  const qr = await qboQuery(accessToken, realmId,
    "SELECT * FROM Account WHERE AccountType = 'Expense' MAXRESULTS 20");
  const accs = qr.Account || [];
  const prefer = accs.find((a) => /materials|supplies|job|cost of/i.test(a.Name || ''));
  const acc = prefer || accs[0];
  return acc ? { value: acc.Id, name: acc.Name } : null;
}

// Map a free-text line description to one of our six reusable Bedrock Items.
// Keeps the contractor's QBO Items list clean (Labor / Materials / Equipment /
// Travel / Cleanup / Service Call) instead of growing one Item per job.
function pickBedrockItem(description, bedrockItemIds) {
  const d = String(description || '').toLowerCase();
  if (!bedrockItemIds) return null;
  if (/labor|hour|hrs?\b|man[- ]hour/.test(d)        && bedrockItemIds['Labor'])        return { value: bedrockItemIds['Labor'],        name: 'Labor' };
  if (/material|supplies|lumber|paint|paver|stone/.test(d) && bedrockItemIds['Materials']) return { value: bedrockItemIds['Materials'],    name: 'Materials' };
  if (/equipment|rental|skid|bobcat|excavator|trencher/.test(d) && bedrockItemIds['Equipment']) return { value: bedrockItemIds['Equipment'], name: 'Equipment' };
  if (/travel|mileage|trip charge/.test(d)            && bedrockItemIds['Travel'])       return { value: bedrockItemIds['Travel'],       name: 'Travel' };
  if (/clean[- ]?up|haul[- ]?away|dump fee/.test(d)   && bedrockItemIds['Cleanup'])      return { value: bedrockItemIds['Cleanup'],      name: 'Cleanup' };
  // Anything else falls back to Service Call.
  if (bedrockItemIds['Service Call']) return { value: bedrockItemIds['Service Call'], name: 'Service Call' };
  return null;
}

// Convert Donna line_items into QBO SalesItemLine objects. Each line picks its
// own reusable Item from the cached Bedrock set; falls back to defaultRef if
// none match (e.g. before post-connect setup ran).
function buildLines(lineItems, defaultRef, bedrockItemIds) {
  const items = Array.isArray(lineItems) && lineItems.length ? lineItems : [];
  if (!items.length) return null;
  return items.map((li) => {
    const qty   = Number(li.qty) || 1;
    const price = Number(li.unit_price);
    const amount = Number(li.total) || (isFinite(price) ? price * qty : 0);
    const ref    = pickBedrockItem(li.description, bedrockItemIds) || defaultRef;
    const detail = { ItemRef: ref, Qty: qty };
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
  if (['customer', 'estimate', 'invoice', 'receipt'].indexOf(entity) === -1) {
    return { statusCode: 400, body: JSON.stringify({ error: 'entity must be customer, estimate, invoice, or receipt' }) };
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

    // OPS1: receipt → QBO Purchase. Approval-gated upstream (Donna's UI).
    if (entity === 'receipt') {
      const amount = Number(record.total != null ? record.total : record.amount) || 0;
      if (!(amount > 0)) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ synced: false, skipped: true, reason: 'No amount on receipt — saved in Bedrock only.' }) };
      }
      const payAcct = await findPaymentAccountRef(accessToken, realmId);
      // OPS6: prefer the contractor's chosen expense account (record.account_id)
      // over the heuristic findExpenseAccountRef.
      let expAcct = null;
      if (record.account_id) expAcct = { value: String(record.account_id) };
      if (!expAcct) expAcct = await findExpenseAccountRef(accessToken, realmId);
      if (!payAcct || !expAcct) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ synced: false, skipped: true,
            reason: 'QuickBooks needs a bank account and expense category before we can sync receipts.' }) };
      }
      const vendor = record.vendor ? String(record.vendor).trim() : '';
      const payload = {
        AccountRef: { value: payAcct.value },
        PaymentType: 'Cash',          // Donna's receipt scan doesn't track payment method yet; default Cash, editable in QBO
        TotalAmt:   Number(amount.toFixed(2)),
        Line: [{
          DetailType: 'AccountBasedExpenseLineDetail',
          Amount:      Number(amount.toFixed(2)),
          Description: vendor ? vendor + ' — receipt' : 'Receipt',
          AccountBasedExpenseLineDetail: { AccountRef: { value: expAcct.value } },
        }],
      };
      if (record.date) payload.TxnDate = record.date;
      if (vendor)      payload.PrivateNote = vendor;

      const created = await qboPost(accessToken, realmId, 'purchase', payload);
      const qboObj = created.Purchase || {};
      return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ synced: true, qbo_id: qboObj.Id || null }) };
    }

    // estimate / invoice — make sure the customer exists first.
    const qboCustomerId = await ensureQboCustomer(accessToken, realmId, customer);
    if (!qboCustomerId) throw new Error('Could not resolve a QBO customer');

    // Prefer the cached six-Item set (Labor / Materials / Equipment / Travel /
    // Cleanup / Service Call) seeded on connect. Fall back to whatever Service
    // Item QBO already has if the cache is empty (e.g. token row pre-dates the
    // OPS-Items migration).
    const bedrockItemIds = conn.bedrock_item_ids || null;
    const itemRef = await findServiceItemRef(accessToken, realmId);
    let lines = buildLines(record.line_items, itemRef, bedrockItemIds);
    if (!lines) {
      // No itemized lines — fall back to a single line for the total.
      const total = Number(record.total) || 0;
      const fallbackRef = (bedrockItemIds && bedrockItemIds['Service Call'])
        ? { value: bedrockItemIds['Service Call'] }
        : itemRef;
      lines = [{
        DetailType:          'SalesItemLineDetail',
        Amount:              Number(total.toFixed(2)),
        Description:         String(record.description || (entity === 'invoice' ? 'Invoice' : 'Estimate')),
        SalesItemLineDetail: { ItemRef: fallbackRef, Qty: 1, UnitPrice: total },
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
    // Short message only — QBO bodies echo realm + access-token hints.
    console.error('[qbo-sync]', entity, 'code=', (e && e.code) || 'unknown', 'msg=', (e && e.message || '').slice(0, 120));
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ synced: false, skipped: false, error: 'QuickBooks didn’t accept that — saved in Bedrock only.' }) };
  }
};
