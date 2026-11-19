// worktree 생성 뒤 새 세션을 이어가게 하는 continuation 메시지 종류. 생산자와 판정하는 쪽이 모두 이 모듈만 쓴다.
export const FRAME_FORK_CONTINUATION_TYPE = "pilee-frame-worktree-fork-continuation";
export const FRAME_V2_FORK_CONTINUATION_TYPE = "pilee-frame-v2-worktree-fork-continuation";

export type WorktreeContinuationProducer = "new" | "fork" | "create-tool" | "fork-tool";

export function worktreeContinuationType(producer: WorktreeContinuationProducer, currentPanel = false): string {
	return `pilee-worktree-${producer}${currentPanel ? "-current-panel" : ""}-continuation`;
}

export const COMPACT_NEW_CONTINUATION_TYPE = worktreeContinuationType("new", true);

// fork·frame-fork는 source 대화 전문을 이어받는다. new는 clean session이다.
export type WorktreeContinuationKind = "frame-fork" | "fork" | "new";

export function worktreeContinuationKind(customType: string | undefined): WorktreeContinuationKind | undefined {
	if (customType === FRAME_FORK_CONTINUATION_TYPE || customType === FRAME_V2_FORK_CONTINUATION_TYPE) return "frame-fork";
	const producer = customType?.match(/^pilee-worktree-(new|fork|create-tool|fork-tool)(?:-current-panel)?-continuation$/)?.[1];
	if (!producer) return undefined;
	return producer === "fork" || producer === "fork-tool" ? "fork" : "new";
}
