import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("Claude Code and Codex project skill entries resolve to the canonical skill", async () => {
	for (const entry of [
		join(ROOT, ".agents/skills/salesnav-slicer"),
		join(ROOT, ".claude/skills/salesnav-slicer"),
	]) {
		assert.equal(await realpath(entry), await realpath(ROOT));
	}
});
