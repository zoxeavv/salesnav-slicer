import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { buildSalesNavigatorSliceManifest } from "../scripts/slicer-core.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_PATH = join(ROOT, "examples/plan.example.json");
const FIXTURE_PATH = join(ROOT, "examples/dogfood-counts.json");

test("browser mode asks for the next URL, then verifies one Chrome session", async () => {
	const plan = JSON.parse(await readFile(PLAN_PATH, "utf8"));
	const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "salesnav-slicer-"));
	const countsPath = join(temporaryDirectory, "counts.json");
	await writeFile(countsPath, JSON.stringify({ counts: {} }), "utf8");

	const first = runCli([PLAN_PATH, "--counts", countsPath]);
	assert.equal(first.status, 0, first.stderr);
	assert.equal(JSON.parse(first.stdout).status, "needs_browser_count");
	assert.equal(JSON.parse(first.stdout).nextSearch.key, "root");

	const fixtureManifest = await buildSalesNavigatorSliceManifest(plan, async (_url, path) => {
		const key = path.length === 0 ? "root" : path.join("/");
		return fixture[key];
	});
	const counts = Object.fromEntries(
		fixtureManifest.countedSearches.map((search) => [
			search.path.length === 0 ? "root" : search.path.join("/"),
			{ url: search.url, display: `${search.count} results`, count: search.count, exact: true },
		]),
	);
	const browser = {
		name: "Chrome",
		initialAccount: {
			displayName: "Test Account",
			profileUrl: "https://www.linkedin.com/in/test-account/",
		},
		finalAccount: {
			displayName: "Test Account",
			profileUrl: "https://www.linkedin.com/in/test-account/",
		},
		finalUrl: plan.marketSearchUrl,
		observedAt: "2026-09-04T13:00:00.000Z",
	};
	await writeFile(countsPath, JSON.stringify({ browser, counts }), "utf8");

	const complete = runCli([PLAN_PATH, "--counts", countsPath]);
	assert.equal(complete.status, 0, complete.stderr);
	const manifest = JSON.parse(complete.stdout);
	assert.equal(manifest.status, "ready");
	assert.equal(manifest.countSource, "sales-navigator-ui");
	assert.equal(manifest.countsExact, true);
	assert.equal(manifest.reconciliationDelta, 0);
	assert.equal(manifest.browser.initialAccount.displayName, "Test Account");

	counts.root.exact = false;
	counts.root.display = "1.7K+ results";
	await writeFile(countsPath, JSON.stringify({ browser, counts }), "utf8");
	const approximate = runCli([PLAN_PATH, "--counts", countsPath]);
	assert.equal(approximate.status, 0, approximate.stderr);
	assert.equal(JSON.parse(approximate.stdout).status, "review_required");
});

test("browser mode rejects a changed LinkedIn account", async () => {
	const plan = JSON.parse(await readFile(PLAN_PATH, "utf8"));
	const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
	const fixtureManifest = await buildSalesNavigatorSliceManifest(plan, async (_url, path) => {
		const key = path.length === 0 ? "root" : path.join("/");
		return fixture[key];
	});
	const counts = Object.fromEntries(
		fixtureManifest.countedSearches.map((search) => [
			search.path.length === 0 ? "root" : search.path.join("/"),
			{ url: search.url, display: `${search.count} results`, count: search.count, exact: true },
		]),
	);
	const temporaryDirectory = await mkdtemp(join(tmpdir(), "salesnav-slicer-"));
	const countsPath = join(temporaryDirectory, "counts.json");
	await writeFile(
		countsPath,
		JSON.stringify({
			browser: {
				name: "Chrome",
				initialAccount: { displayName: "Account A" },
				finalAccount: { displayName: "Account B" },
				finalUrl: plan.marketSearchUrl,
				observedAt: "2026-09-04T13:00:00.000Z",
			},
			counts,
		}),
		"utf8",
	);

	const result = runCli([PLAN_PATH, "--counts", countsPath]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /LinkedIn account changed/);
});

function runCli(args) {
	return spawnSync(process.execPath, [join(ROOT, "scripts/slice-salesnav.mjs"), ...args], {
		cwd: ROOT,
		encoding: "utf8",
	});
}
