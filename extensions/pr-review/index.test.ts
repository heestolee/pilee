import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPrReviewQuestion } from "./chat.ts";
import { captureCurrentWorkRun, captureGitHubPrRun, parseGitHubPrUrl, registerPrReview } from "./index.ts";

const DIFF = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,4 +1,5 @@
 export function visible(status: string) {
-  return status !== "HIDDEN";
+  const allowed = new Set(["OPEN", "READY"]);
+  return allowed.has(status);
 }
`;

function fixture() {
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const messages: Array<{ message: any; options: any }> = [];
	const entries: Array<{ customType: string; data: any }> = [];
	const execCalls: Array<{ command: string; args: string[] }> = [];
	const pi = {
		registerCommand(name: string, value: any) { commands.set(name, value); },
		registerTool(value: any) { tools.set(value.name, value); },
		on() {},
		async exec(command: string, args: string[]) {
			execCalls.push({ command, args });
			if (args[1] === "view") {
				return {
					code: 0,
					stdout: JSON.stringify({
						number: 42,
						title: "Visibility contract",
						url: "https://github.com/acme/repo/pull/42",
						body: "Do not expose future states.",
						author: { login: "author" },
						baseRefName: "main",
						baseRefOid: "base1234",
						headRefName: "feature/visibility",
						headRefOid: "head1234567890",
						state: "OPEN",
						isDraft: false,
						mergeable: "MERGEABLE",
					}),
					stderr: "",
				};
			}
			return { code: 0, stdout: DIFF, stderr: "" };
		},
		sendMessage(message: any, options: any) { messages.push({ message, options }); },
		appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
	} as any;
	return { pi, commands, tools, messages, entries, execCalls };
}

test("parseGitHubPrUrl accepts canonical and changes URLs", () => {
	assert.deepEqual(parseGitHubPrUrl("https://github.com/creatrip/product/pull/4919/changes"), {
		url: "https://github.com/creatrip/product/pull/4919",
		owner: "creatrip",
		repo: "product",
		number: 4919,
	});
	assert.throws(() => parseGitHubPrUrl("https://example.com/a/b/pull/1"), /github.com/);
	assert.throws(() => parseGitHubPrUrl("https://github.com/a/b/issues/1"), /owner\/repo\/pull/);
});

test("meta_review_chat answer는 완료된 Q&A를 owner Pi session에 visible transcript로 남긴다", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-chat-visible-"));
	try {
		const { pi, tools, entries } = fixture();
		registerPrReview(pi, { stateRoot, now: () => 1000 });
		const state = await captureGitHubPrRun(pi, "/tmp", parseGitHubPrUrl("https://github.com/acme/repo/pull/42"), stateRoot, 1000);
		const question = createPrReviewQuestion(state.runDir, {
			runId: state.runId,
			question: "이 변경이 호출자에게 어떤 영향을 주나?",
			scope: "session",
		}, 1100);
		const result = await tools.get("meta_review_chat").execute("call-answer", {
			action: "answer",
			runId: state.runId,
			questionId: question.id,
			answer: "허용 상태 이외의 호출 결과가 숨겨집니다.",
			evidence: [{ label: "정책 구현", path: "src/example.ts", line: 2 }],
		}, undefined, undefined, { cwd: "/tmp" });
		assert.equal(result.details.question.status, "answered");
		assert.equal(entries.length, 1);
		assert.equal(entries[0].data.display, true);
		assert.match(entries[0].data.content, /Meta Review 답변/);
		assert.match(entries[0].data.content, /허용 상태 이외의 호출 결과/);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("captureCurrentWorkRun captures branch plus working changes without requiring Frame", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-current-"));
	try {
		const pi = {
			async exec(command: string, args: string[]) {
				if (command === "gh") return { code: 1, stdout: "", stderr: "no PR" };
				if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: "/tmp/acme-repo\n", stderr: "" };
				if (args[0] === "branch") return { code: 0, stdout: "feature/current\n", stderr: "" };
				if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: "head1234567890\n", stderr: "" };
				if (args[0] === "symbolic-ref") return { code: 0, stdout: "origin/development\n", stderr: "" };
				if (args[0] === "merge-base" && args[2] === "origin/development") return { code: 0, stdout: "base1234567890\n", stderr: "" };
				if (args[0] === "merge-base") return { code: 1, stdout: "", stderr: "" };
				if (args[0] === "diff") return { code: 0, stdout: DIFF, stderr: "" };
				if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
				if (args[0] === "remote") return { code: 0, stdout: "git@github.com:acme/repo.git\n", stderr: "" };
				throw new Error(`unexpected ${command} ${args.join(" ")}`);
			},
		} as any;
		const state = await captureCurrentWorkRun(pi, "/tmp/acme-repo", stateRoot, 900);
		assert.equal(state.target.kind, "current-work");
		assert.equal(state.target.branch, "feature/current");
		assert.equal(state.target.baseRefName, "development");
		assert.equal(state.target.number, 0);
		assert.match(readFileSync(state.diffPath, "utf8"), /allowed/);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("/meta-review without args opens current work in the Study Hard code review surface", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-current-command-"));
	try {
		const commands = new Map<string, any>();
		const tools = new Map<string, any>();
		const messages: any[] = [];
		const opened: any[] = [];
		const pi = {
			registerCommand(name: string, value: any) { commands.set(name, value); },
			registerTool(value: any) { tools.set(value.name, value); },
			on() {},
			sendMessage(message: any, options: any) { messages.push({ message, options }); },
			async exec(command: string, args: string[]) {
				if (command === "gh") return { code: 1, stdout: "", stderr: "no PR" };
				if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: "/tmp/acme-repo\n", stderr: "" };
				if (args[0] === "branch") return { code: 0, stdout: "feature/current\n", stderr: "" };
				if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: "head1234567890\n", stderr: "" };
				if (args[0] === "symbolic-ref") return { code: 0, stdout: "origin/development\n", stderr: "" };
				if (args[0] === "merge-base" && args[2] === "origin/development") return { code: 0, stdout: "base1234567890\n", stderr: "" };
				if (args[0] === "merge-base") return { code: 1, stdout: "", stderr: "" };
				if (args[0] === "diff") return { code: 0, stdout: DIFF, stderr: "" };
				if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
				if (args[0] === "remote") return { code: 0, stdout: "git@github.com:acme/repo.git\n", stderr: "" };
				throw new Error(`unexpected ${command} ${args.join(" ")}`);
			},
		} as any;
		registerPrReview(pi, { stateRoot, now: () => 1000, openMetaReview: async (_pi, _ctx, state) => { opened.push(state); return { studio: { url: "http://127.0.0.1/review" }, studyRunId: "study-current" } as any; } });
		await commands.get("meta-review").handler("", { cwd: "/tmp/acme-repo", hasUI: true, ui: { notify() {}, setStatus() {} } });
		assert.equal(opened.length, 1);
		assert.equal(opened[0].target.kind, "current-work");
		assert.equal(messages.length, 1);
		assert.equal(messages[0].message.customType, "pilee-meta-review-command");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("/meta-review captures one PR from any cwd and sends the inlined workflow", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-pr-review-command-"));
	try {
		const { pi, commands, tools, messages, execCalls } = fixture();
		registerPrReview(pi, { stateRoot, now: () => 1000 });
		assert.ok(commands.has("meta-review"));
		assert.equal(commands.has("pr-review"), false);
		assert.ok(tools.has("meta_review_run"));
		assert.ok(tools.has("meta_review_chat"));
		const notifications: Array<{ message: string; level: string }> = [];
		const statuses: Array<[string, string | undefined]> = [];
		await commands.get("meta-review").handler("https://github.com/acme/repo/pull/42/changes", {
			cwd: "/tmp",
			ui: {
				notify(message: string, level: string) { notifications.push({ message, level }); },
				setStatus(key: string, value?: string) { statuses.push([key, value]); },
			},
		});
		assert.deepEqual(execCalls.map((call) => call.args.slice(0, 4)), [
			["pr", "view", "42", "--repo"],
			["pr", "diff", "42", "--repo"],
		]);
		assert.equal(messages.length, 1);
		assert.equal(messages[0]?.options.deliverAs, "followUp");
		assert.equal(messages[0]?.options.triggerTurn, true);
		assert.equal(messages[0]?.message.customType, "pilee-meta-review-command");
		assert.equal(messages[0]?.message.display, false);
		assert.match(messages[0]?.message.content, /meta-review/);
		assert.match(messages[0]?.message.content, /Do not expose future states/);
		assert.equal(notifications.at(-1)?.level, "info");
		assert.deepEqual(statuses.at(-1), ["meta-review", undefined]);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("/meta-review hands a UI invocation to a head-pinned review workspace session", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-pr-review-workspace-command-"));
	try {
		const { pi, commands, messages } = fixture();
		const requests: any[] = [];
		registerPrReview(pi, {
			stateRoot,
			now: () => 1500,
			reviewWorkspaceRunner: async (_pi, _ctx, request) => {
				requests.push(request);
				return { status: "activated", name: "review-pr-42-head1234", branch: "review/pr-42-head1234", path: "/tmp/review-pr-42", sessionFile: "/tmp/review.jsonl", reused: false, activation: { status: "activated", panelLabel: "P1", placement: "right" } };
			},
		});
		await commands.get("meta-review").handler("https://github.com/acme/repo/pull/42", {
			cwd: "/tmp",
			hasUI: true,
			ui: { notify() {}, setStatus() {} },
		});
		assert.equal(requests.length, 1);
		assert.equal(requests[0].repo, "repo");
		assert.equal(requests[0].number, 42);
		assert.equal(requests[0].baseSha, "base1234");
		assert.equal(requests[0].headSha, "head1234567890");
		assert.match(requests[0].afterSwitchFollowUp.content, /meta_review_run.*open/);
		assert.match(requests[0].afterSwitchFollowUp.content, /\.pi\/review-context\.json/);
		assert.equal(messages.length, 0);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("meta_review_run refresh appends a safe linear incremental revision", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-refresh-tool-"));
	try {
		const commands = new Map<string, any>();
		const tools = new Map<string, any>();
		const messages: any[] = [];
		let captureIndex = 0;
		const pi = {
			registerCommand(name: string, value: any) { commands.set(name, value); },
			registerTool(value: any) { tools.set(value.name, value); },
			on() {},
			sendMessage(message: any, options: any) { messages.push({ message, options }); },
			async exec(command: string, args: string[]) {
				if (command === "gh" && args[1] === "view") {
					return { code: 0, stdout: JSON.stringify({ number: 42, title: "Visibility", url: "https://github.com/acme/repo/pull/42", body: "contract", author: { login: "author" }, baseRefName: "main", baseRefOid: "base1234", headRefName: "feature", headRefOid: captureIndex === 0 ? "head11111111" : "head22222222", state: "OPEN" }), stderr: "" };
				}
				if (command === "gh" && args[1] === "diff") {
					const value = captureIndex === 0 ? DIFF : DIFF.replace('"READY"', '"READY", "PAUSED"');
					captureIndex += 1;
					return { code: 0, stdout: value, stderr: "" };
				}
				if (command === "git" && args[0] === "fetch") return { code: 0, stdout: "", stderr: "" };
				if (command === "git" && args[0] === "merge-base") return { code: 0, stdout: "", stderr: "" };
				throw new Error(`unexpected ${command} ${args.join(" ")}`);
			},
		} as any;
		registerPrReview(pi, { stateRoot, now: () => 3000, openStudio: false, switchToReviewWorkspace: false });
		await commands.get("meta-review").handler("https://github.com/acme/repo/pull/42", { cwd: "/tmp", hasUI: false, ui: { notify() {}, setStatus() {} } });
		const runId = messages[0].message.details.runId as string;
		const tool = tools.get("meta_review_run");
		await tool.execute("inspect", { action: "inspect", runId, chunkId: "C001" }, undefined, undefined, { cwd: "/tmp" });
		const source = JSON.parse(readFileSync(join(stateRoot, "runs", runId, "source.json"), "utf8"));
		const changedEvidenceIds = source.lines.filter((line: any) => line.kind === "addition" || line.kind === "deletion").map((line: any) => line.id);
		await tool.execute("submit", { action: "submit", runId, guides: [{ path: "src/example.ts", role: "상태 노출 정책", changeReason: "허용 상태 명시", flow: "consumer → visible", hunks: [{ id: "E-01", title: "allowlist", evidenceIds: changedEvidenceIds, whatChanged: "조건 변경", why: "자동 노출 방지", evidence: "diff", responsibility: "policy", flowImpact: "허용 상태만 통과" }] }], cards: [] }, undefined, undefined, { cwd: "/tmp" });
		const refreshed = await tool.execute("refresh", { action: "refresh", runId, mode: "auto" }, undefined, undefined, { cwd: "/tmp" });
		assert.equal(refreshed.details.mode, "incremental");
		assert.equal(refreshed.details.revision.number, 2);
		assert.equal(refreshed.details.revision.status, "captured");
		assert.equal(refreshed.details.previousRunId, runId);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("meta_review_run requires full inspection and complete explanation coverage before submit", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-pr-review-tool-"));
	try {
		const { pi, commands, tools, messages } = fixture();
		registerPrReview(pi, { stateRoot, now: () => 2000 });
		await commands.get("meta-review").handler("https://github.com/acme/repo/pull/42", {
			cwd: "/tmp",
			ui: { notify() {}, setStatus() {} },
		});
		const runId = messages[0]?.message.details.runId as string;
		const tool = tools.get("meta_review_run");
		const status = await tool.execute("call-1", { action: "status", runId }, undefined, undefined, {});
		assert.match(status.content[0].text, /inspection: 0\/1/);
		await assert.rejects(
			() => tool.execute("call-2", { action: "submit", runId, cards: [] }, undefined, undefined, {}),
			/submit 전에 모든 chunk/,
		);
		await assert.rejects(
			() => tool.execute("call-search-before", { action: "search", runId, query: "상태 allowlist" }, undefined, undefined, {}),
			/blind source inspection 뒤에만/,
		);
		const inspection = await tool.execute("call-3", { action: "inspect", runId, chunkId: "C001" }, undefined, undefined, {});
		assert.match(inspection.content[0].text, /D000001/);
		const noCorpus = await tool.execute("call-search-after", { action: "search", runId, query: "상태 allowlist" }, undefined, undefined, {});
		assert.match(noCorpus.content[0].text, /not configured/);
		const source = JSON.parse(readFileSync(join(stateRoot, "runs", runId, "source.json"), "utf8"));
		const evidenceId = source.lines.find((line: any) => line.kind === "deletion").id;
		const changedEvidenceIds = source.lines.filter((line: any) => line.kind === "addition" || line.kind === "deletion").map((line: any) => line.id);
		await assert.rejects(
			() => tool.execute("call-guide-missing", { action: "submit", runId, guides: [], cards: [] }, undefined, undefined, {}),
			/every changed file needs a guide/,
		);
		const submitted = await tool.execute("call-4", {
			action: "submit",
			runId,
			document: {
				overview: { summary: "상태 노출 정책을 allowlist로 좁힙니다.", reviewFocus: "새 상태가 자동 노출되지 않는지 확인합니다." },
				relationships: { summary: "한 파일 안에서 정책 계약을 완결합니다.", diagram: "flowchart", relations: [], readingOrder: [{ path: "src/example.ts", reason: "정책 변경과 근거를 함께 확인합니다." }] },
			},
			guides: [{
				path: "src/example.ts",
				role: "상태 노출 정책을 소유하는 함수입니다.",
				changeReason: "새 상태의 자동 노출을 막기 위해 변경됐습니다.",
				flow: "consumer → visible policy",
				impact: "OPEN과 READY만 노출됩니다.",
				hunks: [{
					id: "E-01",
					title: "허용 상태 계약 명시",
					evidenceIds: changedEvidenceIds,
					whatChanged: "부정 조건을 명시적 허용 목록으로 바꿨습니다.",
					why: "새 상태가 자동으로 노출되는 회귀를 막습니다.",
					evidence: "삭제된 조건과 새 Set 조회를 함께 확인했습니다.",
					responsibility: "visible 함수가 노출 정책을 소유합니다.",
					concepts: ["allowlist"],
					flowImpact: "호출자는 허용된 상태만 true를 받습니다.",
				}],
			}],
			cards: [{
				id: "R-01",
				title: "허용 상태를 명시한다",
				strength: "required",
				confidence: "high",
				evidenceIds: [evidenceId],
				reviewDraft: "새 상태가 자동 노출되지 않도록 허용 상태를 명시해주세요.",
				explanation: "부정 조건은 이후 상태 추가를 자동 허용합니다.",
				meta: { summary: "focused test로 재발을 막을 수 있습니다.", scope: "current-pr" },
			}],
		}, undefined, undefined, {});
		assert.match(submitted.content[0].text, /1 files explained, 1 findings/);
		assert.equal(submitted.details.relationshipCount, 0);
		assert.equal(existsSync(submitted.details.documentPath), true);
		assert.equal(submitted.terminate, true);
		const markdown = readFileSync(submitted.details.reportPath, "utf8");
		assert.match(markdown, /설명 coverage: 파일 1\/1/);
		assert.match(markdown, /상태 노출 정책을 allowlist로 좁힙니다/);
		assert.match(markdown, /권장 읽기 순서/);
		assert.match(markdown, /### 리뷰 초안/);
		assert.match(markdown, /### 메타적 관점/);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("meta_review_run submits large snapshots through one validated run-local artifact", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-pr-review-artifact-submit-"));
	try {
		const { pi, commands, tools, messages } = fixture();
		registerPrReview(pi, { stateRoot, now: () => 4000, openStudio: false, switchToReviewWorkspace: false });
		await commands.get("meta-review").handler("https://github.com/acme/repo/pull/42", { cwd: "/tmp", hasUI: false, ui: { notify() {}, setStatus() {} } });
		const runId = messages[0]?.message.details.runId as string;
		const tool = tools.get("meta_review_run");
		const status = await tool.execute("artifact-status", { action: "status", runId }, undefined, undefined, {});
		const submissionPath = status.details.submissionPath as string;
		assert.equal(submissionPath, join(stateRoot, "runs", runId, "submission.json"));
		assert.match(status.content[0].text, /large submission artifact:/);
		await tool.execute("artifact-inspect", { action: "inspect", runId, chunkId: "C001" }, undefined, undefined, {});
		const source = JSON.parse(readFileSync(join(stateRoot, "runs", runId, "source.json"), "utf8"));
		const changedEvidenceIds = source.lines.filter((line: any) => line.kind === "addition" || line.kind === "deletion").map((line: any) => line.id);
		const artifact = {
			document: {
				overview: { summary: "상태 계약 변경", reviewFocus: "노출 정책을 확인합니다." },
				relationships: { summary: "단일 정책 파일 변경입니다.", diagram: "flowchart", relations: [], readingOrder: [{ path: "src/example.ts", reason: "정책 계약을 확인합니다." }] },
			},
			guides: [{
				path: "src/example.ts",
				role: "상태 노출 정책을 소유하는 함수입니다.",
				changeReason: "새 상태의 자동 노출을 막기 위해 변경됐습니다.",
				flow: "consumer → visible policy",
				hunks: [{ id: "E-01", title: "허용 상태 계약 명시", evidenceIds: changedEvidenceIds, whatChanged: "조건 변경", why: "자동 노출 방지", evidence: "diff", responsibility: "policy", flowImpact: "허용 상태만 통과" }],
			}],
			cards: [],
		};
		const outsidePath = join(stateRoot, "outside-submission.json");
		writeFileSync(outsidePath, JSON.stringify(artifact));
		await assert.rejects(() => tool.execute("artifact-outside", { action: "submit", runId, submissionPath: outsidePath }, undefined, undefined, {}), /현재 run의 submission\.json/);
		writeFileSync(submissionPath, "{invalid");
		await assert.rejects(() => tool.execute("artifact-invalid", { action: "submit", runId, submissionPath }, undefined, undefined, {}), /유효한 JSON/);
		writeFileSync(submissionPath, "x".repeat(5 * 1024 * 1024 + 1));
		await assert.rejects(() => tool.execute("artifact-oversize", { action: "submit", runId, submissionPath }, undefined, undefined, {}), /5MB 이하/);
		writeFileSync(submissionPath, JSON.stringify(artifact));
		const submitted = await tool.execute("artifact-submit", { action: "submit", runId, submissionPath }, undefined, undefined, {});
		assert.equal(submitted.details.submissionTransport, "run-artifact");
		assert.equal(submitted.details.guideCount, 1);
		assert.equal(existsSync(submitted.details.documentPath), true);
		assert.equal(existsSync(submissionPath), false, "transport artifact is removed after successful canonical save");
		const inline = await tool.execute("inline-submit", { action: "submit", runId, guides: artifact.guides, cards: artifact.cards }, undefined, undefined, {});
		assert.equal(inline.details.submissionTransport, "inline");
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
