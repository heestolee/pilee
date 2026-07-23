import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export const PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT = "pilee:subagent:programmatic-launch";
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
	claim: () => void;
	onStarted: (event: ProgrammaticSubagentStarted) => void;
	onCompleted: (event: ProgrammaticSubagentCompleted) => void | Promise<void>;
	onRejected: (error: string) => void;
}

export interface ProgrammaticSubagentHooks {
	requestId: string;
	onStarted: ProgrammaticSubagentLaunchRequest["onStarted"];
	onCompleted: ProgrammaticSubagentLaunchRequest["onCompleted"];
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

export function registerProgrammaticSubagentLauncher(
	pi: ExtensionAPI,
	getCurrentContext: () => ExtensionContext | null,
	execute: ProgrammaticSubagentExecute,
): void {
	pi.events.on(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, (payload) => {
		const request = payload as ProgrammaticSubagentLaunchRequest;
		if (!request || request.kind !== "programmatic-subagent-launch") return;
		request.claim();

		const ctx = getCurrentContext();
		if (!ctx) {
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
			onCompleted: request.onCompleted,
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
					request.onRejected(resultError(result));
				}
			})
			.catch((error: unknown) => {
				if (!started) request.onRejected(error instanceof Error ? error.message : String(error));
			});
	});
}
