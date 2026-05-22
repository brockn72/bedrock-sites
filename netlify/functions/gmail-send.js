// gmail-send.js
// Sends an approved estimate or invoice to the customer. If the contractor has
// connected Google (oauth_connections, provider='google', with the gmail.send
// scope), the email goes out FROM their own Gmail address. Otherwise it falls
// back to Resend, sent from Bedrock's verified address with the contractor's
// email as reply-to.
//
// Called from bedrock-donna-v1.html approve() after an estimate/invoice is
// approved — the approval gate has already been satisfied.
//
// ── Request body ───────────────────────────────────────────────────────────
//   { doc_type:'estimate'|'invoice', to, customer_name?,
//     line_items?, subtotal?, total?, notes? }
//
// ── Returns ────────────────────────────────────────────────────────────────
//   { sent, via:'gmail'|'resend', reason? }
//
// ── Required Netlify env vars ──────────────────────────────────────────────
//   GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET
//   RESEND_API_KEY, RESEND_FROM, SUPABASE_URL, SUPABASE_SERVICE_KEY

const { getGoogleConnection } = require('../lib/google-token');

function money(n) {
  return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function buildHtml(docType, businessName, customerName, lineItems, subtotal, total, notes) {
  const items = Array.isArray(lineItems) ? lineItems : [];
  const rows = items.map((li) =>
    '<tr><td style="padding:7px 0;border-bottom:1px solid #eee">' + esc(li.description || 'Item') +
    '</td><td style="padding:7px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">' + money(li.total) + '</td></tr>'
  ).join('');
  const grand = total != null ? total : subtotal;
  return '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#1B3557;line-height:1.55">'
    + '<h2 style="color:#1B3557;margin:0 0 0.6rem">' + esc(docType === 'invoice' ? 'Invoice' : 'Estimate') + ' from ' + esc(businessName) + '</h2>'
    + (customerName ? '<p>Hi ' + esc(customerName) + ',</p>' : '')
    + '<p>' + (docType === 'invoice' ? "Here's your invoice." : "Here's your estimate.") + ' Just reply to this email with any questions.</p>'
    + (rows
        ? '<table style="width:100%;border-collapse:collapse;margin:1rem 0;font-size:14px">' + rows
          + '<tr><td style="padding:9px 0;font-weight:bold">Total</td><td style="padding:9px 0;font-weight:bold;text-align:right">' + money(grand) + '</td></tr></table>'
        : '<p style="font-weight:bold;font-size:15px">Total: ' + money(grand) + '</p>')
    + (notes ? '<p style="color:#4A5568">' + esc(notes) + '</p>' : '')
    + '<p style="color:#8696aa;font-size:12px;margin-top:1.6rem">Sent via Bedrock Digital</p></div>';
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

  // Identify the contractor.
  const auth  = (event.headers.authorization || event.headers.Authorization || '').trim();
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return { statusCode: 401, body: JSON.stringify({ error: 'Sign in required' }) };
  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: supabaseKey },
  });
  if (!userRes.ok) return { statusCode: 401, body: JSON.stringify({ error: 'Invalid or expired session' }) };
  const user        = await userRes.json();
  const userId      = user.id;
  const contractorEmail = (user.email || '').toLowerCase();

  const ok = (p) => ({ statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });

  const to = (body.to || '').trim();
  if (!to || to.indexOf('@') === -1) return ok({ sent: false, reason: 'no recipient email' });

  const docType = body.doc_type === 'invoice' ? 'invoice' : 'estimate';

  // Business name for the email header.
  let businessName = 'Your Contractor';
  try {
    const pRes = await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${userId}&select=business_name&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    if (pRes.ok) { const rows = await pRes.json(); if (rows.length && rows[0].business_name) businessName = rows[0].business_name; }
  } catch (_) { /* non-fatal */ }

  const subject = (docType === 'invoice' ? 'Invoice' : 'Estimate') + ' from ' + businessName;
  const html    = buildHtml(docType, businessName, body.customer_name, body.line_items, body.subtotal, body.total, body.notes);

  // ── 1. Try Gmail when the contractor connected Google with the send scope ──
  let googleConn = { connected: false };
  try { googleConn = await getGoogleConnection(userId, supabaseUrl, supabaseKey); }
  catch (e) { console.error('[gmail-send] google connection', e.message); }

  if (googleConn.connected && (googleConn.scopes || '').indexOf('gmail.send') !== -1) {
    try {
      const raw = [
        'To: ' + to,
        'Subject: ' + subject,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        '',
        html,
      ].join('\r\n');
      // Gmail API wants base64url with no padding.
      const encoded = Buffer.from(raw).toString('base64')
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const gRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${googleConn.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw: encoded }),
      });
      if (gRes.ok) return ok({ sent: true, via: 'gmail' });
      console.error('[gmail-send] gmail api', gRes.status, await gRes.text());
      // fall through to Resend on a Gmail failure
    } catch (e) { console.error('[gmail-send] gmail', e.message); }
  }

  // ── 2. Resend fallback (from Bedrock's verified address) ──────────────────
  const resendKey  = process.env.RESEND_API_KEY;
  const resendFrom = process.env.RESEND_FROM;
  if (resendKey && resendFrom) {
    try {
      const payload = { from: resendFrom, to: [to], subject: subject, html: html };
      if (contractorEmail) payload.reply_to = contractorEmail;  // replies reach the contractor
      const rRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (rRes.ok) return ok({ sent: true, via: 'resend' });
      console.error('[gmail-send] resend', rRes.status, await rRes.text());
    } catch (e) { console.error('[gmail-send] resend', e.message); }
  }

  return ok({ sent: false, reason: 'email could not be sent' });
};
