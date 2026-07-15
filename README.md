# Rankscale API skill

An [Agent Skill](https://code.claude.com/docs/en/skills) that teaches your AI
coding agent to query the [Rankscale](https://rankscale.ai) AI brand-visibility
REST API on demand — so an SEO or marketing professional can pull data into
reports, tables, and charts without clicking through the dashboard.

Ask your agent things like:

> *"How is my brand doing this week?"*
> *"Show me the citation sources for brand X."*
> *"What's my Rankscale credit balance and runway?"*
> *"List my tracked brands."*

…and get clean tables back, with the raw JSON saved alongside for follow-ups.

## Works with most agentic coding tools

This is a plain-markdown skill (a `SKILL.md` plus reference files) that drives the
REST API with `curl`. It's model- and provider-agnostic — nothing in it is tied
to a specific AI vendor. It works with any agentic harness that can read a skill/
instructions file and run shell commands, including:

- **[Claude Code](https://claude.com/claude-code)** (native Agent Skills support)
- **[Cursor](https://cursor.com)**
- **[OpenAI Codex](https://openai.com/codex/)**
- **[Windsurf](https://windsurf.com)**
- **[Gemini CLI](https://github.com/google-gemini/gemini-cli)**
- **[GitHub Copilot](https://github.com/features/copilot)** (agent mode)

If your tool doesn't auto-load skills, just point it at [`SKILL.md`](SKILL.md) and
it'll follow the instructions there.

## What it can do

- **Reporting** — visibility, sentiment, mentions, citations, avg. position, detection rate, top-3 rate over any time window
- **Brand Rank (by Visibility)** — your brand's computed rank vs. competitors, overall or per topic / engine / query
- **Citations** — which third-party sources AI models cite for your tracked terms
- **Sentiment** — positive / neutral / negative breakdowns
- **Search-term reports** — per-query performance
- **Workspace management** — list / create / edit brands, topics, and search terms (writes always ask for confirmation)
- **Credits** — balance and runway estimate

## Usage examples

A worked walkthrough of the skill in action — real questions and the tables it
produces — is here:
**[Rankscale skill examples](https://bojan-basrak.github.io/rankscale-webinar-2026-07-16/index.html)**
(from a July 2026 webinar).

## Requirements

- An agentic coding tool that can read a skill file and run shell commands (see the list above).
- A shell with `curl` available (JSON parsing uses whatever's on hand — `node`, `jq`, or `python`).
- A Rankscale account with REST API access enabled (Agency Growth or Enterprise plan). If your API key starts with `rk_` you're set; otherwise ask the Rankscale team to enable REST API access.

## Install

See **[INSTALL.md](INSTALL.md)** for the full setup. In short, for Claude Code:

```bash
git clone https://github.com/bojan-basrak/rankscale-api-skill.git \
  ~/.claude/skills/rankscale-api-skill
```

For other tools, place the folder wherever that tool loads skills or custom
instructions from (or just open the repo and point your agent at `SKILL.md`).

Then set your API key as an environment variable:

```bash
# macOS / Linux — add to ~/.bashrc or ~/.zshrc
export RANKSCALE_API_KEY="rk_your_key_here"
```

```powershell
# Windows PowerShell (persistent) — open a new shell afterward
setx RANKSCALE_API_KEY "rk_your_key_here"
```

## Layout

| File | Purpose |
|---|---|
| [`SKILL.md`](SKILL.md) | The skill itself — setup, calling patterns, and workflow recipes |
| [`references/endpoints.md`](references/endpoints.md) | Full endpoint inventory, request shapes, engine catalog, error codes |
| [`references/quirks.md`](references/quirks.md) | API behaviors that affect how numbers should be interpreted |
| [`INSTALL.md`](INSTALL.md) | Setup guide |

## Limitations

- **Paid plans only.** REST API access is available on Rankscale's Agency Growth and Enterprise plans. If you don't have an `rk_` key, the skill can't do anything — ask the Rankscale team to enable it.
- **The API may change without notice.** The official docs aren't public yet, so this skill was built from hands-on probing. Endpoints, field names, and behaviors can shift; if calls start failing or returning odd shapes, the skill likely needs updating. The quirks it documents (strict camelCase params, exclusive end dates, POST-not-GET reporting) are current-as-of-testing, not guaranteed-stable.
- **No live validation here.** Nothing in this repo is tested against your account. Always sanity-check that returned time windows and numbers match what you asked for before trusting a report.
- **Rate limits apply.** 200 requests/min per key; the skill caches and batches, but heavy ad-hoc use can hit the ceiling.

## Security

The skill reads the API key from the `RANKSCALE_API_KEY` environment variable and
never prints it or writes it to disk. No credentials are stored in this
repository. Don't commit your key.

## Disclaimer

This is an **unofficial** skill. I am not affiliated with Rankscale — just a
power-user of their tool, a beta-tester, and a friend of the Rankscale team.

The official Rankscale API documentation is currently not public; it's available
only to signed-in users (they'll likely change that soon).

I'm an SEO & business-growth consultant, not a developer. I wouldn't even call
myself a "vibe coder" — I barely read the files for this skill, which were
created by Claude Opus 4.8. So use it at your own risk and discretion. I offer no
guarantees and no support.

## License

[MIT](LICENSE).
