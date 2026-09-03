#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createCargoSearchCompanyMetricsCounter } from "./cargo-counter.mjs";
import {
	buildSalesNavigatorSliceManifest,
	CARGO_SEARCH_COMPANY_METRICS_CREDIT_ESTIMATE,
	validateSalesNavigatorSliceRequest,
} from "./slicer-core.mjs";

async function main() {
	const args = process.argv.slice(2);
	const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
	const inputPath = positionalArgument(args);
	const outputPath = flagValue(args, "--output");
	const connectorUuid = flagValue(args, "--connector-uuid");
	const resumePath = flagValue(args, "--resume");
	const checkpointPath = flagValue(args, "--checkpoint");
	const fixturePath = flagValue(args, "--fixture");
	const execute = args.includes("--execute");

	if (!inputPath) {
		throw new Error(
			"Usage: node scripts/slice-salesnav.mjs <plan.json> [--execute | --fixture counts.json] [--connector-uuid uuid] [--resume counted.json] [--checkpoint counted.json] [--output manifest.json]",
		);
	}
	for (const flag of ["--output", "--connector-uuid", "--resume", "--checkpoint", "--fixture"]) {
		if (args.includes(flag) && !flagValue(args, flag)) throw new Error(`${flag} requires a value`);
	}
	if (execute && fixturePath) throw new Error("--execute and --fixture are mutually exclusive");

	const request = JSON.parse(await readFile(resolve(invocationDirectory, inputPath), "utf8"));
	validateSalesNavigatorSliceRequest(request);

	if (!execute && !fixturePath) {
		writeJson({
			status: "validated_not_executed",
			message: "Pass --execute for bounded Cargo counts or --fixture for deterministic dogfood.",
			marketSearchUrl: request.marketSearchUrl,
			dimensions: request.dimensions.map((dimension) => dimension.id),
			maxSearches: request.maxSearches ?? 25,
			maxEstimatedCountCredits:
				(request.maxSearches ?? 25) * CARGO_SEARCH_COMPANY_METRICS_CREDIT_ESTIMATE,
			creditEstimateBasis:
				"0.25 credit per searchCompanyMetrics call; verify live Cargo billing before execution",
		});
		return;
	}

	const seedCountedSearches = resumePath
		? readCountedSearches(
				JSON.parse(await readFile(resolve(invocationDirectory, resumePath), "utf8")),
			)
		: [];
	const checkpointedSearches = [...seedCountedSearches];
	let countSearch;
	if (fixturePath) {
		const fixture = JSON.parse(
			await readFile(resolve(invocationDirectory, fixturePath), "utf8"),
		);
		countSearch = async (_url, path) => {
			const key = path.length === 0 ? "root" : path.join("/");
			const count = fixture[key];
			if (!Number.isInteger(count) || count < 0) {
				throw new Error(`fixture is missing a non-negative integer count for ${key}`);
			}
			return count;
		};
	} else {
		countSearch = createCargoSearchCompanyMetricsCounter({ connectorUuid });
	}

	const manifest = await buildSalesNavigatorSliceManifest(request, countSearch, {
		seedCountedSearches,
		onCounted: checkpointPath
			? async (search) => {
					checkpointedSearches.push(search);
					await writeFile(
						resolve(invocationDirectory, checkpointPath),
						`${JSON.stringify({ countedSearches: checkpointedSearches }, null, 2)}\n`,
						"utf8",
					);
				}
			: undefined,
	});
	const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
	if (outputPath) {
		await writeFile(resolve(invocationDirectory, outputPath), serialized, "utf8");
	}
	process.stdout.write(serialized);
}

function positionalArgument(args) {
	for (let index = 0; index < args.length; index += 1) {
		if (args[index].startsWith("--")) {
			if (args[index] !== "--execute") index += 1;
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

function readCountedSearches(value) {
	if (!value || typeof value !== "object" || !Array.isArray(value.countedSearches)) {
		throw new Error("resume file must contain countedSearches");
	}
	return value.countedSearches;
}

function writeJson(value) {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

main().catch((error) => {
	process.stderr.write(`ERROR: ${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
