# Bedrock Digital — Project Status
*Last updated: May 17, 2026*

## What This Is
Website builder SaaS targeting trade businesses (plumbers, electricians, contractors). Non-technical owners get a live professional site with minimal friction.

**External brand:** Bedrock Digital  
**Owner:** Brock Niederer, Idaho Falls ID  
**GitHub:** brockn72 / bedrock-sites  
**Live site:** bedrock-sites.com (on Netlify)

---

## Phase 1 Goal
> 10 paying clients = ~$200/month = success

- Timeline: MVP + backend fully functional before August
- After August: part-time sales, marketing, incremental improvements
- Unit economics: ~99% margins (near-zero marginal cost per site)

---

## Current Builder Version
**bedrock-v35.html** — single HTML/CSS/JS file, no framework, no build step.

The builder walks a contractor through:
1. Business info (name, trade, city, phone)
2. Style picker (hero photo, font pair, color)
3. Preview + edit panel (live iframe)
4. Claim screen (contact info → Stripe payment link)
5. Success screen (pending / paid / demo fallback states)

---

## What's Done ✓

### Backend Functions (in netlify/functions/)
- `capture-lead.js` — saves lead to Supabase, fires email notification via Resend
- `create-checkout.js` — creates Stripe Checkout session (dynamic, for future use)
- `stripe-webhook.js` — handles payment confirmation, marks lead paid in Supabase, emails Brock
- `deploy-site.js` — DELETED (was wrong approach; auto-deploy from frontend is bad)

### Infrastructure
- Supabase project: `bedrock` (vkzkzteewfoqrdwktgae.supabase.co)
- Database tables: `leads` (see [[02-DATABASE-SCHEMA]])
- Netlify env vars: all set (see [[03-ENV-VARS]])
- Stripe: live account, payment link active, webhook configured
- Resend: API key set
- GitHub repo connected to Netlify *(pending — still drag-and-drop deploy)*

### Obsidian Planning Vault
Committed to GitHub repo at `/bedrock-vault/`

---

## What's NOT Done Yet ✗

- [ ] GitHub repo NOT yet connected to Netlify (functions won't fire until this is done)
- [ ] Supabase service_role key may be wrong format (sb_secret_ vs eyJ... JWT) — verify if leads fail
- [ ] Auto-deploy: payment → site live → customer email (needs Cloudflare Pages setup)
- [ ] Stripe PRICE_ID for the $19/month subscription is set; $200 one-time is secondary
- [ ] Custom domain per client (jpbsites.com subdomains) — not started
- [ ] Client dashboard / admin view (Retool mockup in roadmap, not built)

---

## The Critical Next Step
**Connect GitHub repo to Netlify** so the serverless functions actually deploy.

Netlify → bedrock-sites.com → Site configuration → Build & deploy → Link repository → pick `bedrock-sites`

Domain stays. Env vars stay. Functions go live.

---

## Pricing Model
- **$200** one-time setup fee
- **$19/month** recurring hosting/subscription
- Beta clients: promo code for free site, pay monthly only

---

## Sales Approach
- Door-to-door / direct outreach (Brock has experience)
- Lead with the problem (no website = lost customers), not features
- Genuine, value-first — no pushy tactics
- Keep pricing simple and easy to say yes to

---

## Related

- [[01-TECH-STACK]] — full stack breakdown and architecture
- [[02-DATABASE-SCHEMA]] — Supabase tables and schema
- [[03-ENV-VARS]] — all environment variables and Stripe config
- [[04-DECISIONS-LOG]] — why things are built the way they are
- [[BEDROCK-PLATFORM]] — broader product roadmap (Sites, SEO, CFO)
