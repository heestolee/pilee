import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { setGlimpseOpenForTests } from "../utils/glimpse.ts";
import {
	STUDY_HARD_META_REVIEW_OPEN_EVENT,
	registerStudyHardMetaReviewOpenBroker,
	registerStudyHardMetaReviewStartBroker,
	requestStudyHardMetaReviewOpen,
	requestStudyHardMetaReviewStart,
} from "../study-hard/meta-review-broker.ts";
import { registerStudyHardBoardTool, startStudyHardStudio, stopStudyHardStudios } from "../study-hard/studio.ts";
import { createPrReviewQuestion, loadPrReviewQuestions } from "./chat.ts";
import { captureUnifiedDiff } from "./evidence.ts";
import { captureCurrentWorkRun, captureGitHubPrRun, parseGitHubPrUrl, registerPrReview, registerPrReviewTranscriptRenderer } from "./index.ts";
import { loadPrReviewRun } from "./run.ts";

const BASE_SOURCE = `export function visible(status: string) {
  return status !== "HIDDEN";
}
`;

const HEAD_SOURCE = `export function visible(status: string) {
  const allowed = new Set(["OPEN", "READY"]);
  return allowed.has(status);
}
`;

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

function createTestEventBus() {
	const listeners = new Map<string, Set<(payload: unknown) => void>>();
	return {
		on(name: string, listener: (payload: unknown) => void) {
			const group = listeners.get(name) ?? new Set();
			group.add(listener);
			listeners.set(name, group);
			return () => group.delete(listener);
		},
		emit(name: string, payload: unknown) {
			for (const listener of listeners.get(name) ?? []) listener(payload);
		},
	};
}

function fixture(events = createTestEventBus()) {
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const messages: Array<{ message: any; options: any }> = [];
	const entries: Array<{ customType: string; data: any }> = [];
	const execCalls: Array<{ command: string; args: string[] }> = [];
	const pi = {
		events,
		registerCommand(name: string, value: any) { commands.set(name, value); },
		registerTool(value: any) { tools.set(value.name, value); },
		on() {},
		async exec(command: string, args: string[]) {
			execCalls.push({ command, args });
			if (command === "gh" && args[0] === "api") {
				const ref = args.find((value) => value.startsWith("ref="))?.slice(4);
				return { code: 0, stdout: ref === "base1234" ? BASE_SOURCE : HEAD_SOURCE, stderr: "" };
			}
			if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: "/tmp/review-pr-42\n", stderr: "" };
			if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: "head1234567890\n", stderr: "" };
			if (command === "git" && args[0] === "status") return { code: 0, stdout: "?? .pi/review-context.json\n", stderr: "" };
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

test("Meta Review transcript lineage는 Study Hard와 같은 visible entry renderer를 등록한다", () => {
	let rendererType = "";
	let renderer: any;
	registerPrReviewTranscriptRenderer({
		registerEntryRenderer(type: string, value: any) { rendererType = type; renderer = value; },
	} as any);
	assert.equal(rendererType, "meta-review-transcript-lineage");
	const theme = { bg: (_name: string, text: string) => text, fg: (_name: string, text: string) => text };
	assert.equal(renderer({ data: { content: "숨긴 entry", details: {} } }, { expanded: false }, theme), undefined);
	const visible = renderer({ data: { content: "🔎 Meta Review 질문 · 전체 PR", details: {}, display: true } }, { expanded: false }, theme);
	assert.ok(visible);
});

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

test("Study Hard Meta Review broker는 shared event bus당 owner 하나만 유지한다", async () => {
	const events = createTestEventBus();
	const firstPi = { events } as any;
	const secondPi = { events } as any;
	let firstOpenCalls = 0;
	let secondOpenCalls = 0;
	let legacyOpenCalls = 0;
	const legacyDispose = events.on(STUDY_HARD_META_REVIEW_OPEN_EVENT, (payload: any) => {
		if (!payload.claim()) return;
		legacyOpenCalls += 1;
		payload.onOpened({ runId: "legacy", url: "http://127.0.0.1:0", statePath: "/tmp/legacy", revision: 0 });
	});
	const registrySymbol = Symbol.for("pilee.study-hard.meta-review-open-broker");
	const registry = ((globalThis as any)[registrySymbol] ??= {});
	registry.owners = new WeakMap([[events, legacyDispose]]);
	const input = { ctx: { hasUI: false } as any, url: "https://example.com/review", title: "Review", fallbackRunId: "fallback", patch: {} };
	const disposeFirst = registerStudyHardMetaReviewOpenBroker(firstPi, async () => {
		firstOpenCalls += 1;
		return { runId: "first", url: "http://127.0.0.1:1", statePath: "/tmp/first", revision: 1 };
	});
	const disposeSecond = registerStudyHardMetaReviewOpenBroker(secondPi, async () => {
		secondOpenCalls += 1;
		return { runId: "second", url: "http://127.0.0.1:2", statePath: "/tmp/second", revision: 2 };
	});
	try {
		const completion = requestStudyHardMetaReviewOpen(firstPi, input);
		assert.ok(completion);
		assert.equal((await completion).runId, "second");
		assert.equal(firstOpenCalls, 0);
		assert.equal(secondOpenCalls, 1);
		assert.equal(legacyOpenCalls, 0);
		assert.equal(requestStudyHardMetaReviewOpen({} as any, input), undefined);
	} finally {
		disposeFirst();
		disposeSecond();
	}
});

test("Study Hard Meta Review start broker는 현재 창에 연결할 run만 반환한다", async () => {
	const events = createTestEventBus();
	const pi = { events } as any;
	let received: any;
	const dispose = registerStudyHardMetaReviewStartBroker(pi, async (input) => {
		received = input;
		return { runId: "current-run", runDir: "/tmp/current-run", source: "current-work" };
	});
	try {
		const completion = requestStudyHardMetaReviewStart(pi, { cwd: "/tmp/current-work", studyRunId: "study-current" });
		assert.ok(completion);
		assert.deepEqual(await completion, { runId: "current-run", runDir: "/tmp/current-run", source: "current-work" });
		assert.equal(received.cwd, "/tmp/current-work");
		assert.equal(received.studyRunId, "study-current");
		assert.equal(requestStudyHardMetaReviewStart({} as any, { cwd: "/tmp", studyRunId: "study" }), undefined);
	} finally {
		dispose();
	}
});

test("Study Hard first entry는 실제 PR Review start callback으로 current-work run을 연결한다", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-first-entry-integration-"));
	const studyStateRoot = mkdtempSync(join(tmpdir(), "pilee-study-hard-first-entry-integration-"));
	const previousStudyStateDir = process.env.STUDY_HARD_STATE_DIR;
	process.env.STUDY_HARD_STATE_DIR = studyStateRoot;
	const events = createTestEventBus();
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const messages: any[] = [];
	const pi = {
		events,
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
	registerPrReview(pi, { stateRoot, now: () => 1000 });
	const handle = await startStudyHardStudio(pi, { hasUI: false, cwd: "/tmp/acme-repo" } as any, {
		url: "https://example.com/learning-source",
		runId: "meta-review-first-entry-integration",
		title: "기존 학습노트",
	});
	try {
		const response = await fetch(new URL("/meta-review/start", handle.url), {
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Study-Hard-Capability": handle.capabilityToken },
			body: JSON.stringify({}),
		});
		assert.equal(response.status, 202);
		const result = await response.json() as any;
		assert.equal(result.metaReview.source, "current-work");
		assert.equal(loadPrReviewRun(result.metaReview.runDir).revisionMode, "initial");
		const board = await fetch(new URL("/state", handle.url)).then((item) => item.json() as Promise<any>);
		assert.equal(board.url, "https://example.com/learning-source");
		assert.equal(board.title, "기존 학습노트");
		assert.equal(board.activeSurface, "review");
		assert.equal(board.metaReview.runId, result.metaReview.runId);
		assert.equal(messages.length, 1);
		assert.equal(messages[0].message.customType, "pilee-meta-review-command");
		assert.equal(messages[0].message.details.studyRunId, "meta-review-first-entry-integration");
		assert.equal(messages[0].options.triggerTurn, true);
	} finally {
		stopStudyHardStudios();
		rmSync(stateRoot, { recursive: true, force: true });
		rmSync(studyStateRoot, { recursive: true, force: true });
		if (previousStudyStateDir === undefined) delete process.env.STUDY_HARD_STATE_DIR;
		else process.env.STUDY_HARD_STATE_DIR = previousStudyStateDir;
	}
});

test("meta_review_run open은 기존 학습노트 창에 코드리뷰 탭을 연결한다", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-shared-study-hard-"));
	const studyStateRoot = mkdtempSync(join(tmpdir(), "pilee-study-hard-shared-window-"));
	const previousStudyStateDir = process.env.STUDY_HARD_STATE_DIR;
	process.env.STUDY_HARD_STATE_DIR = studyStateRoot;
	let glimpseOpenCalls = 0;
	let glimpseShowCalls = 0;
	setGlimpseOpenForTests((() => {
		glimpseOpenCalls += 1;
		return {
			on() {},
			show() { glimpseShowCalls += 1; },
			close() {},
		};
	}) as any);
	const events = createTestEventBus();
	const studyHard = fixture(events);
	const metaReview = fixture(events);
	const disposeBroker = registerStudyHardBoardTool(studyHard.pi);
	registerPrReview(metaReview.pi, { stateRoot, now: () => 1000 });
	const ctx = { hasUI: true, cwd: "/tmp/review-pr-42", sessionManager: { getBranch: () => [] } } as any;

	try {
		const board = await studyHard.tools.get("study_hard_board").execute("study-start", {
			action: "start",
			runId: "existing-learning-note",
			url: "https://github.com/acme/repo/pull/42",
			title: "기존 PR 학습노트",
			noteDocument: {
				title: "기존 PR 학습노트",
				sections: [{
					id: "overview",
					kind: "overview",
					title: "기존 학습 내용",
					blocks: [{ id: "mental-model", type: "callout", title: "Mental model", body: "기존 학습노트는 보존되어야 한다." }],
				}],
			},
		}, new AbortController().signal, () => {}, ctx) as any;
		const dormant = await studyHard.tools.get("study_hard_board").execute("study-dormant", {
			action: "start",
			runId: "dormant-same-url-note",
			url: "https://github.com/acme/repo/pull/42",
			title: "열려 있지 않은 같은 URL 노트",
		}, new AbortController().signal, () => {}, { ...ctx, hasUI: false }) as any;
		await studyHard.tools.get("study_hard_board").execute("study-reopen", {
			action: "open",
			runId: "existing-learning-note",
		}, new AbortController().signal, () => {}, ctx);

		const reviewRun = await captureGitHubPrRun(metaReview.pi, ctx.cwd, parseGitHubPrUrl("https://github.com/acme/repo/pull/42"), stateRoot, 1000);
		const opened = await metaReview.tools.get("meta_review_run").execute("meta-open", {
			action: "open",
			runId: reviewRun.runId,
		}, new AbortController().signal, () => {}, ctx) as any;

		assert.equal(opened.details.studyRunId, "existing-learning-note");
		assert.equal(opened.details.url, board.details.url);
		assert.equal(glimpseOpenCalls, 1, "두 tool은 기존 Glimpse window 외에 새 창을 만들면 안 된다");
		assert.equal(glimpseShowCalls, 2, "명시적 reopen과 Meta Review open은 같은 window를 앞으로 가져와야 한다");

		const linkedState = await fetch(new URL("/state", board.details.url)).then((response) => response.json() as Promise<any>);
		const dormantState = await fetch(new URL("/state", dormant.details.url)).then((response) => response.json() as Promise<any>);
		assert.equal(linkedState.noteDocument.title, "기존 PR 학습노트");
		assert.equal(linkedState.noteDocument.sections[0].blocks[0].body, "기존 학습노트는 보존되어야 한다.");
		assert.equal(linkedState.activeSurface, "review");
		assert.equal(linkedState.metaReview.runId, reviewRun.runId);
		assert.equal(dormantState.metaReview, undefined, "열려 있지 않은 같은 URL run은 선택하면 안 된다");

		const html = await fetch(board.details.url).then((response) => response.text());
		const setSurfaceStart = html.indexOf("function setSurface(");
		const setSurfaceEnd = html.indexOf("\n    function ", setSurfaceStart);
		const startTabStart = html.indexOf("function renderMetaReviewStartTab()");
		const startTabEnd = html.indexOf("\n    async function requestMetaReviewStart", startTabStart);
		const renderStart = html.indexOf("function render(){");
		const renderEnd = html.indexOf("\n    document.getElementById('historyPreviewClose')", renderStart);
		assert.ok(setSurfaceStart >= 0 && setSurfaceEnd > setSurfaceStart && startTabStart >= 0 && startTabEnd > startTabStart && renderStart >= 0 && renderEnd > renderStart);
		const setSurfaceSource = html.slice(setSurfaceStart, setSurfaceEnd);
		const startTabSource = html.slice(startTabStart, startTabEnd);
		const renderSource = html.slice(renderStart, renderEnd);
		const { document, window } = parseHTML(html);
		const rendered = new Function("document", "window", "initialState", `
			var state=initialState,metaReviewState=null,metaReviewPollTimer=null,metaReviewStartStatus='idle',metaReviewStartError='';
			function esc(value){return String(value??'');}
			function thoughtQuestions(){return [];}
			function thoughtQuestionCategory(){} function thoughtCounts(){} function thoughtGroups(){} function sequenceSource(){}
			function memoBoardQuestions(){return [];} function memoBoardCategory(){} function memoBoardCounts(){return {all:0,unresolved:0,applied:0,failed:0};} function memoBoardGroups(){return [];}
			function closeDrawer(){} function renderBreadcrumb(){} function renderMap(){} function renderFlow(){} function renderNote(){} function renderDetail(){} function renderStatus(){}
			function loadMetaReview(){window.__metaReviewLoaded=(window.__metaReviewLoaded||0)+1;}
			function post(){return Promise.resolve();}
			${setSurfaceSource}
			${startTabSource}
			${renderSource}
			render();
			return {
				reviewTabHidden:document.getElementById('reviewSurfaceTab').hidden,
				reviewSurfaceActive:document.getElementById('reviewSurface').classList.contains('active'),
				noteSurfaceActive:document.getElementById('noteSurface').classList.contains('active'),
				metaReviewLoads:window.__metaReviewLoaded||0
			};
		`)(document, window, linkedState) as any;
		assert.equal(rendered.reviewTabHidden, false);
		assert.equal(rendered.reviewSurfaceActive, true);
		assert.equal(rendered.noteSurfaceActive, false);
		assert.equal(rendered.metaReviewLoads, 1);
	} finally {
		disposeBroker();
		stopStudyHardStudios();
		setGlimpseOpenForTests(undefined);
		if (previousStudyStateDir === undefined) delete process.env.STUDY_HARD_STATE_DIR;
		else process.env.STUDY_HARD_STATE_DIR = previousStudyStateDir;
		rmSync(stateRoot, { recursive: true, force: true });
		rmSync(studyStateRoot, { recursive: true, force: true });
	}
});

test("captureGitHubPrRun은 exact base/head source의 선언 snapshot을 pin한다", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-github-source-"));
	try {
		const { pi, execCalls } = fixture();
		const state = await captureGitHubPrRun(pi, "/tmp", parseGitHubPrUrl("https://github.com/acme/repo/pull/42"), stateRoot, 950);
		const source = JSON.parse(readFileSync(state.sourcePath, "utf8"));
		const visible = source.fileSources[0].declarations.find((item: any) => item.name === "visible");
		assert.ok(visible.before && visible.after);
		assert.equal(visible.evidenceIds.length, 3);
		assert.deepEqual(execCalls.filter((call) => call.args[0] === "api").map((call) => call.args.find((value) => value.startsWith("ref="))), ["ref=base1234", "ref=head1234567890"]);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
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
		const routed = await tools.get("meta_review_chat").execute("call-route", {
			action: "route",
			runId: state.runId,
			questionId: question.id,
			executionMode: "direct",
			routeReason: "현재 review source만으로 답할 수 있습니다.",
		}, undefined, undefined, { cwd: "/tmp" });
		assert.equal(routed.details.question.execution.mode, "direct");
		const result = await tools.get("meta_review_chat").execute("call-answer", {
			action: "answer",
			runId: state.runId,
			questionId: question.id,
			answer: "허용 상태 이외의 호출 결과가 숨겨집니다.",
			evidence: [{ label: "정책 구현", path: "src/example.ts", line: 2 }],
		}, undefined, undefined, { cwd: "/tmp" });
		assert.equal(result.details.question.status, "answered");
		assert.equal(result.details.question.execution.phase, "answered");
		assert.equal(entries.length, 1);
		assert.equal(entries[0].data.display, true);
		assert.match(entries[0].data.content, /Meta Review 답변/);
		assert.match(entries[0].data.content, /허용 상태 이외의 호출 결과/);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("meta_review_chat worker route는 legacy runtime에서 명시적 P0 fallback을 남긴다", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-chat-worker-fallback-"));
	try {
		const { pi, tools, messages } = fixture();
		registerPrReview(pi, { stateRoot, now: () => 1000 });
		const state = await captureGitHubPrRun(pi, "/tmp", parseGitHubPrUrl("https://github.com/acme/repo/pull/42"), stateRoot, 1000);
		const question = createPrReviewQuestion(state.runDir, { runId: state.runId, question: "전체 PR 호출 경로를 다시 검산해줘.", scope: "session" }, 1100);
		const result = await tools.get("meta_review_chat").execute("call-route-worker", {
			action: "route",
			runId: state.runId,
			questionId: question.id,
			executionMode: "worker",
			routeReason: "전체 PR의 독립 경로 비교가 필요합니다.",
		}, undefined, undefined, { cwd: "/tmp/review-pr-42" });
		assert.equal(result.terminate, true);
		assert.equal(result.details.executionMode, "worker");
		assert.equal(result.details.workerLaunched, false);
		const fallback = messages.find(({ message }) => message.customType === "pilee-meta-review-worker-request");
		assert.ok(fallback);
		assert.equal(fallback.message.display, false);
		assert.equal(fallback.options.triggerTurn, true);
		assert.match(fallback.message.content, /meta-review-question-worker --isolated/);
		assert.match(fallback.message.content, /action="worker_started"/);
		assert.match(fallback.message.content, /details\.claimed가 true일 때만/);
		assert.match(fallback.message.content, /details\.completionToken/);
		assert.match(fallback.message.content, /apply_worker_result/);
		assert.doesNotMatch(fallback.message.content, /apply_worker_result[^\n]*expectedSourceSha256=/);
		const dispatchToken = fallback.message.details.dispatchToken;
		assert.equal(typeof dispatchToken, "string");

		const preAckMessageCount = messages.length;
		const preAckDuplicate = await tools.get("meta_review_chat").execute("call-route-worker-before-ack", {
			action: "route",
			runId: state.runId,
			questionId: question.id,
			executionMode: "worker",
			routeReason: "ack 전에 같은 fallback route 재호출",
		}, undefined, undefined, { cwd: "/tmp/review-pr-42" });
		assert.equal(preAckDuplicate.details.workerLaunched, false);
		assert.equal(messages.length, preAckMessageCount);

		const started = await tools.get("meta_review_chat").execute("call-worker-started", {
			action: "worker_started",
			runId: state.runId,
			questionId: question.id,
			dispatchToken,
			workerRunId: 81,
		}, undefined, undefined, { cwd: "/tmp/review-pr-42" });
		assert.equal(started.details.claimed, true);
		assert.equal(typeof started.details.completionToken, "string");
		assert.equal(started.details.question.execution.phase, "worker-running");
		const providerVisibleCompletionToken = started.content[0].text.match(/^completionToken:\s*(\S+)$/m)?.[1];
		assert.equal(providerVisibleCompletionToken, started.details.completionToken);
		const duplicateClaim = await tools.get("meta_review_chat").execute("call-worker-started-again", {
			action: "worker_started",
			runId: state.runId,
			questionId: question.id,
			dispatchToken,
			workerRunId: 82,
		}, undefined, undefined, { cwd: "/tmp/review-pr-42" });
		assert.equal(duplicateClaim.details.claimed, false);
		assert.equal(duplicateClaim.details.completionToken, undefined);
		assert.equal(duplicateClaim.details.question.workerRunId, 81);
		assert.equal(duplicateClaim.terminate, true);
		assert.doesNotMatch(duplicateClaim.content[0].text, /^completionToken:/m);

		const workerResultPath = started.details.question.workerResultPath as string;
		writeFileSync(workerResultPath, JSON.stringify({
			schemaVersion: 1,
			kind: "meta-review-question-worker-result",
			runId: state.runId,
			questionId: question.id,
			headSha: started.details.question.expectedHeadSha,
			sourceSha256: JSON.parse(readFileSync(state.sourcePath, "utf8")).sourceSha256,
			answer: "provider-visible completion token으로 legacy apply를 완료했습니다.",
			evidence: [{ label: "허용 상태 구현", path: "src/example.ts", line: 2 }],
		}));
		const applied = await tools.get("meta_review_chat").execute("call-apply-worker-result", {
			action: "apply_worker_result",
			runId: state.runId,
			questionId: question.id,
			completionToken: providerVisibleCompletionToken,
			workerResultPath,
			workerRunId: 81,
		}, undefined, undefined, { cwd: "/tmp/review-pr-42" });
		assert.equal(applied.details.question.status, "answered");
		assert.match(applied.content[0].text, /legacy apply를 완료/);

		const messageCount = messages.length;
		const duplicateRoute = await tools.get("meta_review_chat").execute("call-route-worker-again", {
			action: "route",
			runId: state.runId,
			questionId: question.id,
			executionMode: "worker",
			routeReason: "같은 fallback route 재호출",
		}, undefined, undefined, { cwd: "/tmp/review-pr-42" });
		assert.equal(duplicateRoute.details.workerLaunched, false);
		assert.equal(messages.length, messageCount);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("captureCurrentWorkRun captures branch, working source, and base declarations without requiring Frame", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-current-"));
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-repo-"));
	mkdirSync(join(repoRoot, "src"), { recursive: true });
	writeFileSync(join(repoRoot, "src", "example.ts"), HEAD_SOURCE);
	try {
		const pi = {
			async exec(command: string, args: string[]) {
				if (command === "gh") return { code: 1, stdout: "", stderr: "no PR" };
				if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: `${repoRoot}\n`, stderr: "" };
				if (args[0] === "show" && args[1] === "base1234567890:src/example.ts") return { code: 0, stdout: BASE_SOURCE, stderr: "" };
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
		const state = await captureCurrentWorkRun(pi, repoRoot, stateRoot, 900);
		assert.equal(state.target.kind, "current-work");
		assert.equal(state.target.branch, "feature/current");
		assert.equal(state.target.baseRefName, "development");
		assert.equal(state.target.number, 0);
		assert.match(readFileSync(state.diffPath, "utf8"), /allowed/);
		const source = JSON.parse(readFileSync(state.sourcePath, "utf8"));
		const visible = source.fileSources[0].declarations.find((item: any) => item.name === "visible");
		assert.ok(visible.before && visible.after);
		assert.equal(visible.evidenceIds.length, 3);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
		rmSync(repoRoot, { recursive: true, force: true });
	}
});

test("/meta-review without args opens current work in the Study Hard code review surface", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-current-command-"));
	try {
		const commands = new Map<string, any>();
		const tools = new Map<string, any>();
		const messages: any[] = [];
		const opened: any[] = [];
		const notices: string[] = [];
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
		const context = { cwd: "/tmp/acme-repo", hasUI: true, ui: { notify(message: string) { notices.push(message); }, setStatus() {} } };
		await commands.get("meta-review").handler("help", context);
		assert.match(notices[0] ?? "", /\/meta-review\s+현재 작업 diff 검토/);
		assert.match(notices[0] ?? "", /\/meta-review <GitHub PR URL>\s+지정 PR 검토/);
		await assert.rejects(
			() => tools.get("meta_review_run").execute("status-before-run", { action: "status" }, undefined, undefined, context),
			/현재 작업은 \/meta-review, 지정 PR은 \/meta-review <GitHub PR URL>/,
		);
		await commands.get("meta-review").handler("", context);
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
		assert.deepEqual(execCalls.filter((call) => call.args[0] === "pr").map((call) => call.args.slice(0, 4)), [
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

test("/meta-review current-panel handoff stops using the stale source command context", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-pr-review-workspace-command-"));
	try {
		const { pi, commands, messages } = fixture();
		const requests: any[] = [];
		const notifications: string[] = [];
		let switched = false;
		registerPrReview(pi, {
			stateRoot,
			now: () => 1500,
			reviewWorkspaceRunner: async (_pi, _ctx, request) => {
				requests.push(request);
				switched = true;
				return { status: "switched", name: "review-pr-42-head1234", branch: "review/pr-42-head1234", path: "/tmp/review-pr-42", sessionFile: "/tmp/review.jsonl", reused: false, continuationDispatched: true, contract: { activationTarget: "current-panel" } };
			},
		});
		await commands.get("meta-review").handler("https://github.com/acme/repo/pull/42", {
			cwd: "/tmp",
			hasUI: true,
			ui: {
				notify(message: string) { notifications.push(message); },
				setStatus() {
					if (switched) throw new Error("stale source command context used after switch");
				},
			},
		});
		assert.equal(requests.length, 1);
		assert.equal(requests[0].repo, "repo");
		assert.equal(requests[0].number, 42);
		assert.equal(requests[0].baseSha, "base1234");
		assert.equal(requests[0].headSha, "head1234567890");
		assert.match(requests[0].afterSwitchFollowUp.content, /meta_review_run.*open/);
		assert.match(requests[0].afterSwitchFollowUp.content, /\.pi\/review-context\.json/);
		assert.equal(notifications.some((message) => /meta-review failed/.test(message)), false);
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
		const question = createPrReviewQuestion(join(stateRoot, "runs", runId), { runId, question: "이 조건 변경 이유가 뭐야?", scope: "session" }, 3001);
		await tool.execute("inspect", { action: "inspect", runId, chunkId: "C001" }, undefined, undefined, { cwd: "/tmp" });
		const source = JSON.parse(readFileSync(join(stateRoot, "runs", runId, "source.json"), "utf8"));
		const changedEvidenceIds = source.lines.filter((line: any) => line.kind === "addition" || line.kind === "deletion").map((line: any) => line.id);
		await tool.execute("submit", { action: "submit", runId, guides: [{ path: "src/example.ts", role: "상태 노출 정책", changeReason: "허용 상태 명시", flow: "consumer → visible", hunks: [{ id: "E-01", title: "allowlist", evidenceIds: changedEvidenceIds, whatChanged: "조건 변경", why: "자동 노출 방지", evidence: "diff", responsibility: "policy", flowImpact: "허용 상태만 통과" }] }], cards: [] }, undefined, undefined, { cwd: "/tmp" });
		const refreshed = await tool.execute("refresh", { action: "refresh", runId, mode: "auto" }, undefined, undefined, { cwd: "/tmp" });
		assert.equal(refreshed.details.mode, "incremental");
		assert.equal(refreshed.details.revision.number, 2);
		assert.equal(refreshed.details.revision.status, "captured");
		assert.equal(refreshed.details.previousRunId, runId);
		const inherited = loadPrReviewQuestions(refreshed.details.runDir);
		assert.deepEqual(inherited.map((item) => item.id), [question.id], "새 revision에서도 기존 질문 thread를 유지한다");
		assert.equal(inherited[0]?.runId, refreshed.details.runId, "승계한 질문은 새 revision identity를 사용한다");

		const duringRefresh = createPrReviewQuestion(join(stateRoot, "runs", runId), { runId, question: "갱신 중 추가 질문", scope: "session" }, 3002);
		const refreshedSource = JSON.parse(readFileSync(join(refreshed.details.runDir, "source.json"), "utf8"));
		for (const chunk of refreshedSource.chunks) await tool.execute("inspect", { action: "inspect", runId: refreshed.details.runId, chunkId: chunk.id }, undefined, undefined, { cwd: "/tmp" });
		const refreshedEvidenceIds = refreshedSource.lines.filter((line: any) => line.kind === "addition" || line.kind === "deletion").map((line: any) => line.id);
		await tool.execute("submit", { action: "submit", runId: refreshed.details.runId, guides: [{ path: "src/example.ts", role: "상태 노출 정책", changeReason: "허용 상태 갱신", flow: "consumer → visible", hunks: [{ id: "E-02", title: "allowlist 갱신", evidenceIds: refreshedEvidenceIds, whatChanged: "조건 재변경", why: "새 상태 반영", evidence: "diff", responsibility: "policy", flowImpact: "허용 상태 갱신" }] }], cards: [] }, undefined, undefined, { cwd: "/tmp" });
		const readyQuestions = loadPrReviewQuestions(refreshed.details.runDir);
		assert.deepEqual(readyQuestions.map((item) => item.id), [question.id, duringRefresh.id], "captured→ready 사이의 질문도 새 revision에 병합한다");
		assert.ok(readyQuestions.every((item) => item.runId === refreshed.details.runId));
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
