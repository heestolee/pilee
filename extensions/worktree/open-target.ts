import { Type } from "typebox";
import type { NewPanelPlacement } from "../utils/workspace-activation-contract.ts";

export type WorkspaceOpenTarget = "current" | Extract<NewPanelPlacement, "tab" | "right">;

// /wt fork, worktree_create·worktree_fork 도구, PR review, Frame/TFT fork가 모두 이 선택지를 쓴다.
export const WORKSPACE_OPEN_TARGET_OPTIONS: ReadonlyArray<{
	target: WorkspaceOpenTarget;
	label: string;
}> = [
	{ target: "current", label: "현재 패널" },
	{ target: "tab", label: "새 탭" },
	{ target: "right", label: "오른쪽 패널" },
];

// 에이전트가 여는 worktree(도구·Frame/TFT fork)는 묻지 않는다. 위치를 정하지 않았으면 오른쪽 패널에 연다.
export const DEFAULT_AGENT_OPEN_TARGET: WorkspaceOpenTarget = "right";

export const workspaceOpenTargetParameter = Type.Optional(Type.Union(
	[Type.Literal("current"), Type.Literal("tab"), Type.Literal("right")],
	{
		description: "Where to open the new worktree session. Infer it from what the user means, not from specific words: a separate/fork panel or no stated place → omit (opens the right panel). \"tab\" only when the user wants a new tab. \"current\" only when the user clearly wants to continue in this same panel; if unsure, omit. Never ask the user where to open.",
	},
));

export function workspaceOpenTargetForLabel(label: string | undefined): WorkspaceOpenTarget | null {
	return WORKSPACE_OPEN_TARGET_OPTIONS.find((option) => option.label === label)?.target ?? null;
}

// 사용자가 직접 입력한 slash 명령(/wt fork, PR review)에서만 묻는다.
export async function chooseWorkspaceOpenTarget(
	ctx: { hasUI: boolean; ui: { select(title: string, options: string[]): Promise<string | undefined> } },
	title: string,
	headlessTarget: WorkspaceOpenTarget | null,
): Promise<WorkspaceOpenTarget | null> {
	if (!ctx.hasUI) return headlessTarget;
	const selected = await ctx.ui.select(title, WORKSPACE_OPEN_TARGET_OPTIONS.map((option) => option.label));
	return workspaceOpenTargetForLabel(selected);
}
