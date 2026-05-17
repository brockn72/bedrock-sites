---
type: reference
project: bedrock
status: active
---

# Tech Stack & Architecture

## Stack Overview

| Layer | Tool | Notes |
|---|---|---|
| Builder frontend | `bedrock-v35.html` | Single file, vanilla HTML/CSS/JS, no build step |
| Serverless functions | Netlify Functions | Node.js 18, in `/netlify/functions/` |
| Database | Supabase (PostgreSQL) | Project: `bedrock` |
| Payments | Stripe | Live mode, payment link + webhook |
| Email | Resend | Notification emails to Brock on lead capture |
| Site hosting | Netlify | bedrock-sites.com, single account |
| Client subdomains | TBD | jpbsites.com planned; Cloudflare Pages for auto-deploy |
| Domain cost | ~$12/year | Primary ongoing infrastructure cost |

---

## Architecture Decision: Locked In

**Model:** Brock hosts ALL customer sites on a single Netlify account. Each client gets a subdomain.

**Rejected alternatives:**
- HTML download + Netlify Drop — too many steps for non-technical users (dealbreaker)
- Full custom backend (Railway + Express) — too much build effort at current stage
- Auto-deploy from frontend — burns through Netlify site limit fast; wrong trigger point

---

## The Correct Deploy Flow (When Ready)

```
Customer builds site
    → Step 4: enters contact info + clicks "Pay Now"
    → capture-lead.js fires (saves to Supabase, emails Brock)
    → Redirected to Stripe payment link
    → Stripe payment confirmed
    → stripe-webhook.js fires
    → Marks lead "paid" in Supabase
    → Emails Brock: "Deploy this one"
    → [FUTURE] Auto-deploys to Cloudflare Pages
    → [FUTURE] Customer receives live URL via email
```

**Right now:** Brock deploys manually after getting the "paid" email. That's fine for 10 clients.

---

## Netlify Functions

Located at `/netlify/functions/` in the repo.

### capture-lead.js
- Triggered: when customer clicks "Pay Now" in Step 4
- Does: saves lead data to Supabase `leads` table, sends notification email to Brock via Resend
- Fire-and-forget: doesn't block the Stripe redirect

### create-checkout.js
- Purpose: dynamic Stripe Checkout (future use — not currently wired)
- Would pass lead ID to Stripe for automatic webhook matching
- Currently bypassed in favor of static payment link

### stripe-webhook.js
- Triggered: by Stripe on `checkout.session.completed`
- Does: verifies Stripe signature, marks lead as paid in Supabase, emails Brock
- Endpoint: `https://bedrock-sites.com/.netlify/functions/stripe-webhook`

---

## Why Railway/Express Was Rejected
The planning docs mentioned Railway + Express. That was an earlier plan. Current architecture stays serverless on Netlify — simpler, cheaper, zero maintenance.

---

## Future: Cloudflare Pages for Client Sites
- Unlimited free bandwidth (unlike Netlify's limits)
- Direct Upload API works perfectly for static HTML
- When set up: stripe-webhook.js gets one more step — auto-deploy to Cloudflare → email customer their URL

---

## Key Engineering Principles
- **Non-destructive edits preferred** — hide with `display:none` over deleting code; large HTML files are risky to surgically edit
- **Zero friction for end user** — target customer is a plumber, not a developer
- **Simple > clever** — get to working first
- **Deploy trigger = payment, not button click** — never deploy from the frontend

---

## Related

- [[00-PROJECT-STATUS]] — current build state and what's live
- [[02-DATABASE-SCHEMA]] — Supabase tables the functions write to
- [[03-ENV-VARS]] — all secrets and keys used by functions
- [[04-DECISIONS-LOG]] — reasoning behind architecture choices
- [[CLAUDE-CODE-CONTEXT]] — working rules and context for Claude Code sessions
