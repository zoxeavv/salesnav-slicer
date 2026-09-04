# Sales Navigator Slicer Skill

A standalone Codex skill that opens reviewed LinkedIn Sales Navigator company
searches in Chrome, records their visible counts, recursively splits oversized
searches and verifies that the final leaf counts reconcile with the parent.

It requires no Cargo account, API token, connector, browser extension or npm
dependency. It uses the user's existing Chrome session and Sales Navigator
access. It never extracts companies, enriches contacts, writes to a CRM or
sends outreach.

## Install

Clone or copy this repository into the Codex skills directory under the folder
name `salesnav-slicer`. No package installation is required.

```bash
git clone https://github.com/zoxeavv/salesnav-slicer.git \
  ~/.codex/skills/salesnav-slicer
```

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
