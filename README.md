# Rankscale API skill for Claude Code

A [Claude Code](https://claude.com/claude-code) skill that lets Claude query the
[Rankscale](https://rankscale.ai) AI brand-visibility REST API on demand — so an
SEO or marketing professional can pull data into reports, tables, and charts
without clicking through the dashboard.

Ask Claude things like:

> *"How is Dashmoto doing this week?"*
> *"Show me the citation sources for brand X."*
> *"What's my Rankscale credit balance and runway?"*
> *"List my tracked brands."*

…and get clean tables back, with the raw JSON saved alongside for follow-ups.

## What it can do

- **Reporting** — visibility, sentiment, mentions, citations, avg. position, detection rate, top-3 rate over any time window
- **Brand Rank (by Visibility)** — your brand's computed rank vs. competitors, overall or per topic / engine / query
- **Citations** — which third-party sources AI models cite for your tracked terms
- **Sentiment** — positive / neutral / negative breakdowns
- **Search-term reports** — per-query performance
- **Workspace management** — list / create / edit brands, topics, and search terms (writes always ask for confirmation)
- **Credits** — balance and runway estimate

## Requirements

- Claude Code installed and signed in.
- A Rankscale account with REST API access enabled (Agency Growth or Enterprise plan). If your API key starts with `rk_` you're set; otherwise email `support@rankscale.ai` to request REST API access.

## Install

See **[INSTALL.md](INSTALL.md)** for the full 5-minute setup. In short:

```bash
git clone https://github.com/bojan-basrak/rankscale-skill.git \
  ~/.claude/skills/rankscale
```

Then set your API key as an environment variable and restart Claude Code:

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
| [`INSTALL.md`](INSTALL.md) | Teammate setup guide |

## Security

The skill reads the API key from the `RANKSCALE_API_KEY` environment variable and
never prints it or writes it to disk. No credentials are stored in this
repository.

## License

[MIT](LICENSE). Not affiliated with or endorsed by Rankscale — this is a
community-built integration.
