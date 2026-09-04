---
name: salesnav-slicer
description: Open supplied LinkedIn Sales Navigator company-search URLs in Chrome, verify the active LinkedIn account, read result counts, recursively split oversized searches, and reconcile leaf counts with the parent. Use for browser-based Sales Navigator TAM slicing without Cargo, scraping APIs, extensions, extraction, enrichment, CRM writes, or outreach.
---

# Sales Navigator slicer

Turn one or more reviewed company-search URLs into a verified manifest:

```text
Chrome session -> parent count -> mutually exclusive slices -> leaf counts
  -> numerical reconciliation -> return to parent and account readback
```

This skill has no Cargo dependency and makes no provider API call. It uses the
user's existing Chrome and Sales Navigator session. The bundled scripts use
only Node.js built-ins; do not run `npm install`.

## Required inputs

- one or more exact `https://*.linkedin.com/sales/search/company` URLs;
- extraction cap, default `1000` and always interpreted strictly (`999` is
  acceptable, `1000` is not);
- optional expected LinkedIn display name or profile URL;
- optional pre-reviewed child URLs or partition dimensions.

## Browser workflow

1. Load the available computer-use guide, then open one new tab in **Chrome**.
   Reuse that tab for the complete run.
2. Navigate to the first parent URL. If LinkedIn requests login, seat selection,
   MFA or a challenge, pause for the user. Never request, store or type their
   password and never bypass a challenge.
3. Read the visible LinkedIn identity from the account/profile menu. Record the
   display name and profile URL when available. Stop on a mismatch with the
   expected identity.
4. Read the result-count text from the Sales Navigator UI and preserve both the
   visible text and parsed integer. Mark abbreviated values such as `52K+` as
   `exact: false`; do not present them as exact.
5. For every count at or above the cap, create mutually exclusive child
   searches with Sales Navigator's own filter UI, then capture each resulting
   address-bar URL. Never invent facet IDs or handcraft a filter from a label.
   Prefer a complete partition of already-selected geography, industry or
   company-headcount values. Recurse only on oversized children.
6. Return to the exact parent search. Reopen the account menu and verify that
   the LinkedIn identity did not change. Re-read the parent count if the run was
   long enough for results to drift.
7. Accept only a manifest whose leaves are all strictly below the cap and whose
   sum reconciles with an exact parent count. An abbreviated count, incomplete
   partition, changed identity, changed parent count or numerical delta is
   `review_required`, never silently `ready`.

If the user supplies several independent parent URLs, run this contract once
per URL and keep separate manifests. Do not sum overlapping parent searches.
Create the plan and browser-observation JSON as internal run artifacts; never
ask the user to write them.

## Deterministic helper

Use the helper to validate URL rewriting and drive the next browser count:

```bash
node scripts/slice-salesnav.mjs plan.json
node scripts/slice-salesnav.mjs plan.json --counts browser-counts.json \
  --output manifest.json
node scripts/verify-manifest.mjs manifest.json
```

When the helper returns `needs_browser_count`, open exactly the returned URL in
the same Chrome tab, record that observation under the returned key, and rerun.
Read [references/plan-schema.md](references/plan-schema.md) for the plan,
browser-observation and manifest contracts.

## Hard boundaries

- company searches only; reject `/sales/search/people`;
- no Cargo account, CLI, token, connector or credit;
- no scraping API, browser extension or LinkedIn cookie export;
- no company/contact extraction, enrichment, CRM mutation or outreach;
- no claim of exact reconciliation when Sales Navigator only exposes an
  abbreviated or changing count.
