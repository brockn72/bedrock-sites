---
type: reference
project: bedrock
status: active
---

# Environment Variables — Netlify

All vars are set in Netlify → bedrock-sites.com → Site configuration → Environment variables.

**⚠️ Never put keys in code or the GitHub repo. Netlify env vars only.**

---

## Current Status

| Variable | Status | Value / Notes |
|---|---|---|
| SUPABASE_URL | ✓ Set | https://vkzkzteewfoqrdwktgae.supabase.co |
| SUPABASE_SERVICE_KEY | ✓ Set | sb_secret_... format (verify if leads fail) |
| RESEND_API_KEY | ✓ Set | re_... key |
| SITE_URL | ✓ Set | https://bedrock-sites.com |
| NOTIFY_EMAIL | ✓ Set | brockniederer@gmail.com |
| STRIPE_WEBHOOK_SECRET | ✓ Set | whsec_... (from Stripe webhook endpoint) |
| STRIPE_SECRET_KEY | ✓ Set | sk_live_... (LIVE mode — real charges) |
| STRIPE_PRICE_ID | ✓ Set | price_... ($19/month subscription) |

---

## Stripe Notes
- Account is in **LIVE mode** — real payments will be charged
- Static payment link: https://buy.stripe.com/aFacN7c0edSFcDWbJ15kk00
- Webhook endpoint registered at: `https://bedrock-sites.com/.netlify/functions/stripe-webhook`
- Event listened for: `checkout.session.completed`
- Two price IDs exist: $19/month (subscription, in env vars) and $200 one-time (secondary)

---

## Netlify Personal Access Token
A personal access token was created for Claude Code to add env vars via API.  
**Name:** bedrock  
**Expiry:** 1 year from creation  
**Location:** Netlify → User settings → Applications → Personal access tokens  
*(Rotate this if ever compromised)*

---

## What Happens When Functions Aren't Live
If the GitHub repo isn't connected to Netlify yet, the functions don't exist as far as Netlify is concerned. The env vars are ready, but `capture-lead.js`, `stripe-webhook.js` etc. won't respond to requests.

**Fix:** Netlify → Site configuration → Build & deploy → Link repository → bedrock-sites

---

## Related

- [[00-PROJECT-STATUS]] — current project state and what's blocking progress
- [[01-TECH-STACK]] — how Netlify Functions use these variables
- [[02-DATABASE-SCHEMA]] — Supabase project the keys connect to
- [[04-DECISIONS-LOG]] — architecture decisions that shaped this config
