# Rankscale skill — install for teammates

A 5-minute setup that lets Claude Code pull data from your Rankscale workspace on demand. You'll be able to ask things like *"how is Dashmoto doing this week?"* or *"what's my credit balance?"* and get clean tables back.

## Prereqs

- Claude Code installed and signed in.
- A Rankscale account with REST API access enabled. If your key starts with `rk_` you're set. Otherwise email `support@rankscale.ai` with subject *"Please activate REST API access for my account"*.

## 1 — Drop the skill into place

**Option A — clone from GitHub (recommended):**
```bash
git clone https://github.com/bojan-basrak/rankscale-skill.git ~/.claude/skills/rankscale
```
On Windows, `~` resolves to `%USERPROFILE%`, so this lands at `%USERPROFILE%\.claude\skills\rankscale\`.

**Option B — download the ZIP:** grab it from the repo's green **Code ▸ Download ZIP** button and unzip so the folder lands at:

- **Windows:** `%USERPROFILE%\.claude\skills\rankscale\`
- **macOS / Linux:** `~/.claude/skills/rankscale/`

Either way, you should see `SKILL.md` and a `references/` folder inside.

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

## 3 — Restart Claude Code

So it picks up the new skill folder.

## 4 — Try it

Open Claude Code in any working directory and ask:

> *"List my Rankscale brands."*

Claude should call the API and show your brands as a table. If it asks for your API key, the env var didn't take — re-check step 2.

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
- Server-side date filtering works reliably when parameters are cased correctly (`timeFrame`, `isoStartDate`/`isoEndDate`). Always sanity-check that the returned window matches what you asked for. (An earlier "only ~7-8 days" note was a mis-casing bug, since fixed.)

## Trouble?

- **"Skill not triggering"**: try mentioning *"Rankscale"* explicitly in your prompt; restart Claude Code if you just installed.
- **HTTP 401/403**: API key is wrong, expired, or REST access isn't activated yet.
- **HTTP 404 with HTML body**: the marketing site served a 404 — check the URL path is `/v1/...` not `/api/v1/...` (the skill handles this, but worth knowing if you build something custom).
