// netlify/lib/qbo-setup.js
// One-time post-connect setup for QuickBooks Online:
//   1. Ensure the contractor has the six reusable Bedrock Service Items
//      (Labor · Materials · Equipment · Travel · Cleanup · Service Call) so
//      every estimate/invoice we push references the same items instead of
//      inventing a new one per job (which would clutter the QBO Items list).
//   2. Pull the contractor's expense accounts (Chart of Accounts) and cache
//      them on `donna_qbo_tokens` so the receipt category dropdown in Donna
//      shows the contractor's real categories, not a hardcoded list.
//
// Called from qbo-callback.js after the token row is upserted. Failures here
// never abort the OAuth flow — the contractor still gets connected; we just
// don't have the cache, and estimates/invoices/receipts fall back to the
// runtime lookup paths in qbo-sync.js.
//
// ── One-time migration (run in Supabase SQL editor) ────────────────────────
//   alter table donna_qbo_tokens add column if not exists bedrock_item_ids jsonb;
//   alter table donna_qbo_tokens add column if not exists expense_accounts jsonb;
//   alter table donna_qbo_tokens add column if not exists setup_at         timestamptz;

const BEDROCK_ITEMS = ['Labor', 'Materials', 'Equipment', 'Travel', 'Cleanup', 'Service Call'];

function qboApiBase() {
  return process.env.QBO_SANDBOX === 'false'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com';
}

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
  if (!res.ok) throw new Error('QBO ' + entity + ' write status ' + res.status);
  return res.json();
}

async function qboQuery(accessToken, realmId, query) {
  const url = `${qboApiBase()}/v3/company/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) return {};
  return (await res.json()).QueryResponse || {};
}

// Find a default Income account (required field on Service Items).
async function findIncomeAccountRef(accessToken, realmId) {
  let qr = await qboQuery(accessToken, realmId,
    "SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 5");
  let accs = qr.Account || [];
  // Prefer "Sales of Product Income" / "Services" / first one.
  const prefer = accs.find((a) => /sales|services|fees/i.test(a.Name || ''));
  const acc = prefer || accs[0];
  return acc ? { value: acc.Id, name: acc.Name } : null;
}

// For each of BEDROCK_ITEMS, look it up by name; create if missing. Returns a
// map { Labor: '101', Materials: '102', … }.
async function ensureBedrockItems(accessToken, realmId) {
  const out = {};
  let incomeRef = null;

  for (const name of BEDROCK_ITEMS) {
    // QBO query escaping: a single quote in a string literal is doubled.
    const safe = name.replace(/'/g, "''");
    let existing = null;
    try {
      const qr = await qboQuery(accessToken, realmId,
        `SELECT * FROM Item WHERE Name = '${safe}' MAXRESULTS 1`);
      existing = (qr.Item || [])[0];
    } catch (_) { /* fall through to create */ }
    if (existing && existing.Id) { out[name] = existing.Id; continue; }

    // Need an Income account ref before creating the Service Item.
    if (!incomeRef) {
      incomeRef = await findIncomeAccountRef(accessToken, realmId);
      if (!incomeRef) {
        // Without an Income account, we can't create Items. Bail gracefully —
        // qbo-sync.js will fall back to its runtime findServiceItemRef path.
        return out;
      }
    }
    try {
      const created = await qboPost(accessToken, realmId, 'item', {
        Name:           name,
        Type:           'Service',
        IncomeAccountRef: { value: incomeRef.value },
        Active:         true,
      });
      const item = created.Item;
      if (item && item.Id) out[name] = item.Id;
    } catch (e) {
      // Don't fail the whole setup if one item creation fails — keep going.
      console.warn('[qbo-setup] item create', name, 'status=', (e && e.message) || 'unknown');
    }
  }
  return out;
}

// Pull every Expense account so Donna's receipt category dropdown shows the
// contractor's real chart of accounts. Returns [{ id, name }].
async function listExpenseAccounts(accessToken, realmId) {
  try {
    const qr = await qboQuery(accessToken, realmId,
      "SELECT * FROM Account WHERE AccountType = 'Expense' ORDER BY Name MAXRESULTS 200");
    return (qr.Account || []).map((a) => ({ id: a.Id, name: a.Name }));
  } catch (_) { return []; }
}

// Cache both onto the contractor's donna_qbo_tokens row.
async function cacheSetup(supabaseUrl, supabaseKey, userId, itemIds, expenseAccounts) {
  try {
    await fetch(`${supabaseUrl}/rest/v1/donna_qbo_tokens?user_id=eq.${userId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer:        'return=minimal',
      },
      body: JSON.stringify({
        bedrock_item_ids: itemIds || {},
        expense_accounts: expenseAccounts || [],
        setup_at:         new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.warn('[qbo-setup] cache write status=', (e && e.message) || 'unknown');
  }
}

// Public entry point. Best-effort: never throws.
async function runPostConnectSetup({ accessToken, realmId, userId, supabaseUrl, supabaseKey }) {
  try {
    const [itemIds, expenseAccounts] = await Promise.all([
      ensureBedrockItems(accessToken, realmId),
      listExpenseAccounts(accessToken, realmId),
    ]);
    await cacheSetup(supabaseUrl, supabaseKey, userId, itemIds, expenseAccounts);
    return { ok: true, item_ids: itemIds, expense_account_count: expenseAccounts.length };
  } catch (e) {
    console.warn('[qbo-setup] failed:', (e && e.message) || 'unknown');
    return { ok: false };
  }
}

module.exports = { runPostConnectSetup, BEDROCK_ITEMS };
