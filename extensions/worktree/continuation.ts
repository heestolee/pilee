export interface CurrentPanelContinuationInput {
	name?: string;
	branch?: string;
	ticket?: string;
	note?: string;
}

export interface CurrentPanelContinuation {
	customType: string;
	content: string;
	display: boolean;
	details: Record<string, unknown>;
}

export function buildCurrentPanelNewContinuation(
	recentPrompts: string[],
	input: CurrentPanelContinuationInput,
): CurrentPanelContinuation | undefined {
	const latestPrompt = [...recentPrompts].reverse().find((prompt) => !/^\/wt\s+(new|fork)\b/i.test(prompt));
	if (!latestPrompt && !input.ticket && !input.note) return undefined;
	return {
		customType: "pilee-worktree-new-current-panel-continuation",
		display: false,
		content: [
			"# Worktree new continuation",
			"",
			"현재 panel이 새 worktree의 clean session/cwd로 전환됐다.",
			"full transcript는 복사하지 않았다. 아래의 compact 요청·ticket·note만 사용해 전환 설명이나 추가 명령 요구 없이 작업을 바로 시작한다.",
			latestPrompt ? `## Latest request\n${latestPrompt}` : undefined,
			input.name ? `- worktree: ${input.name}` : undefined,
			input.branch ? `- branch: ${input.branch}` : undefined,
			input.ticket ? `- ticket: ${input.ticket}` : undefined,
			input.note ? `- note: ${input.note}` : undefined,
		].filter((line): line is string => Boolean(line)).join("\n"),
		details: { kind: "new", activationTarget: "current-panel", compact: true, ...input },
	};
}
