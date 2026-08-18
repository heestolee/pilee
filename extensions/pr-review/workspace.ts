import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PR_REVIEW_WORKSPACE_SCHEMA_VERSION = 1;
export const PR_REVIEW_WORKSPACE_FILE = join(".pi", "pr-review.json");

export interface PrReviewWorkspaceMetadata {
	schemaVersion: typeof PR_REVIEW_WORKSPACE_SCHEMA_VERSION;
	runId: string;
	runDir: string;
	prUrl: string;
	repository: string;
	number: number;
	title: string;
	baseRefName: string;
	baseSha: string;
	headRefName?: string;
	headSha: string;
	branch: string;
	worktreeName: string;
	worktreePath: string;
	sourceSessionFile?: string;
	createdAt: number;
}

function assertString(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`invalid PR review workspace ${label}`);
}

export function validatePrReviewWorkspaceMetadata(value: unknown): PrReviewWorkspaceMetadata {
	if (!value || typeof value !== "object") throw new Error("invalid PR review workspace metadata");
	const metadata = value as Record<string, unknown>;
	if (metadata.schemaVersion !== PR_REVIEW_WORKSPACE_SCHEMA_VERSION) throw new Error("unsupported PR review workspace schemaVersion");
	for (const key of ["runId", "runDir", "prUrl", "repository", "title", "baseRefName", "baseSha", "headSha", "branch", "worktreeName", "worktreePath"] as const) {
		assertString(metadata[key], key);
	}
	if (!Number.isInteger(metadata.number) || Number(metadata.number) <= 0) throw new Error("invalid PR review workspace number");
	if (!Number.isFinite(metadata.createdAt)) throw new Error("invalid PR review workspace createdAt");
	if (metadata.headRefName !== undefined && typeof metadata.headRefName !== "string") throw new Error("invalid PR review workspace headRefName");
	if (metadata.sourceSessionFile !== undefined && typeof metadata.sourceSessionFile !== "string") throw new Error("invalid PR review workspace sourceSessionFile");
	return metadata as unknown as PrReviewWorkspaceMetadata;
}

export function prReviewWorkspacePath(cwd: string): string {
	return join(cwd, PR_REVIEW_WORKSPACE_FILE);
}

export function writePrReviewWorkspaceMetadata(cwd: string, metadata: PrReviewWorkspaceMetadata): string {
	const validated = validatePrReviewWorkspaceMetadata(metadata);
	const path = prReviewWorkspacePath(cwd);
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
	return path;
}

export function readPrReviewWorkspaceMetadata(cwd: string): PrReviewWorkspaceMetadata | null {
	const path = prReviewWorkspacePath(cwd);
	if (!existsSync(path)) return null;
	return validatePrReviewWorkspaceMetadata(JSON.parse(readFileSync(path, "utf8")));
}

export function prReviewWorktreeIdentity(number: number, headSha: string): { name: string; branch: string; remoteRef: string } {
	if (!Number.isInteger(number) || number <= 0) throw new Error("invalid PR number");
	if (!/^[0-9a-f]{7,64}$/i.test(headSha)) throw new Error("invalid PR head SHA");
	const short = headSha.slice(0, 8).toLowerCase();
	return {
		name: `review-pr-${number}-${short}`,
		branch: `review/pr-${number}-${short}`,
		remoteRef: `refs/remotes/origin/pilee-review/pr-${number}`,
	};
}
