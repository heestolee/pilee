export type TaskKind = "slice" | "decision" | "verify" | "blocked" | "followup" | "general";
export type TaskOwner = "agent" | "user" | "reviewer" | "subagent" | "external";
export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed" | "deleted" | "rejected" | "deprioritized" | "superseded";
export type TaskDispositionType = "deleted" | "rejected" | "deprioritized" | "superseded" | "misread";
export type TaskSource = "frame" | "user" | "agent" | "subagent" | "verify" | "review" | "manual";

export interface TaskDisposition {
	type: TaskDispositionType;
	reason?: string;
	at: number;
	by?: TaskOwner | string;
}

export interface TaskGitFacts {
	commits: Array<{ hash: string; paths: string[] }>;
	push: { status: "done" | "not_requested" | "skipped_no_safe_target" | "failed"; remote?: string; branch?: string };
}

export interface Task {
	id: string;
	subject: string;
	description: string;
	activeForm?: string;
	status: TaskStatus;
	kind?: TaskKind;
	owner?: TaskOwner | string;
	area?: string;
	source?: TaskSource | string;
	disposition?: TaskDisposition;
	acceptance?: string[];
	refs?: Record<string, unknown>;
	evidence?: string[];
	blocks: string[];
	blockedBy: string[];
	metadata: Record<string, unknown>;
	git?: TaskGitFacts;
	createdAt: number;
	updatedAt: number;
}

export interface TaskStore {
	nextId: number;
	tasks: Task[];
}
