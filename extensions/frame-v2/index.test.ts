import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FrameIdentity } from "../tft-commands/frame-identity.ts";
import { parseFrameV2Args } from "./artifact.ts";
import frameV2, { buildFrameV2Prompt } from "./index.ts";

function testIdentity(storageDir: string): FrameIdentity {
	return {
		mode: "planning-session",
		key: "planning:session:frame-v2-prompt-test",
		displayTitle: "Planning · Frame v2 prompt test",
		storageDir,
		cwd: "/tmp",
		reason: "test",
		sessionFile: "/tmp/frame-v2-session.jsonl",
	};
}

test("Frame v2 prompt keeps two-stage visual/refinement and work-start gates", () => {
	const storageDir = "/tmp/frame-v2-prompt";
	const identity = testIdentity(storageDir);
	const invocation = parseFrameV2Args("--draft checkout", identity.key) as any;
	const prompt = buildFrameV2Prompt({
		args: "--draft checkout",
		cwd: "/tmp",
		identity,
		invocation,
		runId: "frame-v2-test",
		statePath: "/tmp/frame-v2-test.json",
		manifestPath: "/tmp/frame-v2.json",
	});
	assert.match(prompt, /Draft-first mode/);
	assert.match(prompt, /TFT Studio first/);
	assert.match(prompt, /Study Hard board for refinement/);
	assert.match(prompt, /backend-layer-map/);
	assert.match(prompt, /architecture-flow/);
	assert.match(prompt, /data-model-migration-map/);
	assert.match(prompt, /frame_v2_state action=ready/);
	assert.match(prompt, /frame_v2_worktree_fork/);
	assert.match(prompt, /Do not fetch it/);
});

test("/frame-v2 registers independent command and persists command-context manifest", async () => {
	const root = mkdtempSync(join(tmpdir(), "frame-v2-command-"));
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, "worktree-meta.json"), JSON.stringify({ name: "frame-v2-test", branch: "feature/test" }));

	let command: { description: string; handler: (args: string, ctx: any) => Promise<void> } | undefined;
	const tools = new Map<string, any>();
	const messages: Array<{ message: any; options: any }> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const fakePi = {
		registerCommand(name: string, options: any) {
			if (name === "frame-v2") command = options;
		},
		registerTool(tool: any) {
			tools.set(tool.name, tool);
		},
		sendMessage(message: any, options: any) {
			messages.push({ message, options });
		},
	} as any;
	frameV2(fakePi);
	assert.ok(command);
	assert.match(command!.description, /Study Hard refinement/);
	assert.deepEqual([...tools.keys()].sort(), ["frame_v2_state", "frame_v2_worktree_fork"]);

	const sessionFile = join(root, "session.jsonl");
	const ctx = {
		cwd: root,
		hasUI: false,
		sessionManager: {
			getSessionFile: () => sessionFile,
			getSessionName: () => "Frame v2 command test",
		},
		ui: { notify(message: string, level: string) { notifications.push({ message, level }); } },
	};

	try {
		await command!.handler("--draft checkout", ctx);
		assert.equal(messages.length, 1);
		assert.equal(messages[0]!.options.deliverAs, "followUp");
		assert.equal(messages[0]!.options.triggerTurn, true);
		assert.equal(messages[0]!.message.customType, "pilee-frame-v2-command");
		assert.equal(messages[0]!.message.display, false);
		assert.equal(messages[0]!.message.details.mode, "draft");
		assert.ok(notifications.some((entry) => /초안 먼저/.test(entry.message)));

		const manifestPath = join(piDir, "frame-v2.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		assert.equal(manifest.status, "drafting");
		assert.equal(manifest.mode, "draft");
		assert.match(manifest.studyHard.runId, /^frame-v2-/);

		const toolCtx = { sessionManager: { getSessionFile: () => sessionFile } } as any;
		const blocked = await tools.get("frame_v2_state").execute("state-1", { action: "ready" }, new AbortController().signal, () => {}, toolCtx);
		assert.equal(blocked.details.blocked, true);
		assert.match(blocked.content[0].text, /frame\.json이 없습니다/);

		writeFileSync(join(piDir, "frame.json"), "{}\n");
		const ready = await tools.get("frame_v2_state").execute("state-2", { action: "ready" }, new AbortController().signal, () => {}, toolCtx);
		assert.equal(ready.details.manifest.status, "ready");
		assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).status, "ready");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Frame v2 fork tool blocks before canonical frame readiness", async () => {
	const root = mkdtempSync(join(tmpdir(), "frame-v2-fork-block-"));
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, "worktree-meta.json"), JSON.stringify({ name: "frame-v2-block", branch: "feature/block" }));
	let command: any;
	const tools = new Map<string, any>();
	const fakePi = {
		registerCommand(name: string, options: any) { if (name === "frame-v2") command = options; },
		registerTool(tool: any) { tools.set(tool.name, tool); },
		sendMessage() {},
	} as any;
	frameV2(fakePi);
	const sessionFile = join(root, "session.jsonl");
	const ctx = {
		cwd: root,
		hasUI: false,
		sessionManager: { getSessionFile: () => sessionFile, getSessionName: () => "Frame v2 block" },
		ui: { notify() {} },
	};
	try {
		await command.handler("checkout", ctx);
		const result = await tools.get("frame_v2_worktree_fork").execute("fork-1", {}, new AbortController().signal, () => {}, { sessionManager: { getSessionFile: () => sessionFile } });
		assert.equal(result.details.blocked, true);
		assert.match(result.content[0].text, /표준 frame\.json이 없어/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
