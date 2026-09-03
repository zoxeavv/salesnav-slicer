---
name: cargo-salesnav-slicer
description: Count and recursively split an oversized LinkedIn Sales Navigator company search into a reviewed under-cap URL manifest using Cargo searchCompanyMetrics. Use when a Cargo TAM search may exceed the 1,000-company extraction cap. Do not use for people searches, extraction, enrichment, CRM writes, or outreach.
---

# Cargo Sales Navigator slicer

Produce a design-time manifest for Cargo:

```text
reviewed company-search URL -> count -> split -> recount -> under-cap URLs
```

The script never extracts companies or writes to Cargo models. Only `--execute`
invokes Cargo, and it invokes `salesNavigator.searchCompanyMetrics` for bounded
counts.

## Workflow

1. Obtain the exact reviewed `https://*.linkedin.com/sales/search/company` URL.
   Do not convert a people search and do not invent LinkedIn facet IDs.
2. Copy `examples/plan.example.json` and replace the parent URL and buckets with
   reviewed, mutually exclusive facets. Prefer industry, then geography, then
   headcount when the available taxonomy supports that order.
3. Validate without spending credits:

   ```bash
   node scripts/slice-salesnav.mjs plan.json
   ```

4. Before a live count, show `maxSearches` and `maxEstimatedCountCredits`. Run
   only after the user explicitly authorizes the bounded Cargo count:

   ```bash
   node scripts/slice-salesnav.mjs plan.json --execute \
     --checkpoint counted.json --output manifest.json
   ```

   Add `--connector-uuid <uuid>` when the Cargo workspace has multiple Sales
   Navigator connections. Resume an interrupted run with
   `--resume counted.json`.
5. Accept the manifest only when `status` is `ready`, `blocked` is empty, every
   leaf count is strictly below `extractionCap`, and the reconciliation ratio is
   within the plan tolerance. `review_required` and `blocked` are stop states.

## Dogfood without Cargo spend

Run the same recursive engine with deterministic counts:

```bash
npm run dogfood
```

This must return `status: ready`, three leaves below `1000`, and a zero
reconciliation delta. It proves URL rewriting, recursion, limits, and manifest
verification; it does not prove live Cargo access or current provider pricing.

Read [references/plan-schema.md](references/plan-schema.md) when creating or
reviewing a plan. A generated manifest is not authorization to run
`fetchAccountSearch`, enrich accounts, promote rows, mutate a CRM, or contact
anyone.
