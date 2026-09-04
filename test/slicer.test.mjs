import assert from "node:assert/strict";
import { test } from "node:test";

import {
	buildSalesNavigatorSliceManifest,
	setSalesNavigatorCompanyFilter,
	validateSalesNavigatorCompanySearchUrl,
} from "../scripts/slicer-core.mjs";

const MARKET_URL =
	"https://www.linkedin.com/sales/search/company?query=(filters:List((type:REGION,values:List((id:105015875,selectionType:INCLUDED),(id:100565514,selectionType:INCLUDED))),(type:ANNUAL_REVENUE,rangeValue:(min:10,max:200),selectedSubFilter:EUR)))&viewAllFilters=true";

const REQUEST = {
	marketSearchUrl: MARKET_URL,
	extractionCap: 1_000,
	maxSearches: 10,
	reconciliationTolerance: 0.05,
	dimensions: [
		{
			id: "geography",
			filterType: "REGION",
			exhaustive: true,
			buckets: [
				{ id: "market-a", label: "Market A", values: [{ id: "105015875" }] },
				{ id: "market-b", label: "Market B", values: [{ id: "100565514" }] },
			],
		},
		{
			id: "headcount",
			filterType: "COMPANY_HEADCOUNT",
			exhaustive: true,
			buckets: [
				{ id: "small", label: "Small", values: [{ id: "B" }, { id: "C" }] },
				{ id: "large", label: "Large", values: [{ id: "D" }, { id: "E" }] },
			],
		},
	],
};

test("accepts a company search and rejects unsafe URL shapes", () => {
	assert.equal(validateSalesNavigatorCompanySearchUrl(MARKET_URL).pathname, "/sales/search/company");
	assert.throws(
		() => validateSalesNavigatorCompanySearchUrl(MARKET_URL.replace("/company", "/people")),
		/\/sales\/search\/company/,
	);
	assert.throws(
		() =>
			validateSalesNavigatorCompanySearchUrl(
				MARKET_URL.replace("&viewAllFilters=true", ")&viewAllFilters=true"),
			),
		/unbalanced parentheses/,
	);
});

test("replaces one facet and preserves the remaining ICP filters", () => {
	const child = setSalesNavigatorCompanyFilter(MARKET_URL, "REGION", [{ id: "105015875" }]);
	const parsed = new URL(child);
	const query = parsed.searchParams.get("query");
	assert.match(query, /type:REGION,values:List\(\(id:105015875/);
	assert.doesNotMatch(query, /id:100565514/);
	assert.match(query, /type:ANNUAL_REVENUE/);
	assert.equal(parsed.searchParams.get("viewAllFilters"), "true");
});

test("uses a child URL captured directly from the Sales Navigator UI", async () => {
	const capturedChildUrl = setSalesNavigatorCompanyFilter(MARKET_URL, "REGION", [
		{ id: "105015875" },
	]);
	const request = {
		marketSearchUrl: MARKET_URL,
		extractionCap: 1_000,
		dimensions: [
			{
				id: "captured",
				filterType: "REGION",
				exhaustive: true,
				buckets: [{ id: "market-a", label: "Market A", url: capturedChildUrl }],
			},
		],
	};
	const visited = [];
	const manifest = await buildSalesNavigatorSliceManifest(request, async (url) => {
		visited.push(url);
		return url === MARKET_URL ? 1_100 : 900;
	});

	assert.deepEqual(visited, [MARKET_URL, capturedChildUrl]);
	assert.equal(manifest.leaves[0].url, capturedChildUrl);
});

test("recurses to a ready manifest whose leaves are strictly below the cap", async () => {
	const counts = new Map([
		["root", 1_700],
		["geography:market-a", 1_300],
		["geography:market-a/headcount:small", 700],
		["geography:market-a/headcount:large", 600],
		["geography:market-b", 400],
	]);
	const manifest = await buildSalesNavigatorSliceManifest(REQUEST, async (_url, path) => {
		const count = counts.get(path.length === 0 ? "root" : path.join("/"));
		assert.notEqual(count, undefined);
		return count;
	});

	assert.equal(manifest.status, "ready");
	assert.deepEqual(
		manifest.leaves.map((leaf) => leaf.count),
		[700, 600, 400],
	);
	assert.ok(manifest.leaves.every((leaf) => leaf.count < 1_000));
	assert.equal(manifest.countCalls, 5);
	assert.equal(manifest.reconciliationDelta, 0);
});

test("a count equal to the cap remains blocked", async () => {
	const manifest = await buildSalesNavigatorSliceManifest(
		{ marketSearchUrl: MARKET_URL, extractionCap: 1_000, dimensions: [] },
		async () => 1_000,
	);
	assert.equal(manifest.status, "blocked");
	assert.equal(manifest.leaves.length, 0);
	assert.equal(manifest.blocked[0].reason, "no_remaining_dimensions");
});

test("a non-exhaustive split requires human review", async () => {
	const manifest = await buildSalesNavigatorSliceManifest(
		{ ...REQUEST, dimensions: [{ ...REQUEST.dimensions[0], exhaustive: false }] },
		async (url) => (url === MARKET_URL ? 1_100 : 550),
	);
	assert.equal(manifest.status, "review_required");
	assert.deepEqual(manifest.warnings, ["dimension geography is not declared exhaustive"]);
});

test("checkpointed counts are reused without recounting", async () => {
	const marketA = setSalesNavigatorCompanyFilter(MARKET_URL, "REGION", [{ id: "105015875" }]);
	const marketB = setSalesNavigatorCompanyFilter(MARKET_URL, "REGION", [{ id: "100565514" }]);
	const newlyCounted = [];
	const manifest = await buildSalesNavigatorSliceManifest(
		REQUEST,
		async (url) => {
			newlyCounted.push(url);
			return url.includes("id%3AB") ? 700 : 600;
		},
		{
			seedCountedSearches: [
				{ url: MARKET_URL, count: 1_700, path: [] },
				{ url: marketA, count: 1_300, path: ["geography:market-a"] },
				{ url: marketB, count: 400, path: ["geography:market-b"] },
			],
		},
	);
	assert.equal(newlyCounted.length, 2);
	assert.equal(manifest.reusedCountCalls, 3);
	assert.equal(manifest.executedCountCalls, 2);
});
