# Decisions Log

A running record of key decisions made and why, so future Claude Code sessions don't re-litigate them.

---

## Build Progress Checklist

### Phase 0 — Dev Environment
- [x] Git installed
- [x] GitHub repo created (github.com/brockn72/bedrock-sites)
- [x] Node.js installed
- [x] Cursor installed + GitHub connected
- [x] Obsidian vault created
- [x] Claude Code installed
- [x] bedrock-v35.html added to repo

### Phase 1 — Legal
- [ ] LLC filed (sos.idaho.gov — $100)
- [x] EIN obtained (irs.gov/ein — free) — EIN: 42-2595138
- [ ] Business bank account opened
- [ ] Legal pages written (Termly.io)

### Phase 2 — Vendor Accounts
- [ ] Stripe set up
- [ ] Namecheap sandbox set up
- [ ] Supabase set up
- [ ] Cloudflare set up
- [ ] Resend set up

### Phase 3 — Backend Built
- [ ] All 7 routes built
- [ ] Railway deployed

### Phase 4 — Testing
- [ ] Full sandbox test passing
- [ ] Gone live

---

## Architecture

### Deploy trigger = Stripe webhook, NOT the "Pay Now" button
**Decided:** May 2026  
**Why:** Auto-deploying on button click would burn through Netlify's 500-site free limit fast (every demo click = a new site). The correct trigger is confirmed payment. For Phase 1, Brock deploys manually after receiving the "paid" email.

### Static Stripe payment link over dynamic Stripe Checkout
**Decided:** May 2026  
**Why:** Faster to ship. Static link works immediately with no backend. Downside: webhook can't auto-match which lead paid (manual matching for now). Will swap to `create-checkout.js` dynamic approach once backend is fully connected.

### Netlify Functions over Railway + Express backend
**Decided:** May 2026  
**Why:** Railway + Express was the original plan in the vault docs but deemed overkill for current stage. Serverless functions on Netlify = zero maintenance, no server to manage, free tier covers the use case.

### Supabase RLS disabled
**Decided:** May 2026  
**Why:** Only the backend service_role key touches the DB. No end users have direct DB access. RLS would add complexity with zero security benefit given the architecture.

### bedrock-v35.html stays as a single HTML file
**Decided:** Ongoing  
**Why:** No build step = easy to edit, deploy, and understand. The target customer is a plumber — the product itself should be built like they'd appreciate: simple and working.

### AI editor (Claude/Anthropic integration) removed from builder
**Decided:** Pre-May 2026  
**Why:** Deemed too complex and not worth API overhead. Hidden via `display:none` rather than deleted — surgical deletion on a large HTML file broke critical functions (`startBuild`, `showPage`, `goBS`, `renderPhotos`, `fileToBase64`).

### Cloudflare Pages for client site hosting (future)
**Decided:** May 2026  
**Why:** Unlimited free bandwidth vs. Netlify's limits. When set up, becomes the auto-deploy target in `stripe-webhook.js`.

---

## Product

### Beta clients get free sites, pay $19/month only
**Decided:** May 2026  
**Why:** Getting real users using the product is more valuable than $200 upfront. Promo code approach keeps it simple.

### LLC formation on pause
**Decided:** May 2026  
**Why:** Waiting until product is more finished. Sole proprietor in the meantime.

### Phase 1 = 10 clients, no automation required
**Decided:** Ongoing  
**Why:** Manual deployment for 10 clients is totally manageable and eliminates a lot of complexity. Automation (Cloudflare auto-deploy) comes when there's enough volume to justify it.

---

## Things That Were Tried and Failed

### Surgical code deletion on bedrock-v28.html
**What happened:** Attempted to remove the AI editor by deleting code. Progressive deletions removed critical functions: `startBuild`, `showPage`, `goBS`, `renderPhotos`, `fileToBase64`.  
**Lesson:** On large HTML files, hide (`display:none`) don't delete. The safe edit is non-destructive.

### deploy-site.js (auto-deploy from frontend)
**What happened:** Built a Netlify function that deployed a new site every time the success screen was reached. Realized this fires for demos, not just paying customers.  
**Decision:** Deleted. Deploy trigger = payment webhook only.

---

## Related

- [[00-PROJECT-STATUS]] — current build state
- [[01-TECH-STACK]] — tech stack that these decisions shaped
- [[BEDROCK-PLATFORM]] — product roadmap context (Sites, SEO, CFO)
- [[CLAUDE-CODE-CONTEXT]] — critical rules for Claude Code sessions
- [[BEDROCK-PLATFORM]] — product roadmap and market context
