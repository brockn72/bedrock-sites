# Bedrock Digital — Platform Overview
*Last updated: May 2026*

## What Is Bedrock Digital?

Bedrock Digital is a software platform for trade business owners — plumbers, electricians, HVAC techs, contractors — who are great at their craft and hate the business side of running it.

**Core insight:** Contractors don't want to be business operators. They want to do the work. Bedrock Digital removes the friction of everything else.

**Owner:** Brock Niederer | Idaho Falls, ID → Milwaukee, WI  
**GitHub:** brockn72/bedrock-sites  
**Live site:** bedrock-sites.com

---

## Market Opportunity

- 28% of small businesses have no website; 44% of those plan to get one
- 31% of shoppers have decided against a business due to no website
- 75% of people who search for a local service visit within 24 hours; 28% buy
- Top barriers: feel too small (35%), don't think it helps (24%), lack tech skills (21%)
- ~2.5M home service businesses in the US
- *(Sources: SCORE, BrightLocal, Network Solutions, Go-Globe)*

---

## Brock's Role

- Non-coder — directs Claude/AI to write all code
- Handles product vision, sales strategy, and client relationships
- Claude handles implementation
- Has door-to-door sales background; will do direct outreach for first clients

---

## The Three Products

### 1. Bedrock Sites — Website Builder
**Status: MVP — nearly live**  
**Pricing:** $200 setup + $19/month

The entry point. A contractor goes from zero to a live, professional website in under 10 minutes with no technical knowledge required. They pick their style, upload photos, enter their info, and pay. Brock deploys manually for Phase 1 (10 clients). Auto-deploy via Cloudflare Pages is Phase 2.

This is the door opener — low friction, low price, gets contractors into the Bedrock ecosystem.

**Current stack:** Vanilla HTML/CSS/JS builder → Netlify Functions → Supabase → Stripe → Cloudflare Pages (coming)

---

### 2. Bedrock SEO — Audit & Optimizer
**Status: Roadmap — build after Sites is live and generating revenue**  
**Pricing:** TBD (e.g., free audit report / $X for full optimization service)

For contractors who already have a website and want more leads. Bedrock SEO crawls their site, analyzes it for issues (missing schema, slow load time, broken meta tags, no sitemap, thin content), and delivers a plain-English report.

Two tiers:
- **Diagnostic:** Free or low-cost automated report. Acts as a lead magnet for Sites and for the optimization service.
- **Optimization:** Paid service. Bedrock fixes the issues — schema injection, sitemap generation, meta tag rewrites, page speed recommendations.

The free audit also works as cold outreach: "We found 7 problems with your Google listing — here's a free report." Then convert them.

**Technical scope:** Web crawler + HTML analysis + schema/meta checker. Good fit for serverless jobs. Probably 2-3 months part-time to build properly.

---

### 3. Bedrock CFO — Business Intelligence Agent
**Status: Roadmap — the long game. Start scoping late 2026.**  
**Pricing:** TBD (target $99–$199/month — replaces a part-time bookkeeper)

The highest-value product and the hardest to build. A conversational AI agent that connects to a contractor's financial and operational tools and helps them run their business without needing to understand accounting.

**What it does:**
- Connects to QuickBooks: auto-categorizes expenses, flags anomalies, reconciles bank statements
- Bid intelligence: "I have a job that's X square feet, Y materials — what should I charge to hit my margin?"
- Cash flow visibility: "Am I going to make payroll this month?"
- Answers plain-English questions about the business's finances
- Works on mobile — contractor asks a question after a job, gets an answer

**Integration targets (MVP = QuickBooks only):**
- QuickBooks Online (via OAuth + API)
- Potentially Jobber, ServiceTitan (job/CRM platforms) later
- Bank feeds via Plaid (later)

**Why this wins:** A part-time bookkeeper costs $500-1,500/month. Bedrock CFO at $150/month with better availability is an obvious yes. The switching cost after setup is very high — contractors don't leave.

**Technical scope:** Significant. Needs OAuth integrations, Claude API for conversational layer, persistent memory/context, mobile-friendly interface. This is a 6-12+ month build.

---

## Sequencing & Priorities

| Phase | Timeline | Focus |
|---|---|---|
| Phase 1 | Now → August 2026 | Ship Bedrock Sites. 10 paying clients. Learn what contractors care about. |
| Phase 2 | Fall 2026 (part-time) | Bedrock SEO. Free audit as lead magnet. Paid optimization as upsell. |
| Phase 3 | Late 2026 → 2027 | Bedrock CFO. QuickBooks integration first. Expand from there. |

**Why this order matters:** Every Sites client is a potential SEO client. Every SEO client is a potential CFO client. The platform sells itself upward once you're in the door.

---

## Shared Infrastructure (All Three Products)

- **Auth/Database:** Supabase — one account/project per customer works across all three products. Add tables as products are built.
- **Email:** Resend — already set up, works for all transactional emails
- **Payments:** Stripe — subscriptions already configured; add new price IDs per product
- **Backend:** Netlify Functions now; may expand to Railway for CFO agent's more complex integrations

**Key principle:** A contractor signs up for Sites once. That same account unlocks SEO tools and CFO agent later. No re-registration.

---

## Target Customer Profile

- Trade business owner: plumber, electrician, HVAC, general contractor, roofer, landscaper
- 1–10 employees (often solo or 2–3 person shop)
- Has a phone, not a computer mindset
- Not technical — any friction is a dealbreaker
- Has more work than he can handle OR needs more leads — both are common
- Currently paying someone else (bookkeeper, web designer, marketing agency) for things Bedrock can replace at lower cost

---

## Phase 1 Success Metric

**10 paying clients = $200/month recurring = proof of concept.**

That's it. 10 clients, working product, no automation required. After August: part-time sales and marketing to grow to 50-100 contractors.

---

## What Bedrock Digital Is NOT

- Not trying to compete with Wix or Squarespace
- Not trying to replace a full accounting firm
- Not a tool for corporate businesses or non-trades
- Not overengineered — simple > clever at every stage

---

## Related

- [[00-PROJECT-STATUS]] — Phase 1 build state and critical next steps
- [[00-PROJECT-STATUS]] — current Phase 1 build state
- [[CLAUDE-CODE-CONTEXT]] — working rules and context for Claude Code sessions
- [[04-DECISIONS-LOG]] — key architectural and product decisions
- [[01-TECH-STACK]] — shared infrastructure across all three products
