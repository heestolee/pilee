import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createPrReviewQuestion, loadPrReviewQuestions } from "./chat.ts";
import {
	applyPrReviewQuestionWorkerResult,
	launchPrReviewQuestionWorker,
	prReviewQuestionWorkerResultPath,
	routePrReviewQuestion,
} from "./question-worker.ts";
import type { PrReviewRunState } from "./run.ts";
import type { ProgrammaticSubagentLaunchRequest } from "../subagent/programmatic.ts";

const HEAD = "b".repeat(40);
const SOURCE_SHA = "source-sha-1";

function fixture() {
	const runDir = mkdtempSync(join(tmpdir(), "pilee-meta-review-question-worker-"));
	const sourcePath = join(runDir, "source.json");
	writeFileSync(sourcePath, JSON.stringify({ sourceSha256: SOURCE_SHA }));
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

function writeArtifact(state: PrReviewRunState, questionId: string, answer = "호출 경로는 Web → API → DB 순서입니다."): string {
	const path = prReviewQuestionWorkerResultPath(state, questionId);
	writeFileSync(path, JSON.stringify({
		schemaVersion: 1,
		kind: "meta-review-question-worker-result",
		runId: state.runId,
		questionId,
		headSha: HEAD,
		sourceSha256: SOURCE_SHA,
		answer,
		evidence: [{ label: "호출 시작점", path: "src/web.ts", line: 10 }],
		uncertainty: "운영 빈도는 확인하지 않았습니다.",
	}));
	return path;
}

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

test("programmatic Meta Review worker는 head/source가 고정된 artifact를 답변으로 적용한다", async () => {
	const { runDir, state, question } = fixture();
	try {
		const routed = routePrReviewQuestion(state, question.id, "worker", "전체 PR 경로 비교", 1100);
		const requests: ProgrammaticSubagentLaunchRequest[] = [];
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec() { return { code: 0, stdout: `${HEAD}\n`, stderr: "" }; },
			events: {
				emit(_name: string, payload: unknown) {
					const request = payload as ProgrammaticSubagentLaunchRequest;
					requests.push(request);
					request.claim();
					request.onStarted({ requestId: request.requestId, runId: 71, agent: request.agent, sessionFile: "/tmp/meta-review-worker.jsonl" });
				},
			},
		} as any;
		assert.equal(launchPrReviewQuestionWorker(pi, state, routed.question, "/tmp/review-pr-42"), true);
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

test("worker 완료 시 checkout head가 바뀌면 답변 대신 stale 상태를 남긴다", async () => {
	const { runDir, state, question } = fixture();
	try {
		const routed = routePrReviewQuestion(state, question.id, "worker", "전체 흐름 검증", 1100);
		const artifactPath = writeArtifact(state, question.id);
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage() {},
			async exec() { return { code: 0, stdout: `${"c".repeat(40)}\n`, stderr: "" }; },
		} as any;
		const stale = await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, "/tmp/review-pr-42", 72, 1200);
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
