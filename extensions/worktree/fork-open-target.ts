export type CommandForkOpenTarget = "current" | "tab" | "right";

export const COMMAND_FORK_OPEN_TARGET_OPTIONS: ReadonlyArray<{
	target: CommandForkOpenTarget;
	label: string;
}> = [
	{ target: "current", label: "현재 패널" },
	{ target: "tab", label: "새 탭" },
	{ target: "right", label: "오른쪽 패널" },
];

export function commandForkOpenTargetForLabel(label: string | undefined): CommandForkOpenTarget | null {
	return COMMAND_FORK_OPEN_TARGET_OPTIONS.find((option) => option.label === label)?.target ?? null;
}
