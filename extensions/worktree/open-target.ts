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

export function workspaceOpenTargetForLabel(label: string | undefined): WorkspaceOpenTarget | null {
	return WORKSPACE_OPEN_TARGET_OPTIONS.find((option) => option.label === label)?.target ?? null;
}

export async function chooseWorkspaceOpenTarget(
	ctx: { hasUI: boolean; ui: { select(title: string, options: string[]): Promise<string | undefined> } },
	title: string,
	headlessTarget: WorkspaceOpenTarget | null,
): Promise<WorkspaceOpenTarget | null> {
	if (!ctx.hasUI) return headlessTarget;
	const selected = await ctx.ui.select(title, WORKSPACE_OPEN_TARGET_OPTIONS.map((option) => option.label));
	return workspaceOpenTargetForLabel(selected);
}
