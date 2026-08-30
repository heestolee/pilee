import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	createQuestionRoutingExecution,
	normalizeQuestionExecution,
	routeQuestionExecution,
	updateQuestionExecutionPhase,
	type QuestionExecutionMode,
} from "../questions/runtime.ts";
import {
	PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT,
	type ProgrammaticSubagentCompleted,
	type ProgrammaticSubagentLaunchRequest,
} from "../subagent/programmatic.ts";
import {
	answerPrReviewQuestion,
	loadPrReviewQuestions,
	publishPrReviewQuestionTranscript,
	updatePrReviewQuestion,
	type PrReviewQuestion,
	type PrReviewQuestionEvidence,
} from "./chat.ts";
import type { PrReviewRunState } from "./run.ts";

const MAX_WORKER_RESULT_BYTES = 2 * 1024 * 1024;

interface MetaReviewQuestionWorkerArtifact {
	schemaVersion: 1;
	kind: "meta-review-question-worker-result";
	runId: string;
	questionId: string;
	headSha?: string;
	sourceSha256: string;
	answer: string;
	evidence: PrReviewQuestionEvidence[];
	uncertainty?: string;
}

export interface PrReviewQuestionRouteResult {
	question: PrReviewQuestion;
	mode: QuestionExecutionMode;
	workerLaunchRequired: boolean;
}

function currentQuestion(state: PrReviewRunState, questionId: string): PrReviewQuestion {
	const question = loadPrReviewQuestions(state.runDir).find((item) => item.id === questionId);
	if (!question) throw new Error(`unknown Meta Review question: ${questionId}`);
	return question;
}

function sourceSha256(state: PrReviewRunState): string {
	const source = JSON.parse(readFileSync(state.sourcePath, "utf8")) as { sourceSha256?: unknown };
	if (typeof source.sourceSha256 !== "string" || !source.sourceSha256) throw new Error("Meta Review sourceSha256가 없습니다.");
	return source.sourceSha256;
}

export function prReviewQuestionWorkerResultPath(state: PrReviewRunState, questionId: string): string {
	return join(state.runDir, "question-workers", `${questionId}.json`);
}

export function routePrReviewQuestion(
	state: PrReviewRunState,
	questionId: string,
	mode: QuestionExecutionMode,
	reason: string,
	now = Date.now(),
): PrReviewQuestionRouteResult {
	const question = currentQuestion(state, questionId);
	const currentExecution = normalizeQuestionExecution(question.execution) ?? createQuestionRoutingExecution(question.createdAt);
	if (currentExecution.mode === mode) return { question, mode, workerLaunchRequired: false };
	const execution = routeQuestionExecution(currentExecution, mode, reason, now);
	if (mode === "direct") {
		return {
			question: updatePrReviewQuestion(state.runDir, questionId, { status: "answering", execution, error: undefined }, now),
			mode,
			workerLaunchRequired: false,
		};
	}
	const workerResultPath = prReviewQuestionWorkerResultPath(state, questionId);
	mkdirSync(dirname(workerResultPath), { recursive: true });
	return {
		question: updatePrReviewQuestion(state.runDir, questionId, {
			status: "answering",
			execution,
			workerResultPath,
			workerRunId: undefined,
			error: undefined,
		}, now),
		mode,
		workerLaunchRequired: true,
	};
}

export function markPrReviewQuestionWorkerStarted(
	state: PrReviewRunState,
	questionId: string,
	workerRunId?: number,
	now = Date.now(),
): PrReviewQuestion {
	const question = currentQuestion(state, questionId);
	const execution = normalizeQuestionExecution(question.execution)?.mode === "worker"
		? updateQuestionExecutionPhase(question.execution, "worker-running", now)
		: updateQuestionExecutionPhase(routeQuestionExecution(question.execution, "worker", "기존 worker 실행 경로 호환", now), "worker-running", now);
	return updatePrReviewQuestion(state.runDir, questionId, {
		status: "answering",
		execution,
		workerRunId: Number.isInteger(workerRunId) ? workerRunId : question.workerRunId,
		error: undefined,
	}, now);
}

export function failPrReviewQuestionWorker(
	pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">,
	state: PrReviewRunState,
	questionId: string,
	error: string,
	workerRunId?: number,
	now = Date.now(),
): PrReviewQuestion {
	const question = currentQuestion(state, questionId);
	if (question.status === "answered") return question;
	const baseExecution = normalizeQuestionExecution(question.execution)?.mode === "worker"
		? question.execution
		: routeQuestionExecution(question.execution, "worker", "worker 실패 상태 복구", now);
	const failed = updatePrReviewQuestion(state.runDir, questionId, {
		status: "failed",
		execution: updateQuestionExecutionPhase(baseExecution, "failed", now),
		workerRunId: Number.isInteger(workerRunId) ? workerRunId : question.workerRunId,
		error: error.trim().slice(0, 2_000) || "Meta Review question worker failed",
	}, now);
	return publishPrReviewQuestionTranscript(pi, state, failed, "failed");
}

function normalizeEvidence(value: unknown): PrReviewQuestionEvidence[] {
	if (!Array.isArray(value)) return [];
	return value.slice(0, 100).map((item) => {
		if (!item || typeof item !== "object") throw new Error("worker evidence 항목이 객체가 아닙니다.");
		const record = item as Record<string, unknown>;
		const label = typeof record.label === "string" ? record.label.trim() : "";
		if (!label) throw new Error("worker evidence label이 없습니다.");
		const line = Number.isInteger(record.line) && Number(record.line) >= 1 ? Number(record.line) : undefined;
		return {
			label: label.slice(0, 300),
			path: typeof record.path === "string" && record.path.trim() ? record.path.trim() : undefined,
			line,
			url: typeof record.url === "string" && /^https?:\/\//u.test(record.url) ? record.url : undefined,
			note: typeof record.note === "string" && record.note.trim() ? record.note.trim().slice(0, 2_000) : undefined,
		};
	});
}

function readWorkerArtifact(state: PrReviewRunState, question: PrReviewQuestion, artifactPath: string): MetaReviewQuestionWorkerArtifact {
	const expectedPath = resolve(question.workerResultPath || "");
	const receivedPath = resolve(artifactPath);
	if (!question.workerResultPath || receivedPath !== expectedPath || receivedPath !== resolve(prReviewQuestionWorkerResultPath(state, question.id))) {
		throw new Error("Meta Review worker result path가 question 계약과 다릅니다.");
	}
	if (!existsSync(receivedPath)) throw new Error("Meta Review worker result artifact가 없습니다.");
	if (lstatSync(receivedPath).isSymbolicLink()) throw new Error("Meta Review worker result symlink는 허용하지 않습니다.");
	if (realpathSync(dirname(receivedPath)) !== realpathSync(dirname(expectedPath))) throw new Error("Meta Review worker result directory가 다릅니다.");
	const size = statSync(receivedPath).size;
	if (size <= 0 || size > MAX_WORKER_RESULT_BYTES) throw new Error("Meta Review worker result는 1 byte 이상 2MB 이하여야 합니다.");
	const raw = JSON.parse(readFileSync(receivedPath, "utf8")) as Record<string, unknown>;
	if (raw.schemaVersion !== 1 || raw.kind !== "meta-review-question-worker-result") throw new Error("Meta Review worker result schema가 다릅니다.");
	if (raw.runId !== state.runId || raw.questionId !== question.id) throw new Error("Meta Review worker result identity가 다릅니다.");
	if (raw.sourceSha256 !== sourceSha256(state)) throw new Error("Meta Review worker result source가 현재 review run과 다릅니다.");
	if ((state.target.headSha || undefined) !== (typeof raw.headSha === "string" && raw.headSha ? raw.headSha : undefined)) throw new Error("Meta Review worker result head가 현재 review run과 다릅니다.");
	const answer = typeof raw.answer === "string" ? raw.answer.trim() : "";
	if (!answer || answer.length > 32_000) throw new Error("Meta Review worker answer는 1자 이상 32000자 이하여야 합니다.");
	return {
		schemaVersion: 1,
		kind: "meta-review-question-worker-result",
		runId: state.runId,
		questionId: question.id,
		headSha: state.target.headSha,
		sourceSha256: String(raw.sourceSha256),
		answer,
		evidence: normalizeEvidence(raw.evidence),
		uncertainty: typeof raw.uncertainty === "string" && raw.uncertainty.trim() ? raw.uncertainty.trim().slice(0, 8_000) : undefined,
	};
}

async function assertObservedHead(pi: Pick<ExtensionAPI, "exec">, state: PrReviewRunState, cwd: string): Promise<void> {
	if (!state.target.headSha) return;
	const result = await pi.exec("git", ["rev-parse", "HEAD"], { cwd, timeout: 30_000 });
	if (result.code !== 0) throw new Error(`Meta Review worker checkout head를 확인하지 못했습니다: ${result.stderr || result.stdout}`);
	if (result.stdout.trim() !== state.target.headSha) throw new Error(`stale Meta Review checkout: expected ${state.target.headSha}, current ${result.stdout.trim()}`);
}

export async function applyPrReviewQuestionWorkerResult(
	pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage" | "exec">,
	state: PrReviewRunState,
	questionId: string,
	artifactPath: string,
	cwd: string,
	workerRunId?: number,
	now = Date.now(),
): Promise<PrReviewQuestion> {
	const question = currentQuestion(state, questionId);
	if (question.status === "answered") return question;
	try {
		await assertObservedHead(pi, state, cwd);
	} catch (error) {
		const baseExecution = normalizeQuestionExecution(question.execution)?.mode === "worker"
			? question.execution
			: routeQuestionExecution(question.execution, "worker", "worker 결과 적용 전 head 확인", now);
		const stale = updatePrReviewQuestion(state.runDir, questionId, {
			status: "stale",
			execution: updateQuestionExecutionPhase(baseExecution, "stale", now),
			workerRunId: Number.isInteger(workerRunId) ? workerRunId : question.workerRunId,
			error: error instanceof Error ? error.message : String(error),
		}, now);
		return publishPrReviewQuestionTranscript(pi, state, stale, "stale");
	}
	const artifact = readWorkerArtifact(state, question, artifactPath);
	const answered = answerPrReviewQuestion(state.runDir, questionId, artifact.answer, artifact.evidence, artifact.uncertainty, now);
	const completed = updatePrReviewQuestion(state.runDir, questionId, {
		execution: updateQuestionExecutionPhase(answered.execution, "answered", now),
		workerRunId: Number.isInteger(workerRunId) ? workerRunId : answered.workerRunId,
	}, now);
	return publishPrReviewQuestionTranscript(pi, state, completed, "answer");
}

export function buildPrReviewQuestionWorkerTask(state: PrReviewRunState, question: PrReviewQuestion, cwd: string): string {
	return `# Meta Review question worker request

현재 PR review run의 사용자 질문을 실제 source 근거로 조사하고 지정된 artifact 하나만 작성하세요.

- reviewCwd: ${cwd}
- runId: ${state.runId}
- sourcePath: ${state.sourcePath}
- expectedHeadSha: ${state.target.headSha || "(none)"}
- expectedSourceSha256: ${sourceSha256(state)}
- questionId: ${question.id}
- workerResultPath: ${question.workerResultPath}
- scope: ${question.scope}
- filePath: ${question.filePath || "(none)"}
- selection: ${JSON.stringify(question.selection || null)}
- evidenceIds: ${JSON.stringify(question.evidenceIds || [])}

## 사용자 질문
${question.question}

## 완료 계약
1. reviewCwd에서 git rev-parse HEAD를 확인하고 expected head와 다르면 artifact를 만들지 않습니다.
2. sourcePath의 immutable evidence와 필요한 실제 source/callsite/schema/test를 읽습니다.
3. repository, review run, 질문 JSONL은 수정하지 않습니다. routine broad validation을 실행하지 않습니다.
4. workerResultPath에 아래 JSON 하나만 씁니다: {"schemaVersion":1,"kind":"meta-review-question-worker-result","runId":"...","questionId":"...","headSha":"...","sourceSha256":"...","answer":"...","evidence":[{"label":"...","path":"...","line":1,"url":"...","note":"..."}],"uncertainty":"..."}.
5. 성공 stdout은 [META_REVIEW_QUESTION_WORKER_RESULT], artifactPath, runId, questionId, summary만 출력합니다.`;
}

function completionError(question: PrReviewQuestion, completion: ProgrammaticSubagentCompleted): string | undefined {
	if (completion.status === "error") return completion.error || completion.output || "Meta Review question worker가 실패했습니다.";
	if (!completion.output.includes("[META_REVIEW_QUESTION_WORKER_RESULT]")) return "Meta Review question worker 완료 marker가 없습니다.";
	const artifactPath = completion.output.match(/^artifactPath:\s*(.+)$/m)?.[1]?.trim();
	if (!artifactPath || resolve(artifactPath) !== resolve(question.workerResultPath || "")) return "Meta Review question worker artifactPath가 question 계약과 다릅니다.";
	return undefined;
}

export function launchPrReviewQuestionWorker(
	pi: ExtensionAPI,
	state: PrReviewRunState,
	question: PrReviewQuestion,
	cwd: string,
): boolean {
	if (!pi.events || typeof pi.events.emit !== "function") return false;
	let claimed = false;
	const request: ProgrammaticSubagentLaunchRequest = {
		kind: "programmatic-subagent-launch",
		requestId: `meta-review-question:${state.runId}:${question.id}:${question.execution?.updatedAt || question.updatedAt}`,
		agent: "meta-review-question-worker",
		task: buildPrReviewQuestionWorkerTask(state, question, cwd),
		contextMode: "isolated",
		claim: () => {
			if (claimed) return false;
			claimed = true;
			return true;
		},
		onStarted: ({ runId }) => { markPrReviewQuestionWorkerStarted(state, question.id, runId); },
		onCompleted: async (completion) => {
			const latest = currentQuestion(state, question.id);
			if (latest.status === "answered" || latest.status === "stale") return;
			const error = completionError(latest, completion);
			if (error) {
				failPrReviewQuestionWorker(pi, state, question.id, error, completion.runId);
				return;
			}
			const artifactPath = completion.output.match(/^artifactPath:\s*(.+)$/m)![1]!.trim();
			try {
				await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, cwd, completion.runId);
			} catch (applyError) {
				failPrReviewQuestionWorker(pi, state, question.id, applyError instanceof Error ? applyError.message : String(applyError), completion.runId);
			}
		},
		onRejected: (error) => { failPrReviewQuestionWorker(pi, state, question.id, error); },
	};
	pi.events.emit(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, request);
	if (!claimed) throw new Error("표준 subagent dispatcher가 Meta Review question launch request를 claim하지 않았습니다.");
	return true;
}
