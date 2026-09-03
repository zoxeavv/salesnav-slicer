# Cargo Sales Navigator Slicer Skill

A standalone Codex skill that fills the missing design-time step between a
reviewed Sales Navigator company search and Cargo extraction:

```text
count -> split -> recount -> reviewed URLs below the extraction cap
```

It validates and rewrites Sales Navigator company-search URLs, recursively
counts each branch through Cargo, bounds count calls, checkpoints progress, and
emits a reconciliation manifest. It does **not** extract companies, enrich
accounts, write to a CRM, or send outreach.

## Install as a Codex skill

Clone the repository into your Codex skills directory, or copy this folder as
`cargo-salesnav-slicer`. The required entrypoint is `SKILL.md`.

Requires Node.js 20+. Live mode additionally requires an authenticated
`cargo-ai` CLI and a Cargo workspace with a Sales Navigator connection.

## Quick verification

```bash
npm test
npm run validate
npm run dogfood
```

`npm run dogfood` uses deterministic fixture counts and makes no external
calls. A live bounded count is explicit:

```bash
node scripts/slice-salesnav.mjs plan.json --execute \
  --connector-uuid <reviewed-connector-uuid> \
  --checkpoint counted.json \
  --output manifest.json
```

Review the maximum call and credit estimate printed by validation before using
`--execute`. Only a `ready` manifest may feed a later Cargo landing step.

## Provenance

The implementation is extracted from the reusable Sales Navigator slicing
engine developed for a private TAM operating-system project, with all client
configuration, company data, credentials, database code, and product UI
removed. The public repository contains only the generic algorithm, Cargo
count adapter, validation contract, examples, and tests.
