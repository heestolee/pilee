export type QuestionExecutionMode = "direct" | "worker";

export type QuestionExecutionPhase =
	| "routing"
	| "answering"
	| "escalating"
	| "worker-starting"
	| "worker-running"
	| "answered"
	| "failed"
	| "stale";

export interface QuestionExecution {
	mode?: QuestionExecutionMode;
	phase: QuestionExecutionPhase;
	reason?: string;
	escalatedFrom?: "direct";
	routedAt: number;
	updatedAt: number;
	completedAt?: number;
}

interface LegacyQuestionExecutionInput {
	execution?: unknown;
	fallbackMode: QuestionExecutionMode;
	status?: unknown;
	processingStatus?: unknown;
	orchestrationId?: unknown;
	workerRunId?: unknown;
	updatedAt?: unknown;
	createdAt?: unknown;
}

const MODES = new Set<QuestionExecutionMode>(["direct", "worker"]);
const PHASES = new Set<QuestionExecutionPhase>([
	"routing",
	"answering",
	"escalating",
	"worker-starting",
	"worker-running",
	"answered",
	"failed",
	"stale",
]);
const TERMINAL_PHASES = new Set<QuestionExecutionPhase>(["answered", "failed", "stale"]);

function timestamp(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function reasonText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized ? normalized.slice(0, 300) : undefined;
}

export function normalizeQuestionExecution(value: unknown): QuestionExecution | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Record<string, unknown>;
	const phase = item.phase as QuestionExecutionPhase;
	const mode = MODES.has(item.mode as QuestionExecutionMode) ? item.mode as QuestionExecutionMode : undefined;
	if (!PHASES.has(phase) || (!mode && phase !== "routing")) return undefined;
	const routedAt = timestamp(item.routedAt, 0);
	const updatedAt = timestamp(item.updatedAt, routedAt);
	return {
		mode,
		phase,
		reason: reasonText(item.reason),
		escalatedFrom: item.escalatedFrom === "direct" ? "direct" : undefined,
		routedAt,
		updatedAt,
		completedAt: TERMINAL_PHASES.has(phase) ? timestamp(item.completedAt, updatedAt) : undefined,
	};
}

export function inferQuestionExecution(input: LegacyQuestionExecutionInput): QuestionExecution {
	const normalized = normalizeQuestionExecution(input.execution);
	if (normalized) return normalized;
	const now = timestamp(input.updatedAt, timestamp(input.createdAt, 0));
	const orchestrationId = typeof input.orchestrationId === "string" ? input.orchestrationId : "";
	const mode: QuestionExecutionMode = orchestrationId.startsWith("worker-") || Number.isInteger(input.workerRunId)
		? "worker"
		: orchestrationId.startsWith("pi-") ? "direct" : input.fallbackMode;
	const status = String(input.status || "");
	const processingStatus = String(input.processingStatus || "");
	let phase: QuestionExecutionPhase;
	if (status === "answered" || processingStatus === "applied") phase = "answered";
	else if (status === "failed" || processingStatus === "failed" || processingStatus === "conflict") phase = "failed";
	else if (mode === "worker") phase = processingStatus === "running" || ["result-ready", "merging", "rebasing"].includes(processingStatus) ? "worker-running" : "worker-starting";
	else phase = status === "queued" ? "routing" : "answering";
	return {
		mode,
		phase,
		routedAt: now,
		updatedAt: now,
		completedAt: TERMINAL_PHASES.has(phase) ? now : undefined,
	};
}

export function createQuestionRoutingExecution(now = Date.now()): QuestionExecution {
	return { phase: "routing", routedAt: now, updatedAt: now };
}

export function routeQuestionExecution(
	currentValue: unknown,
	mode: QuestionExecutionMode,
	reason: string | undefined,
	now = Date.now(),
): QuestionExecution {
	const current = normalizeQuestionExecution(currentValue);
	if (current && TERMINAL_PHASES.has(current.phase)) throw new Error(`완료된 질문은 다시 routing할 수 없습니다: ${current.phase}`);
	if (current?.mode === "worker" && mode === "direct") throw new Error("worker로 위임한 질문을 direct로 되돌릴 수 없습니다.");
	const escalating = current?.mode === "direct" && mode === "worker";
	return {
		mode,
		phase: escalating ? "escalating" : mode === "worker" ? (current?.phase === "worker-running" ? "worker-running" : "worker-starting") : "answering",
		reason: reasonText(reason) ?? current?.reason,
		escalatedFrom: escalating || current?.escalatedFrom === "direct" ? "direct" : undefined,
		routedAt: current?.routedAt ?? now,
		updatedAt: now,
	};
}

export function updateQuestionExecutionPhase(
	currentValue: unknown,
	phase: QuestionExecutionPhase,
	now = Date.now(),
): QuestionExecution {
	const current = normalizeQuestionExecution(currentValue);
	if (!current?.mode) throw new Error("질문 execution route가 먼저 필요합니다.");
	if (current.mode === "direct" && ["escalating", "worker-starting", "worker-running"].includes(phase)) {
		throw new Error(`direct 질문에는 ${phase} phase를 적용할 수 없습니다.`);
	}
	if (current.mode === "worker" && phase === "answering") throw new Error("worker 질문에는 direct answering phase를 적용할 수 없습니다.");
	if (TERMINAL_PHASES.has(current.phase) && current.phase !== phase) throw new Error(`완료된 질문 phase를 변경할 수 없습니다: ${current.phase}`);
	return {
		...current,
		phase,
		updatedAt: now,
		completedAt: TERMINAL_PHASES.has(phase) ? current.completedAt ?? now : undefined,
	};
}

export function questionExecutionNeedsPolling(value: unknown): boolean {
	const execution = normalizeQuestionExecution(value);
	return !!execution && !TERMINAL_PHASES.has(execution.phase);
}
