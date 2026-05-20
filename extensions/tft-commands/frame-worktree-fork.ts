import type { FrameIdentity } from "./frame-identity.ts";

export interface FrameWorktreeForkParams {
	identityKey?: string;
	repo?: string;
	name?: string;
	ticket?: string;
	note?: string;
	hotfix?: boolean;
	minimalContext?: boolean;
}

function quoteArg(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

export function buildFrameWorktreeForkArgs(params: FrameWorktreeForkParams, frameIdentity?: FrameIdentity): string {
	const parts: string[] = [];
	if (params.name?.trim()) parts.push(quoteArg(params.name.trim()));
	if (params.repo?.trim()) parts.push("--repo", quoteArg(params.repo.trim()));
	const ticket = params.ticket?.trim() || frameIdentity?.ticket;
	if (ticket) parts.push("--ticket", quoteArg(ticket));
	if (params.note?.trim()) parts.push("--note", quoteArg(params.note.trim()));
	if (params.hotfix) parts.push("--hotfix");
	if (params.minimalContext) parts.push("--minimal-context");
	else parts.push("--full-context");
	return parts.join(" ");
}

export function buildFrameForkContinuationPrompt(frameIdentity: FrameIdentity): string {
	return [
		"# /frame → worktree fork continuation",
		"",
		"사용자가 `/frame` Step 9에서 `fork해서 시작`을 선택했고, 현재 패널은 방금 생성된 forked worktree session으로 전환됐다.",
		"",
		"## 반드시 지킬 것",
		"- 사용자에게 worktree 전환 명령을 다시 요구하지 않는다.",
		"- 이 세션의 cwd/worktree boundary를 source of truth로 사용한다.",
		"- 먼저 `.pi/frame.json`과 `.pi/work-context.json`을 읽고 현재 slice/성공 기준/검증 초점을 확인한다.",
		"- bootstrap worker가 돌고 있으면 코드 탐색·구현은 진행하되 lint/test/local-dev 전 readiness를 확인한다.",
		"- frame의 첫 구현 slice부터 바로 이어서 작업한다.",
		"",
		"## Frame provenance",
		`- frame identity: ${frameIdentity.key}`,
		`- frame title: ${frameIdentity.displayTitle}`,
		frameIdentity.ticket ? `- ticket: ${frameIdentity.ticket}` : undefined,
	].filter((line): line is string => line !== undefined).join("\n");
}
