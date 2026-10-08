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
		"사용자가 `/frame` Step 9에서 `fork해서 시작`을 선택했고, source panel은 보존된 채 이 새 작업 panel에서 forked worktree exact session이 활성화됐다.",
		"",
		"## 반드시 지킬 것",
		"- 사용자에게 worktree 전환 명령을 다시 요구하지 않는다.",
		"- 이 세션의 cwd/worktree boundary를 source of truth로 사용한다.",
		"- 먼저 `.pi/frame.json`과 `.pi/work-context.json`을 읽고 현재 slice/성공 기준/검증 초점을 확인한다.",
		"- bootstrap worker가 돌고 있으면 코드 탐색·구현은 진행하되 lint/test/local-dev 전 readiness를 확인한다.",
		"- 미해결 결정과 실행 권한을 확인하고 frame의 첫 ready 구현 slice부터 바로 이어서 작업한다. 의존 slice만 보류하고 승인된 독립 slice는 진행한다.",
		"- 구현 중 추가 결정은 현재 대화에서 처리한다. Decide 스킬의 기존 저장 계약을 읽고 질문 전에 decision_queue에 stable ID·근거·영향 slice·다음 행동을 기록한다. 침묵·취소·모호한 답은 승인이 아니며 명시 답변을 기다린다.",
		"- 명시 답변 후 같은 ID로 decisions[]·큐·implementation_plan/slice 의존성·verify 조건·linked Task·work_context refresh를 동기화한다. 다른 미결정과 다른 task blocker는 보존한다. 저장 재승인이나 state 저장을 위한 Studio update/finish·창 재오픈은 하지 않는다. 명시 /decide·웹뷰 비교 요청 경로는 유지한다.",
		"",
		"## Frame provenance",
		`- frame identity: ${frameIdentity.key}`,
		`- frame title: ${frameIdentity.displayTitle}`,
		frameIdentity.ticket ? `- ticket: ${frameIdentity.ticket}` : undefined,
	].filter((line): line is string => line !== undefined).join("\n");
}
