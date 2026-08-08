# Rankscale API skill — install

A quick setup that lets your AI coding agent pull data from your Rankscale
workspace on demand. You'll be able to ask things like *"how is my brand doing
this week?"* or *"what's my credit balance?"* and get clean tables back.

## Prereqs

- An agentic coding tool that can read a skill/instructions file and run shell commands — e.g. Claude Code, Cursor, OpenAI Codex, Windsurf, Gemini CLI, or GitHub Copilot (agent mode).
- A shell with `curl` available.
- A Rankscale account with REST API access enabled. If your key starts with `rk_` you're set. Otherwise ask the Rankscale team to activate REST API access for your account.

## 1 — Drop the skill into place

**Claude Code** — clone (or download) so the folder lands in your skills directory:

```bash
git clone https://github.com/bojan-basrak/rankscale-api-skill.git ~/.claude/skills/rankscale-api-skill
```

On Windows, `~` resolves to `%USERPROFILE%`, so this lands at
`%USERPROFILE%\.claude\skills\rankscale-api-skill\`.

**Other tools** — put the folder wherever your tool loads skills or custom
instructions from (for example, a project-level rules/instructions folder), or
simply open the repo in your workspace and point your agent at `SKILL.md`. You
should see `SKILL.md` and a `references/` folder inside. See
[Per-tool setup](#per-tool-setup) below for concrete recipes for Codex, Cursor,
Windsurf, Aider, and web-only assistants.

**Download instead of clone:** use the repo's green **Code ▸ Download ZIP**
button and unzip to the same location.

## 2 — Set your API key as an environment variable

**Windows (PowerShell), persistent:**
```powershell
setx RANKSCALE_API_KEY "rk_your_key_here"
```
Then open a *new* PowerShell window (setx only affects new shells).

**macOS / Linux (bash/zsh):** add to `~/.bashrc` or `~/.zshrc`:
```bash
export RANKSCALE_API_KEY="rk_your_key_here"
```
Then `source` it or open a new terminal.

## 3 — Restart your agent

So it picks up the new skill folder / environment variable.

## 4 — Try it

Open your agent in any working directory and ask:

> *"List my Rankscale brands."*

It should call the API and show your brands as a table. If it asks for your API
key, the env var didn't take — re-check step 2.

## Per-tool setup

Step 2 (the API key) is the same everywhere. This section only covers *where the
files go* for tools that don't auto-discover skills the way Claude Code does.

### OpenAI Codex CLI

Codex auto-loads `AGENTS.md` from your project root.

**Option A — single project:** put `rankscale-api-skill/` somewhere in your
project (e.g. `docs/rankscale/`), then add to your existing `AGENTS.md`:

```markdown
## Rankscale API
When working with the Rankscale brand-visibility API, follow `docs/rankscale/SKILL.md`
and consult `docs/rankscale/references/endpoints.md` and
`docs/rankscale/references/quirks.md` as needed.
```

**Option B — dedicated:** if the project has no `AGENTS.md` yet, copy `SKILL.md`
to the project root and rename it `AGENTS.md`. Codex picks it up automatically.
Copy the `references/` folder alongside it.

### Cursor

Place the folder in your project, then create `.cursor/rules/rankscale.mdc`:

```markdown
---
description: Rankscale brand-visibility API instructions
globs:
alwaysApply: false
---

@docs/rankscale/SKILL.md
@docs/rankscale/references/endpoints.md
@docs/rankscale/references/quirks.md
```

### Windsurf

Add the folder to your workspace's context paths, or attach `SKILL.md` to a chat
with *"Use this to call the Rankscale API."*

### Aider

Aider has no auto-discovery convention but reads whatever you point it at:

```bash
aider \
  --read rankscale-api-skill/SKILL.md \
  --read rankscale-api-skill/references/endpoints.md \
  --read rankscale-api-skill/references/quirks.md \
  <your-other-files>
```

Or append the contents to your project's `CONVENTIONS.md`, which Aider
auto-loads when present.

### Web-only assistants (ChatGPT, Gemini, Claude.ai)

No filesystem, so paste instead of install:

1. Copy the whole of `SKILL.md`.
2. Start a new conversation and paste it as the first message, prefixed with
   *"Use the following instructions when I ask about Rankscale or AI
   brand-visibility tracking."*
3. When the conversation needs deeper endpoint detail or hits a quirk, paste the
   relevant section of `references/endpoints.md` or `references/quirks.md`.

Where the platform supports file attachments — Claude.ai Projects, ChatGPT
custom GPTs with knowledge files, Gemini Gems — attach `SKILL.md` and both
`references/*.md` files so they persist across the conversation.

Note that a web assistant can't run `curl`, so it can only tell you *what* to
call, not call it. For actual data pulls you need one of the tools above.

## What the skill can do

- **Reporting**: visibility, sentiment, mentions, citations, avg. position, detection rate, top-3 rate
- **Brand Rank (by Visibility)**: your brand's computed rank vs. competitors — overall or per topic/engine/query
- **Citations**: which third-party sources AI models cite for your tracked terms
- **Sentiment**: positive/neutral/negative breakdowns
- **Search-term reports**: per-query performance
- **Workspace**: list/create/edit brands, topics, and search terms (writes always ask for confirmation)
- **Credits**: balance + runway estimate

## Notes

- The skill saves full JSON responses into a `Rankscale/` folder in your current working directory, so you can ask follow-up questions or build charts without re-calling the API.
- Destructive actions (delete, deactivate, run-now which costs credits) always ask before executing.
- Server-side date filtering works reliably when parameters are cased correctly (`timeFrame`, `isoStartDate`/`isoEndDate`). Always sanity-check that the returned window matches what you asked for.

## Trouble?

- **"Skill not triggering"**: try mentioning *"Rankscale"* explicitly in your prompt; restart your agent if you just installed it.
- **HTTP 401**: API key is missing, wrong, expired, or REST access isn't activated yet.
- **HTTP 403 / "Unauthorized access to brand"**: the key is valid but belongs to a *different workspace* than the brand you're querying. Keys are workspace-scoped — if you have more than one Rankscale account, check you're using the right key.
- **HTTP 404 with HTML body**: check the URL path is `/v1/...` not `/api/v1/...` (the skill handles this, but worth knowing if you build something custom).

## Disclaimer

This is an **unofficial** skill — not affiliated with or endorsed by Rankscale,
built by a power-user and beta-tester. Provided as-is, with no guarantees and no
support. Use at your own risk. See the [README](README.md#disclaimer) for the
full note.
