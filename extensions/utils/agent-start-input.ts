import type { BeforeAgentStartEvent } from "@mariozechner/pi-coding-agent";

export interface AgentStartInput {
	kind: "user" | "command" | "continuation" | "status" | "unknown";
	text: string;
	request?: string;
	command?: string;
	customType?: string;
	details?: Record<string, unknown>;
	purpose?: "investigate" | "artifact" | "implement";
	scope?: "learning" | "review";
}

/** Trusted producers opt in via details.agentStart. Only original command args or
 * a saved loop request belong here, never inlined skills/results. Purpose permits
 * command work, not workspace topology; continuations cannot mint authorization. */
export interface AgentStartMetadata {
	kind: "command" | "continuation" | "status";
	command?: string;
	args?: string;
	request?: string;
	purpose?: AgentStartInput["purpose"];
}

export const AGENT_START_COMMAND_PRODUCERS: Readonly<Record<string, readonly string[]>> = {
	"pilee-tft-command-shim": ["frame", "decide", "verify"],
	"pilee-ship-command-shim": ["ship", "pr-ship", "ci-ship"],
	"pilee-frame-v2-command": ["frame-v2"],
	"pilee-test-refine-command": ["test-refine"],
	"pilee-ember-ship-command": ["ember-ship"],
	"pilee-meta-review-command": ["meta-review"],
};

const SCOPED_CONTINUATIONS: Readonly<Record<string, "learning" | "review">> = {
	"heestolee.study-hard.question-route": "learning",
	"heestolee.study-hard.learner-request": "learning",
	"heestolee.study-hard.worker-conflict": "learning",
	"heestolee.study-hard.node-answer": "learning",
	"pilee-meta-review-worker-request": "review",
	"pilee-meta-review-refresh-request": "review",
	"pilee-meta-review-workspace-ready": "review",
	"pilee-diff-workspace-ready": "review",
};

export function agentInputText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.flatMap((block) => block?.type === "text" && typeof block.text === "string" ? [block.text] : []).join("\n");
}

export function isAgentStatusText(text: string): boolean {
	return /^(?:\[dependency-bootstrap\]|## Worktree cwd binding|Workflow guard for this turn:|WORKTREE DEPENDENCY BOOTSTRAP:)/.test(text.trim());
}

/** Interpret only producers with an explicit command/continuation contract, never arbitrary custom prose. */
export function readAgentStartInput(event: BeforeAgentStartEvent): AgentStartInput {
	if (event.messageType !== "custom") {
		const text = typeof event.prompt === "string" ? event.prompt : "";
		return { kind: isAgentStatusText(text) ? "status" : "user", text, request: text };
	}
	const { message } = event;
	const text = agentInputText(message.content);
	const customType = message.customType;
	const details = message.details && typeof message.details === "object" && !Array.isArray(message.details)
		? message.details as Record<string, unknown> : undefined;
	const input = { text, customType, details };
	if (isAgentStatusText(text) || ["worktree-dependency-bootstrap", "worktree-cwd-binding", "workflow_guard"].includes(customType)) {
		return { ...input, kind: "status" };
	}
	const metadata = details?.agentStart && typeof details.agentStart === "object" && !Array.isArray(details.agentStart)
		? details.agentStart as Record<string, unknown> : undefined;
	if (metadata?.kind === "status") return { ...input, kind: "status" };
	const command = typeof metadata?.command === "string" ? metadata.command
		: typeof details?.command === "string" ? details.command : customType === "pilee-frame-v2-command" ? "frame-v2" : undefined;
	const validCommand = (metadata?.kind === "command" && /^[a-z][a-z0-9-]*$/.test(command ?? ""))
		|| AGENT_START_COMMAND_PRODUCERS[customType]?.includes(command ?? "");
	if (validCommand) {
		const args = typeof metadata?.args === "string" ? metadata.args.trim() : typeof details?.args === "string" ? details.args.trim() : "";
		const purpose = ["investigate", "artifact", "implement"].includes(String(metadata?.purpose))
			? metadata!.purpose as AgentStartInput["purpose"] : undefined;
		return { ...input, kind: "command", command, purpose, request: `/${command}${args ? ` ${args}` : ""}` };
	}
	const scope = SCOPED_CONTINUATIONS[customType];
	if (scope || (customType === "pilee-meta-review-command" && command === "meta-review-refresh")) {
		return { ...input, kind: "continuation", scope: scope ?? "review" };
	}
	if (customType === "heestolee.study-hard.work-transition") {
		return details?.intent === "start-work" || details?.intent === "apply-frame"
			? { ...input, kind: "command", command: details.intent === "start-work" ? "study-hard-start-work" : "frame", purpose: details.intent === "start-work" ? "implement" : "artifact", request: details.intent === "start-work" ? "/study-hard-start-work" : "/frame" }
			: { ...input, kind: "unknown" };
	}
	if (customType === "subagent-tool") {
		const terminal = ["done", "error", "aborted", "cancelled"].includes(String(details?.status));
		return { ...input, kind: terminal && details?.agent !== "bootstrapper" && !isAgentStatusText(String(details?.task ?? "")) ? "continuation" : "status" };
	}
	if (customType === "interactive-shell-update" || customType === "interactive-shell-transfer") {
		const terminal = ["exited", "killed"].includes(String(details?.status))
			|| (typeof details?.exitCode === "number" || details?.timedOut === true || details?.cancelled === true);
		const status = details?.status === "user-takeover" || details?.status === "backgrounded" || details?.userTookOver === true;
		return { ...input, kind: terminal && !status ? "continuation" : "status" };
	}
	if (customType === "until-prompt" && metadata?.kind === "continuation" && typeof metadata.request === "string") {
		return { ...input, kind: "continuation", request: metadata.request };
	}
	if (customType === "pilee-tft-studio-resume") return { ...input, kind: "continuation" };
	if (customType === "convention-lens-review"
		|| /^pilee-(?:frame(?:-v2)?-worktree-fork|worktree-(?:new|fork|create-tool|fork-tool)(?:-current-panel)?)-continuation$/.test(customType)) {
		// Only the clean-session producer embeds a compact original request; fork instructions are not new authority.
		const compact = customType === "pilee-worktree-new-current-panel-continuation"
			? text.match(/(?:^|\n)## Latest request\n([\s\S]*?)(?=\n- (?:worktree|branch|ticket|note):|$)/)?.[1]?.trim() : undefined;
		const note = typeof details?.note === "string" ? details.note : undefined;
		return { ...input, kind: "continuation", request: compact || note };
	}
	return { ...input, kind: "unknown" };
}

/** A scoped question stays active across results/loops, until a new explicit request. */
export function activeAgentContinuationScope(entries: readonly unknown[]): AgentStartInput["scope"] {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; message?: { role?: string; content?: unknown } };
		if (entry.type === "message" && entry.message?.role === "user" && latestAgentRequest([entry])) return undefined;
		if (entry.type !== "custom_message") continue;
		const input = readAgentStartInput({ messageType: "custom", message: entry } as BeforeAgentStartEvent);
		if (input.kind === "command") return undefined;
		if (input.scope) return input.scope;
	}
	return undefined;
}

/** Read the active branch only; never take authorization from assistant/tool or unknown custom text. */
export function latestAgentRequest(entries: readonly unknown[]): string | undefined {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index] as { type?: string; message?: { role?: string; content?: unknown }; customType?: string; details?: unknown; content?: unknown };
		if (entry.type === "message" && entry.message?.role === "user") {
			const text = agentInputText(entry.message.content).trim();
			if (text && !isAgentStatusText(text) && !/^(?:계속해?|이어가|이어서|진행해?|다음(?:으로)?|continue|proceed|go on|next)$/i.test(text)
				&& !/^\/wt\s+(?:new|fork|switch)\b/i.test(text)) return text;
		}
		if (entry.type === "custom_message") {
			const input = readAgentStartInput({ messageType: "custom", message: entry } as BeforeAgentStartEvent);
			if (input.kind === "command" && input.request) return input.request;
		}
	}
	return undefined;
}
