import assert from "node:assert/strict";
import { test } from "node:test";
import {
	inferQuestionExecution,
	normalizeQuestionExecution,
	questionExecutionNeedsPolling,
	routeQuestionExecution,
	updateQuestionExecutionPhase,
} from "./runtime.ts";

test("구버전 Study Hard와 Meta Review 질문은 기존 실행 방식으로 추론한다", () => {
	assert.deepEqual(inferQuestionExecution({
		fallbackMode: "worker",
		processingStatus: "running",
		orchestrationId: "worker-legacy",
		workerRunId: 17,
		createdAt: 100,
	}), {
		mode: "worker",
		phase: "worker-running",
		routedAt: 100,
		updatedAt: 100,
		completedAt: undefined,
	});
	assert.deepEqual(inferQuestionExecution({
		fallbackMode: "direct",
		status: "answering",
		createdAt: 200,
	}), {
		mode: "direct",
		phase: "answering",
		routedAt: 200,
		updatedAt: 200,
		completedAt: undefined,
	});
});

test("새 질문은 의미 판단 결과를 direct 또는 worker route로 기록한다", () => {
	assert.deepEqual(routeQuestionExecution(undefined, "direct", "현재 선택 문맥으로 답할 수 있음", 100), {
		mode: "direct",
		phase: "answering",
		reason: "현재 선택 문맥으로 답할 수 있음",
		escalatedFrom: undefined,
		routedAt: 100,
		updatedAt: 100,
	});
	assert.deepEqual(routeQuestionExecution(undefined, "worker", "외부 자료 조사가 필요함", 200), {
		mode: "worker",
		phase: "worker-starting",
		reason: "외부 자료 조사가 필요함",
		escalatedFrom: undefined,
		routedAt: 200,
		updatedAt: 200,
	});
});

test("direct 질문은 같은 ID와 최초 route 시각을 유지한 채 worker로 한 번 승격한다", () => {
	const direct = routeQuestionExecution(undefined, "direct", "현재 문맥 우선", 100);
	const escalated = routeQuestionExecution(direct, "worker", "실행 검증 축이 새로 발견됨", 150);
	assert.deepEqual(escalated, {
		mode: "worker",
		phase: "escalating",
		reason: "실행 검증 축이 새로 발견됨",
		escalatedFrom: "direct",
		routedAt: 100,
		updatedAt: 150,
	});
	assert.throws(() => routeQuestionExecution(escalated, "direct", "되돌리기", 200), /direct로 되돌릴 수 없습니다/);
});

test("execution phase는 mode 경계를 지키고 terminal 상태를 다시 열지 않는다", () => {
	const worker = routeQuestionExecution(undefined, "worker", undefined, 100);
	const running = updateQuestionExecutionPhase(worker, "worker-running", 120);
	const answered = updateQuestionExecutionPhase(running, "answered", 150);
	assert.equal(questionExecutionNeedsPolling(running), true);
	assert.equal(questionExecutionNeedsPolling(answered), false);
	assert.equal(answered.completedAt, 150);
	assert.throws(() => updateQuestionExecutionPhase(answered, "worker-running", 200), /완료된 질문 phase/);
	assert.throws(() => updateQuestionExecutionPhase(routeQuestionExecution(undefined, "direct", undefined, 100), "worker-running", 120), /direct 질문/);
});

test("malformed execution metadata는 구버전 fallback을 위해 무시한다", () => {
	assert.equal(normalizeQuestionExecution({ mode: "automatic", phase: "thinking" }), undefined);
	const inferred = inferQuestionExecution({
		execution: { mode: "automatic", phase: "thinking" },
		fallbackMode: "direct",
		status: "answered",
		updatedAt: 300,
	});
	assert.equal(inferred.mode, "direct");
	assert.equal(inferred.phase, "answered");
});
