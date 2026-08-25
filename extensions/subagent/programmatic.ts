import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export const PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT = "pilee:subagent:programmatic-launch";
export const PROGRAMMATIC_SUBAGENT_LINEAGE_ENTRY = "subagent-programmatic-lineage";
export const PROGRAMMATIC_SUBAGENT_HOOKS = Symbol("pilee.subagent.programmatic-hooks");

export interface ProgrammaticSubagentStarted {
	requestId: string;
	runId: number;
	agent: string;
	sessionFile?: string;
}

export interface ProgrammaticSubagentCompleted extends ProgrammaticSubagentStarted {
	status: "done" | "error";
	output: string;
	error?: string;
}

export interface ProgrammaticSubagentLaunchRequest {
	kind: "programmatic-subagent-launch";
	requestId: string;
	agent: string;
	task: string;
	contextMode: "main" | "isolated";
	continueRunId?: number;
	claim: () => boolean;
	onStarted: (event: ProgrammaticSubagentStarted) => void;
	onCompleted: (event: ProgrammaticSubagentCompleted) => void | Promise<void>;
	onRejected: (error: string) => void;
}

export interface ProgrammaticSubagentHooks {
	requestId: string;
	onStarted: ProgrammaticSubagentLaunchRequest["onStarted"];
	onCompleted: ProgrammaticSubagentLaunchRequest["onCompleted"];
}

export interface ProgrammaticSubagentLineageMessage {
	customType: string;
	content: string;
	display: boolean;
	details?: Record<string, unknown>;
}

export function queueProgrammaticSubagentLineage(
	pi: Pick<ExtensionAPI, "appendEntry">,
	message: ProgrammaticSubagentLineageMessage,
): void {
	// Worker lifecycle is durable UI/history state, not a new P0 instruction.
	// Applying it through sendMessage() leaks it into a future LLM context where it
	// can be mistaken for a steering request during an unrelated implementation turn.
	try {
		pi.appendEntry(PROGRAMMATIC_SUBAGENT_LINEAGE_ENTRY, { message });
	} catch (error) {
		// A background programmatic worker can finish after print-mode shutdown,
		// reload, or session replacement. The old runtime can no longer own a durable
		// lineage row, but its completion callback must still run for the coordinator.
		if (error instanceof Error && /extension ctx is stale after session replacement or reload/i.test(error.message)) return;
		throw error;
	}
}

export function restoreProgrammaticSubagentLineageEntry(entry: unknown): Record<string, unknown> | undefined {
	if (!entry || typeof entry !== "object") return undefined;
	const candidate = entry as { type?: unknown; customType?: unknown; timestamp?: unknown; data?: { message?: unknown } };
	if (candidate.type !== "custom" || candidate.customType !== PROGRAMMATIC_SUBAGENT_LINEAGE_ENTRY) return undefined;
	if (!candidate.data?.message || typeof candidate.data.message !== "object") return undefined;
	return { type: "custom_message", timestamp: candidate.timestamp, ...(candidate.data.message as Record<string, unknown>) };
}

interface ProgrammaticExecuteResult {
	content?: Array<{ type?: string; text?: string }>;
	details?: { launches?: Array<{ runId?: number }> };
	isError?: boolean;
}

type ProgrammaticSubagentExecute = (
	toolCallId: string,
	params: Record<PropertyKey, unknown>,
	signal: AbortSignal | undefined,
	onUpdate: undefined,
	ctx: ExtensionContext,
) => Promise<ProgrammaticExecuteResult>;

function buildProgrammaticCommand(request: ProgrammaticSubagentLaunchRequest): string {
	const contextFlag = request.contextMode === "main" ? "--main" : "--isolated";
	if (request.continueRunId !== undefined) {
		return `subagent continue ${request.continueRunId} ${contextFlag} -- ${request.task}`;
	}
	return `subagent run ${request.agent} ${contextFlag} -- ${request.task}`;
}

function resultError(result: ProgrammaticExecuteResult): string {
	const text = result.content
		?.filter((part) => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
	return text || "표준 subagent dispatcher가 launch를 거부했습니다.";
}

interface ProgrammaticLauncherRegistry {
	owners: WeakMap<object, () => void>;
	activeRequestIds: WeakMap<object, Set<string>>;
}

const PROGRAMMATIC_LAUNCHER_REGISTRY = Symbol.for("pilee.subagent.programmatic-launcher-registry");

function programmaticLauncherRegistry(): ProgrammaticLauncherRegistry {
	const root = globalThis as typeof globalThis & { [PROGRAMMATIC_LAUNCHER_REGISTRY]?: ProgrammaticLauncherRegistry };
	return root[PROGRAMMATIC_LAUNCHER_REGISTRY] ??= {
		owners: new WeakMap<object, () => void>(),
		activeRequestIds: new WeakMap<object, Set<string>>(),
	};
}

export function registerProgrammaticSubagentLauncher(
	pi: ExtensionAPI,
	getCurrentContext: () => ExtensionContext | null,
	execute: ProgrammaticSubagentExecute,
): () => void {
	const registry = programmaticLauncherRegistry();
	registry.owners.get(pi as object)?.();
	const activeRequestIds = registry.activeRequestIds.get(pi as object) ?? new Set<string>();
	registry.activeRequestIds.set(pi as object, activeRequestIds);

	const disposeListener = pi.events.on(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, (payload) => {
		const request = payload as ProgrammaticSubagentLaunchRequest;
		if (!request || request.kind !== "programmatic-subagent-launch") return;
		if (!request.claim()) return;
		if (activeRequestIds.has(request.requestId)) return;
		activeRequestIds.add(request.requestId);
		const release = () => activeRequestIds.delete(request.requestId);

		const ctx = getCurrentContext();
		if (!ctx) {
			release();
			request.onRejected("활성 메인 session context가 없어 subagent를 시작할 수 없습니다.");
			return;
		}

		let started = false;
		const hooks: ProgrammaticSubagentHooks = {
			requestId: request.requestId,
			onStarted(event) {
				started = true;
				request.onStarted(event);
			},
			async onCompleted(event) {
				try {
					await request.onCompleted(event);
				} finally {
					release();
				}
			},
		};

		void execute(
			`programmatic:${request.requestId}`,
			{
				command: buildProgrammaticCommand(request),
				[PROGRAMMATIC_SUBAGENT_HOOKS]: hooks,
			},
			undefined,
			undefined,
			ctx,
		)
			.then((result) => {
				if (!started && (result.isError || !result.details?.launches?.some((launch) => Number.isInteger(launch.runId)))) {
					release();
					request.onRejected(resultError(result));
				}
			})
			.catch((error: unknown) => {
				if (!started) {
					release();
					request.onRejected(error instanceof Error ? error.message : String(error));
				}
			});
	});

	let disposed = false;
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		disposeListener();
		if (registry.owners.get(pi as object) === dispose) registry.owners.delete(pi as object);
	};
	registry.owners.set(pi as object, dispose);
	return dispose;
}
