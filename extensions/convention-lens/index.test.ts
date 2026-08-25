import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import type { ConventionLensProfile } from "../utils/private-profiles.ts";
import { __test, registerConventionLens } from "./index.ts";
import { CONVENTION_LENS_FOLLOWUP_MARKER } from "./reviewer.ts";

const execFileAsync = promisify(execFile);

async function git(root: string, ...args: string[]) {
	await execFileAsync("git", args, { cwd: root });
}

async function withRepo(run: (root: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "convention-lens-index-"));
	try {
		await git(root, "init", "-q");
		await git(root, "config", "user.name", "Test");
		await git(root, "config", "user.email", "test@example.com");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src/service.ts"), "export function find() { return 1; }\n");
		await git(root, "add", ".");
		await git(root, "commit", "-qm", "base");
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

function harness(profile: ConventionLensProfile, options: { stateDir?: string } = {}) {
	const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	const entries: Array<{ customType: string; data: any }> = [];
	const tools: any[] = [];
	const commands: any[] = [];
	const messages: Array<{ message: any; options: any }> = [];
	const pi = {
		on(name: string, handler: (event: any, ctx: any) => unknown) {
			handlers.set(name, [...(handlers.get(name) ?? []), handler]);
		},
		registerTool(tool: any) { tools.push(tool); },
		registerCommand(name: string, command: any) { commands.push({ name, ...command }); },
		appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
		sendMessage(message: any, sendOptions: any) { messages.push({ message, options: sendOptions }); },
		async exec(command: string, args: string[], execOptions: { cwd: string }) {
			try {
				const result = await execFileAsync(command, args, { cwd: execOptions.cwd, encoding: "utf8" });
				return { stdout: result.stdout, stderr: result.stderr, code: 0 };
			} catch (error: any) {
				return { stdout: error.stdout ?? "", stderr: error.stderr ?? error.message, code: error.code ?? 1 };
			}
		},
	} as any;
	let tick = 1_000;
	registerConventionLens(pi, { profiles: [profile], stateDir: options.stateDir, disableStateFile: true, now: () => ++tick });
	return {
		pi,
		entries,
		tools,
		commands,
		messages,
		async emit(name: string, ctx: any, event: any = {}) {
			const results = [];
			for (const handler of handlers.get(name) ?? []) results.push(await handler(event, ctx));
			return results;
		},
	};
}

function context(root: string) {
	return {
		cwd: root,
		mode: "tui",
		hasUI: false,
		ui: { notify() {} },
		sessionManager: { getEntries: () => [], getSessionFile: () => join(root, ".session.jsonl") },
	} as any;
}

test("agent_settled shadow trigger는 명령 없이 changed diff의 lens를 기록한다", async () => {
	await withRepo(async (root) => {
		const cards = join(root, "cards");
		await mkdir(cards);
		await writeFile(join(cards, "lock.md"), `---
id: row-lock
kind: decision-lens
status: candidate
authority: personal-precedent
signals: [FOR UPDATE, LOCK.UPDATE]
applies_to: [src/**/*.ts]
---
# Row Lock

## Trigger
FOR UPDATE
`);
		const profile: ConventionLensProfile = {
			id: "fixture",
			mode: "shadow",
			packs: [{ id: "cards", kind: "markdown-cards", rootDir: cards, authority: "personal-precedent" }],
			candidateThreshold: 4,
			maxSelectedNodes: 3,
		};
		const h = harness(profile);
		const ctx = context(root);
		await h.emit("session_start", ctx, { reason: "startup" });
		await h.emit("agent_start", ctx);
		await writeFile(join(root, "src/service.ts"), "export function find() { return 'FOR UPDATE LOCK.UPDATE'; }\n");
		await h.emit("agent_settled", ctx);

		assert.ok(h.tools.some((tool) => tool.name === "convention_lens"));
		assert.ok(h.commands.some((command) => command.name === "convention"));
		assert.equal(h.entries.length, 1);
		assert.equal(h.entries[0]?.customType, "convention-lens-state");
		assert.equal(h.entries[0]?.data.status, "shadow");
		assert.equal(h.entries[0]?.data.selected[0]?.id, "row-lock");
		assert.deepEqual(h.entries[0]?.data.paths, ["src/service.ts"]);
	});
});

test("변경 없음과 같은 fingerprint는 visible turn 없이 skip/suppress한다", async () => {
	await withRepo(async (root) => {
		const cards = join(root, "cards");
		await mkdir(cards);
		await writeFile(join(cards, "type.md"), `---
id: type-contract
status: candidate
signals: [as unknown as]
---
# Type Contract
`);
		const profile: ConventionLensProfile = {
			id: "fixture",
			mode: "shadow",
			packs: [{ id: "cards", kind: "markdown-cards", rootDir: cards, authority: "personal-precedent" }],
		};
		const h = harness(profile);
		const ctx = context(root);
		await h.emit("session_start", ctx, { reason: "startup" });
		await h.emit("agent_start", ctx);
		await h.emit("agent_settled", ctx);
		assert.equal(h.entries[0]?.data.reason, "no-run-change");
		assert.equal(h.entries[0]?.data.selected.length, 0);
	});
});

test("repair mode는 main agent follow-up을 자동 전달하고 다음 settle에서 완료를 기록한다", async () => {
	await withRepo(async (root) => {
		const cards = join(root, "cards");
		const stateDir = join(root, "state");
		await mkdir(cards);
		await writeFile(join(cards, "type.md"), `---
id: type-contract
kind: decision-lens
authority: team-convention
status: reviewed
signals: [as unknown as]
applies_to: [src/**/*.ts]
---
# Type Contract
`);
		const profile: ConventionLensProfile = {
			id: "fixture",
			mode: "repair",
			maxCycles: 2,
			packs: [{ id: "cards", kind: "markdown-cards", rootDir: cards, authority: "team-convention", defaultStatus: "reviewed" }],
		};
		const h = harness(profile, { stateDir });
		const ctx = context(root);
		await h.emit("session_start", ctx, { reason: "startup" });
		await h.emit("agent_start", ctx);
		await writeFile(join(root, "src/service.ts"), "export const value = input as unknown as Result;\n");
		await h.emit("agent_settled", ctx);
		assert.equal(h.entries[0]?.data.status, "review-started");
		assert.equal(h.messages.length, 1);
		assert.equal(h.messages[0]?.message.customType, "convention-lens-review");
		assert.equal(h.messages[0]?.options.triggerTurn, true);
		assert.match(h.messages[0]?.message.content, /AUTO_FIX는 reviewed lens/);
		assert.match(h.messages[0]?.message.content, new RegExp(CONVENTION_LENS_FOLLOWUP_MARKER));
		const blocked = await h.emit("tool_call", ctx, { toolName: "edit", input: { path: "src/service.ts" } });
		assert.match(blocked.find(Boolean)?.reason ?? "", /action=submit/);

		const artifact = JSON.parse(await readFile(h.messages[0]!.message.details.artifactPath, "utf8"));
		const evidenceId = artifact.evidence.lines.find((line: any) => line.kind === "addition").id;
		const tool = h.tools.find((candidate) => candidate.name === "convention_lens");
		const submitted = await tool.execute("submit-1", {
			action: "submit",
			verdict: "AUTO_FIX",
			summary: "과한 assertion을 제거한다.",
			findings: [{
				id: "CL-1",
				verdict: "AUTO_FIX",
				lensIds: ["type-contract"],
				evidenceIds: [evidenceId],
				confidence: "high",
				recommendation: "실제 producer 타입으로 좁힌다.",
				validation: ["targeted type test"],
			}],
		});
		assert.equal(submitted.details.submission.repairAuthorized, true);
		assert.equal((await h.emit("tool_call", ctx, { toolName: "edit", input: { path: "src/service.ts" } })).find(Boolean), undefined);

		await h.emit("before_agent_start", ctx, { prompt: h.messages[0]?.message.content });
		await h.emit("agent_start", ctx);
		await writeFile(join(root, "src/service.ts"), "export const value: Result = input;\n");
		await h.emit("agent_settled", ctx);
		assert.ok(h.entries.some((entry) => entry.data.status === "review-done" && entry.data.reason === "submission:AUTO_FIX"));
	});
});

test("focused consumer query는 명시 seed를 최우선 lens로 projection한다", async () => {
	await withRepo(async (root) => {
		const cards = join(root, "cards");
		await mkdir(cards);
		await writeFile(join(cards, "type.md"), `---
id: type-contract
status: candidate
signals: [as unknown as]
---
# Type Contract
`);
		const profile: ConventionLensProfile = {
			id: "fixture",
			mode: "shadow",
			packs: [{ id: "cards", kind: "markdown-cards", rootDir: cards, authority: "personal-precedent" }],
			consumers: [{ id: "type-refine", role: "focused", seedIds: ["type-contract"] }],
		};
		const h = harness(profile);
		const ctx = context(root);
		await h.emit("session_start", ctx, { reason: "startup" });
		const tool = h.tools.find((candidate) => candidate.name === "convention_lens");
		const result = await tool.execute("query-1", { action: "query", query: "unrelated words", consumerId: "type-refine" });
		assert.equal(result.details.selection.candidates[0].node.id, "type-contract");
		assert.deepEqual(result.details.selection.candidates[0].reasons, ["consumer:type-refine"]);
	});
});

test("print/json mode는 background reviewer를 시작하지 않고 fail-open record를 남긴다", async () => {
	await withRepo(async (root) => {
		const cards = join(root, "cards");
		await mkdir(cards);
		await writeFile(join(cards, "type.md"), `---
id: type-contract
status: reviewed
signals: [as unknown as]
---
# Type Contract
`);
		const profile: ConventionLensProfile = {
			id: "fixture",
			mode: "review",
			packs: [{ id: "cards", kind: "markdown-cards", rootDir: cards, authority: "team-convention", defaultStatus: "reviewed" }],
		};
		const h = harness(profile);
		const ctx = context(root);
		ctx.mode = "print";
		await h.emit("session_start", ctx, { reason: "startup" });
		await h.emit("agent_start", ctx);
		await writeFile(join(root, "src/service.ts"), "export const value = input as unknown as Result;\n");
		await h.emit("agent_settled", ctx);
		assert.equal(h.messages.length, 0);
		assert.equal(h.entries[0]?.data.status, "review-error");
		assert.equal(h.entries[0]?.data.reason, "non-persistent-mode");
	});
});

test("submit 전 bash gate는 read-only stderr discard를 허용하고 실제 write를 막는다", () => {
	assert.equal(__test.isMutatingBash("rg TODO src 2>/dev/null"), false);
	assert.equal(__test.isMutatingBash("git diff -- src/a.ts"), false);
	assert.equal(__test.isMutatingBash("cat result > output.txt"), true);
	assert.equal(__test.isMutatingBash("git commit -m test"), true);
});

test("session restore는 최신 no-change record 뒤의 reviewed fingerprint도 복원한다", () => {
	const record = (timestamp: number, diffFingerprint?: string) => ({
		schemaVersion: 1,
		timestamp,
		profileId: "fixture",
		mode: "shadow",
		cwdHash: "cwd",
		paths: [],
		selected: [],
		status: "skipped",
		latencyMs: 1,
		diffFingerprint,
	});
	const restored = __test.restoreRuntimeRecords({
		sessionManager: {
			getEntries: () => [
				{ type: "custom", customType: "convention-lens-state", data: record(1, "reviewed-hash") },
				{ type: "custom", customType: "convention-lens-state", data: record(2) },
			],
		},
	} as any);
	assert.equal(restored.lastRecord?.timestamp, 2);
	assert.equal(restored.lastFingerprint, "reviewed-hash");
});
