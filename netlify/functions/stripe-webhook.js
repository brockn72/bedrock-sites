const { createHmac, timingSafeEqual } = require('crypto');
const { deploySite } = require('../lib/deploy-site');
const { sendOnboardingEmail } = require('../lib/onboarding-email');
const { consumeCheckoutState } = require('../lib/checkout-state');

// G9 (Batch G, 2026-05-26): reward amount in cents per referral. Spec calls
// for 2 months free to the referrer. Monthly Website = $20 → 2 months = $40.
// Annual subscribers receive the same dollar value (2 months prorated). For
// today, we apply a flat $40 ($4000) credit; if Brock wants to differentiate
// monthly vs. annual referrers later, this is the single place to change.
const REFERRAL_REWARD_CENTS = 4000;
const REFERRAL_REWARD_MONTHS = 2;

function verifyStripeSignature(rawBody, sigHeader, secret) {
  if (!sigHeader) return false;
  const parts  = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const timestamp = parts.t;
  const sig       = parts.v1;
  if (!timestamp || !sig) return false;

  const signed   = `${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signed).digest('hex');

  // Constant-time comparison to prevent timing attacks
  const expBuf = Buffer.from(expected, 'hex');
  const sigBuf = Buffer.from(sig,      'hex');
  if (expBuf.length !== sigBuf.length) return false;
  return timingSafeEqual(expBuf, sigBuf);
}

// Upsert one `subscriptions` row per tool for a contractor. Used by the tool
// subscription flow (Marketing / Finance & Operations) — entirely separate from
// the site-build flow, which keys off metadata.lead_id instead.
async function upsertToolSubs(supabaseUrl, supabaseKey, userId, tools, status, stripeSubId, stripeCustId) {
  if (!supabaseUrl || !supabaseKey || !userId || !tools || !tools.length) return;
  const now = new Date().toISOString();
  const rows = tools.map((t) => ({
    user_id: userId,
    tool:    t === 'cfo' ? 'finance_operations' : t,   // normalize the legacy cart key
    status:  status,
    stripe_subscription_id: stripeSubId || null,
    stripe_customer_id:     stripeCustId || null,
    updated_at: now,
  }));
  try {
    const r = await fetch(`${supabaseUrl}/rest/v1/subscriptions?on_conflict=user_id,tool`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey:         supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer:        'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    });
    // SEC8: status only — body may contain user / customer identifiers.
    if (!r.ok) console.error('[stripe-webhook] subscriptions upsert status=', r.status);
  } catch (e) {
    console.error('[stripe-webhook] subscriptions upsert failed:', e.message);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const supabaseUrl   = process.env.SUPABASE_URL;
  const supabaseKey   = process.env.SUPABASE_SERVICE_KEY;
  const resendKey     = process.env.RESEND_API_KEY;

  if (!webhookSecret) {
    return { statusCode: 500, body: 'STRIPE_WEBHOOK_SECRET not configured' };
  }

  // Netlify may base64-encode the body for binary payloads
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;

  const sigHeader = event.headers['stripe-signature'];
  if (!verifyStripeSignature(rawBody, sigHeader, webhookSecret)) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // SEC3: replay guard — reject Stripe events older than 5 minutes. Stripe's
  // signature alone doesn't expire, so a captured webhook can otherwise be
  // re-fired indefinitely. event.created is a Unix-seconds timestamp.
  if (typeof stripeEvent.created === 'number'
      && Math.abs(Date.now() / 1000 - stripeEvent.created) > 300) {
    console.log('[stripe-webhook] rejected stale event', stripeEvent.id, 'age=' +
      Math.round(Date.now() / 1000 - stripeEvent.created) + 's');
    return { statusCode: 400, body: 'Event too old' };
  }

  // ── Tool subscription lifecycle (Marketing / Finance & Operations) ──────────
  // Fired when a Stripe subscription changes state. Site-build subscriptions
  // carry metadata.lead_id (no tools) so they're skipped here.
  if (stripeEvent.type === 'customer.subscription.updated' ||
      stripeEvent.type === 'customer.subscription.deleted') {
    const sub      = stripeEvent.data.object;
    const userId   = sub.metadata && sub.metadata.user_id;
    const toolsStr = sub.metadata && sub.metadata.tools;
    if (userId && toolsStr) {
      const tools = toolsStr.split(',').map((s) => s.trim()).filter(Boolean);
      // Status mapping:
      //   active / trialing      → 'active'   (tools fully unlocked)
      //   past_due               → 'past_due' (tools still work; portal shows a "update your card" banner)
      //   unpaid / canceled      → 'canceled' (tools locked — every retry failed or the contractor canceled)
      let status = 'active';
      if (stripeEvent.type === 'customer.subscription.deleted'
          || sub.status === 'canceled' || sub.status === 'unpaid') status = 'canceled';
      else if (sub.status === 'past_due') status = 'past_due';
      else if (sub.status === 'active' || sub.status === 'trialing') status = 'active';
      else status = sub.status || 'active';
      await upsertToolSubs(supabaseUrl, supabaseKey, userId, tools, status, sub.id, sub.customer || '');
    }
    return { statusCode: 200, body: JSON.stringify({ received: true }) };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session      = stripeEvent.data.object;

    // SEC5: prefer the server-stored mapping behind metadata.state. Falls back
    // to legacy metadata.user_id / metadata.lead_id only when no state token
    // is present (in-flight checkouts from before this deploy).
    let trustedState = null;
    if (session.metadata && session.metadata.state) {
      const consumed = await consumeCheckoutState(session.metadata.state);
      if (consumed.ok) trustedState = consumed.state;
      else console.warn('[stripe-webhook] state resolve failed:', consumed.error, 'session=', session.id);
    } else {
      console.warn('[stripe-webhook] DEPRECATED: webhook arrived with no metadata.state — using legacy metadata fields');
    }

    // ── Tool subscription checkout (Marketing / Finance & Operations) ─────────
    // Distinguished from a site build by metadata.tools (site builds use
    // metadata.lead_id). Mark the tools active and stop — none of the
    // site-build logic below applies.
    const isToolCheckout = (trustedState && trustedState.kind === 'tools')
                        || (session.metadata && session.metadata.tools);
    if (isToolCheckout) {
      const subUserId = (trustedState && trustedState.user_id)
                     || (session.metadata && session.metadata.user_id) || '';
      const subTools  = (trustedState && Array.isArray(trustedState.tools) && trustedState.tools.length)
                     ? trustedState.tools
                     : (session.metadata.tools || '').split(',').map((s) => s.trim()).filter(Boolean);
      await upsertToolSubs(supabaseUrl, supabaseKey, subUserId, subTools, 'active',
                           session.subscription || '', session.customer || '');

      // G9 (Batch G, 2026-05-26): fire the referrer's reward on first paid
      // tool subscription. Wrapped in try/catch so any failure here does NOT
      // block the customer's subscription from being marked active.
      try {
        const referralCode = (trustedState && trustedState.referral_code)
                          || (session.metadata && session.metadata.referral_code) || '';
        if (referralCode) {
          await fireReferralReward({
            supabaseUrl, supabaseKey, resendKey,
            stripeKey:    process.env.STRIPE_SECRET_KEY,
            referralCode: String(referralCode).toUpperCase(),
            referredUserId:  subUserId,
            referredEmail:   session.customer_details?.email || session.customer_email || '',
            referredCustId:  session.customer || '',
          });
        }
      } catch (e) {
        console.error('[stripe-webhook] referral reward failed:', e.message);
      }
      if (resendKey && process.env.RESEND_DRY_RUN === 'true') {
        console.log('[stripe-webhook][dry-run] tool-subscription notify email skipped');
      } else if (resendKey) {
        const fromEmail = process.env.RESEND_FROM  || 'hello@bedrock-sites.com';
        const toEmail   = process.env.NOTIFY_EMAIL || 'brockniederer@gmail.com';
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: fromEmail, to: [toEmail],
            subject: `New tool subscription: ${subTools.join(', ')}`,
            html: `<div style="font-family:sans-serif"><h2>New tool subscription</h2>
                   <p>Tools: <strong>${subTools.join(', ')}</strong><br>
                   Customer: ${session.customer_details?.email || session.customer_email || '—'}<br>
                   User ID: ${subUserId || '—'}<br>
                   Stripe subscription: ${session.subscription || '—'}</p></div>`,
          }),
        }).catch((e) => console.error('[stripe-webhook] notify email failed:', e.message));
      }
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    // SEC5: trusted state wins over client-supplied metadata for the site-build flow.
    const leadId       = (trustedState && trustedState.lead_id) || session.metadata?.lead_id;
    const businessName = (trustedState && trustedState.business_name)
                       || session.metadata?.business_name || 'Unknown Business';
    const customerEmail = session.customer_details?.email || session.customer_email
                       || (trustedState && trustedState.email) || '';

    // Mark lead as paid in Supabase
    if (supabaseUrl && supabaseKey && leadId) {
      await fetch(`${supabaseUrl}/rest/v1/leads?id=eq.${leadId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey:         supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer:        'return=minimal',
        },
        body: JSON.stringify({
          status:            'paid',
          stripe_session_id: session.id,
        }),
      });
    }

    // The $20/mo subscription and its 30-day trial are now created by the Stripe
    // Checkout session itself (subscription mode — see create-checkout.js). The
    // customer sees and agrees to it on Stripe's page. Re-creating it here would
    // double-bill them, so the webhook no longer touches subscriptions.

    // Auto-deploy site to Cloudflare Workers
    let deployedUrl = '';
    if (leadId) {
      try {
        const deployResult = await deploySite(leadId);
        deployedUrl = deployResult.url;
      } catch (deployErr) {
        console.error('Auto-deploy failed:', deployErr.message);
      }
    }

    // Email Brock
    if (resendKey && process.env.RESEND_DRY_RUN === 'true') {
      console.log('[stripe-webhook][dry-run] paid-customer notify email skipped');
    } else if (resendKey) {
      const fromEmail = process.env.RESEND_FROM  || 'hello@bedrock-sites.com';
      const toEmail   = process.env.NOTIFY_EMAIL || 'brockniederer@gmail.com';
      const siteBlock = deployedUrl
        ? `<p style="margin-top:20px;padding:12px;background:#f0f5ea;border-left:3px solid #3b6d11;font-size:14px">
             Site deployed: <a href="${deployedUrl}">${deployedUrl}</a>
           </p>`
        : `<p style="margin-top:20px;padding:12px;background:#fff3cd;border-left:3px solid #c9a84c;font-size:14px">
             Auto-deploy did not complete — check Netlify logs and redeploy manually via<br>
             POST /.netlify/functions/deploy-customer-site with {"leadId":"${leadId || ''}"}
           </p>`;

      const html = `
        <div style="font-family:sans-serif;max-width:540px">
          <h2 style="color:#111">New paid customer: ${businessName}</h2>
          <table style="border-collapse:collapse;width:100%">
            <tr><td style="padding:6px 12px 6px 0;color:#666;width:140px">Business</td><td>${businessName}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Customer email</td><td><a href="mailto:${customerEmail}">${customerEmail || '—'}</a></td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Lead ID</td><td>${leadId || '—'}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Stripe session</td><td>${session.id}</td></tr>
            <tr><td style="padding:6px 12px 6px 0;color:#666">Amount</td><td>$${((session.amount_total || 0) / 100).toFixed(2)}</td></tr>
          </table>
          ${siteBlock}
        </div>
      `;

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from:    fromEmail,
          to:      [toEmail],
          subject: deployedUrl ? `Live: ${businessName} — ${deployedUrl}` : `Paid (deploy failed): ${businessName}`,
          html,
        }),
      });
    }

    // Welcome email to customer — day 0 of the onboarding sequence. Days 2
    // and 7 are sent by onboarding-email-scheduler.js (daily scheduled fn).
    if (customerEmail && deployedUrl && process.env.RESEND_DRY_RUN === 'true') {
      console.log('[stripe-webhook][dry-run] day-0 onboarding email skipped');
    } else if (customerEmail && deployedUrl) {
      await sendOnboardingEmail({
        to:           customerEmail,
        name:         businessName,
        site_url:     deployedUrl,
        delay_index:  0,
      });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

// G9 (Batch G, 2026-05-26): Apply a Stripe customer-balance credit to the
// referrer, mark the referrals row credited, increment the referrer's
// profiles.referral_credits_earned, and email the referrer via Resend.
//
// Guards (defense-in-depth — duplicate of the SQL constraints):
//   1. Code must resolve to a referrer profile.
//   2. The referrer cannot be the new paying customer (self-referral block,
//      by user_id and by email).
//   3. There must be a referrals row in 'pending' state for this attribution.
//      If it doesn't exist (referred lead was created before the referral
//      program existed), we create one on the fly so the credit still fires.
//   4. The referrals row must not already be 'credited' — prevents double
//      rewards if Stripe re-fires the webhook.
//   5. The referrer must have a stripe_customer_id we can credit against —
//      otherwise we leave the row in 'paid' state and email Brock so he can
//      apply the credit manually.
//
// Credit is applied via Stripe's customer-balance API as a negative-amount
// balance transaction (Stripe convention: balance < 0 ⇒ credit, deducted
// from next invoice).
async function fireReferralReward({
  supabaseUrl, supabaseKey, resendKey, stripeKey,
  referralCode, referredUserId, referredEmail, referredCustId,
}) {
  if (!referralCode || !supabaseUrl || !supabaseKey || !stripeKey) return;

  // 1) Look up the referrer.
  const refLookup = await fetch(
    `${supabaseUrl}/rest/v1/profiles?referral_code=eq.${encodeURIComponent(referralCode)}&select=user_id,email,business_name,referral_credits_earned&limit=1`,
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (!refLookup.ok) { console.error('[fireReferralReward] profile lookup status=', refLookup.status); return; }
  const refRows = await refLookup.json();
  if (!refRows.length) { console.log('[fireReferralReward] unknown code, skipping'); return; }
  const referrer = refRows[0];

  // 2) Self-referral guard.
  if (referrer.user_id && referredUserId && referrer.user_id === referredUserId) {
    console.log('[fireReferralReward] self-referral by user_id, skipping');
    return;
  }
  if (referrer.email && referredEmail && referrer.email.toLowerCase() === referredEmail.toLowerCase()) {
    console.log('[fireReferralReward] self-referral by email, skipping');
    return;
  }

  // 3) Locate or create the referrals row.
  let referralRow = null;
  const findRow = await fetch(
    `${supabaseUrl}/rest/v1/referrals?referrer_user_id=eq.${referrer.user_id}&referral_code=eq.${encodeURIComponent(referralCode)}&order=created_at.desc&limit=1`
    + (referredEmail ? `&referred_email=eq.${encodeURIComponent(referredEmail.toLowerCase())}` : ''),
    { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
  );
  if (findRow.ok) {
    const rows = await findRow.json();
    referralRow = rows[0] || null;
  }
  if (!referralRow) {
    // Backfill: create the attribution row now. This covers the case where the
    // referred lead was captured before the referrals table existed.
    const ins = await fetch(`${supabaseUrl}/rest/v1/referrals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        referrer_user_id: referrer.user_id,
        referred_user_id: referredUserId || null,
        referred_email:   referredEmail  || null,
        referral_code:    referralCode,
        status:           'pending',
      }),
    });
    if (ins.ok) {
      const inserted = await ins.json();
      referralRow = inserted[0] || null;
    } else {
      console.error('[fireReferralReward] referral row backfill status=', ins.status);
      return;
    }
  }

  // 4) Already credited? Don't double-charge ourselves.
  if (referralRow.status === 'credited') {
    console.log('[fireReferralReward] already credited, skipping referral id=', referralRow.id);
    return;
  }

  // 5) Find the referrer's stripe_customer_id from their most recent active
  //    subscription. No customer = can't apply credit automatically.
  let referrerStripeCustId = '';
  try {
    const subRes = await fetch(
      `${supabaseUrl}/rest/v1/subscriptions?user_id=eq.${referrer.user_id}&stripe_customer_id=not.is.null&select=stripe_customer_id&order=updated_at.desc&limit=1`,
      { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } }
    );
    if (subRes.ok) {
      const rows = await subRes.json();
      referrerStripeCustId = (rows[0] && rows[0].stripe_customer_id) || '';
    }
  } catch (_) { /* fall through */ }

  if (!referrerStripeCustId) {
    // Park in 'paid' state so we know to manually credit later.
    await fetch(`${supabaseUrl}/rest/v1/referrals?id=eq.${referralRow.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        status: 'paid',
        referred_user_id: referredUserId || referralRow.referred_user_id || null,
      }),
    });
    notifyOpsCreditPending(resendKey, referrer, referralCode);
    return;
  }

  // 6) Apply the Stripe customer-balance credit. Negative amount = credit.
  const txnBody = new URLSearchParams();
  txnBody.append('amount',      String(-REFERRAL_REWARD_CENTS));
  txnBody.append('currency',    'usd');
  txnBody.append('description', `Bedrock referral reward — code ${referralCode}`);
  const txnRes = await fetch(
    `https://api.stripe.com/v1/customers/${encodeURIComponent(referrerStripeCustId)}/balance_transactions`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: txnBody.toString(),
    }
  );
  if (!txnRes.ok) {
    console.error('[fireReferralReward] Stripe balance txn status=', txnRes.status);
    // Stripe call failed — leave the row at 'paid' so a retry won't double-credit.
    await fetch(`${supabaseUrl}/rest/v1/referrals?id=eq.${referralRow.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ status: 'paid' }),
    });
    return;
  }
  const txn = await txnRes.json();

  // 7) Mark referrals row credited + bump the referrer's profile counter.
  await fetch(`${supabaseUrl}/rest/v1/referrals?id=eq.${referralRow.id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      status: 'credited',
      credited_at: new Date().toISOString(),
      credited_stripe_txn:   txn.id || null,
      credited_amount_cents: REFERRAL_REWARD_CENTS,
      referred_user_id:      referredUserId || referralRow.referred_user_id || null,
    }),
  });
  await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${referrer.user_id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      referral_credits_earned: (referrer.referral_credits_earned || 0) + REFERRAL_REWARD_MONTHS,
    }),
  });

  // 8) Email the referrer. RESEND_DRY_RUN respected so test mode doesn't send.
  if (resendKey && process.env.RESEND_DRY_RUN === 'true') {
    console.log('[fireReferralReward][dry-run] referrer notify email skipped');
  } else if (resendKey && referrer.email) {
    const fromEmail = process.env.RESEND_FROM || 'hello@bedrock-sites.com';
    const firstName = (referrer.business_name || 'there').split(/\s+/)[0];
    const html = `
      <div style="font-family:sans-serif;max-width:540px">
        <h2 style="color:#0D1B2E">Hey ${firstName} — your buddy just signed up.</h2>
        <p>Someone you referred just became a paying Bedrock customer. As promised, you've earned <strong>${REFERRAL_REWARD_MONTHS} months free</strong> ($${REFERRAL_REWARD_CENTS/100}) on your subscription.</p>
        <p>The credit is already on your account. It'll come off your next ${REFERRAL_REWARD_MONTHS} bills automatically — nothing to claim.</p>
        <p style="margin-top:2rem;padding-top:1rem;border-top:1px solid #eee;color:#666;font-size:0.85rem">Want to refer someone else? Your code is still <strong>${referralCode}</strong>. Every referral that pays = another ${REFERRAL_REWARD_MONTHS} months free.</p>
      </div>`;
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: fromEmail, to: [referrer.email],
        subject: `Your referral just paid — ${REFERRAL_REWARD_MONTHS} months free credited`,
        html,
      }),
    }).catch((e) => console.error('[fireReferralReward] referrer email failed:', e.message));
  }
}

function notifyOpsCreditPending(resendKey, referrer, referralCode) {
  if (!resendKey) return;
  if (process.env.RESEND_DRY_RUN === 'true') {
    console.log('[fireReferralReward][dry-run] ops credit-pending email skipped');
    return;
  }
  const fromEmail = process.env.RESEND_FROM  || 'hello@bedrock-sites.com';
  const toEmail   = process.env.NOTIFY_EMAIL || 'brockniederer@gmail.com';
  fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: fromEmail, to: [toEmail],
      subject: `Manual referral credit needed — ${referralCode}`,
      html: `<div style="font-family:sans-serif"><h2>Referral reward couldn't auto-apply</h2>
        <p>Code: <strong>${referralCode}</strong><br>
        Referrer: ${referrer.business_name || '—'} (${referrer.email || '—'})<br>
        Reason: no stripe_customer_id on file for this referrer (they may not have an active subscription).</p>
        <p>Apply a $${REFERRAL_REWARD_CENTS/100} customer balance credit manually in Stripe, then mark the referrals row credited.</p>
      </div>`,
    }),
  }).catch(() => {});
}
