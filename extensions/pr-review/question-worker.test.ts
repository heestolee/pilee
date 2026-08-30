import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPrReviewQuestion, loadPrReviewQuestions } from "./chat.ts";
import { captureUnifiedDiff } from "./evidence.ts";
import {
	applyPrReviewQuestionWorkerResult,
	buildPrReviewQuestionWorkerTask,
	claimPrReviewQuestionWorkerLaunch,
	failPrReviewQuestionWorker,
	launchPrReviewQuestionWorker,
	markPrReviewQuestionWorkerStarted,
	prReviewQuestionWorkerResultPath,
	reservePrReviewQuestionWorkerLaunch,
	routePrReviewQuestion,
} from "./question-worker.ts";
import type { PrReviewRunState } from "./run.ts";
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

test("Meta Review 질문 worker task는 첨부 이미지 provenance를 유지한다", () => {
	const { runDir, state } = fixture();
	try {
		const question = createPrReviewQuestion(runDir, {
			runId: state.runId,
			question: "첨부 이미지를 실제 코드와 비교해줘.",
			scope: "session",
			attachmentIds: ["review-image-1"],
			attachments: [{ id: "review-image-1", name: "review.png", mimeType: "image/png", path: "/tmp/review.png", url: "/attachments/review.png" }],
		}, 1001);
		const task = buildPrReviewQuestionWorkerTask(state, question, "/tmp/review-pr-42");
		assert.match(task, /review\.png/);
		assert.match(task, /\/tmp\/review\.png/);
		assert.doesNotMatch(task, /data:image/);
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

test("checkout source와 artifact가 함께 바뀌어도 저장된 routing pin을 대체하지 못한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 74, 1150);
		const changedDiff = DIFF.replace("newCall();", "newerCall();");
		const changedSourceSha = captureUnifiedDiff(changedDiff).sourceSha256;
		const artifactPath = writeArtifact(state, question.id, "바뀐 source 기준 답변", changedSourceSha);
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec(command: string, args: string[]) {
				if (command === "gh" && args[0] === "pr" && args[1] === "diff") return { code: 0, stdout: changedDiff, stderr: "" };
				return freshSourceExec(command, args);
			},
		} as any;
		const stale = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/review-pr-42", dispatchToken, 74, 1200);
		assert.equal(stale.status, "stale");
		assert.equal(stale.execution?.phase, "stale");
		assert.match(stale.error || "", /stale Meta Review source/);
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

test("source freshness 관찰 실패는 source 변경이 아니라 worker 실패로 기록한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 76, 1150);
		const artifactPath = writeArtifact(state, question.id);
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec(command: string, args: string[]) {
				if (command === "gh" && args[0] === "pr" && args[1] === "view") return { code: 1, stdout: "", stderr: "oauth token expired" };
				return freshSourceExec(command, args);
			},
		} as any;
		const failed = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/review-pr-42", dispatchToken, 76, 1200);
		assert.equal(failed.status, "failed");
		assert.equal(failed.execution?.phase, "failed");
		assert.match(failed.error || "", /oauth token expired/);
		assert.equal(entries.length, 1);
		assert.match(entries[0].data.content, /질문 실패/);
		assert.doesNotMatch(entries[0].data.content, /기준 변경/);
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

test("worker 완료 시 checkout head가 바뀌면 답변 대신 stale 상태를 남긴다", async () => {
	const { runDir, state, question } = fixture();
	try {
		const routed = routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
		const dispatchToken = reserveAndStartWorker(state, question.id, 72, 1150);
		const artifactPath = writeArtifact(state, question.id);
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec() { return { code: 0, stdout: `${"c".repeat(40)}\n`, stderr: "" }; },
		} as any;
		const stale = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/review-pr-42", dispatchToken, 72, 1200);
		assert.equal(stale.status, "stale");
		assert.equal(stale.execution?.phase, "stale");
		assert.match(stale.error || "", /stale Meta Review checkout/);
		assert.equal(entries.length, 1);
		assert.match(entries[0].data.content, /기준 변경/);
		assert.equal(routed.question.workerResultPath, artifactPath);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});
