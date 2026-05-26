// donna-conversation.js
// Wires Donna's chat to the Anthropic API. One stateless call per turn —
// conversation history is passed in by the client, not held server-side.
//
// Donna is a CONSTRAINED workflow assistant, not an open-ended chatbot. The
// system prompt is built from the contractor's profile + donna_preferences so
// her drafts use their real labor rate, markup, and fees. She DRAFTS only —
// the approval gate (contractor reviews before anything sends) is enforced by
// the UI; this function never executes an external action.
//
// ── Request body ───────────────────────────────────────────────────────────
//   { message: "contractor's latest message",
//     history: [{ role:'user'|'assistant', content:'…' }, …] }   // optional
//
// ── Returns ────────────────────────────────────────────────────────────────
//   { reply: "Donna's text", workflow: { type, customer, line_items, … } | null }
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY

const MODEL      = 'claude-sonnet-4-6';   // matches the model used elsewhere in this repo
const MAX_TOKENS = 900;
const MAX_TURNS  = 12;                    // cap history sent to the API (cost control)

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  const apiKey      = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!apiKey) {
    return { statusCode: 503, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Donna’s chat isn’t configured yet — set ANTHROPIC_API_KEY in Netlify.' }) };
  }
  if (!supabaseUrl || !supabaseKey) {
    return { statusCode: 503, body: JSON.stringify({ error: 'Service not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const message = (body.message || '').trim();
  if (!message) return { statusCode: 400, body: JSON.stringify({ error: 'message is required' }) };

  // Identify the contractor from their Supabase session token.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const userId = (await userRes.json()).id;

  // Pull the contractor's profile + Donna preferences for the system prompt.
  let profile = {}, prefs = {};
  try {
    const pRes = await fetch(
      `${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=*&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (pRes.ok) { const rows = await pRes.json(); if (rows.length) profile = rows[0]; }
  } catch (_) { /* non-fatal */ }
  try {
    const prRes = await fetch(
      `${supabaseUrl}/rest/v1/donna_preferences?user_id=eq.${userId}&select=*&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (prRes.ok) { const rows = await prRes.json(); if (rows.length) prefs = rows[0]; }
  } catch (_) { /* table may not exist — non-fatal */ }

  // Preferences fall back to profile.extra (Donna onboarding writes there today).
  const ex = profile.extra || {};
  const laborRate   = prefs.labor_rate            != null ? prefs.labor_rate            : ex.labor_rate;
  const markupPct   = prefs.material_markup_pct   != null ? prefs.material_markup_pct   : ex.material_markup_pct;
  const travelFee   = prefs.travel_fee            != null ? prefs.travel_fee            : ex.travel_fee;
  const cleanupFee  = prefs.cleanup_fee           != null ? prefs.cleanup_fee           : ex.cleanup_fee;
  const payTerms    = prefs.default_payment_terms || ex.default_payment_terms || 'Net 30';

  const systemPrompt =
`You are Donna, the operational assistant inside Bedrock Operations — a tool for trade contractors (plumbers, electricians, landscapers, etc.).

YOUR JOB: handle the paperwork. You ONLY help with these workflows:
- Creating customers
- Drafting estimates / bids
- Drafting invoices
- Logging receipts / expenses
- Scheduling jobs
- Storing customer notes

You are NOT a general chatbot. If asked something outside those workflows (general knowledge, advice, chit-chat), briefly decline and steer back to what you can do.

DONNA NEVER DOES THESE — DECLINE PLAINLY AND REDIRECT:
- Payroll, paycheck calculations, W-2 / 1099 paperwork, employee taxes
- Tax filing, tax advice, tax estimates, sales-tax filing
- Bank-account access, bank reconciliations, reading bank feeds, transferring money
- Editing raw QuickBooks JournalEntry items or chart-of-accounts mappings
- Depreciation schedules, asset depreciation, year-end adjusting entries
- Anything an accountant, bookkeeper, lawyer, or financial advisor should own
- Legal advice, contracts, lien filings, license / permit advice

WHEN DECLINING, BE BRIEF AND HELPFUL. Say something like: "That's for your accountant — your Finance dashboard shows the expense though." or "That's beyond my role — your bookkeeper handles that. I can [related thing I CAN do]." Never pretend to do it, never partially do it, never produce a fake number.

PERSONALITY: approachable, fast, practical, blue-collar friendly. A little sassy is fine. Be brief — contractors are busy. Never gimmicky.

THE APPROVAL GATE — NON-NEGOTIABLE: You only ever DRAFT. You never send, file, or execute anything. Everything you produce waits for the contractor's approval. Never claim you sent or filed something.

THIS CONTRACTOR'S BUSINESS:
- Business: ${profile.business_name || '(not set)'}
- Owner: ${profile.contact_name || '(not set)'}
- Trade: ${profile.trade || '(not set)'}
- City / area: ${profile.city || '(not set)'}
- Labor rate: ${laborRate != null ? '$' + laborRate + '/hr' : '(not set — ask before pricing labor)'}
- Material markup: ${markupPct != null ? markupPct + '%' : '(not set — ask before marking up materials)'}
- Travel fee: ${travelFee != null ? '$' + travelFee : '(none on file)'}
- Cleanup fee: ${cleanupFee != null ? '$' + cleanupFee : '(none on file)'}
- Default payment terms: ${payTerms}

PROACTIVE CLARIFICATION: Before drafting, flag ambiguity. If the contractor's labor rate or markup is missing, ask for it rather than guessing. If a job seems outside their normal area, ask about a travel fee.

HOW TO RESPOND:
1. Write a short, natural reply to the contractor.
2. When — and ONLY when — you have enough detail to produce a draft, append a fenced JSON block on its own at the very end of your message, exactly like:
\`\`\`json
{"type":"estimate","customer":{"name":"Joe Smith","phone":"","email":"","address":""},"line_items":[{"description":"Labor — 14 hrs","qty":14,"unit_price":${laborRate || 65},"total":${(laborRate || 65) * 14}}],"subtotal":0,"total":0,"notes":""}
\`\`\`
   - "type" is one of: estimate, invoice, customer, receipt, schedule.
   - For "customer", only the customer object is required.
   - Compute subtotal and total honestly from the line items.
   - If you still need more information, DO NOT include the JSON block — just ask your question.
3. Never put the JSON block inline in the middle of prose. It goes last, once.

Keep replies under ~120 words unless the contractor asks for detail.`;

  // cleanHistory = the contractor's full prior conversation (used for storage).
  // messages = only the last MAX_TURNS of it + this turn (sent to the API).
  const history = Array.isArray(body.history) ? body.history : [];
  const cleanHistory = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: String(m.content) }));
  const messages = cleanHistory.slice(-MAX_TURNS);
  messages.push({ role: 'user', content: message });

  let aiRes;
  try {
    aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system: systemPrompt, messages }),
    });
  } catch (e) {
    // Short message only — full error may contain network internals / paths.
    console.error('[donna-conversation] network code=', (e && e.code) || 'unknown', 'msg=', (e && e.message) || '');
    return { statusCode: 502, body: JSON.stringify({ error: 'Donna couldn’t be reached. Try again in a moment.' }) };
  }

  if (!aiRes.ok) {
    // Log status only — body can echo system prompt fragments + contractor messages.
    console.error('[donna-conversation] anthropic status=', aiRes.status);
    return { statusCode: 502, body: JSON.stringify({ error: 'Donna hit a snag. Try again in a moment.' }) };
  }

  const data = await aiRes.json();
  let raw = (data && data.content && data.content[0] && data.content[0].text) || '';

  // Extract the optional trailing ```json … ``` workflow block.
  let workflow = null;
  const fence = raw.match(/```json\s*([\s\S]*?)```/i);
  if (fence) {
    try { workflow = JSON.parse(fence[1].trim()); } catch (_) { workflow = null; }
    raw = raw.replace(fence[0], '').trim();
  }
  if (!raw) raw = "Tell me a bit more and I'll get it drafted.";

  // Persist to donna_conversations (best-effort — never blocks the reply).
  // ONE row per chat session: the client passes a stable session_id (a UUID),
  // used as the row's primary key, and each turn upserts the full conversation
  // onto that one row instead of inserting a new row per turn.
  try {
    const fullConversation = cleanHistory.concat([
      { role: 'user',      content: message },
      { role: 'assistant', content: raw },
    ]);
    const row = {
      user_id:        userId,
      messages:       fullConversation,
      workflow_type:  workflow ? workflow.type : null,
      workflow_state: workflow || null,
      status:         'active',
    };
    // A valid UUID session_id → upsert on the id primary key. Without one
    // (older client), fall back to a plain insert so nothing breaks.
    const sessionId = (body.session_id || '').trim();
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
    let url = `${supabaseUrl}/rest/v1/donna_conversations`;
    let prefer = 'return=minimal';
    if (isUuid) {
      row.id = sessionId;
      url = `${supabaseUrl}/rest/v1/donna_conversations?on_conflict=id`;
      prefer = 'resolution=merge-duplicates,return=minimal';
    }
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer:         prefer,
      },
      body: JSON.stringify(row),
    });
  } catch (_) { /* non-fatal */ }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reply: raw, workflow: workflow }),
  };
};
