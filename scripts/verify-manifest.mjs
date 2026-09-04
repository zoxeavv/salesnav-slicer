#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

async function main() {
	const manifestPath = process.argv[2];
	if (!manifestPath) throw new Error("Usage: node scripts/verify-manifest.mjs <manifest.json>");
	const manifest = JSON.parse(await readFile(resolve(process.cwd(), manifestPath), "utf8"));
	const failures = [];

	if (manifest.status !== "ready") failures.push(`status is ${manifest.status ?? "missing"}`);
	if (!Array.isArray(manifest.blocked) || manifest.blocked.length > 0) {
		failures.push("blocked nodes are present or invalid");
	}
	if (!Array.isArray(manifest.leaves) || manifest.leaves.length === 0) {
		failures.push("no leaves were emitted");
	} else if (
		manifest.leaves.some(
			(leaf) => !Number.isInteger(leaf.count) || leaf.count < 0 || leaf.count >= manifest.extractionCap,
		)
	) {
		failures.push("at least one leaf is invalid or not strictly below extractionCap");
	}
	if (!Number.isInteger(manifest.countCalls) || manifest.countCalls > manifest.maxSearches) {
		failures.push("countCalls exceeds maxSearches or is invalid");
	}
	if (!Array.isArray(manifest.warnings) || manifest.warnings.length > 0) {
		failures.push("warnings are present or invalid");
	}
	if (
		!Number.isFinite(manifest.reconciliationRatio) ||
		manifest.reconciliationRatio > manifest.reconciliationTolerance
	) {
		failures.push("reconciliation ratio exceeds tolerance");
	}
	if (manifest.countSource === "sales-navigator-ui") {
		if (manifest.countsExact !== true) failures.push("browser counts are not all exact");
		if (manifest.browser?.name !== "Chrome") failures.push("browser readback is not Chrome");
		const initialAccount = accountKey(manifest.browser?.initialAccount);
		const finalAccount = accountKey(manifest.browser?.finalAccount);
		if (!initialAccount || initialAccount !== finalAccount) {
			failures.push("LinkedIn account identity is missing or changed");
		}
	}

	if (failures.length > 0) throw new Error(failures.join("; "));
	process.stdout.write(
		`${JSON.stringify({
			status: "verified",
			leaves: manifest.leaves.length,
			countCalls: manifest.countCalls,
			maxLeafCount: Math.max(...manifest.leaves.map((leaf) => leaf.count)),
			reconciliationDelta: manifest.reconciliationDelta,
		})}\n`,
	);
}

function accountKey(account) {
	if (!account?.displayName?.trim()) return null;
	return account.profileUrl ?? account.displayName.trim().toLocaleLowerCase();
}

main().catch((error) => {
	process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
