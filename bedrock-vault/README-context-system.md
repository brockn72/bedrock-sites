---
type: system
status: active
---

# Context System — README

## What This Is

A set of `.md` files that give Claude full context about you so you don't waste tokens re-explaining yourself every session. GIGO — good context in, good output out.

Obsidian is the **source of truth**. Claude.ai Projects and Claude Code get copies.

---

## All Files in This Vault

| File | What It Is | Load When |
|---|---|---|
| [[CLAUDE]] | Personal context — who you are, values, communication style | Almost every session |
| [[wealth-career-context]] | Resume, credentials, career situation, job search | Career decisions, writing, CFP prep |
| [[BEDROCK-PLATFORM]] | Full platform overview — market, products, roadmap, Brock's role | Strategy / roadmap discussions |
| [[CLAUDE-CODE-CONTEXT]] | Working rules for Claude Code — critical rules, payment flow | Every Bedrock dev session |
| [[00-PROJECT-STATUS]] | Current build state, what's done, what's blocking | Starting any Bedrock dev session |
| [[01-TECH-STACK]] | Stack breakdown, architecture, Netlify functions explained | Building or debugging anything |
| [[02-DATABASE-SCHEMA]] | Supabase tables and columns | DB work, schema questions |
| [[03-ENV-VARS]] | All Netlify env vars, Stripe config, key locations | Config, secrets, deployment |
| [[04-DECISIONS-LOG]] | Build progress checklist + why things were built the way they were | Before relitigating any past decision |
| [[README-context-system]] | This file — the system itself | When adding a new context file |

---

## Claude.ai Projects Setup

Claude.ai Projects let you attach files and set a system prompt. Here's the correct setup for each project.

> **Note:** Claude.ai does not auto-sync from Obsidian. When you update a file or add a new one, re-upload it manually (see checklist below).

---

### Project: Bedrock (Dev)

**System prompt:** Paste contents of [[CLAUDE-CODE-CONTEXT]]

**Attached files:**
- [[CLAUDE]]
- [[BEDROCK-PLATFORM]]
- [[00-PROJECT-STATUS]]
- [[01-TECH-STACK]]
- [[02-DATABASE-SCHEMA]]
- [[03-ENV-VARS]]
- [[04-DECISIONS-LOG]]

**Use for:** All Bedrock dev work, debugging, building features, architecture questions.

---

### Project: Bedrock (Strategy / Sales)

**System prompt:** Paste contents of [[CLAUDE]]

**Attached files:**
- [[BEDROCK-PLATFORM]]
- [[00-PROJECT-STATUS]]

**Use for:** Pricing decisions, sales scripts, product planning, outreach copy.

---

### Project: Career / Wealth Management

**System prompt:** Paste contents of [[CLAUDE]]

**Attached files:**
- [[wealth-career-context]]

**Use for:** Lido decision, CFP prep, cover letters, LinkedIn content, client writing.

---

### Project: Personal

**System prompt:** Paste contents of [[CLAUDE]]

**Attached files:** None required

**Use for:** Fitness goals, family planning, general life decisions.

---

## When You Create a New Context File

Follow this checklist every time you add a new `.md` file to the vault:

- [ ] Start from the `[[_template-context]]` template (Cmd+T in Obsidian)
- [ ] Write the file with a clear `#` title and logical sections
- [ ] Add YAML frontmatter (type, project, status)
- [ ] Add wikilinks in the body wherever you mention another note by title (e.g., `[[01-TECH-STACK]]`)
- [ ] Add a `## Related` section at the bottom linking to the 3–5 most relevant other notes
- [ ] Add a row for it in the **All Files in This Vault** table above
- [ ] Decide which Claude.ai Project(s) it belongs in — add it to the file list in that project's section above
- [ ] Go to Claude.ai → open that Project → click **Add content** → upload the new file
- [ ] If an existing file now references the new file, update that file and re-upload it too

---

## How to Use in Claude Code

Claude Code picks up `CLAUDE.md` automatically from the project root and parent directories. The vault's [[CLAUDE-CODE-CONTEXT]] is synced into the repo as `CLAUDE.md` — so Claude Code sessions load it without you asking.

For extra context mid-session:
```bash
claude "Read bedrock-vault/00-PROJECT-STATUS.md first, then help me with..."
```

---

## Quick Start for Any New Session

**Bedrock dev session (Claude Code):**
> Just open Claude Code — CLAUDE.md loads automatically. If picking up from last time, say: "Check 00-PROJECT-STATUS and 04-DECISIONS-LOG, then let's work on [X]."

**Bedrock dev session (Claude.ai):**
> Open the Bedrock (Dev) project — files are already attached. Say: "Today I want to work on [X]."

**Career/writing session:**
> Open the Career project. Say: "Help me draft [X]."

**General session:**
> Open the Personal project or start fresh. Say: "Load my CLAUDE context. Here's what I need..."

---

## Related

- [[CLAUDE]] — main personal context file
- [[BEDROCK-PLATFORM]] — Bedrock project context and roadmap
- [[wealth-career-context]] — career and professional context
- [[04-DECISIONS-LOG]] — build progress checklist and decisions log
