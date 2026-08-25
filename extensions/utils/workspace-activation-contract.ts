export const WORKSPACE_ACTIONS = [
	"none",
	"branch-in-place",
	"create-worktree",
	"use-existing-worktree",
] as const;

export type WorkspaceAction = (typeof WORKSPACE_ACTIONS)[number];
export type WorkspaceActivationTarget = "current-panel" | "new-panel";
export type NewPanelPlacement = "right" | "left" | "up" | "down" | "tab";
export type WorkspaceContextMode = "full" | "clean";
export type WorkspaceAuthorizationSource = "command" | "tool" | "tui" | "user-turn";
export type WorkspaceAuthorizationDecision = "allow" | "deny";

export interface WorkspaceAuthorizationEvent {
	source: WorkspaceAuthorizationSource;
	sourceId: string;
	action: WorkspaceAction;
	decision: WorkspaceAuthorizationDecision;
	activationTarget?: WorkspaceActivationTarget;
	placement?: NewPanelPlacement;
	text?: string;
	createdAt?: string;
}

export interface WorkspaceAuthorizationProvenance {
	events: WorkspaceAuthorizationEvent[];
	allowedActions: WorkspaceAction[];
	deniedActions: WorkspaceAction[];
}

export interface WorkspaceContinuation {
	workflow: string;
	customType: string;
	content: string;
	display?: boolean;
	details?: Record<string, unknown>;
}

export interface WorkspaceActivationContract {
	id: string;
	workspaceAction: WorkspaceAction;
	activationTarget: WorkspaceActivationTarget;
	placement?: NewPanelPlacement;
	contextMode: WorkspaceContextMode;
	continuation?: WorkspaceContinuation;
	authorization: WorkspaceAuthorizationProvenance;
	createdAt: string;
}

interface IndexedAuthorizationEvent extends WorkspaceAuthorizationEvent {
	index: number;
	end: number;
}

const WORKTREE_NOUN = "(?:worktree|워크트리)";
const BRANCH_NOUN = "(?:branch|브랜치)";
const NEGATIVE_VERB = "(?:만들지|생성하지|쓰지|사용하지|포크하지|fork하지|하지\\s*마|하지마|금지|말고|않(?:아|고|을|습니다)?)";
const CREATE_VERB = "(?:만들(?:어|기|자|고|어서|어줘|어주세요)?|생성(?:해|하자|하고|해서|해주세요)?|fork(?:해|하자|하고)?|포크(?:해|하자|하고)?)";
const BRANCH_VERB = "(?:만들(?:어|기|자|고|어서|어줘|어주세요)?|생성(?:해|하자|하고|해서|해주세요)?|전환(?:해|하자|하고)?|옮겨|switch|checkout)";

function collectMatches(text: string, pattern: RegExp, event: Omit<WorkspaceAuthorizationEvent, "text">): IndexedAuthorizationEvent[] {
	return [...text.matchAll(pattern)].map((match) => ({
		...event,
		text: match[0],
		index: match.index ?? 0,
		end: (match.index ?? 0) + match[0].length,
	}));
}

function rangesOverlap(left: Pick<IndexedAuthorizationEvent, "index" | "end">, right: Pick<IndexedAuthorizationEvent, "index" | "end">): boolean {
	return left.index < right.end && right.index < left.end;
}

function userTurnEvents(text: string, sourceId: string): WorkspaceAuthorizationEvent[] {
	const normalized = text.normalize("NFKC");
	const events: IndexedAuthorizationEvent[] = [];
	const worktreeDenials = [
		new RegExp(`${WORKTREE_NOUN}.{0,36}${NEGATIVE_VERB}`, "giu"),
		/\bno\s+(?:new\s+)?worktree\b/giu,
		/\bdo\s+not\s+(?:create|use|fork)\s+(?:a\s+)?worktree\b/giu,
	].flatMap((pattern) => collectMatches(normalized, pattern, {
		source: "user-turn",
		sourceId,
		action: "create-worktree",
		decision: "deny",
	}));
	events.push(...worktreeDenials);

	const worktreeAllows = [
		new RegExp(`${WORKTREE_NOUN}.{0,36}${CREATE_VERB}`, "giu"),
		new RegExp(`${CREATE_VERB}.{0,36}${WORKTREE_NOUN}`, "giu"),
		/\/wt\s+(?:new|fork)\b/giu,
	].flatMap((pattern) => collectMatches(normalized, pattern, {
		source: "user-turn",
		sourceId,
		action: "create-worktree",
		decision: "allow",
		activationTarget: "new-panel",
	}));
	events.push(...worktreeAllows.filter((event) => !worktreeDenials.some((denial) => rangesOverlap(event, denial))));

	const branchDenials = [
		new RegExp(`${BRANCH_NOUN}.{0,36}${NEGATIVE_VERB}`, "giu"),
	].flatMap((pattern) => collectMatches(normalized, pattern, {
		source: "user-turn",
		sourceId,
		action: "branch-in-place",
		decision: "deny",
	}));
	events.push(...branchDenials);

	const branchAllows = [
		new RegExp(`${BRANCH_NOUN}.{0,36}${BRANCH_VERB}`, "giu"),
		new RegExp(`${BRANCH_VERB}.{0,36}${BRANCH_NOUN}`, "giu"),
	].flatMap((pattern) => collectMatches(normalized, pattern, {
		source: "user-turn",
		sourceId,
		action: "branch-in-place",
		decision: "allow",
		activationTarget: "current-panel",
	}));
	events.push(...branchAllows.filter((event) => !branchDenials.some((denial) => rangesOverlap(event, denial))));

	events.push(...collectMatches(normalized, /\/wt\s+(?:switch|sw)\b/giu, {
		source: "user-turn",
		sourceId,
		action: "use-existing-worktree",
		decision: "allow",
		activationTarget: "current-panel",
	}));

	return events
		.sort((left, right) => left.index - right.index || (left.decision === "deny" ? 1 : -1))
		.map(({ index: _index, end: _end, ...event }) => event);
}

export function reduceWorkspaceAuthorization(events: WorkspaceAuthorizationEvent[]): WorkspaceAuthorizationProvenance {
	const latest = new Map<WorkspaceAction, WorkspaceAuthorizationDecision>();
	for (const event of events) latest.set(event.action, event.decision);
	const allowedActions = WORKSPACE_ACTIONS.filter((action) => latest.get(action) === "allow");
	const deniedActions = WORKSPACE_ACTIONS.filter((action) => latest.get(action) === "deny");
	return { events: [...events], allowedActions, deniedActions };
}

export function deriveWorkspaceAuthorization(
	text: string,
	priorEvents: WorkspaceAuthorizationEvent[] = [],
	sourceId = "current-user-turn",
): WorkspaceAuthorizationProvenance {
	return reduceWorkspaceAuthorization([...priorEvents, ...userTurnEvents(text, sourceId)]);
}

export function explicitWorkspaceAuthorization(event: WorkspaceAuthorizationEvent): WorkspaceAuthorizationProvenance {
	return reduceWorkspaceAuthorization([event]);
}

export function isWorkspaceActionAuthorized(
	authorization: WorkspaceAuthorizationProvenance,
	action: WorkspaceAction,
): boolean {
	return authorization.allowedActions.includes(action) && !authorization.deniedActions.includes(action);
}

export function workspaceAuthorizationReason(
	authorization: WorkspaceAuthorizationProvenance,
	action: WorkspaceAction,
): string {
	if (authorization.deniedActions.includes(action)) return `${action} 동작이 최신 사용자/TUI authorization에서 명시적으로 거부됐습니다.`;
	if (authorization.allowedActions.includes("branch-in-place") && action === "create-worktree") {
		return "branch/in-place 요청은 새 worktree 생성 권한이 아닙니다.";
	}
	return `${action} 동작을 허용한 command/tool/TUI/user-turn provenance가 없습니다.`;
}

export function createWorkspaceActivationContract(input: {
	id: string;
	workspaceAction: WorkspaceAction;
	activationTarget: WorkspaceActivationTarget;
	placement?: NewPanelPlacement;
	contextMode: WorkspaceContextMode;
	continuation?: WorkspaceContinuation;
	authorization: WorkspaceAuthorizationProvenance;
	createdAt?: string;
}): WorkspaceActivationContract {
	if (!isWorkspaceActionAuthorized(input.authorization, input.workspaceAction)) {
		throw new Error(workspaceAuthorizationReason(input.authorization, input.workspaceAction));
	}
	if (input.activationTarget === "new-panel" && !input.placement) {
		throw new Error("new-panel activation에는 placement가 필요합니다.");
	}
	if (input.activationTarget === "current-panel" && input.placement) {
		throw new Error("current-panel activation에는 new panel placement를 지정할 수 없습니다.");
	}
	return {
		id: input.id,
		workspaceAction: input.workspaceAction,
		activationTarget: input.activationTarget,
		placement: input.placement,
		contextMode: input.contextMode,
		continuation: input.continuation,
		authorization: input.authorization,
		createdAt: input.createdAt ?? new Date().toISOString(),
	};
}
