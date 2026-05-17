# Context System — README

## What This Is

A set of `.md` files that give Claude full context about you so you don't waste tokens re-explaining yourself every session. GIGO — good context in, good output out.

---

## The Files

| File | Use When |
|---|---|
| `CLAUDE.md` | Almost always — load this for any session that involves you personally |
| `bedrock-context.md` | Building, planning, or selling anything related to Bedrock Sites |
| `wealth-career-context.md` | Career decisions, professional writing, CFP prep, client communication |

---

## How to Use in Cursor

1. Put all these `.md` files in a folder at the root of your project (e.g., `/context/`)
2. When you start a session in Cursor, type:
   ```
   @CLAUDE.md @bedrock-context.md
   ```
   Cursor will pull those files into context automatically
3. For Bedrock dev sessions, always load both `CLAUDE.md` + `bedrock-context.md`
4. You can reference them mid-conversation too: `per my bedrock-context.md, here's what I need...`

**Pro tip:** In Cursor, you can add a `.cursorrules` file at your project root. Paste the contents of `CLAUDE.md` there and Cursor will load it automatically on every session without you having to ask.

---

## How to Use in Claude.ai Projects

Claude.ai has a **Projects** feature that lets you attach files and set a system prompt per project.

**Setup for each project:**

### Project: Bedrock
- System prompt: Paste contents of `CLAUDE.md`
- Attached files: `bedrock-context.md`
- Use for: all Bedrock dev, planning, and sales work

### Project: Career / Wealth Management
- System prompt: Paste contents of `CLAUDE.md`
- Attached files: `wealth-career-context.md`
- Use for: Lido decision, CFP prep, client writing, LinkedIn

### Project: Personal
- System prompt: Paste contents of `CLAUDE.md`
- Use for: fitness goals, family planning, general life stuff

---

## How to Use in Claude Code (Shell)

When you open Claude Code in your terminal, you can tell it to read a context file at the start:

```bash
claude "Read CLAUDE.md and bedrock-context.md first, then help me with..."
```

Or put `CLAUDE.md` in your home directory — Claude Code will often pick it up automatically.

---

## How to Maintain These in Obsidian

1. Store all these files in your Obsidian vault under a folder called `/AI-Context/`
2. When something changes (new job, project update, new goals), update the file in Obsidian
3. Copy/paste or sync the updated file to your Cursor project folder when needed
4. Think of Obsidian as the **source of truth** — Cursor/Claude get copies

**Suggested Obsidian structure:**
```
/AI-Context/
  CLAUDE.md
  bedrock-context.md
  wealth-career-context.md
  README.md

/Projects/
  /Bedrock/
    bedrock-memories.md   ← running log of decisions made, things tried
  /Career/
    career-notes.md

/Personal/
  goals.md
  fitness.md
```

---

## The `[Project]-memories.md` Pattern

For each active project, keep a running `memories.md` file. After each productive session, add a bullet:

```markdown
## Bedrock Memories

- 2025-05-16: Decided on Option A deployment (single Netlify account, auto subdomain)
- 2025-05-16: Removed AI editor via display:none — do not delete, it broke things before
- 2025-05-18: Started building serverless deployment function
```

Load this file in future sessions so Claude picks up exactly where you left off without re-explaining the history.

---

## Quick Start for Any New Session

**Bedrock dev session:**
> "Load bedrock-context.md and CLAUDE.md. Today I want to work on [X]."

**Career/writing session:**
> "Load wealth-career-context.md and CLAUDE.md. Help me draft [X]."

**General session:**
> "Load CLAUDE.md. Here's what I need today..."
