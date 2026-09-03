# Plan schema

## Input

```json
{
  "marketSearchUrl": "https://www.linkedin.com/sales/search/company?query=(filters:List(...))",
  "extractionCap": 1000,
  "maxSearches": 10,
  "reconciliationTolerance": 0.05,
  "dimensions": [
    {
      "id": "geography",
      "filterType": "REGION",
      "exhaustive": true,
      "buckets": [
        {
          "id": "market-a",
          "label": "Market A",
          "values": [{ "id": "reviewed-linkedin-facet-id" }]
        }
      ]
    }
  ]
}
```

## Fields

- `marketSearchUrl`: exact reviewed Sales Navigator company-search URL.
- `extractionCap`: integer from 1 to 1000. A result equal to the cap remains
  truncated and must be split.
- `maxSearches`: hard ceiling on total count calls, including resumed counts.
- `reconciliationTolerance`: accepted absolute difference between the parent
  count and the sum of leaves, expressed as a ratio.
- `dimensions`: ordered partition strategies. Each dimension replaces one Sales
  Navigator filter in the parent query.
- `exhaustive`: assert `true` only when the buckets cover the parent dimension
  without gaps. Duplicate facet values are rejected.
- `whenPathIncludes`: optionally apply a bucket only below one prior path, such
  as `industry:manufacturing`.
- `values[].text`: retain a provider-required facet label when Sales Navigator
  includes it, for example a headcount band.

## Output states

- `ready`: no oversized branch remains and no review warning exists.
- `review_required`: the engine completed but a partition or reconciliation
  warning requires human review.
- `blocked`: a branch exhausted its dimensions or the count-call ceiling.

The credit estimate defaults to `0.25` per Cargo count call. It is a planning
estimate, not a live billing quote; verify current Cargo billing before running
`--execute`.
