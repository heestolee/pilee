import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPrReviewQuestion, loadPrReviewQuestions } from "./chat.ts";
import { captureUnifiedDiff } from "./evidence.ts";
import {
	applyPrReviewQuestionWorkerResult,
	buildPrReviewQuestionWorkerTask,
	claimPrReviewQuestionWorkerLaunch,
	dispatchPrReviewQuestionToWorker,
	failPrReviewQuestionWorker,
	launchPrReviewQuestionWorker,
	markPrReviewQuestionWorkerStarted,
	prReviewQuestionWorkerResultPath,
	reservePrReviewQuestionWorkerLaunch,
	retryPrReviewQuestionToWorker,
	routePrReviewQuestion,
} from "./question-worker.ts";
import { createPrReviewRun, type PrReviewRunState } from "./run.ts";
import type { ProgrammaticSubagentLaunchRequest } from "../subagent/programmatic.ts";

const HEAD = "b".repeat(40);
const DIFF = `diff --git a/src/web.ts b/src/web.ts
index 1111111..2222222 100644
--- a/src/web.ts
+++ b/src/web.ts
@@ -9,2 +9,2 @@
-oldCall();
+newCall();
`;
const SOURCE_SHA = captureUnifiedDiff(DIFF).sourceSha256;

function fixture() {
	const runDir = mkdtempSync(join(tmpdir(), "pilee-meta-review-question-worker-"));
	const sourcePath = join(runDir, "source.json");
	writeFileSync(sourcePath, JSON.stringify({ sourceSha256: SOURCE_SHA }));
	writeFileSync(join(runDir, "source.diff"), DIFF);
	const state: PrReviewRunState = {
		schemaVersion: 1,
		runId: "acme-repo-pr-42-head-1",
		status: "ready",
		target: { url: "https://github.com/acme/repo/pull/42", owner: "acme", repo: "repo", number: 42, title: "Review target", headSha: HEAD },
		runDir,
		sourcePath,
		diffPath: join(runDir, "source.diff"),
		inspectionPath: join(runDir, "inspection.json"),
		cardsPath: join(runDir, "cards.json"),
		reportPath: join(runDir, "review.md"),
		createdAt: 1000,
		updatedAt: 1000,
	};
	const question = createPrReviewQuestion(runDir, { runId: state.runId, question: "전체 호출 경로를 다시 검산해줘.", scope: "session" }, 1000);
	return { runDir, state, question };
}

async function freshSourceExec(command: string, args: string[]) {
	if (command === "git" && args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: "/tmp/review-pr-42\n", stderr: "" };
	if (command === "git" && args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: `${HEAD}\n`, stderr: "" };
	if (command === "git" && args[0] === "status") return { code: 0, stdout: "?? .pi/review-context.json\n", stderr: "" };
	if (command === "gh" && args[0] === "pr" && args[1] === "view") return { code: 0, stdout: JSON.stringify({ headRefOid: HEAD }), stderr: "" };
	if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: DIFF, stderr: "" };
	throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
}

function writeArtifact(
	state: PrReviewRunState,
	questionId: string,
	answer = "호출 경로는 Web → API → DB 순서입니다.",
	sourceSha256 = SOURCE_SHA,
	headSha = HEAD,
): string {
	const path = prReviewQuestionWorkerResultPath(state, questionId);
	writeFileSync(path, JSON.stringify({
		schemaVersion: 1,
		kind: "meta-review-question-worker-result",
		runId: state.runId,
		questionId,
		headSha,
		sourceSha256,
		answer,
		evidence: [{ label: "호출 시작점", path: "src/web.ts", line: 10 }],
		uncertainty: "운영 빈도는 확인하지 않았습니다.",
	}));
	return path;
}

function reserveAndStartWorker(state: PrReviewRunState, questionId: string, workerRunId: number, now: number): string {
	const reservation = reservePrReviewQuestionWorkerLaunch(state, questionId, now);
	assert.equal(reservation.dispatchRequired, true);
	const claimed = claimPrReviewQuestionWorkerLaunch(state, questionId, reservation.dispatchToken, now);
	assert.equal(claimed.claimed, true);
	assert.equal(typeof claimed.completionToken, "string");
	markPrReviewQuestionWorkerStarted(state, questionId, claimed.completionToken!, workerRunId, now);
	return claimed.completionToken!;
}

test("Meta Review 질문 worker task는 declaration hierarchy provenance를 유지한다", () => {
	const { runDir, state } = fixture();
	try {
		const question = createPrReviewQuestion(runDir, {
			runId: state.runId,
			question: "이 지역 변수가 왜 필요한지 상위 함수와 함께 설명해줘.",
			scope: "declaration",
			declarationId: "A-F001-localState",
			declarationSide: "after",
			fileId: "F001",
			filePath: "src/web.ts",
			evidenceIds: ["D000007"],
			selection: { kind: "declaration", id: "A-F001-localState", label: "변수 · localState · 변경 후 L10" },
		}, 1001);
		const task = buildPrReviewQuestionWorkerTask(state, question, "/tmp/review-pr-42");
		assert.match(task, /sourceMode: github-pr-immutable/);
		assert.match(task, /repository: acme\/repo/);
		assert.match(task, /현재 checkout HEAD를 요구하지 마세요/);
		assert.match(task, /expectedHeadSha를 ref로 지정한 gh api/);
		assert.match(task, /sourcePath 파일 바이트의 SHA-256이 아닙니다/);
		assert.match(task, /sourcePath JSON의 sourceSha256 필드/);
		assert.doesNotMatch(task, /git rev-parse HEAD를 확인/);
		assert.match(task, /declarationId: A-F001-localState/);
		assert.match(task, /declarationSide: after/);
		assert.match(task, /selection: \{"kind":"declaration","id":"A-F001-localState"/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("Meta Review 질문 worker task는 첨부 이미지 provenance를 유지한다", () => {
	const { runDir, state } = fixture();
	try {
		const question = createPrReviewQuestion(runDir, {
			runId: state.runId,
			question: "첨부 이미지를 파일 관계와 비교해줘.",
			scope: "section",
			sectionId: "relationships",
			selection: { kind: "section", id: "relationships", label: "변경 파일 관계" },
			attachmentIds: ["review-image-1"],
			attachments: [{ id: "review-image-1", name: "review.png", mimeType: "image/png", path: "/tmp/review.png", url: "/attachments/review.png" }],
		}, 1001);
		const task = buildPrReviewQuestionWorkerTask(state, question, "/tmp/review-pr-42");
		assert.match(task, /sectionId: relationships/);
		assert.match(task, /review\.png/);
		assert.match(task, /\/tmp\/review\.png/);
		assert.doesNotMatch(task, /data:image/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("current-work worker task는 live root와 diff freshness 계약을 유지한다", () => {
	const { runDir, state, question } = fixture();
	try {
		state.target = { ...state.target, kind: "current-work", root: "/tmp/current-work", baseSha: "base-sha" };
		const task = buildPrReviewQuestionWorkerTask(state, question, "/tmp/current-work");
		assert.match(task, /sourceMode: current-work-live/);
		assert.match(task, /repository: \(current-work\)/);
		assert.match(task, /실제 파일을 이 root에서 읽고 현재 tracked·untracked diff/);
		assert.doesNotMatch(task, /현재 checkout HEAD를 요구하지 마세요/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("Meta Review 질문은 direct에서 같은 ID의 worker로 한 번 승격한다", () => {
	const { runDir, state, question } = fixture();
	try {
		const direct = routePrReviewQuestion(state, question.id, "direct", "현재 review source부터 확인", 1100);
		assert.equal(direct.question.execution?.mode, "direct");
		assert.equal(direct.question.execution?.phase, "answering");
		const worker = routePrReviewQuestion(state, question.id, "worker", "외부 precedent 비교가 필요함", 1200);
		assert.equal(worker.question.id, question.id);
		assert.equal(worker.question.execution?.mode, "worker");
		assert.equal(worker.question.execution?.phase, "escalating");
		assert.equal(worker.question.execution?.escalatedFrom, "direct");
		assert.equal(worker.workerLaunchRequired, true);
		assert.equal(worker.question.workerResultPath, prReviewQuestionWorkerResultPath(state, question.id));
		assert.throws(() => routePrReviewQuestion(state, question.id, "direct", "되돌리기", 1300), /direct로 되돌릴 수 없습니다/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("worker-starting route는 시작 acknowledgement 전까지 같은 request를 재전송할 수 있다", () => {
	const { runDir, state, question } = fixture();
	try {
		const first = routePrReviewQuestion(state, question.id, "worker", "전체 PR 경로 비교", 1100);
		const retry = routePrReviewQuestion(state, question.id, "worker", "중단된 launch 재전송", 1200);
		assert.equal(first.workerLaunchRequired, true);
		assert.equal(retry.workerLaunchRequired, true);
		assert.equal(retry.question.execution?.phase, "worker-starting");
		const reservation = reservePrReviewQuestionWorkerLaunch(state, question.id, 1250);
		const claimed = claimPrReviewQuestionWorkerLaunch(state, question.id, reservation.dispatchToken, 1250);
		assert.equal(claimed.claimed, true);
		markPrReviewQuestionWorkerStarted(state, question.id, claimed.completionToken!, 70, 1300);
		const acknowledged = routePrReviewQuestion(state, question.id, "worker", "중복 route", 1400);
		assert.equal(acknowledged.workerLaunchRequired, false);
		assert.equal(acknowledged.question.execution?.phase, "worker-running");
		assert.equal(acknowledged.question.workerRunId, 70);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("unclaimed fallback lease는 중복 route를 막고 만료 뒤 새 token으로만 재예약한다", () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "전체 PR 경로 비교", 1100);
		const first = reservePrReviewQuestionWorkerLaunch(state, question.id, 1200);
		const duplicate = reservePrReviewQuestionWorkerLaunch(state, question.id, 1300);
		assert.equal(first.dispatchRequired, true);
		assert.equal(duplicate.dispatchRequired, false);
		assert.equal(duplicate.dispatchToken, first.dispatchToken);
		const renewed = reservePrReviewQuestionWorkerLaunch(state, question.id, first.expiresAt);
		assert.equal(renewed.dispatchRequired, true);
		assert.notEqual(renewed.dispatchToken, first.dispatchToken);
		const oldClaim = claimPrReviewQuestionWorkerLaunch(state, question.id, first.dispatchToken, first.expiresAt);
		assert.equal(oldClaim.claimed, false);
		assert.equal(oldClaim.completionToken, undefined);
		const renewedClaim = claimPrReviewQuestionWorkerLaunch(state, question.id, renewed.dispatchToken, first.expiresAt);
		assert.equal(renewedClaim.claimed, true);
		assert.equal(typeof renewedClaim.completionToken, "string");
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("worker launch lease registry는 extension module reload 뒤에도 같은 reservation을 유지한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "전체 PR 경로 비교", 1100);
		const first = reservePrReviewQuestionWorkerLaunch(state, question.id, 1150);
		const moduleUrl = new URL("./question-worker.ts", import.meta.url);
		moduleUrl.searchParams.set("reload", String(Date.now()));
		const reloaded = await import(moduleUrl.href);
		const duplicate = reloaded.reservePrReviewQuestionWorkerLaunch(state, question.id, 1200);
		assert.equal(duplicate.dispatchRequired, false);
		assert.equal(duplicate.dispatchToken, first.dispatchToken);
		const claimed = reloaded.claimPrReviewQuestionWorkerLaunch(state, question.id, first.dispatchToken, 1200);
		assert.equal(claimed.claimed, true);
		assert.equal(typeof claimed.completionToken, "string");
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("reservation token과 false claimant는 worker apply/fail completion 권한이 없다", async () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "전체 PR 경로 비교", 1100);
		const reservation = reservePrReviewQuestionWorkerLaunch(state, question.id, 1150);
		const winner = claimPrReviewQuestionWorkerLaunch(state, question.id, reservation.dispatchToken, 1150);
		assert.equal(winner.claimed, true);
		assert.equal(typeof winner.completionToken, "string");
		assert.equal(claimPrReviewQuestionWorkerLaunch(state, question.id, reservation.dispatchToken, 1150).completionToken, undefined);
		markPrReviewQuestionWorkerStarted(state, question.id, winner.completionToken!, 78, 1160);
		const artifactPath = writeArtifact(state, question.id);
		const pi = {
			appendEntry() {},
			sendMessage() {},
			async exec(command: string, args: string[]) { return freshSourceExec(command, args); },
		} as any;
		await assert.rejects(
			() => applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/review-pr-42", reservation.dispatchToken, 78, 1200),
			/completion token/,
		);
		assert.throws(
			() => failPrReviewQuestionWorker(pi, state, question.id, reservation.dispatchToken, "loser failure", 79, 1200),
			/completion token/,
		);
		const answered = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/review-pr-42", winner.completionToken!, 78, 1200);
		assert.equal(answered.status, "answered");
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("Meta Review drawer 질문은 메인 Pi turn 없이 공통 background worker를 즉시 시작한다", () => {
	const { runDir, state, question } = fixture();
	try {
		const requests: ProgrammaticSubagentLaunchRequest[] = [];
		const entries: any[] = [];
		const messages: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage(message: any, options: any) { messages.push({ message, options }); },
			events: {
				emit(_name: string, payload: unknown) {
					const request = payload as ProgrammaticSubagentLaunchRequest;
					requests.push(request);
					request.claim();
					request.onStarted({ requestId: request.requestId, runId: 70, agent: request.agent });
				},
			},
		} as any;
		const dispatched = dispatchPrReviewQuestionToWorker(pi, state, question, "/tmp/review-pr-42", 1100);
		assert.equal(requests.length, 1);
		assert.equal(requests[0]?.agent, "meta-review-question-worker");
		assert.equal(dispatched.workerRunId, 70);
		assert.equal(dispatched.execution?.phase, "worker-running");
		assert.equal(messages.length, 0, "메인 Pi followUp routing turn을 만들면 안 된다");
		assert.equal(entries.length, 1);
		assert.match(entries[0]?.data.content || "", /Meta Review 질문/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("실패한 Meta Review 질문은 같은 ID로 공통 worker lifecycle을 재시도한다", () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "첫 worker", 1001);
		const reservation = reservePrReviewQuestionWorkerLaunch(state, question.id, 1002);
		const claim = claimPrReviewQuestionWorkerLaunch(state, question.id, reservation.dispatchToken, 1003);
		failPrReviewQuestionWorker({ appendEntry() {}, sendMessage() {} } as any, state, question.id, claim.completionToken!, "첫 실행 실패", 40, 1004);
		const requests: ProgrammaticSubagentLaunchRequest[] = [];
		const retried = retryPrReviewQuestionToWorker({
			appendEntry() {},
			sendMessage() {},
			events: { emit(_name: string, payload: unknown) { const request = payload as ProgrammaticSubagentLaunchRequest; requests.push(request); request.claim(); request.onStarted({ requestId: request.requestId, runId: 41, agent: request.agent }); } },
		} as any, state, question.id, "/tmp/review-pr-42", 1005);
		assert.equal(retried.id, question.id);
		assert.equal(retried.status, "answering");
		assert.equal(retried.workerRunId, 41);
		assert.equal(retried.error, undefined);
		assert.equal(requests.length, 1);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("programmatic Meta Review worker는 head/source가 고정된 artifact를 답변으로 적용한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		const routed = routePrReviewQuestion(state, question.id, "worker", "전체 PR 경로 비교", 1100);
		const requests: ProgrammaticSubagentLaunchRequest[] = [];
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec(command: string, args: string[]) { return freshSourceExec(command, args); },
			events: {
				emit(_name: string, payload: unknown) {
					const request = payload as ProgrammaticSubagentLaunchRequest;
					requests.push(request);
					request.claim();
					request.onStarted({ requestId: request.requestId, runId: 71, agent: request.agent, sessionFile: "/tmp/meta-review-worker.jsonl" });
				},
			},
		} as any;
		const reservation = reservePrReviewQuestionWorkerLaunch(state, question.id, 1100);
		assert.equal(launchPrReviewQuestionWorker(pi, state, routed.question, "/tmp/review-pr-42", reservation.dispatchToken, 1100), true);
		assert.equal(requests.length, 1);
		assert.equal(requests[0].agent, "meta-review-question-worker");
		assert.equal(requests[0].contextMode, "isolated");
		assert.match(requests[0].task, /expectedHeadSha/);
		assert.equal(loadPrReviewQuestions(runDir)[0]?.execution?.phase, "worker-running");
		const artifactPath = writeArtifact(state, question.id);
		await requests[0].onCompleted({
			requestId: requests[0].requestId,
			runId: 71,
			agent: requests[0].agent,
			status: "done",
			output: `[META_REVIEW_QUESTION_WORKER_RESULT]\nartifactPath: ${artifactPath}\nrunId: ${state.runId}\nquestionId: ${question.id}`,
		});
		const completed = loadPrReviewQuestions(runDir)[0]!;
		assert.equal(completed.status, "answered");
		assert.equal(completed.execution?.phase, "answered");
		assert.equal(completed.workerRunId, 71);
		assert.match(completed.answer || "", /Web → API → DB/);
		assert.equal(entries.length, 1);
		assert.equal(entries[0].data.display, true);
		assert.match(entries[0].data.content, /Meta Review 답변/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("current-work 변경 요청은 pinned patch를 적용하고 Meta Review revision을 갱신한다", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-change-state-"));
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-meta-review-change-repo-"));
	mkdirSync(join(stateRoot, "runs"), { recursive: true });
	mkdirSync(join(repoRoot, "src"), { recursive: true });
	const before = "oldCall();\n";
	const current = "newCall();\n";
	const changed = "changedCall();\n";
	writeFileSync(join(repoRoot, "src", "web.ts"), current);
	const initialDiff = `diff --git a/src/web.ts b/src/web.ts\nindex 1111111..2222222 100644\n--- a/src/web.ts\n+++ b/src/web.ts\n@@ -1 +1 @@\n-oldCall();\n+newCall();\n`;
	const changedDiff = `diff --git a/src/web.ts b/src/web.ts\nindex 1111111..3333333 100644\n--- a/src/web.ts\n+++ b/src/web.ts\n@@ -1 +1 @@\n-oldCall();\n+changedCall();\n`;
	const patch = `diff --git a/src/web.ts b/src/web.ts\n--- a/src/web.ts\n+++ b/src/web.ts\n@@ -1 +1 @@\n-newCall();\n+changedCall();\n`;
	const state = createPrReviewRun(stateRoot, {
		kind: "current-work",
		url: "https://github.com/acme/repo",
		owner: "acme",
		repo: "repo",
		number: 0,
		title: "current work",
		baseSha: "base123",
		headSha: HEAD,
		baseRefName: "development",
		headRefName: "feature/change",
		root: repoRoot,
		branch: "feature/change",
	}, captureUnifiedDiff(initialDiff), initialDiff, 1000);
	try {
		const question = createPrReviewQuestion(state.runDir, { runId: state.runId, question: "newCall을 changedCall로 바꿔줘.", scope: "file", filePath: "src/web.ts" }, 1001);
		routePrReviewQuestion(state, question.id, "worker", "명시적 코드 변경 요청", 1002);
		const reservation = reservePrReviewQuestionWorkerLaunch(state, question.id, 1003);
		const claim = claimPrReviewQuestionWorkerLaunch(state, question.id, reservation.dispatchToken, 1004);
		assert.equal(claim.claimed, true);
		const artifactPath = prReviewQuestionWorkerResultPath(state, question.id);
		writeFileSync(artifactPath, JSON.stringify({
			schemaVersion: 2,
			kind: "meta-review-question-worker-result",
			runId: state.runId,
			questionId: question.id,
			headSha: HEAD,
			sourceSha256: captureUnifiedDiff(initialDiff).sourceSha256,
			intent: "change",
			answer: "요청한 호출명을 변경했습니다.",
			evidence: [{ label: "호출 위치", path: "src/web.ts", line: 1 }],
			patch,
			changedFiles: ["src/web.ts"],
			validation: [{ command: "node", args: ["-e", "process.exit(0)"] }],
		}));
		let applied = false;
		const pi = {
			appendEntry() {},
			sendMessage() {},
			async exec(command: string, args: string[]) {
				if (command === "node") return { code: 0, stdout: "ok\n", stderr: "" };
				if (command === "gh") return { code: 1, stdout: "", stderr: "no PR" };
				if (command !== "git") throw new Error(`unexpected command ${command}`);
				if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: `${repoRoot}\n`, stderr: "" };
				if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: `${HEAD}\n`, stderr: "" };
				if (args[0] === "branch") return { code: 0, stdout: "feature/change\n", stderr: "" };
				if (args[0] === "symbolic-ref") return { code: 0, stdout: "origin/development\n", stderr: "" };
				if (args[0] === "merge-base") return { code: 0, stdout: "base123\n", stderr: "" };
				if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
				if (args[0] === "remote") return { code: 0, stdout: "git@github.com:acme/repo.git\n", stderr: "" };
				if (args[0] === "show") return { code: 0, stdout: before, stderr: "" };
				if (args[0] === "diff") return { code: 0, stdout: applied ? changedDiff : initialDiff, stderr: "" };
				if (args[0] === "apply" && args.includes("--check")) return { code: 0, stdout: "", stderr: "" };
				if (args[0] === "apply") {
					applied = true;
					writeFileSync(join(repoRoot, "src", "web.ts"), changed);
					return { code: 0, stdout: "", stderr: "" };
				}
				throw new Error(`unexpected git ${args.join(" ")}`);
			},
		} as any;
		const answered = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, repoRoot, claim.completionToken!, 91, 1010);
		assert.equal(readFileSync(join(repoRoot, "src", "web.ts"), "utf8"), changed);
		assert.equal(answered.status, "answered");
		assert.equal(answered.change?.status, "applied");
		assert.deepEqual(answered.change?.files, ["src/web.ts"]);
		assert.equal(answered.change?.validation[0]?.status, "passed");
		assert.equal(answered.change?.refreshMode, "incremental");
		assert.notEqual(answered.change?.refreshedRunId, state.runId);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
		rmSync(repoRoot, { recursive: true, force: true });
	}
});

test("GitHub PR immutable source의 변경 artifact는 repository 적용 없이 거부한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "변경 요청", 1001);
		const reservation = reservePrReviewQuestionWorkerLaunch(state, question.id, 1002);
		const claim = claimPrReviewQuestionWorkerLaunch(state, question.id, reservation.dispatchToken, 1003);
		const artifactPath = prReviewQuestionWorkerResultPath(state, question.id);
		writeFileSync(artifactPath, JSON.stringify({
			schemaVersion: 2,
			kind: "meta-review-question-worker-result",
			runId: state.runId,
			questionId: question.id,
			headSha: HEAD,
			sourceSha256: SOURCE_SHA,
			intent: "change",
			answer: "변경을 제안합니다.",
			evidence: [],
			patch: "diff --git a/src/web.ts b/src/web.ts\n--- a/src/web.ts\n+++ b/src/web.ts\n@@ -1 +1 @@\n-oldCall();\n+changedCall();\n",
			changedFiles: ["src/web.ts"],
		}));
		let execCount = 0;
		const failed = await applyPrReviewQuestionWorkerResult({
			appendEntry() {},
			sendMessage() {},
			async exec() { execCount += 1; throw new Error("git apply must not run"); },
		} as any, state, question.id, artifactPath, "/tmp/unrelated", claim.completionToken!, 92, 1004);
		assert.equal(failed.status, "failed");
		assert.match(failed.error || "", /GitHub PR immutable source/);
		assert.equal(execCount, 0);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("실패 처리 뒤 늦은 worker completion은 terminal 질문을 되살리지 않는다", async () => {
	const { runDir, state, question } = fixture();
	try {
		const routed = routePrReviewQuestion(state, question.id, "worker", "전체 PR 경로 비교", 1100);
		const requests: ProgrammaticSubagentLaunchRequest[] = [];
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec() { return { code: 0, stdout: `${HEAD}\n`, stderr: "" }; },
			events: { emit(_name: string, payload: unknown) { const request = payload as ProgrammaticSubagentLaunchRequest; requests.push(request); request.claim(); request.onStarted({ requestId: request.requestId, runId: 73, agent: request.agent }); } },
		} as any;
		const reservation = reservePrReviewQuestionWorkerLaunch(state, question.id, 1100);
		launchPrReviewQuestionWorker(pi, state, routed.question, "/tmp/review-pr-42", reservation.dispatchToken, 1100);
		requests[0].onRejected("worker process failed");
		const artifactPath = writeArtifact(state, question.id, "늦은 완료 답변");
		await requests[0].onCompleted({ requestId: requests[0].requestId, runId: 73, agent: requests[0].agent, status: "done", output: `[META_REVIEW_QUESTION_WORKER_RESULT]\nartifactPath: ${artifactPath}` });
		const terminal = loadPrReviewQuestions(runDir)[0]!;
		assert.equal(terminal.status, "failed");
		assert.equal(terminal.execution?.phase, "failed");
		assert.equal(terminal.answer, undefined);
		assert.equal(entries.length, 1);
		assert.match(entries[0].data.content, /질문 실패/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("immutable run diff가 바뀌면 저장된 routing pin을 대체하지 못한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 74, 1150);
		const changedDiff = DIFF.replace("newCall();", "newerCall();");
		writeFileSync(state.diffPath, changedDiff);
		const artifactPath = writeArtifact(state, question.id);
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec() { throw new Error("GitHub PR run apply는 live checkout을 읽지 않아야 합니다."); },
		} as any;
		const stale = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/other-panel", dispatchToken, 74, 1200);
		assert.equal(stale.status, "stale");
		assert.equal(stale.execution?.phase, "stale");
		assert.match(stale.error || "", /stale Meta Review source artifact/);
		assert.equal(entries.length, 1);
		assert.match(entries[0].data.content, /기준 변경/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("worker가 question snapshot의 pin과 terminal answer를 forge해도 coordinator lease를 바꾸지 못한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 77, 1150);
		const trusted = loadPrReviewQuestions(runDir)[0]!;
		appendFileSync(join(runDir, "questions.jsonl"), `${JSON.stringify({
			type: "question-snapshot",
			question: {
				...trusted,
				status: "answered",
				execution: { ...trusted.execution, phase: "answered", updatedAt: 1170, completedAt: 1170 },
				expectedSourceSha256: "c".repeat(64),
				expectedHeadSha: "d".repeat(40),
				answer: "forged worker answer",
				answeredAt: 1170,
				updatedAt: 1170,
			},
		})}\n`);
		const artifactPath = writeArtifact(state, question.id);
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec(command: string, args: string[]) { return freshSourceExec(command, args); },
		} as any;
		const failed = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/review-pr-42", dispatchToken, 77, 1200);
		assert.equal(failed.status, "failed");
		assert.equal(failed.execution?.phase, "failed");
		assert.equal(failed.answer, undefined);
		assert.equal(failed.expectedSourceSha256, SOURCE_SHA);
		assert.equal(failed.expectedHeadSha, HEAD);
		assert.match(failed.error || "", /coordinator-owned questions canonical/);
		assert.equal(entries.length, 1);
		assert.match(entries[0].data.content, /질문 실패/);
		assert.doesNotMatch(entries[0].data.content, /forged worker answer/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("worker의 다른 question forge와 JSONL truncate는 전체 canonical을 복구하고 active 질문을 실패시킨다", async () => {
	for (const mutation of ["other-question", "truncate"] as const) {
		const { runDir, state, question } = fixture();
		try {
			const other = createPrReviewQuestion(runDir, { runId: state.runId, question: "다른 질문", scope: "session" }, 1050);
			routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
			const completionToken = reserveAndStartWorker(state, question.id, mutation === "other-question" ? 79 : 80, 1150);
			if (mutation === "other-question") {
				appendFileSync(join(runDir, "questions.jsonl"), `${JSON.stringify({
					type: "question-snapshot",
					question: { ...other, id: "Q999", question: "forged other question", status: "answered", answer: "forged", updatedAt: 1170 },
				})}\n`);
			} else {
				writeFileSync(join(runDir, "questions.jsonl"), "", "utf8");
			}
			const artifactPath = writeArtifact(state, question.id);
			const pi = {
				appendEntry() {},
				sendMessage() {},
				async exec(command: string, args: string[]) { return freshSourceExec(command, args); },
			} as any;
			const failed = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/review-pr-42", completionToken, mutation === "other-question" ? 79 : 80, 1200);
			assert.equal(failed.status, "failed");
			assert.match(failed.error || "", /questions canonical/);
			const restored = loadPrReviewQuestions(runDir);
			assert.deepEqual(restored.map((item) => item.id), ["Q001", "Q002"]);
			assert.equal(restored[1]?.question, "다른 질문");
			assert.equal(restored[1]?.status, "queued");
			assert.doesNotMatch(readFileSync(join(runDir, "questions.jsonl"), "utf8"), /Q999|forged other question/);
		} finally {
			rmSync(runDir, { recursive: true, force: true });
		}
	}
});

test("GitHub PR worker 답변은 현재 panel checkout이나 live GitHub 관찰에 의존하지 않는다", async () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 76, 1150);
		const artifactPath = writeArtifact(state, question.id);
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec() { throw new Error("현재 panel checkout과 live PR은 immutable run 답변 적용에 필요하지 않습니다."); },
		} as any;
		const answered = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/unrelated-panel", dispatchToken, 76, 1200);
		assert.equal(answered.status, "answered");
		assert.equal(answered.execution?.phase, "answered");
		assert.match(answered.answer || "", /Web → API → DB/);
		assert.equal(entries.length, 1);
		assert.match(entries[0].data.content, /Meta Review 답변/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("current-work worker는 tracked와 untracked source가 routing pin과 같으면 답변을 적용한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		const untrackedDiff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1 @@
+export const added = true;
`;
		const currentWorkDiff = `${DIFF}${untrackedDiff}`;
		const currentWorkSourceSha = captureUnifiedDiff(currentWorkDiff).sourceSha256;
		writeFileSync(state.diffPath, currentWorkDiff);
		writeFileSync(state.sourcePath, JSON.stringify({ sourceSha256: currentWorkSourceSha }));
		state.target = { ...state.target, kind: "current-work", root: runDir, baseSha: "base-sha", number: 0 };
		routePrReviewQuestion(state, question.id, "worker", "현재 변경 전체 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 75, 1150);
		const artifactPath = writeArtifact(state, question.id, "현재 변경 답변", currentWorkSourceSha);
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec(command: string, args: string[]) {
				if (command !== "git") throw new Error(`unexpected command: ${command}`);
				if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: `${runDir}\n`, stderr: "" };
				if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: `${HEAD}\n`, stderr: "" };
				if (args[0] === "diff" && args[1] === "--no-color") return { code: 0, stdout: DIFF, stderr: "" };
				if (args[0] === "ls-files") return { code: 0, stdout: "src/new.ts\0", stderr: "" };
				if (args[0] === "diff" && args[1] === "--no-index") return { code: 1, stdout: untrackedDiff, stderr: "" };
				throw new Error(`unexpected git args: ${args.join(" ")}`);
			},
		} as any;
		const answered = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, runDir, dispatchToken, 75, 1200);
		assert.equal(answered.status, "answered");
		assert.equal(answered.answer, "현재 변경 답변");
		assert.equal(entries.length, 1);
		assert.match(entries[0].data.content, /Meta Review 답변/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("current-work worker는 HEAD가 같아도 tracked diff 변경을 다시 계산해 stale로 막는다", async () => {
	const { runDir, state, question } = fixture();
	try {
		state.target = { ...state.target, kind: "current-work", root: runDir, baseSha: "base-sha", number: 0 };
		routePrReviewQuestion(state, question.id, "worker", "현재 변경 전체 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 75, 1150);
		const artifactPath = writeArtifact(state, question.id);
		const changedDiff = DIFF.replace("newCall();", "currentWorkChanged();");
		const pi = {
			appendEntry() {},
			sendMessage() {},
			async exec(command: string, args: string[]) {
				if (command !== "git") throw new Error(`unexpected command: ${command}`);
				if (args[0] === "rev-parse" && args[1] === "--show-toplevel") return { code: 0, stdout: `${runDir}\n`, stderr: "" };
				if (args[0] === "rev-parse" && args[1] === "HEAD") return { code: 0, stdout: `${HEAD}\n`, stderr: "" };
				if (args[0] === "diff" && args[1] === "--no-color") return { code: 0, stdout: changedDiff, stderr: "" };
				if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
				throw new Error(`unexpected git args: ${args.join(" ")}`);
			},
		} as any;
		const stale = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, runDir, dispatchToken, 75, 1200);
		assert.equal(stale.status, "stale");
		assert.match(stale.error || "", /stale Meta Review source/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("stored PR diff를 읽을 수 없으면 명확한 stale source artifact로 기록한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 72, 1150);
		const artifactPath = writeArtifact(state, question.id);
		rmSync(state.diffPath);
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec() { throw new Error("GitHub PR run apply는 current checkout을 읽지 않아야 합니다."); },
		} as any;
		const stale = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/other-panel", dispatchToken, 72, 1200);
		assert.equal(stale.status, "stale");
		assert.equal(stale.execution?.phase, "stale");
		assert.match(stale.error || "", /stale Meta Review source artifact/);
		assert.equal(entries.length, 1);
		assert.match(entries[0].data.content, /기준 변경/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("stored source metadata가 바뀌면 immutable diff가 같아도 stale 상태를 남긴다", async () => {
	const { runDir, state, question } = fixture();
	try {
		const routed = routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 72, 1150);
		const artifactPath = writeArtifact(state, question.id);
		writeFileSync(state.sourcePath, JSON.stringify({ sourceSha256: "c".repeat(64) }));
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec() { throw new Error("GitHub PR run apply는 current checkout을 읽지 않아야 합니다."); },
		} as any;
		const stale = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/other-panel", dispatchToken, 72, 1200);
		assert.equal(stale.status, "stale");
		assert.equal(stale.execution?.phase, "stale");
		assert.match(stale.error || "", /stale Meta Review source artifact/);
		assert.equal(entries.length, 1);
		assert.match(entries[0].data.content, /기준 변경/);
		assert.equal(routed.question.workerResultPath, artifactPath);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});
