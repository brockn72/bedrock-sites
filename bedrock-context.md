# bedrock-context.md — Bedrock Sites Project

> ⚠️ **ARCHIVED — This file is stale. Do not load into Claude Code sessions.**
>
> **What's wrong with this file:**
> - References "JPB Business Solutions" — old brand name (now **Bedrock Digital**)
> - References Namecheap — registrar is **Name.com** (not Namecheap)
> - References `bedrock-v28.html` — current canonical file is `index.html`
> - Says deploy is not built — **auto-deploy has been working since May 2026**
>
> **Use instead:** `bedrock-vault/CLAUDE-CODE-CONTEXT.md` for all current project context.
> **Archived copy:** `bedrock-vault/Archive/bedrock-context-stale.md`

---

> ~~Load this file when working on the Bedrock project in Cursor or Claude.ai.~~
> ~~Pair with CLAUDE.md for full context.~~

---

## What Is Bedrock?

**Bedrock Sites** (externally branded as **JPB Business Solutions**) is a website builder product targeting trade businesses — plumbers, electricians, contractors, and similar home service providers.

**Core value prop:** Non-technical small business owners get a live, professional website with minimal friction. No tech skills required. Done for them.

---

## The Market

- 28% of small businesses have no website; 44% of those plan to get one
- 31% of shoppers have decided against a business due to no website
- 75% of people who search for a local service visit within 24 hours; 28% buy
- Top barriers: feel too small (35%), don't think it helps (24%), lack tech skills (21%)
- ~2.5M home service businesses in the US
- *(Sources: SCORE, BrightLocal, Network Solutions, Go-Globe)*

---

## My Goals for Bedrock

- **Not trying to be the next Wix** — this is a focused, scrappy product for one niche
- **Target:** 10 paying clients = ~$200/month = success for phase 1
- **Timeline:** MVP + backend fully functional before August
- After August: part-time sales, marketing, and incremental improvements
- Unit economics are excellent — near-zero marginal cost per site, ~99% margins possible

---

## Current Tech Stack

| Layer | Tool |
|---|---|
| Builder frontend | Vanilla HTML/CSS/JS (single file: `bedrock-v28.html`) |
| Hosting | Netlify (single account, subdomain per client) |
| Deployment | Netlify Functions (serverless, calling Netlify API) |
| Subdomains | `clientname.jpbsites.com` auto-generated on deploy |
| Domain cost | ~$12/year |

---

## Architecture Decision (Locked In)

**Chosen: Option A** — Brock hosts all customer sites on a single Netlify account. Deployment is automated via a serverless Netlify Function that calls the Netlify API. Customer gets a live subdomain with zero manual steps.

**Rejected alternatives:**
- HTML download + Netlify Drop (too many steps for non-technical users — dealbreaker)
- Full custom backend (too much build effort for current stage)

---

## Current State of the Builder

- Working HTML-based site builder (`bedrock-v28.html`)
- AI editor (Claude/Anthropic integration) was **removed** — deemed too complex and not worth the API overhead. Hidden via `display:none` rather than deleted (surgical deletion broke critical functions on prior attempt)
- Critical functions to never break: `startBuild`, `showPage`, `goBS`, `renderPhotos`, `fileToBase64`

---

## Next Build Items (In Order)

1. Serverless Netlify deployment function
2. Updated "Launch" button in builder wired to trigger deployment
3. Success screen showing the customer's live URL

---

## Key Engineering Principles

- **Non-destructive edits preferred** — hide with `display:none` over deleting code when possible; large HTML files are risky to surgically edit
- **Zero friction for end user** — the target customer is a plumber, not a developer. Any step that requires technical knowledge is a product failure
- **Simple > clever** — don't over-engineer; get to working first

---

## My Role in This Project

- I am **not a coder** — I direct Claude/AI to write all the code
- I understand logic, functions, and product decisions
- I handle product vision, sales, and client relationships
- Claude handles implementation

---

## Sales & Marketing Approach

- Genuine, value-first — I hate pushy sales tactics
- Direct outreach (I have door-to-door sales experience)
- Transparency about what the product is and isn't
- Lead with the problem they have (no website = lost customers), not with features
- Keep pricing simple and easy to say yes to
