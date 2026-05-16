# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Bedrock?

Two products targeting non-technical home service contractors (plumbers, electricians, landscapers):

1. **Website Builder** — AI-generated websites. $200 setup + $19/month hosting.
2. **CFO Bot** — AI assistant for invoicing and QuickBooks. $40/month add-on. Builds after website builder is live.

Owner: Brock Niederer (solo, Idaho Falls ID). GitHub: brockn72.

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Single HTML file (`bedrock-v35.html`) | No framework, no build step |
| Backend | Node.js + Express | Deployed on Railway |
| Database | Supabase | |
| Payments | Stripe | |
| Domains | Namecheap API | Requires static IP → Railway (not Vercel) |
| Site Hosting | Cloudflare Pages | Free unlimited bandwidth for customer sites |
| Email | Resend | |

## Architecture

The backend will expose **7 routes** (not yet defined). The frontend is a single HTML file that talks to the Express API.

Customer websites are hosted on Cloudflare Pages (static). The Express backend on Railway handles everything dynamic: Stripe billing, Namecheap domain provisioning, Supabase reads/writes, AI generation, and Resend email.

## Development Commands

> No code exists yet. Once `package.json` is created, update this section with:
> - `npm install` — install dependencies
> - `npm run dev` — start local Express server
> - `npm test` — run tests (if added)

## Key Decisions

- **Railway over Vercel** — Namecheap API requires a static IP; Railway provides one, Vercel does not.
- **Cloudflare Pages for customer sites** — unlimited bandwidth on the free tier.
- **CFO Bot scope** — MVP is QuickBooks only; do not expand to other integrations until website builder is profitable.
- **Single HTML file frontend** — no React, no build pipeline; keep it simple for a solo builder.

## Repository Layout

```
bedrock-sites/
├── bedrock-vault/          # Obsidian planning docs (backed up to GitHub)
│   ├── CLAUDE.md           # Short project context card
│   ├── bedrock-memories.md # Decision log and phase checklist
│   └── bedrock-master-plan.md (planned)
└── bedrock-v35.html        # Frontend (not yet committed)
```

The vault lives inside the repo intentionally for GitHub backup. It is documentation only — never import from it in code.

## Current Status

See `bedrock-vault/bedrock-memories.md` for the live phase checklist. At the time this was written: dev environment set up, no backend code written, no vendor accounts configured, legal not yet filed.
