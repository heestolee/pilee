import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadPersistedStudyHardState, startStudyHardStudio, stopStudyHardStudios } from "../study-hard/studio.ts";
import type { FrameIdentity } from "../tft-commands/frame-identity.ts";
import { parseFrameV2Args } from "./artifact.ts";
import frameV2, { buildFrameV2Prompt, setFrameV2ForkRunnerForTests } from "./index.ts";

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

function readyFrame(identityKey: string) {
	return {
		version: 1,
		identity: { key: identityKey },
		goal: "Frame v2 구현",
		success_criteria: [{ id: "SC-1", statement: "ready", evidence_locator: "test" }],
		verify_plan: { commands: [], manual_checks: [] },
		implementation_plan: { status: "ready", derivedFrom: { decisionIds: [] }, slices: [], firstSafeStep: "start", readiness: {}, gates: [] },
		provenance: { canonicalHash: "frame-v2-test-hash", notes: ["Frame v2 test"] },
	};
}

test("Frame v2 prompt follows the selected entry lane without making learning a work gate", () => {
	const storageDir = "/tmp/frame-v2-prompt";
	const identity = testIdentity(storageDir);
	const invocation = parseFrameV2Args("--draft checkout", identity.key, "frame-first") as any;
	const prompt = buildFrameV2Prompt({
		args: "--draft checkout",
		cwd: "/tmp",
		identity,
		invocation,
		runId: "frame-v2-test",
		statePath: "/tmp/frame-v2-test.json",
		manifestPath: "/tmp/frame-v2.json",
	});
	assert.match(prompt, /selected entry lane: frame-first/);
	assert.match(prompt, /Frame-first lane/);
	assert.match(prompt, /before, alongside, or after implementation/);
	assert.match(prompt, /Do not create a Frame v2-specific hard gate/);
	assert.doesNotMatch(prompt, /Do not start implementation until/);
	assert.doesNotMatch(prompt, /TFT Studio first/);
	assert.match(prompt, /backend-layer-map/);
	assert.match(prompt, /architecture-flow/);
	assert.match(prompt, /data-model-migration-map/);
	assert.match(prompt, /type:"visual"/);
	assert.match(prompt, /Do not fetch it/);

	const studyInvocation = parseFrameV2Args("checkout", identity.key, "study-hard-first") as any;
	const studyPrompt = buildFrameV2Prompt({
		args: "checkout",
		cwd: "/tmp",
		identity,
		invocation: studyInvocation,
		runId: "frame-v2-study-test",
		statePath: "/tmp/frame-v2-study-test.json",
		manifestPath: "/tmp/frame-v2-study.json",
	});
	assert.match(studyPrompt, /selected entry lane: study-hard-first/);
	assert.match(studyPrompt, /Study-Hard-first lane/);
	assert.match(studyPrompt, /Check whether a standard frame\.json exists/);
	assert.match(studyPrompt, /Guided mode: follow the learning conversation/);
});

test("/frame-v2 registers independent command and persists command-context manifest", async () => {
	const root = mkdtempSync(join(tmpdir(), "frame-v2-command-"));
	const piDir = join(root, ".pi");
	const originalStateDir = process.env.STUDY_HARD_STATE_DIR;
	process.env.STUDY_HARD_STATE_DIR = join(root, "study-hard");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, "worktree-meta.json"), JSON.stringify({ name: "frame-v2-test", branch: "feature/test" }));

	let command: { description: string; handler: (args: string, ctx: any) => Promise<void> } | undefined;
	const tools = new Map<string, any>();
	const messages: Array<{ message: any; options: any }> = [];
	const notifications: Array<{ message: string; level: string }> = [];
	const selections: Array<{ title: string; options: string[] }> = [];
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
	assert.match(command!.description, /Frame.*Study Hard/);
	assert.deepEqual([...tools.keys()].sort(), ["frame_v2_state", "frame_v2_worktree_fork"]);

	const sessionFile = join(root, "session.jsonl");
	const ctx = {
		cwd: root,
		hasUI: false,
		sessionManager: {
			getSessionFile: () => sessionFile,
			getSessionName: () => "Frame v2 command test",
		},
		ui: {
			notify(message: string, level: string) { notifications.push({ message, level }); },
			async select(title: string, options: string[]) { selections.push({ title, options }); return options[0]; },
		},
	};

	try {
		await command!.handler("--draft checkout", ctx);
		assert.equal(messages.length, 1);
		assert.equal(messages[0]!.options.deliverAs, "followUp");
		assert.equal(messages[0]!.options.triggerTurn, true);
		assert.equal(messages[0]!.message.customType, "pilee-frame-v2-command");
		assert.equal(messages[0]!.message.display, false);
		assert.equal(messages[0]!.message.details.mode, "draft");
		assert.equal(messages[0]!.message.details.entryMode, "frame-first");
		assert.deepEqual(selections, [{ title: "어떤 방식으로 시작할까요?", options: ["Frame 먼저", "Study Hard 먼저"] }]);
		assert.ok(notifications.some((entry) => /Frame 먼저/.test(entry.message)));

		const manifestPath = join(piDir, "frame-v2.json");
		const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		assert.equal(manifest.status, "drafting");
		assert.equal(manifest.mode, "draft");
		assert.equal(manifest.entryMode, "frame-first");
		assert.match(manifest.studyHard.runId, /^frame-v2-/);
		await startStudyHardStudio(fakePi, ctx, {
			url: manifest.studyHard.sourceUrl,
			runId: manifest.studyHard.runId,
			title: "Frame v2 command test",
		});

		const toolCtx = { sessionManager: { getSessionFile: () => sessionFile } } as any;
		const blocked = await tools.get("frame_v2_state").execute("state-1", { action: "ready" }, new AbortController().signal, () => {}, toolCtx);
		assert.equal(blocked.details.blocked, true);
		assert.match(blocked.content[0].text, /frame\.json이 없습니다/);

		writeFileSync(join(piDir, "frame.json"), "{}\n");
		const invalid = await tools.get("frame_v2_state").execute("state-2", { action: "ready" }, new AbortController().signal, () => {}, toolCtx);
		assert.equal(invalid.details.blocked, true);
		assert.match(invalid.content[0].text, /version은 1/);

		writeFileSync(join(piDir, "frame.json"), `${JSON.stringify(readyFrame(manifest.identity.key), null, 2)}\n`);
		const ready = await tools.get("frame_v2_state").execute("state-3", { action: "ready" }, new AbortController().signal, () => {}, toolCtx);
		assert.equal(ready.details.manifest.status, "ready");
		const readyManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
		assert.equal(readyManifest.status, "ready");
		const companionPath = join(piDir, "learning-companion.json");
		assert.ok(existsSync(companionPath));
		const companion = JSON.parse(readFileSync(companionPath, "utf8"));
		assert.equal(companion.runId, manifest.studyHard.runId);
		assert.equal(companion.frame.path, join(piDir, "frame.json"));
		assert.equal(companion.frame.initialCanonicalHash, "frame-v2-test-hash");
		assert.equal(readyManifest.learningCompanion.manifestPath, companionPath);
		assert.equal(readyManifest.learningCompanion.companionId, companion.companionId);
		assert.equal(ready.details.companion.stateAttached, true);
		const learningState = loadPersistedStudyHardState(manifest.studyHard.runId);
		assert.equal(learningState?.companion?.companionId, companion.companionId);
		assert.equal(learningState?.companion?.events[0]?.kind, "frame_ready");
		assert.match(ready.content[0].text, /학습노트 companion/);

		let forkArgs = "";
		let continuation = "";
		setFrameV2ForkRunnerForTests(async (_pi, args, _ctx, options) => {
			forkArgs = args;
			continuation = options.afterSwitchFollowUp.content;
			return { status: "switched", name: "frame-v2-impl", branch: "feature/frame-v2-impl", path: "/tmp/frame-v2-impl", sessionFile: "/tmp/frame-v2-impl.jsonl", contextMode: "full" };
		});
		const forked = await tools.get("frame_v2_worktree_fork").execute("fork-ready", {}, new AbortController().signal, () => {}, toolCtx);
		assert.equal(forked.details.autoStarted, true);
		assert.match(forked.content[0].text, /Frame v2 구현 세션 시작/);
		assert.match(forkArgs, /--full-context/);
		assert.match(continuation, /promoted `.pi\/frame\.json`/);
		assert.match(continuation, /\.pi\/learning-companion\.json/);
		assert.match(continuation, /Study Hard state remains the learning canonical/);
		assert.equal(JSON.parse(readFileSync(manifestPath, "utf8")).status, "started");
	} finally {
		setFrameV2ForkRunnerForTests(undefined);
		stopStudyHardStudios();
		if (originalStateDir === undefined) delete process.env.STUDY_HARD_STATE_DIR;
		else process.env.STUDY_HARD_STATE_DIR = originalStateDir;
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
		ui: { notify() {}, async select(_title: string, options: string[]) { return options[1]; } },
	};
	try {
		await command.handler("checkout", ctx);
		assert.equal(JSON.parse(readFileSync(join(piDir, "frame-v2.json"), "utf8")).entryMode, "study-hard-first");
		const result = await tools.get("frame_v2_worktree_fork").execute("fork-1", {}, new AbortController().signal, () => {}, { sessionManager: { getSessionFile: () => sessionFile } });
		assert.equal(result.details.blocked, true);
		assert.match(result.content[0].text, /표준 frame\.json이 준비되지 않아/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
