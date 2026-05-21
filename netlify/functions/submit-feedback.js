// Emails client reviews and feedback to Brock via Resend.
// kind: 'review' (testimonial + star rating) | 'feedback' (bug/idea/etc.)
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const kind     = body.kind === 'review' ? 'review' : 'feedback';
  const message  = (body.message || '').trim();
  const stars    = body.stars || '';
  const fbType   = body.feedback_type || '';
  const email    = (body.email || '').trim();
  const business = (body.business || '').trim();
  const name     = (body.name || '').trim();

  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'message required' }) };
  }

  const resendKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.RESEND_FROM   || 'hello@bedrock-sites.com';
  const toEmail   = process.env.NOTIFY_EMAIL  || 'brockniederer@gmail.com';

  if (!resendKey) {
    // No email configured — accept the submission so the UI doesn't error,
    // but log it for visibility.
    console.log(`[submit-feedback] (no Resend key) ${kind} from ${email}: ${message}`);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: true, emailed: false }),
    };
  }

  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let subject, heading, metaRows;
  if (kind === 'review') {
    subject = `New client review (${stars}★) — ${business || email || 'Bedrock client'}`;
    heading = `New client review — ${stars} stars`;
    metaRows = `
      <tr><td style="padding:6px 12px 6px 0;color:#666;width:120px">Rating</td><td style="padding:6px 0"><strong>${esc(stars)} / 5</strong></td></tr>`;
  } else {
    subject = `Portal feedback (${fbType || 'general'}) — ${business || email || 'Bedrock client'}`;
    heading = `New portal feedback — ${fbType || 'general'}`;
    metaRows = `
      <tr><td style="padding:6px 12px 6px 0;color:#666;width:120px">Type</td><td style="padding:6px 0"><strong>${esc(fbType || 'general')}</strong></td></tr>`;
  }

  const html = `
    <div style="font-family:sans-serif;max-width:560px">
      <h2 style="color:#0D1B2E">${esc(heading)}</h2>
      <table style="border-collapse:collapse;width:100%">
        ${metaRows}
        <tr><td style="padding:6px 12px 6px 0;color:#666">From</td><td style="padding:6px 0">${esc(name) || '—'}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Business</td><td style="padding:6px 0">${esc(business) || '—'}</td></tr>
        <tr><td style="padding:6px 12px 6px 0;color:#666">Email</td><td style="padding:6px 0"><a href="mailto:${esc(email)}">${esc(email) || '—'}</a></td></tr>
      </table>
      <div style="margin-top:16px;padding:14px 16px;background:#FAF7F2;border-left:3px solid #C9922A;color:#0D1B2E;line-height:1.6;white-space:pre-wrap">${esc(message)}</div>
      <p style="margin-top:20px;color:#888;font-size:12px">Sent from the Bedrock client portal.</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [toEmail],
        reply_to: email || undefined,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`[submit-feedback] Resend ${res.status} — ${t}`);
      return { statusCode: 502, body: JSON.stringify({ error: 'Could not send right now — try again later.' }) };
    }
  } catch (e) {
    console.error('[submit-feedback] network', e);
    return { statusCode: 502, body: JSON.stringify({ error: 'Email service unreachable' }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success: true, emailed: true }),
  };
};
