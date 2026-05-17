# CLAUDE.md — Bedrock Digital

> This file is for Claude Code. Read this at the start of every session before touching any code.

---

## What Is Bedrock Digital?

Website builder SaaS for trade businesses (plumbers, electricians, contractors). Non-technical small business owners get a live professional site with minimal friction.

- **Owner:** Brock Niederer (solo, Idaho Falls ID). Not a coder — directs Claude to write all code.
- **Phase 1 goal:** 10 paying clients by August
- **Pricing:** $200 setup + $19/month. Beta clients: $19/month only (promo)
- **GitHub:** brockn72/bedrock-sites
- **Live site:** bedrock-sites.com

---

## Tech Stack

| Layer | Tool | Notes |
|---|---|---|
| Frontend | `bedrock-v35.html` | Single file, vanilla HTML/CSS/JS, no framework, no build step |
| Functions | Netlify Functions | `/netlify/functions/`, Node.js 18 |
| Database | Supabase | `bedrock` project, vkzkzteewfoqrdwktgae.supabase.co |
| Payments | Stripe | LIVE mode — real charges |
| Email | Resend | Notification emails to Brock |
| Hosting | Netlify | bedrock-sites.com |
| Client sites | Cloudflare Pages (future) | Unlimited bandwidth; auto-deploy not yet built |

---

## The Payment Flow (How It's Supposed to Work)

1. Customer builds site in `bedrock-v35.html`
2. Step 4: enters name/phone/email → clicks "Pay Now — $200"
3. `capture-lead.js` fires (saves to Supabase, emails Brock) — fire and forget
4. Customer redirected to Stripe payment link
5. After payment: Stripe fires webhook → `stripe-webhook.js`
6. Webhook marks lead "paid" in Supabase, emails Brock to deploy
7. **Right now:** Brock deploys manually
8. **Future:** auto-deploy to Cloudflare Pages → customer gets live URL email

---

## Current Build State

### What's done and committed:
- `netlify/functions/capture-lead.js` — saves lead, emails Brock
- `netlify/functions/create-checkout.js` — dynamic Stripe checkout (not yet wired, for future)
- `netlify/functions/stripe-webhook.js` — payment confirmation handler
- `netlify.toml` — functions directory config
- `supabase/schema.sql` — run in Supabase SQL editor to create tables
- `bedrock-v35.html` — builder with real Step 4 contact form + Stripe redirect
- `CLAUDE.md` — this file
- `bedrock-vault/` — Obsidian planning docs

### What's NOT done:
- GitHub repo NOT connected to Netlify (functions don't fire yet)
- Cloudflare Pages auto-deploy not built
- `create-checkout.js` not wired (static payment link used instead)
- Custom subdomains (jpbsites.com) not started

---

## Environment Variables (all set in Netlify)

| Key | Notes |
|---|---|
| SUPABASE_URL | https://vkzkzteewfoqrdwktgae.supabase.co |
| SUPABASE_SERVICE_KEY | sb_secret_... format — verify if leads fail |
| RESEND_API_KEY | re_... |
| SITE_URL | https://bedrock-sites.com |
| NOTIFY_EMAIL | brockniederer@gmail.com |
| STRIPE_WEBHOOK_SECRET | whsec_... |
| STRIPE_SECRET_KEY | sk_live_... (LIVE MODE) |
| STRIPE_PRICE_ID | price_... ($19/month) |

---

## Critical Rules — Read Before Editing Anything

1. **Never auto-deploy from the frontend.** Deploy trigger = Stripe webhook only. Deploying on button click burns the Netlify site limit.

2. **Never delete code from bedrock-v35.html surgically.** Hide with `display:none` instead. Surgical deletion on this file has broken critical functions before: `startBuild`, `showPage`, `goBS`, `renderPhotos`, `fileToBase64`.

3. **Stripe is in LIVE mode.** Test with test keys before touching anything payment-related.

4. **Keep it simple.** The target user is a plumber. Any step requiring technical knowledge is a product failure.

5. **Never put API keys in code or the repo.** Netlify env vars only.

---

## Database Tables (Supabase)

**leads** — main table for builder submissions  
Key fields: `business_name`, `contact_name`, `phone`, `email`, `trade`, `city`, `site_data` (JSONB), `status` (new/paid/deployed), `stripe_session_id`

**clients** — confirmed paying clients

**sites** — deployed site records per client (subdomain, live_url, site_data)

RLS is disabled — only service_role key accesses DB, no end users.

---

## Stripe Setup

- Payment link: https://buy.stripe.com/aFacN7c0edSFcDWbJ15kk00
- Webhook endpoint: `https://bedrock-sites.com/.netlify/functions/stripe-webhook`
- Event: `checkout.session.completed`
- Two prices: $19/month (subscription, in STRIPE_PRICE_ID) and $200 one-time

---

## Next Build Priorities (In Order)

1. **Connect GitHub repo to Netlify** (Brock does this in the UI — not a code task)
2. **Test the full flow:** build a site → claim → Stripe → confirm webhook fires → Supabase updated
3. **Cloudflare Pages setup** → auto-deploy on payment → customer email with live URL
4. **Wire create-checkout.js** for dynamic checkout (auto-matches lead to payment)
5. **Custom subdomains** on jpbsites.com
