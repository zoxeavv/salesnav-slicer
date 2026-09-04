#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
	buildSalesNavigatorSliceManifest,
	validateSalesNavigatorCompanySearchUrl,
	validateSalesNavigatorSliceRequest,
} from "./slicer-core.mjs";

class NeedsBrowserCountError extends Error {
	constructor(url, path) {
		super(`Sales Navigator count required for ${pathKey(path)}`);
		this.name = "NeedsBrowserCountError";
		this.nextSearch = { key: pathKey(path), path, url };
	}
}

async function main() {
	const args = process.argv.slice(2);
	const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
	const inputPath = positionalArgument(args);
	const outputPath = flagValue(args, "--output");
	const countsPath = flagValue(args, "--counts");
	const fixturePath = flagValue(args, "--fixture");

	if (!inputPath) {
		throw new Error(
			"Usage: node scripts/slice-salesnav.mjs <plan.json> [--counts browser-counts.json | --fixture counts.json] [--output manifest.json]",
		);
	}
	for (const flag of ["--output", "--counts", "--fixture"]) {
		if (args.includes(flag) && !flagValue(args, flag)) throw new Error(`${flag} requires a value`);
	}
	if (countsPath && fixturePath) throw new Error("--counts and --fixture are mutually exclusive");

	const request = JSON.parse(await readFile(resolve(invocationDirectory, inputPath), "utf8"));
	validateSalesNavigatorSliceRequest(request);

	if (!countsPath && !fixturePath) {
		writeJson({
			status: "validated_not_counted",
			message:
				"Open the parent URL in Chrome, record Sales Navigator UI counts, then pass --counts.",
			marketSearchUrl: request.marketSearchUrl,
			dimensions: request.dimensions.map((dimension) => dimension.id),
			maxSearches: request.maxSearches ?? 25,
		});
		return;
	}

	const isFixture = Boolean(fixturePath);
	const sourcePath = fixturePath ?? countsPath;
	const source = JSON.parse(await readFile(resolve(invocationDirectory, sourcePath), "utf8"));
	const counts = isFixture ? source : source.counts;
	if (!counts || typeof counts !== "object" || Array.isArray(counts)) {
		throw new Error(`${isFixture ? "fixture" : "browser counts"} must contain a count map`);
	}

	const observationsByKey = new Map();
	const countSearch = async (url, path) => {
		const key = pathKey(path);
		const raw = counts[key];
		if (raw === undefined) throw new NeedsBrowserCountError(url, path);
		const observation = normalizeCountObservation(raw, key, url, isFixture);
		observationsByKey.set(key, observation);
		return observation.count;
	};

	let manifest;
	try {
		manifest = await buildSalesNavigatorSliceManifest(request, countSearch);
	} catch (error) {
		if (error instanceof NeedsBrowserCountError) {
			writeJson({
				status: "needs_browser_count",
				countSource: "sales-navigator-ui",
				nextSearch: error.nextSearch,
				recordedCountKeys: [...observationsByKey.keys()],
			});
			return;
		}
		throw error;
	}

	const approximateKeys = [...observationsByKey.entries()]
		.filter(([, observation]) => !observation.exact)
		.map(([key]) => key);
	const warnings = [...manifest.warnings];
	if (approximateKeys.length > 0) {
		warnings.push(`abbreviated Sales Navigator counts: ${approximateKeys.join(", ")}`);
	}

	const browser = isFixture ? undefined : validateBrowserReadback(source.browser, request.marketSearchUrl);
	const result = {
		...manifest,
		status: manifest.blocked.length > 0 ? "blocked" : warnings.length > 0 ? "review_required" : "ready",
		countSource: isFixture ? "fixture" : "sales-navigator-ui",
		countsExact: approximateKeys.length === 0,
		warnings,
		...(browser ? { browser } : {}),
	};
	const serialized = `${JSON.stringify(result, null, 2)}\n`;
	if (outputPath) {
		await writeFile(resolve(invocationDirectory, outputPath), serialized, "utf8");
	}
	process.stdout.write(serialized);
}

function normalizeCountObservation(raw, key, expectedUrl, isFixture) {
	if (Number.isInteger(raw) && raw >= 0) {
		if (!isFixture) {
			throw new Error(`browser count ${key} must include count, display, exact and url`);
		}
		return { count: raw, display: String(raw), exact: true, url: expectedUrl };
	}
	if (!raw || typeof raw !== "object") {
		throw new Error(`count ${key} must be a non-negative integer or observation object`);
	}
	if (!Number.isInteger(raw.count) || raw.count < 0) {
		throw new Error(`count ${key} must contain a non-negative integer`);
	}
	if (!sameSalesNavigatorSearch(raw.url, expectedUrl)) {
		throw new Error(`count ${key} was observed on a different Sales Navigator URL`);
	}
	if (typeof raw.display !== "string" || !raw.display.trim()) {
		throw new Error(`count ${key} must preserve the visible Sales Navigator count text`);
	}
	if (typeof raw.exact !== "boolean") {
		throw new Error(`count ${key} must declare whether the visible count is exact`);
	}
	return { count: raw.count, display: raw.display, exact: raw.exact, url: raw.url };
}

function validateBrowserReadback(browser, parentUrl) {
	if (!browser || typeof browser !== "object") {
		throw new Error("browser counts must include final Chrome and LinkedIn account readback");
	}
	if (browser.name !== "Chrome") throw new Error("browser readback must come from Chrome");
	const initialAccount = validateAccount(browser.initialAccount, "initialAccount");
	const finalAccount = validateAccount(browser.finalAccount, "finalAccount");
	if (accountKey(initialAccount) !== accountKey(finalAccount)) {
		throw new Error("LinkedIn account changed during the slicing run");
	}
	if (!sameSalesNavigatorSearch(browser.finalUrl, parentUrl)) {
		throw new Error("Chrome did not return to the parent Sales Navigator search");
	}
	if (typeof browser.observedAt !== "string" || Number.isNaN(Date.parse(browser.observedAt))) {
		throw new Error("browser readback must include an ISO observedAt timestamp");
	}
	return { ...browser, initialAccount, finalAccount };
}

function validateAccount(value, field) {
	if (!value || typeof value !== "object" || !value.displayName?.trim()) {
		throw new Error(`${field} must include the visible LinkedIn display name`);
	}
	if (value.profileUrl !== undefined) {
		const profile = new URL(value.profileUrl);
		if (!profile.hostname.endsWith("linkedin.com")) {
			throw new Error(`${field}.profileUrl must use linkedin.com`);
		}
	}
	return value;
}

function accountKey(account) {
	return account.profileUrl ?? account.displayName.trim().toLocaleLowerCase();
}

function sameSalesNavigatorSearch(candidate, parent) {
	const candidateUrl = validateSalesNavigatorCompanySearchUrl(candidate);
	const parentUrl = validateSalesNavigatorCompanySearchUrl(parent);
	return queryValue(candidateUrl) === queryValue(parentUrl);
}

function queryValue(url) {
	if (url.searchParams.has("query")) return url.searchParams.get("query");
	const params = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : url.hash);
	return params.get("query");
}

function pathKey(path) {
	return path.length === 0 ? "root" : path.join("/");
}

function positionalArgument(args) {
	for (let index = 0; index < args.length; index += 1) {
		if (args[index].startsWith("--")) {
			index += 1;
			continue;
		}
		return args[index];
	}
	return undefined;
}

function flagValue(args, flag) {
	const index = args.indexOf(flag);
	return index === -1 ? undefined : args[index + 1];
}

function writeJson(value) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
	process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
