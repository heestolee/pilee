import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isCodexFastModeEnabled, shouldUseCodexFastBadge } from "./footer-state.ts";

test("footer badge follows canonical mode and exact effective model eligibility", () => {
	const root = mkdtempSync(join(tmpdir(), "fast-badge-"));
	const original = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	const cwd = join(root, "workspace"); mkdirSync(cwd);
	try {
		const save = (mode: string, priority = true) => writeFileSync(join(root, "settings.json"), JSON.stringify({ "pi-codex-fast": { mode, priority } }));
		save("fast");
		assert.equal(isCodexFastModeEnabled(cwd), true);
		assert.equal(shouldUseCodexFastBadge("openai-codex", true, "gpt-6.1-sol", cwd), false);
		assert.equal(shouldUseCodexFastBadge("openai-codex", true, "gpt-5.6-sol", cwd), true);
		assert.equal(shouldUseCodexFastBadge("openai-codex", true, "gpt-5.6-sol-preview", cwd), false);
		save("fast", false);
		assert.equal(shouldUseCodexFastBadge("openai-codex", true, "gpt-5.6-sol", cwd), false);
		assert.equal(shouldUseCodexFastBadge("openai-codex", true, "gpt-5.5", cwd), true, "legacy low verbosity remains effective");
		save("ultrafast");
		assert.equal(shouldUseCodexFastBadge("openai", true, "gpt-5.6-sol", cwd), true);
		assert.equal(shouldUseCodexFastBadge("openai-codex", true, "gpt-5.6-sol", cwd), false);
		save("off");
		assert.equal(isCodexFastModeEnabled(cwd), false);
		assert.equal(shouldUseCodexFastBadge("openai-codex", false, "gpt-5.5", cwd), false);
	} finally {
		if (original === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = original;
		rmSync(root, { recursive: true, force: true });
	}
});
