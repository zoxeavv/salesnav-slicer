# Sales Navigator Slicer — Claude Code + Codex

A standalone Agent Skill for Claude Code and Codex. It opens reviewed LinkedIn
Sales Navigator company searches in Chrome, records their visible counts,
recursively splits oversized searches and verifies that the final leaf counts
reconcile with the parent.

It requires no Cargo account, API token, connector, browser extension or npm
dependency. It uses the user's existing Chrome session and Sales Navigator
access. It never extracts companies, enriches contacts, writes to a CRM or
sends outreach.

## Install for both agents

Keep one clone and expose it to both agents. No package installation is
required.

For an agent-led installation, copy and send the prompt in
[INSTALL_WITH_AI.md](INSTALL_WITH_AI.md).

```bash
git clone https://github.com/zoxeavv/salesnav-slicer.git \
  ~/.agents/skills/salesnav-slicer
mkdir -p ~/.claude/skills
ln -s ~/.agents/skills/salesnav-slicer \
  ~/.claude/skills/salesnav-slicer
```

- Codex: invoke with `$salesnav-slicer`.
- Claude Code: invoke with `/salesnav-slicer`.

The repository also contains project-discovery links at
`.agents/skills/salesnav-slicer` and `.claude/skills/salesnav-slicer`. Both
resolve to this same canonical skill folder, so the instructions and scripts
cannot drift between agents. Codex and Claude Code both support symlinked skill
folders: see the [Codex skill locations](https://developers.openai.com/codex/skills)
and [Claude Code skill locations](https://code.claude.com/docs/en/skills).

## What the skill does

1. opens one Chrome tab and navigates to the supplied company-search URL;
2. pauses for user login or MFA when needed and verifies the visible LinkedIn identity;
3. reads and preserves the Sales Navigator result count;
4. builds and recounts mutually exclusive under-cap child searches;
5. returns to the parent and verifies account identity plus numerical reconciliation.

Counts displayed as `K+` or otherwise abbreviated stay approximate. The skill
returns `review_required` instead of claiming an exact total.

The user supplies only the Sales Navigator URL(s) and, optionally, a cap. The
skill creates its internal plan and count observations; no JSON authoring is
required from the user.

## Maintainer verification

The deterministic helper uses only Node.js built-ins:

```bash
npm test
npm run validate
npm run dogfood
```

`npm run dogfood` uses fixture counts and makes no browser or network call.
Actual use is driven by Chrome observations as documented in `SKILL.md` and
`references/plan-schema.md`.
