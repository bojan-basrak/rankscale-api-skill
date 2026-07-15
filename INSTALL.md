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
should see `SKILL.md` and a `references/` folder inside.

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
- **HTTP 401/403**: API key is wrong, expired, or REST access isn't activated yet.
- **HTTP 404 with HTML body**: check the URL path is `/v1/...` not `/api/v1/...` (the skill handles this, but worth knowing if you build something custom).

## Disclaimer

This is an **unofficial** skill — not affiliated with or endorsed by Rankscale,
built by a power-user and beta-tester. Provided as-is, with no guarantees and no
support. Use at your own risk. See the [README](README.md#disclaimer) for the
full note.
