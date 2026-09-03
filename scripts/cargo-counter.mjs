import { spawn } from "node:child_process";

export function createCargoSearchCompanyMetricsCounter(options = {}) {
	const binary = options.binary ?? "cargo-ai";
	const timeoutMs = options.timeoutMs ?? 90_000;
	const pollingIntervalMs = options.pollingIntervalMs ?? 5_000;

	return async (url) => {
		const payload = await executeCargo(
			binary,
			url,
			timeoutMs,
			pollingIntervalMs,
			options.env,
			options.connectorUuid,
		);
		return extractCargoTotalResults(payload);
	};
}

export function buildCargoSearchCompanyMetricsArgs(
	url,
	connectorUuid,
	waitUntilFinished = true,
) {
	const action = JSON.stringify({
		kind: "connector",
		integrationSlug: "salesNavigator",
		actionSlug: "searchCompanyMetrics",
		...(connectorUuid ? { connectorUuid } : {}),
	});
	const data = JSON.stringify({ url });
	const args = ["orchestration", "action", "execute", "--action", action, "--data", data];
	if (waitUntilFinished) args.splice(3, 0, "--wait-until-finished");
	return args;
}

export function extractCargoTotalResults(payload) {
	const result = findTotalResults(payload);
	if (result === null) {
		throw new Error("Cargo response did not contain total_results");
	}
	return result;
}

async function executeCargo(binary, url, timeoutMs, pollingIntervalMs, env, connectorUuid) {
	const submitted = await executeCargoCommand(
		binary,
		buildCargoSearchCompanyMetricsArgs(url, connectorUuid, false),
		env,
	);
	const runUuid = findRunUuid(submitted);
	const workflowUuid = findWorkflowUuid(submitted);
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const payload = await executeCargoCommand(
			binary,
			["orchestration", "run", "get", runUuid],
			env,
		);
		const status = findRunStatus(payload);
		if (status === "success") return payload;
		if (["error", "cancelled", "skipped"].includes(status)) {
			throw new Error(`Cargo count run ${runUuid} finished with status ${status}`);
		}
		await delay(pollingIntervalMs);
	}

	await executeCargoCommand(
		binary,
		[
			"orchestration",
			"run",
			"cancel",
			"--workflow-uuid",
			workflowUuid,
			"--uuids",
			runUuid,
		],
		env,
	);
	throw new Error(`Cargo count run ${runUuid} timed out after ${timeoutMs}ms and was cancelled`);
}

async function executeCargoCommand(binary, args, env) {
	return await new Promise((resolve, reject) => {
		const child = spawn(binary, args, {
			env: env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
		});
		let stdout = "";
		let stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString("utf8");
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`Cargo count failed (${code ?? "unknown"}): ${stderr.slice(-1_000)}`));
				return;
			}
			try {
				resolve(parseCargoJson(stdout));
			} catch (error) {
				reject(error);
			}
		});
	});
}

function findRunUuid(value) {
	const uuid = findNestedString(value, "uuid");
	if (!uuid) throw new Error("Cargo action submission did not return a run UUID");
	return uuid;
}

function findWorkflowUuid(value) {
	const workflowUuid = findNestedString(value, "workflowUuid");
	if (!workflowUuid) throw new Error("Cargo action submission did not return a workflow UUID");
	return workflowUuid;
}

function findRunStatus(value) {
	const status = findNestedString(value, "status");
	if (!status) throw new Error("Cargo run readback did not return a status");
	return status;
}

function findNestedString(value, key) {
	if (Array.isArray(value)) {
		for (const item of value) {
			const result = findNestedString(item, key);
			if (result) return result;
		}
		return null;
	}
	if (!value || typeof value !== "object") return null;
	if (typeof value[key] === "string") return value[key];
	for (const candidate of Object.values(value)) {
		const result = findNestedString(candidate, key);
		if (result) return result;
	}
	return null;
}

function parseCargoJson(stdout) {
	const firstBrace = stdout.indexOf("{");
	if (firstBrace === -1) throw new Error("Cargo count returned no JSON payload");
	try {
		return JSON.parse(stdout.slice(firstBrace));
	} catch {
		throw new Error("Cargo count returned invalid JSON");
	}
}

function findTotalResults(value) {
	if (Array.isArray(value)) {
		for (const item of value) {
			const result = findTotalResults(item);
			if (result !== null) return result;
		}
		return null;
	}
	if (!value || typeof value !== "object") return null;
	for (const key of ["total_results", "totalResults"]) {
		const candidate = value[key];
		if (typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0) {
			return candidate;
		}
	}
	for (const candidate of Object.values(value)) {
		const result = findTotalResults(candidate);
		if (result !== null) return result;
	}
	return null;
}

async function delay(milliseconds) {
	await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
