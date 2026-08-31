import { randomUUID } from "node:crypto";
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
	launchProgrammaticQuestionWorker,
	type ProgrammaticSubagentCompleted,
} from "../subagent/programmatic.ts";
import {
	appendPrReviewQuestionCoordinatorSnapshot,
	assertPrReviewQuestionCanonicalIntegrity,
	isPrReviewQuestionTerminal,
	loadPrReviewQuestions,
	publishPrReviewQuestionTranscript,
	updatePrReviewQuestion,
	type PrReviewQuestion,
	type PrReviewQuestionEvidence,
} from "./chat.ts";
import { captureUnifiedDiff } from "./evidence.ts";
import type { PrReviewRunState } from "./run.ts";

const MAX_WORKER_RESULT_BYTES = 2 * 1024 * 1024;
const WORKER_LAUNCH_LEASE_MS = 30_000;
const TERMINAL_LEASE_RETENTION_MS = 10 * 60_000;

class PrReviewSourceStaleError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PrReviewSourceStaleError";
	}
}

function throwStaleSource(message: string): never {
	throw new PrReviewSourceStaleError(message);
}

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

export interface PrReviewQuestionSourcePin {
	sourceSha256: string;
	headSha?: string;
}

interface PrReviewQuestionWorkerLease {
	dispatchToken: string;
	completionToken?: string;
	pin: PrReviewQuestionSourcePin;
	trustedQuestion: PrReviewQuestion;
	phase: "reserved" | "claimed" | "terminal";
	expiresAt: number;
}

export interface PrReviewQuestionWorkerReservation {
	dispatchToken: string;
	dispatchRequired: boolean;
	expiresAt: number;
}

export interface PrReviewQuestionWorkerClaimResult {
	claimed: boolean;
	completionToken?: string;
	question: PrReviewQuestion;
}

interface PrReviewQuestionWorkerLeaseRegistry {
	leases: Map<string, PrReviewQuestionWorkerLease>;
}

const PR_REVIEW_QUESTION_WORKER_LEASE_REGISTRY = Symbol.for("pilee.meta-review.question-worker-lease-registry");

function workerLeaseRegistry(): PrReviewQuestionWorkerLeaseRegistry {
	const root = globalThis as typeof globalThis & { [PR_REVIEW_QUESTION_WORKER_LEASE_REGISTRY]?: PrReviewQuestionWorkerLeaseRegistry };
	return root[PR_REVIEW_QUESTION_WORKER_LEASE_REGISTRY] ??= { leases: new Map() };
}

const workerLaunchLeases = workerLeaseRegistry().leases;

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
	if (isPrReviewQuestionTerminal(question)) return { question, mode: currentExecution.mode ?? mode, workerLaunchRequired: false };
	if (currentExecution.mode === mode) {
		const workerLaunchRequired = mode === "worker"
			&& !Number.isInteger(question.workerRunId)
			&& ["escalating", "worker-starting"].includes(currentExecution.phase);
		return { question, mode, workerLaunchRequired };
	}
	const execution = routeQuestionExecution(currentExecution, mode, reason, now);
	if (mode === "direct") {
		return {
			question: updatePrReviewQuestion(state.runDir, questionId, { status: "answering", execution, error: undefined }, now),
			mode,
			workerLaunchRequired: false,
		};
	}
	const workerResultPath = prReviewQuestionWorkerResultPath(state, questionId);
	const expectedSourceSha256 = sourceSha256(state);
	mkdirSync(dirname(workerResultPath), { recursive: true });
	return {
		question: updatePrReviewQuestion(state.runDir, questionId, {
			status: "answering",
			execution,
			workerResultPath,
			workerRunId: undefined,
			expectedSourceSha256,
			expectedHeadSha: state.target.headSha,
			error: undefined,
		}, now),
		mode,
		workerLaunchRequired: true,
	};
}

export function markPrReviewQuestionWorkerStarted(
	state: PrReviewRunState,
	questionId: string,
	completionToken: string,
	workerRunId?: number,
	now = Date.now(),
): PrReviewQuestion {
	const lease = leaseForCompletion(state, questionId, completionToken);
	if (lease.phase === "terminal") return structuredClone(lease.trustedQuestion);
	if (lease.phase !== "claimed") throw new Error("Meta Review worker launch claim이 먼저 필요합니다.");
	const question = assertTrustedQuestionSnapshot(state, lease);
	const currentExecution = normalizeQuestionExecution(question.execution);
	if (currentExecution?.phase === "worker-running" && question.workerRunId === workerRunId) return question;
	const execution = currentExecution?.mode === "worker"
		? updateQuestionExecutionPhase(question.execution, "worker-running", now)
		: updateQuestionExecutionPhase(routeQuestionExecution(question.execution, "worker", "기존 worker 실행 경로 호환", now), "worker-running", now);
	return appendLeaseQuestion(state, lease, {
		...question,
		status: "answering",
		execution,
		workerRunId: Number.isInteger(workerRunId) ? workerRunId : question.workerRunId,
		error: undefined,
		updatedAt: now,
	});
}

export function failPrReviewQuestionWorker(
	pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">,
	state: PrReviewRunState,
	questionId: string,
	completionToken: string,
	error: string,
	workerRunId?: number,
	now = Date.now(),
): PrReviewQuestion {
	const lease = leaseForCompletion(state, questionId, completionToken);
	if (lease.phase === "terminal") return structuredClone(lease.trustedQuestion);
	let message = error.trim().slice(0, 2_000) || "Meta Review question worker failed";
	try {
		assertTrustedQuestionSnapshot(state, lease);
	} catch (integrityError) {
		message = `${integrityError instanceof Error ? integrityError.message : String(integrityError)} ${message}`.trim().slice(0, 2_000);
	}
	const question = lease.trustedQuestion;
	const currentExecution = normalizeQuestionExecution(question.execution);
	const workerExecution = currentExecution?.mode === "worker"
		? question.execution
		: routeQuestionExecution(question.execution, "worker", "기존 worker 실행 경로 호환", now);
	const execution = updateQuestionExecutionPhase(workerExecution, "failed", now);
	return terminalLeaseQuestion(pi, state, lease, {
		...question,
		status: "failed",
		execution,
		answer: undefined,
		evidence: undefined,
		uncertainty: undefined,
		answeredAt: undefined,
		workerRunId: Number.isInteger(workerRunId) ? workerRunId : question.workerRunId,
		error: message,
		updatedAt: now,
	}, "failed");
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

function readWorkerArtifact(state: PrReviewRunState, question: PrReviewQuestion, artifactPath: string, pin: PrReviewQuestionSourcePin): MetaReviewQuestionWorkerArtifact {
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
	if (raw.sourceSha256 !== pin.sourceSha256) throw new Error("Meta Review worker result source가 routing snapshot과 다릅니다.");
	if ((pin.headSha || undefined) !== (typeof raw.headSha === "string" && raw.headSha ? raw.headSha : undefined)) throw new Error("Meta Review worker result head가 routing snapshot과 다릅니다.");
	const answer = typeof raw.answer === "string" ? raw.answer.trim() : "";
	if (!answer || answer.length > 32_000) throw new Error("Meta Review worker answer는 1자 이상 32000자 이하여야 합니다.");
	return {
		schemaVersion: 1,
		kind: "meta-review-question-worker-result",
		runId: state.runId,
		questionId: question.id,
		headSha: pin.headSha,
		sourceSha256: String(raw.sourceSha256),
		answer,
		evidence: normalizeEvidence(raw.evidence),
		uncertainty: typeof raw.uncertainty === "string" && raw.uncertainty.trim() ? raw.uncertainty.trim().slice(0, 8_000) : undefined,
	};
}

function sourcePin(question: PrReviewQuestion): PrReviewQuestionSourcePin {
	if (!question.expectedSourceSha256) throw new Error("Meta Review worker question에 routing source pin이 없습니다.");
	return { sourceSha256: question.expectedSourceSha256, headSha: question.expectedHeadSha };
}

function workerLeaseKey(state: PrReviewRunState, questionId: string): string {
	return `${resolve(state.runDir)}\u0000${questionId}`;
}

function sameQuestionSnapshot(left: PrReviewQuestion, right: PrReviewQuestion): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function leaseForToken(state: PrReviewRunState, questionId: string, dispatchToken: string): PrReviewQuestionWorkerLease {
	const lease = workerLaunchLeases.get(workerLeaseKey(state, questionId));
	if (!lease || lease.dispatchToken !== dispatchToken) throw new Error("Meta Review worker dispatch token이 coordinator launch lease와 다릅니다.");
	return lease;
}

function leaseForCompletion(state: PrReviewRunState, questionId: string, completionToken: string): PrReviewQuestionWorkerLease {
	const lease = workerLaunchLeases.get(workerLeaseKey(state, questionId));
	if (!lease || !lease.completionToken || lease.completionToken !== completionToken || lease.phase === "reserved") {
		throw new Error("Meta Review worker completion token이 claim winner lease와 다릅니다.");
	}
	return lease;
}

function assertTrustedQuestionSnapshot(state: PrReviewRunState, lease: PrReviewQuestionWorkerLease): PrReviewQuestion {
	assertPrReviewQuestionCanonicalIntegrity(state.runDir);
	const latest = currentQuestion(state, lease.trustedQuestion.id);
	if (!sameQuestionSnapshot(latest, lease.trustedQuestion)) {
		throw new Error("Meta Review worker가 coordinator-owned question snapshot을 변경했습니다.");
	}
	return latest;
}

function appendLeaseQuestion(state: PrReviewRunState, lease: PrReviewQuestionWorkerLease, question: PrReviewQuestion): PrReviewQuestion {
	const appended = appendPrReviewQuestionCoordinatorSnapshot(state.runDir, question);
	lease.trustedQuestion = structuredClone(appended);
	return appended;
}

function terminalLeaseQuestion(
	pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">,
	state: PrReviewRunState,
	lease: PrReviewQuestionWorkerLease,
	question: PrReviewQuestion,
	eventKind: "answer" | "failed" | "stale",
): PrReviewQuestion {
	const appended = appendLeaseQuestion(state, lease, question);
	lease.phase = "terminal";
	lease.expiresAt = question.updatedAt + TERMINAL_LEASE_RETENTION_MS;
	const published = publishPrReviewQuestionTranscript(pi, state, appended, eventKind);
	lease.trustedQuestion = structuredClone(published);
	return published;
}

function prunePrReviewQuestionWorkerLeases(now: number): void {
	for (const [key, lease] of workerLaunchLeases) {
		if (lease.phase !== "claimed" && now >= lease.expiresAt) workerLaunchLeases.delete(key);
	}
}

export function reservePrReviewQuestionWorkerLaunch(
	state: PrReviewRunState,
	questionId: string,
	now = Date.now(),
): PrReviewQuestionWorkerReservation {
	prunePrReviewQuestionWorkerLeases(now);
	const key = workerLeaseKey(state, questionId);
	const existing = workerLaunchLeases.get(key);
	if (existing && (existing.phase !== "reserved" || now < existing.expiresAt)) {
		assertTrustedQuestionSnapshot(state, existing);
		return { dispatchToken: existing.dispatchToken, dispatchRequired: false, expiresAt: existing.expiresAt };
	}
	const question = currentQuestion(state, questionId);
	if (isPrReviewQuestionTerminal(question)) throw new Error(`terminal Meta Review question은 worker launch를 예약할 수 없습니다: ${questionId}`);
	if (normalizeQuestionExecution(question.execution)?.mode !== "worker") throw new Error(`worker route가 없는 Meta Review question입니다: ${questionId}`);
	const lease: PrReviewQuestionWorkerLease = {
		dispatchToken: randomUUID(),
		pin: sourcePin(question),
		trustedQuestion: structuredClone(question),
		phase: "reserved",
		expiresAt: now + WORKER_LAUNCH_LEASE_MS,
	};
	workerLaunchLeases.set(key, lease);
	return { dispatchToken: lease.dispatchToken, dispatchRequired: true, expiresAt: lease.expiresAt };
}

export function claimPrReviewQuestionWorkerLaunch(
	state: PrReviewRunState,
	questionId: string,
	dispatchToken: string,
	now = Date.now(),
): PrReviewQuestionWorkerClaimResult {
	const lease = workerLaunchLeases.get(workerLeaseKey(state, questionId));
	if (!lease || lease.dispatchToken !== dispatchToken || lease.phase !== "reserved" || now >= lease.expiresAt) {
		return { claimed: false, question: lease?.trustedQuestion ?? currentQuestion(state, questionId) };
	}
	assertTrustedQuestionSnapshot(state, lease);
	lease.phase = "claimed";
	lease.completionToken = randomUUID();
	return { claimed: true, completionToken: lease.completionToken, question: structuredClone(lease.trustedQuestion) };
}

function releasePrReviewQuestionWorkerClaim(state: PrReviewRunState, questionId: string, dispatchToken: string): void {
	const lease = leaseForToken(state, questionId, dispatchToken);
	if (lease.phase === "claimed") {
		lease.phase = "reserved";
		lease.completionToken = undefined;
	}
}

async function execText(
	pi: Pick<ExtensionAPI, "exec">,
	command: string,
	args: string[],
	cwd: string,
	allowDiffExit = false,
): Promise<string> {
	const result = await pi.exec(command, args, { cwd, timeout: 120_000 });
	if (result.code !== 0 && !(allowDiffExit && result.code === 1)) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
	return result.stdout;
}

function capturedPrRunSourceSha256(state: PrReviewRunState): string {
	try {
		const diff = readFileSync(state.diffPath, "utf8");
		if (!diff.trim()) throwStaleSource("stale Meta Review source artifact: 저장된 PR diff가 비어 있습니다.");
		const captured = captureUnifiedDiff(diff).sourceSha256;
		const declared = sourceSha256(state);
		if (captured !== declared) throwStaleSource(`stale Meta Review source artifact: declared ${declared}, captured ${captured}`);
		return captured;
	} catch (error) {
		if (error instanceof PrReviewSourceStaleError) throw error;
		throwStaleSource(`stale Meta Review source artifact: ${error instanceof Error ? error.message : String(error)}`);
	}
}

async function observedCurrentWorkSourceSha256(
	pi: Pick<ExtensionAPI, "exec">,
	state: PrReviewRunState,
	cwd: string,
	pin: PrReviewQuestionSourcePin,
): Promise<string> {
	const root = (await execText(pi, "git", ["rev-parse", "--show-toplevel"], cwd)).trim();
	const head = (await execText(pi, "git", ["rev-parse", "HEAD"], root)).trim();
	if (pin.headSha && head !== pin.headSha) throwStaleSource(`stale Meta Review checkout: expected ${pin.headSha}, current ${head}`);
	if (state.target.root && realpathSync(root) !== realpathSync(state.target.root)) throwStaleSource(`stale Meta Review root: expected ${state.target.root}, current ${root}`);
	let diff = await execText(pi, "git", ["diff", "--no-color", "--find-renames", state.target.baseSha ?? "HEAD"], root);
	const untracked = (await execText(pi, "git", ["ls-files", "--others", "--exclude-standard", "-z"], root)).split("\0").filter(Boolean);
	for (const path of untracked) {
		const addition = await execText(pi, "git", ["diff", "--no-index", "--no-color", "--", "/dev/null", path], root, true);
		diff += `${diff && !diff.endsWith("\n") ? "\n" : ""}${addition}`;
	}
	if (!diff.trim()) throwStaleSource("stale Meta Review source: 현재 diff가 비어 있습니다.");
	return captureUnifiedDiff(diff).sourceSha256;
}

async function assertObservedReviewSource(
	pi: Pick<ExtensionAPI, "exec">,
	state: PrReviewRunState,
	cwd: string,
	pin: PrReviewQuestionSourcePin,
): Promise<void> {
	const observed = state.target.kind === "current-work"
		? await observedCurrentWorkSourceSha256(pi, state, cwd, pin)
		: capturedPrRunSourceSha256(state);
	if (observed !== pin.sourceSha256) throwStaleSource(`stale Meta Review source: expected ${pin.sourceSha256}, current ${observed}`);
}

export async function applyPrReviewQuestionWorkerResult(
	pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage" | "exec">,
	state: PrReviewRunState,
	questionId: string,
	artifactPath: string,
	cwd: string,
	completionToken: string,
	workerRunId?: number,
	now = Date.now(),
): Promise<PrReviewQuestion> {
	const lease = leaseForCompletion(state, questionId, completionToken);
	if (lease.phase === "terminal") return structuredClone(lease.trustedQuestion);
	try {
		assertTrustedQuestionSnapshot(state, lease);
	} catch (error) {
		return failPrReviewQuestionWorker(pi, state, questionId, completionToken, error instanceof Error ? error.message : String(error), workerRunId, now);
	}
	try {
		await assertObservedReviewSource(pi, state, cwd, lease.pin);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		try {
			assertTrustedQuestionSnapshot(state, lease);
		} catch (integrityError) {
			return failPrReviewQuestionWorker(pi, state, questionId, completionToken, integrityError instanceof Error ? integrityError.message : String(integrityError), workerRunId, now);
		}
		if (error instanceof PrReviewSourceStaleError) {
			const question = lease.trustedQuestion;
			const execution = updateQuestionExecutionPhase(question.execution, "stale", now);
			return terminalLeaseQuestion(pi, state, lease, {
				...question,
				status: "stale",
				execution,
				workerRunId: Number.isInteger(workerRunId) ? workerRunId : question.workerRunId,
				error: message || "Meta Review review source가 변경되었습니다.",
				updatedAt: now,
			}, "stale");
		}
		return failPrReviewQuestionWorker(pi, state, questionId, completionToken, message, workerRunId, now);
	}
	try {
		assertTrustedQuestionSnapshot(state, lease);
		const question = lease.trustedQuestion;
		const artifact = readWorkerArtifact(state, question, artifactPath, lease.pin);
		const execution = updateQuestionExecutionPhase(question.execution, "answered", now);
		return terminalLeaseQuestion(pi, state, lease, {
			...question,
			status: "answered",
			execution,
			answer: artifact.answer,
			evidence: artifact.evidence,
			uncertainty: artifact.uncertainty,
			error: undefined,
			answeredAt: now,
			workerRunId: Number.isInteger(workerRunId) ? workerRunId : question.workerRunId,
			updatedAt: now,
		}, "answer");
	} catch (error) {
		return failPrReviewQuestionWorker(pi, state, questionId, completionToken, error instanceof Error ? error.message : String(error), workerRunId, now);
	}
}

export function buildPrReviewQuestionWorkerTask(state: PrReviewRunState, question: PrReviewQuestion, cwd: string): string {
	const repository = state.target.kind === "current-work" ? "(current-work)" : `${state.target.owner}/${state.target.repo}`;
	const sourceContract = state.target.kind === "current-work"
		? `reviewCwd는 current-work source root입니다. 실제 파일을 이 root에서 읽고 현재 tracked·untracked diff가 sourcePath와 같은지 유지합니다.`
		: `reviewCwd는 worker 실행 위치일 뿐 reviewed checkout이 아닙니다. 현재 checkout HEAD를 요구하지 마세요. sourcePath의 immutable evidence를 우선하고, 추가 source는 repository=${repository}의 expectedHeadSha를 ref로 지정한 gh api 또는 동등한 pinned git-object 조회로 읽으세요. plain working-tree 파일을 reviewed source로 사용하지 않습니다.`;
	return `# Meta Review question worker request

현재 PR review run의 사용자 질문을 실제 source 근거로 조사하고 지정된 artifact 하나만 작성하세요. 질문과 답변의 대화 맥락은 메인 Pi session이 소유하며, worker는 Study Hard와 같은 비동기 결과 생산자입니다.

- reviewCwd: ${cwd}
- sourceMode: ${state.target.kind === "current-work" ? "current-work-live" : "github-pr-immutable"}
- repository: ${repository}
- runId: ${state.runId}
- sourcePath: ${state.sourcePath}
- expectedHeadSha: ${question.expectedHeadSha || "(none)"}
- expectedSourceSha256: ${question.expectedSourceSha256 || "(missing)"}
- questionId: ${question.id}
- workerResultPath: ${question.workerResultPath}
- scope: ${question.scope}
- sectionId: ${question.sectionId || "(none)"}
- meaningId: ${question.meaningId || "(none)"}
- declarationId: ${question.declarationId || "(none)"}
- declarationSide: ${question.declarationSide || "(none)"}
- filePath: ${question.filePath || "(none)"}
- selection: ${JSON.stringify(question.selection || null)}
- evidenceIds: ${JSON.stringify(question.evidenceIds || [])}
- attachments: ${JSON.stringify(question.attachments || [])}

## 사용자 질문
${question.question}

## source 계약
${sourceContract}
expectedSourceSha256는 sourcePath 파일 바이트의 SHA-256이 아닙니다. sourcePath JSON의 sourceSha256 필드이며 normalized source.diff의 identity입니다. sourcePath 자체를 shasum하지 말고 이 필드값을 artifact에 그대로 사용하세요.

## 완료 계약
1. sourcePath의 immutable evidence와 필요한 실제 source/callsite/schema/test를 pinned source 계약에 따라 읽습니다.
2. repository, review run, 질문 JSONL은 수정하지 않습니다. routine broad validation을 실행하지 않습니다.
3. workerResultPath에 아래 JSON 하나만 씁니다: {"schemaVersion":1,"kind":"meta-review-question-worker-result","runId":"...","questionId":"...","headSha":"...","sourceSha256":"...","answer":"...","evidence":[{"label":"...","path":"...","line":1,"url":"...","note":"..."}],"uncertainty":"..."}.
4. 성공 stdout은 [META_REVIEW_QUESTION_WORKER_RESULT], artifactPath, runId, questionId, summary만 출력합니다.`;
}

function completionError(question: PrReviewQuestion, completion: ProgrammaticSubagentCompleted): string | undefined {
	if (completion.status === "error") return completion.error || completion.output || "Meta Review question worker가 실패했습니다.";
	if (!completion.output.includes("[META_REVIEW_QUESTION_WORKER_RESULT]")) return "Meta Review question worker 완료 marker가 없습니다.";
	const artifactPath = completion.output.match(/^artifactPath:\s*(.+)$/m)?.[1]?.trim();
	if (!artifactPath || resolve(artifactPath) !== resolve(question.workerResultPath || "")) return "Meta Review question worker artifactPath가 question 계약과 다릅니다.";
	return undefined;
}

export function dispatchPrReviewQuestionToWorker(
	pi: ExtensionAPI,
	state: PrReviewRunState,
	question: PrReviewQuestion,
	cwd: string,
	now = Date.now(),
): PrReviewQuestion {
	publishPrReviewQuestionTranscript(pi, state, question, "question");
	try {
		const routed = routePrReviewQuestion(state, question.id, "worker", "Code Review drawer 요청은 공통 background worker가 처리합니다.", now);
		if (!routed.workerLaunchRequired) return routed.question;
		const reservation = reservePrReviewQuestionWorkerLaunch(state, question.id, now);
		if (!reservation.dispatchRequired) return currentQuestion(state, question.id);
		if (!launchPrReviewQuestionWorker(pi, state, routed.question, cwd, reservation.dispatchToken, now)) {
			throw new Error("표준 subagent dispatcher가 Meta Review launch request를 claim하지 않았습니다.");
		}
		return currentQuestion(state, question.id);
	} catch (error) {
		const failed = updatePrReviewQuestion(state.runDir, question.id, {
			status: "failed",
			execution: updateQuestionExecutionPhase(routeQuestionExecution(question.execution, "worker", "background worker launch 실패", now), "failed", now),
			error: error instanceof Error ? error.message : String(error),
		}, now);
		publishPrReviewQuestionTranscript(pi, state, failed, "failed");
		throw error;
	}
}

export function launchPrReviewQuestionWorker(
	pi: ExtensionAPI,
	state: PrReviewRunState,
	question: PrReviewQuestion,
	cwd: string,
	dispatchToken: string,
	now = Date.now(),
): boolean {
	if (!pi.events || typeof pi.events.emit !== "function") return false;
	const launchClaim = claimPrReviewQuestionWorkerLaunch(state, question.id, dispatchToken, now);
	if (!launchClaim.claimed || !launchClaim.completionToken) return false;
	const completionToken = launchClaim.completionToken;
	let launched = false;
	try {
		launched = launchProgrammaticQuestionWorker(pi, {
			requestId: `meta-review-question:${state.runId}:${question.id}:${dispatchToken}`,
			agent: "meta-review-question-worker",
			task: buildPrReviewQuestionWorkerTask(state, launchClaim.question, cwd),
			onStarted: ({ runId }) => { markPrReviewQuestionWorkerStarted(state, question.id, completionToken, runId); },
			onCompleted: async (completion) => {
				const lease = leaseForCompletion(state, question.id, completionToken);
				if (lease.phase === "terminal") return;
				const error = completionError(lease.trustedQuestion, completion);
				if (error) {
					failPrReviewQuestionWorker(pi, state, question.id, completionToken, error, completion.runId);
					return;
				}
				const artifactPath = completion.output.match(/^artifactPath:\s*(.+)$/m)![1]!.trim();
				try {
					await applyPrReviewQuestionWorkerResult(pi, state, question.id, artifactPath, cwd, completionToken, completion.runId);
				} catch (applyError) {
					failPrReviewQuestionWorker(pi, state, question.id, completionToken, applyError instanceof Error ? applyError.message : String(applyError), completion.runId);
				}
			},
			onRejected: (error) => { failPrReviewQuestionWorker(pi, state, question.id, completionToken, error); },
		});
	} catch (error) {
		releasePrReviewQuestionWorkerClaim(state, question.id, dispatchToken);
		throw error;
	}
	if (!launched) {
		releasePrReviewQuestionWorkerClaim(state, question.id, dispatchToken);
		return false;
	}
	return true;
}
