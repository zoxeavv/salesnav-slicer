const DEFAULT_EXTRACTION_CAP = 1_000;
const DEFAULT_MAX_SEARCHES = 25;
const DEFAULT_RECONCILIATION_TOLERANCE = 0;

export function validateSalesNavigatorCompanySearchUrl(input) {
	let url;
	try {
		url = new URL(input);
	} catch {
		throw new Error("marketSearchUrl must be an absolute URL");
	}

	if (url.protocol !== "https:") {
		throw new Error("marketSearchUrl must use https");
	}
	if (url.hostname !== "linkedin.com" && !url.hostname.endsWith(".linkedin.com")) {
		throw new Error("marketSearchUrl must use a linkedin.com host");
	}
	if (url.pathname !== "/sales/search/company") {
		throw new Error("marketSearchUrl must target /sales/search/company");
	}

	const location = locateSalesNavigatorQuery(url);
	const query = location.params.get("query");
	if (!query || !query.startsWith("(") || !query.endsWith(")")) {
		throw new Error("marketSearchUrl must contain a structured Sales Navigator query");
	}
	if (matchingParenthesis(query, 0) !== query.length - 1) {
		throw new Error("Sales Navigator query contains unbalanced parentheses");
	}

	return url;
}

export function setSalesNavigatorCompanyFilter(input, filterType, values) {
	const url = validateSalesNavigatorCompanySearchUrl(input);
	assertFilterType(filterType);
	assertFacetValues(values);

	const location = locateSalesNavigatorQuery(url);
	const query = location.params.get("query");
	if (!query) {
		throw new Error("Sales Navigator query is missing");
	}

	location.params.set("query", upsertFilter(query, filterType, values));
	if (location.kind === "search") {
		url.search = location.params.toString();
	} else {
		url.hash = location.params.toString();
	}

	return url.toString();
}

export function validateSalesNavigatorSliceRequest(request) {
	if (!request || typeof request !== "object") {
		throw new Error("plan must be a JSON object");
	}
	validateSalesNavigatorCompanySearchUrl(request.marketSearchUrl);

	const extractionCap = request.extractionCap ?? DEFAULT_EXTRACTION_CAP;
	if (!Number.isInteger(extractionCap) || extractionCap < 1 || extractionCap > 1_000) {
		throw new Error("extractionCap must be an integer between 1 and 1000");
	}

	const maxSearches = request.maxSearches ?? DEFAULT_MAX_SEARCHES;
	if (!Number.isInteger(maxSearches) || maxSearches < 1) {
		throw new Error("maxSearches must be a positive integer");
	}

	const tolerance = request.reconciliationTolerance ?? DEFAULT_RECONCILIATION_TOLERANCE;
	if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 1) {
		throw new Error("reconciliationTolerance must be between 0 and 1");
	}

	if (!Array.isArray(request.dimensions)) {
		throw new Error("dimensions must be an array");
	}

	const dimensionIds = new Set();
	for (const dimension of request.dimensions) {
		if (!dimension.id?.trim()) {
			throw new Error("every dimension must have an id");
		}
		if (dimensionIds.has(dimension.id)) {
			throw new Error(`duplicate dimension id: ${dimension.id}`);
		}
		dimensionIds.add(dimension.id);
		assertFilterType(dimension.filterType);
		if (!Array.isArray(dimension.buckets) || dimension.buckets.length === 0) {
			throw new Error(`dimension ${dimension.id} must contain at least one bucket`);
		}

		const bucketIds = new Set();
		const partitionValues = new Set();
		for (const bucket of dimension.buckets) {
			if (!bucket.id?.trim() || !bucket.label?.trim()) {
				throw new Error(`dimension ${dimension.id} has an invalid bucket`);
			}
			if (bucketIds.has(bucket.id)) {
				throw new Error(`duplicate bucket id in ${dimension.id}: ${bucket.id}`);
			}
			bucketIds.add(bucket.id);
			const hasCapturedUrl = typeof bucket.url === "string" && bucket.url.trim().length > 0;
			const hasFacetValues = bucket.values !== undefined;
			if (hasCapturedUrl === hasFacetValues) {
				throw new Error(
					`bucket ${dimension.id}:${bucket.id} must contain exactly one of url or values`,
				);
			}
			if (hasCapturedUrl) validateSalesNavigatorCompanySearchUrl(bucket.url);
			else assertFacetValues(bucket.values);
			if (bucket.whenPathIncludes !== undefined && !bucket.whenPathIncludes.trim()) {
				throw new Error(`dimension ${dimension.id} has an empty path condition`);
			}

			if (dimension.exhaustive && hasFacetValues) {
				for (const value of bucket.values) {
					if (partitionValues.has(value.id)) {
						throw new Error(
							`exhaustive dimension ${dimension.id} has overlapping value ${value.id}`,
						);
					}
					partitionValues.add(value.id);
				}
			}
		}
	}
}

export async function buildSalesNavigatorSliceManifest(request, countSearch, options = {}) {
	validateSalesNavigatorSliceRequest(request);

	const extractionCap = request.extractionCap ?? DEFAULT_EXTRACTION_CAP;
	const maxSearches = request.maxSearches ?? DEFAULT_MAX_SEARCHES;
	const tolerance = request.reconciliationTolerance ?? DEFAULT_RECONCILIATION_TOLERANCE;
	const leaves = [];
	const blocked = [];
	const countedSearches = [];
	const usedDimensionIds = new Set();
	const countCache = new Map();
	for (const seed of options.seedCountedSearches ?? []) {
		if (!Number.isInteger(seed.count) || seed.count < 0) {
			throw new Error(`seed count is invalid for ${seed.url}`);
		}
		if (!countCache.has(seed.url)) {
			countCache.set(seed.url, seed.count);
			countedSearches.push(seed);
		}
	}
	const reusedCountCalls = countedSearches.length;
	let executedCountCalls = 0;

	const counted = async (url, path) => {
		const cached = countCache.get(url);
		if (cached !== undefined) {
			return cached;
		}
		if (countCache.size >= maxSearches) {
			blocked.push({ url, count: null, path, reason: "max_searches_reached" });
			return null;
		}

		const result = await countSearch(url, path);
		if (!Number.isInteger(result) || result < 0) {
			throw new Error(`countSearch returned an invalid count for ${url}`);
		}
		const search = { url, count: result, path };
		countCache.set(url, result);
		countedSearches.push(search);
		executedCountCalls += 1;
		await options.onCounted?.(search);
		return result;
	};

	const visit = async (url, path, dimensionIndex) => {
		const count = await counted(url, path);
		if (count === null) return;
		if (count < extractionCap) {
			leaves.push({ url, count, path });
			return;
		}

		const dimension = request.dimensions[dimensionIndex];
		if (!dimension) {
			blocked.push({ url, count, path, reason: "no_remaining_dimensions" });
			return;
		}

		const applicableBuckets = dimension.buckets.filter(
			(bucket) => !bucket.whenPathIncludes || path.includes(bucket.whenPathIncludes),
		);
		if (applicableBuckets.length === 0) {
			blocked.push({ url, count, path, reason: "no_remaining_dimensions" });
			return;
		}

		usedDimensionIds.add(dimension.id);
		for (const bucket of applicableBuckets) {
			const childUrl = bucket.url
				? validateSalesNavigatorCompanySearchUrl(bucket.url).toString()
				: setSalesNavigatorCompanyFilter(url, dimension.filterType, bucket.values);
			await visit(childUrl, [...path, `${dimension.id}:${bucket.id}`], dimensionIndex + 1);
		}
	};

	await visit(request.marketSearchUrl, [], 0);

	const sourceCount = countedSearches[0]?.count ?? 0;
	const leavesTotalResults = leaves.reduce((total, leaf) => total + leaf.count, 0);
	const reconciliationDelta = leavesTotalResults - sourceCount;
	const reconciliationRatio = sourceCount === 0 ? 0 : Math.abs(reconciliationDelta) / sourceCount;
	const warnings = [];

	for (const dimensionId of usedDimensionIds) {
		const dimension = request.dimensions.find((candidate) => candidate.id === dimensionId);
		if (dimension && !dimension.exhaustive) {
			warnings.push(`dimension ${dimensionId} is not declared exhaustive`);
		}
	}
	if (reconciliationRatio > tolerance) {
		warnings.push(
			`leaf counts differ from the source by ${(reconciliationRatio * 100).toFixed(1)}%`,
		);
	}

	const status = blocked.length > 0 ? "blocked" : warnings.length > 0 ? "review_required" : "ready";

	return {
		status,
		marketSearchUrl: request.marketSearchUrl,
		extractionCap,
		maxSearches,
		reconciliationTolerance: tolerance,
		sourceCount,
		countCalls: countedSearches.length,
		reusedCountCalls,
		executedCountCalls,
		leavesCount: leaves.length,
		leavesTotalResults,
		reconciliationDelta,
		reconciliationRatio,
		usedDimensionIds: [...usedDimensionIds],
		leaves,
		blocked,
		countedSearches,
		warnings,
	};
}

function locateSalesNavigatorQuery(url) {
	if (url.searchParams.has("query")) {
		return { kind: "search", params: new URLSearchParams(url.search) };
	}

	const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
	const hashParams = new URLSearchParams(hash);
	if (hashParams.has("query")) {
		return { kind: "hash", params: hashParams };
	}

	throw new Error("marketSearchUrl must contain a query parameter");
}

function upsertFilter(query, filterType, values) {
	const filter = buildFilter(filterType, values);
	const marker = "filters:List(";
	const markerIndex = query.indexOf(marker);
	if (markerIndex === -1) {
		const inner = query.slice(1, -1);
		return `(filters:List(${filter})${inner ? `,${inner}` : ""})`;
	}

	const openIndex = markerIndex + marker.length - 1;
	const closeIndex = matchingParenthesis(query, openIndex);
	const items = splitTopLevel(query.slice(openIndex + 1, closeIndex));
	const typePattern = new RegExp(`(?:^|[,(])type:${escapeRegExp(filterType)}(?:[,)]|$)`);
	const existingIndex = items.findIndex((item) => typePattern.test(item));
	if (existingIndex === -1) items.push(filter);
	else items[existingIndex] = filter;

	return `${query.slice(0, openIndex + 1)}${items.join(",")}${query.slice(closeIndex)}`;
}

function buildFilter(filterType, values) {
	const encodedValues = values
		.map(
			(value) =>
				`(id:${value.id}${value.text ? `,text:${value.text}` : ""},selectionType:INCLUDED)`,
		)
		.join(",");
	return `(type:${filterType},values:List(${encodedValues}))`;
}

function matchingParenthesis(input, openIndex) {
	let depth = 0;
	for (let index = openIndex; index < input.length; index += 1) {
		if (input[index] === "(") depth += 1;
		else if (input[index] === ")") {
			depth -= 1;
			if (depth === 0) return index;
		}
	}
	throw new Error("Sales Navigator query contains unbalanced parentheses");
}

function splitTopLevel(input) {
	const items = [];
	let depth = 0;
	let start = 0;
	for (let index = 0; index < input.length; index += 1) {
		if (input[index] === "(") depth += 1;
		else if (input[index] === ")") depth -= 1;
		else if (input[index] === "," && depth === 0) {
			items.push(input.slice(start, index));
			start = index + 1;
		}
	}
	items.push(input.slice(start));
	return items.filter(Boolean);
}

function assertFilterType(filterType) {
	if (typeof filterType !== "string" || !/^[A-Z][A-Z_]*$/.test(filterType)) {
		throw new Error(`invalid Sales Navigator filter type: ${filterType}`);
	}
}

function assertFacetValues(values) {
	if (!Array.isArray(values) || values.length === 0) {
		throw new Error("a slice bucket must contain at least one facet value");
	}
	const ids = new Set();
	for (const value of values) {
		if (!value || typeof value.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(value.id)) {
			throw new Error(`invalid Sales Navigator facet id: ${value?.id}`);
		}
		if (ids.has(value.id)) {
			throw new Error(`duplicate Sales Navigator facet id: ${value.id}`);
		}
		if (value.text !== undefined && (!value.text.trim() || /[()]/.test(value.text))) {
			throw new Error(`invalid Sales Navigator facet text: ${value.text}`);
		}
		ids.add(value.id);
	}
}

function escapeRegExp(input) {
	return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
