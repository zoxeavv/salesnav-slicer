# Plan and browser observation schema

## Plan

```json
{
  "marketSearchUrl": "https://www.linkedin.com/sales/search/company?query=(filters:List(...))",
  "extractionCap": 1000,
  "maxSearches": 25,
  "reconciliationTolerance": 0,
  "dimensions": [
    {
      "id": "geography",
      "filterType": "REGION",
      "exhaustive": true,
      "buckets": [
        {
          "id": "market-a",
          "label": "Market A",
          "url": "https://www.linkedin.com/sales/search/company?query=(filters:List(...))"
        }
      ]
    }
  ]
}
```

- `marketSearchUrl` is the exact reviewed company-search URL.
- `extractionCap` defaults to `1000`; a count equal to the cap must be split.
- `maxSearches` bounds browser navigations for one parent.
- `reconciliationTolerance` defaults to `0`. Raise it only when the user
  explicitly accepts a non-zero numerical tolerance.
- `dimensions` are ordered partitions. Prefer a bucket `url` captured after
  applying that slice in the Sales Navigator UI. A bucket may instead contain
  `values` for deterministic URL rewriting, but those facet IDs must come from
  reviewed Sales Navigator URLs and never from guessed labels. Use exactly one
  of `url` or `values` per bucket.
- `exhaustive: true` asserts that the buckets cover the parent without overlap
  or gaps. If that cannot be proven, use `false` and expect `review_required`.

## Browser counts

The user never needs to author this JSON: the skill creates it as a run artifact
from the supplied parent URL and the child URLs captured in Chrome. The helper
returns the next required `{ key, path, url }`. Record the visible
observation under that key:

```json
{
  "browser": {
    "name": "Chrome",
    "initialAccount": {
      "displayName": "Visible LinkedIn name",
      "profileUrl": "https://www.linkedin.com/in/example/"
    },
    "finalAccount": {
      "displayName": "Visible LinkedIn name",
      "profileUrl": "https://www.linkedin.com/in/example/"
    },
    "finalUrl": "https://www.linkedin.com/sales/search/company?query=(filters:List(...))",
    "observedAt": "2026-09-04T13:00:00.000Z"
  },
  "counts": {
    "root": {
      "url": "https://www.linkedin.com/sales/search/company?query=(filters:List(...))",
      "display": "1,700 results",
      "count": 1700,
      "exact": true
    }
  }
}
```

For `52K+ results`, preserve that text, use the integer lower bound `52000` and
set `exact: false`. The final manifest must then remain `review_required`.

## Output states

- `needs_browser_count`: open the returned URL in the same Chrome tab and add
  the observation under the returned key.
- `ready`: all leaves are below the cap, every count is exact, the partition is
  exhaustive, the sum reconciles and the same LinkedIn account is visible after
  returning to the parent.
- `review_required`: slicing completed but a count, partition, identity or
  reconciliation condition is not proven.
- `blocked`: dimensions or the navigation ceiling were exhausted while an
  oversized branch remained.
