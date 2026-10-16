import type { BeforeAgentStartEvent } from "@mariozechner/pi-coding-agent";

export interface AgentStartInput {
	kind: "user" | "command" | "continuation" | "status" | "unknown";
	text: string;
	request?: string;
	command?: string;
	customType?: string;
	details?: Record<string, unknown>;
}

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
	const command = typeof details?.command === "string" ? details.command : customType === "pilee-frame-v2-command" ? "frame-v2" : undefined;
	const validCommand = (customType === "pilee-tft-command-shim" && ["frame", "decide", "verify"].includes(command ?? ""))
		|| (customType === "pilee-ship-command-shim" && ["ship", "pr-ship", "ci-ship"].includes(command ?? ""))
		|| customType === "pilee-frame-v2-command";
	if (validCommand) {
		const args = typeof details?.args === "string" ? details.args.trim() : "";
		return { ...input, kind: "command", command, request: `/${command}${args ? ` ${args}` : ""}` };
	}
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
