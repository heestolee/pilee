import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import {
	expandProfileTemplate,
	loadWorktreeRepoProfiles,
	type WorktreeRepoProfile,
} from "../utils/private-profiles.ts";
import { resolveForkPanelIdentity } from "../utils/fork-panel-identity.ts";
import {
	prReviewWorkspacePath,
	prReviewWorktreeIdentity,
	readPrReviewWorkspaceMetadata,
	writePrReviewWorkspaceMetadata,
	type PrReviewWorkspaceMetadata,
} from "../pr-review/workspace.ts";

const REGISTRY_PATH = join(homedir(), ".pi", "worktree-repos.json");

export interface WorktreeAfterSwitchFollowUp {
	customType: string;
	content: string;
	display?: boolean;
	details?: Record<string, unknown>;
}

export interface PrReviewWorktreeRequest {
	repo: string;
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
	afterSwitchFollowUp?: WorktreeAfterSwitchFollowUp;
}

export type PrReviewWorktreeResult =
	| { status: "switched"; name: string; branch: string; path: string; sessionFile: string; reused: boolean; switchMode: "switch" | "request-switch" }
	| { status: "blocked" | "failed"; reason: string; name?: string; branch?: string; path?: string };

interface RepoRegistry { [name: string]: string }

function loadRegistry(): RepoRegistry {
	if (!existsSync(REGISTRY_PATH)) return {};
	try { return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as RepoRegistry; } catch { return {}; }
}

async function git(pi: ExtensionAPI, cwd: string, args: string[], timeout = 30_000) {
	return pi.exec("git", args, { cwd, timeout });
}

async function repoRootFromCwd(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const result = await git(pi, cwd, ["rev-parse", "--show-toplevel"]);
	return result.code === 0 && result.stdout.trim() ? result.stdout.trim() : null;
}

async function resolveRepoRoot(pi: ExtensionAPI, ctx: ExtensionCommandContext, repoName: string): Promise<string | null> {
	const registered = loadRegistry()[repoName];
	if (registered && existsSync(registered)) return registered;
	const cwdRoot = await repoRootFromCwd(pi, ctx.cwd);
	if (cwdRoot && (!repoName || basename(cwdRoot) === repoName)) return cwdRoot;
	return null;
}

function matchingProfile(repoRoot: string, repoName: string): WorktreeRepoProfile | undefined {
	const normalized = repoRoot.toLowerCase();
	return loadWorktreeRepoProfiles(repoRoot).find((profile) => {
		const match = profile.match ?? {};
		if (profile.name === repoName || (match.registeredNames ?? []).includes(repoName)) return true;
		if ((match.rootBasenames ?? []).includes(basename(repoRoot))) return true;
		if ((match.pathIncludes ?? []).some((part) => normalized.includes(expandProfileTemplate(part).toLowerCase()))) return true;
		return (match.pathRegexes ?? []).some((pattern) => {
			try { return new RegExp(expandProfileTemplate(pattern), "i").test(repoRoot); } catch { return false; }
		});
	});
}

function reviewRootDir(repoRoot: string, repoName: string): string {
	const profile = matchingProfile(repoRoot, repoName);
	return profile?.rootDir
		? expandProfileTemplate(profile.rootDir, { repo: profile.name, repoRoot })
		: join(homedir(), ".pi", "worktrees", repoName || basename(repoRoot));
}

function sourceSessionFile(ctx: ExtensionCommandContext): string | null {
	try { return ctx.sessionManager.getSessionFile() ?? null; } catch { return null; }
}

function childPanelBlocked(repoRoot: string, repoName: string, ctx: ExtensionCommandContext): string | null {
	const profile = matchingProfile(repoRoot, repoName);
	if (!profile?.gate?.requireParentPanel) return null;
	const panel = resolveForkPanelIdentity({ sessionFile: sourceSessionFile(ctx) }).panelLabel;
	if (!/^P\d+$/i.test(panel) || panel.toUpperCase() === "P0") return null;
	return `${profile.displayName ?? profile.name} PR review worktree는 부모 P0 세션에서 생성해야 합니다. 현재 패널: ${panel}`;
}

function sessionDirForWorktree(worktreePath: string): string {
	return join(homedir(), ".pi", "agent", "sessions", `--${worktreePath.slice(1).replace(/\//g, "-")}--`);
}

function appendSessionEntry(session: SessionManager, entry: Record<string, unknown>): void {
	const path = session.getSessionFile();
	if (!path) throw new Error("target PR review session file is missing");
	appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function createReviewSession(ctx: ExtensionCommandContext, worktreePath: string, metadata: PrReviewWorkspaceMetadata): string {
	const source = sourceSessionFile(ctx);
	if (!source || !existsSync(source)) throw new Error("source Pi session file is required for PR review provenance");
	const sessionDir = sessionDirForWorktree(worktreePath);
	mkdirSync(sessionDir, { recursive: true });
	const sessionId = `pr-review-${metadata.number}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
	const sessionFile = join(sessionDir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${sessionId}.jsonl`);
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: worktreePath })}\n`, "utf8");
	const session = SessionManager.open(sessionFile);
	let parentId = session.getLeafId();
	const now = new Date().toISOString();
	const infoId = `pr_review_info_${Date.now().toString(36)}`;
	appendSessionEntry(session, {
		type: "session_info",
		id: infoId,
		parentId,
		timestamp: now,
		name: `PR #${metadata.number} review · ${metadata.title}`,
	});
	parentId = infoId;
	appendSessionEntry(session, {
		type: "custom_message",
		customType: "pr-review-workspace-context",
		id: `pr_review_context_${Date.now().toString(36)}`,
		parentId,
		timestamp: now,
		display: true,
		content: [
			"## PR review workspace",
			"",
			`- PR: ${metadata.prUrl}`,
			`- Base: ${metadata.baseRefName} (${metadata.baseSha})`,
			`- Head: ${metadata.headSha}`,
			`- Run: ${metadata.runId}`,
			`- Metadata: ${prReviewWorkspacePath(worktreePath)}`,
			`- Source conversation: ${source}`,
			`- Reopen source: /archive ${source}`,
			"- PR run과 checkout source가 현재 truth다. 원 대화는 필요한 판단을 찾을 때만 선택적으로 연다.",
			"- 이 worktree는 read-only review workspace다. 사용자가 별도 수정을 요청하기 전에는 repository를 변경하지 않는다.",
		].join("\n"),
		details: { metadataPath: prReviewWorkspacePath(worktreePath), sourceSessionFile: source, fullTranscriptCopied: false, contextMode: "compact-review-handoff" },
	});
	return sessionFile;
}

function worktreeMetaPath(worktreePath: string): string {
	return join(worktreePath, ".pi", "worktree-meta.json");
}

function writeWorktreeMeta(worktreePath: string, value: Record<string, unknown>): void {
	const path = worktreeMetaPath(worktreePath);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function nonReviewDirtyLines(status: string): string[] {
	return status.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => {
		const path = line.slice(3).replace(/^"|"$/g, "");
		return path !== ".pi" && !path.startsWith(".pi/");
	});
}

async function cleanupCreatedReviewWorktree(pi: ExtensionAPI, repoRoot: string, worktreePath: string, branch: string): Promise<void> {
	if (existsSync(worktreePath)) await git(pi, repoRoot, ["worktree", "remove", "--force", worktreePath]);
	await git(pi, repoRoot, ["branch", "-D", branch]);
	rmSync(sessionDirForWorktree(worktreePath), { recursive: true, force: true });
}

function switchOptions(worktreePath: string, metadata: PrReviewWorkspaceMetadata, followUp?: WorktreeAfterSwitchFollowUp) {
	return {
		cwdOverride: worktreePath,
		withSession: async (newCtx: any) => {
			newCtx.ui?.notify?.(`✓ PR #${metadata.number} review workspace (${metadata.headSha.slice(0, 8)})`, "info");
			await newCtx.sendMessage?.({
				customType: "worktree-cwd-binding",
				content: `## Worktree cwd binding\n\n활성 worktree: ${metadata.worktreeName}\n절대경로: ${worktreePath}\n브랜치: ${metadata.branch}\n컨텍스트: PR #${metadata.number} review`,
				display: true,
				details: { name: metadata.worktreeName, path: worktreePath, branch: metadata.branch, review: metadata },
			}, { triggerTurn: false });
			if (followUp) {
				if (typeof newCtx.sendMessage !== "function") throw new Error("switched PR review session cannot receive follow-up");
				await newCtx.sendMessage({
					customType: followUp.customType,
					content: followUp.content,
					display: followUp.display ?? false,
					details: { ...followUp.details, name: metadata.worktreeName, path: worktreePath, branch: metadata.branch },
				}, { deliverAs: "followUp", triggerTurn: true });
			}
		},
	};
}

export async function runPrReviewWorktreeFromCommandContext(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	request: PrReviewWorktreeRequest,
): Promise<PrReviewWorktreeResult> {
	const switchSession = (ctx as any).switchSession;
	const requestSessionSwitch = (ctx as any).requestSessionSwitch;
	if (typeof switchSession !== "function" && typeof requestSessionSwitch !== "function") {
		return { status: "blocked", reason: "현재 context에는 switchSession/requestSessionSwitch API가 없어 review worktree를 만들지 않았습니다." };
	}
	const source = sourceSessionFile(ctx);
	if (!source || !existsSync(source)) return { status: "blocked", reason: "source Pi session provenance가 없어 review worktree를 만들지 않았습니다." };
	const repoRoot = await resolveRepoRoot(pi, ctx, request.repo);
	if (!repoRoot) return { status: "blocked", reason: `등록된 repository를 찾지 못했습니다: ${request.repo}` };
	const panelBlock = childPanelBlocked(repoRoot, request.repo, ctx);
	if (panelBlock) return { status: "blocked", reason: panelBlock };

	const identity = prReviewWorktreeIdentity(request.number, request.headSha);
	const rootDir = reviewRootDir(repoRoot, request.repo);
	const worktreePath = join(rootDir, identity.name);
	mkdirSync(rootDir, { recursive: true });
	let reused = false;
	let created = false;

	if (existsSync(worktreePath)) {
		const existing = readPrReviewWorkspaceMetadata(worktreePath);
		if (!existing || existing.number !== request.number || existing.headSha !== request.headSha || existing.branch !== identity.branch) {
			return { status: "blocked", reason: `기존 ${identity.name} worktree가 요청한 PR head와 일치하지 않습니다.`, name: identity.name, branch: identity.branch, path: worktreePath };
		}
		const status = await git(pi, worktreePath, ["status", "--porcelain"]);
		const dirty = nonReviewDirtyLines(status.stdout ?? "");
		if (status.code !== 0 || dirty.length) return { status: "blocked", reason: `기존 PR review worktree가 clean하지 않습니다: ${dirty.join(", ") || status.stderr.trim()}`, name: identity.name, branch: identity.branch, path: worktreePath };
		const head = await git(pi, worktreePath, ["rev-parse", "HEAD"]);
		if (head.code !== 0 || head.stdout.trim() !== request.headSha) return { status: "blocked", reason: `기존 PR review worktree HEAD가 stale합니다: ${head.stdout.trim() || "unknown"}`, name: identity.name, branch: identity.branch, path: worktreePath };
		reused = true;
	} else {
		ctx.ui.notify(`PR #${request.number} head ${request.headSha.slice(0, 8)} review worktree 준비 중…`, "info");
		const fetchHead = await git(pi, repoRoot, ["fetch", "origin", `+refs/pull/${request.number}/head:${identity.remoteRef}`], 120_000);
		if (fetchHead.code !== 0) return { status: "failed", reason: `PR head fetch failed: ${fetchHead.stderr.trim().slice(0, 300)}`, name: identity.name, branch: identity.branch, path: worktreePath };
		const fetchBase = await git(pi, repoRoot, ["fetch", "origin", request.baseRefName], 120_000);
		if (fetchBase.code !== 0) return { status: "failed", reason: `PR base fetch failed: ${fetchBase.stderr.trim().slice(0, 300)}`, name: identity.name, branch: identity.branch, path: worktreePath };
		const fetchedHead = await git(pi, repoRoot, ["rev-parse", identity.remoteRef]);
		if (fetchedHead.code !== 0 || fetchedHead.stdout.trim() !== request.headSha) return { status: "failed", reason: `fetched PR head mismatch: expected ${request.headSha}, observed ${fetchedHead.stdout.trim() || "unknown"}`, name: identity.name, branch: identity.branch, path: worktreePath };
		const localBranch = await git(pi, repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${identity.branch}`]);
		if (localBranch.code === 0) {
			const branchHead = await git(pi, repoRoot, ["rev-parse", identity.branch]);
			if (branchHead.code !== 0 || branchHead.stdout.trim() !== request.headSha) return { status: "blocked", reason: `기존 review branch가 다른 head를 가리킵니다: ${identity.branch}`, name: identity.name, branch: identity.branch, path: worktreePath };
		}
		const addArgs = localBranch.code === 0 ? ["worktree", "add", worktreePath, identity.branch] : ["worktree", "add", worktreePath, "-b", identity.branch, identity.remoteRef];
		const add = await git(pi, repoRoot, addArgs, 120_000);
		if (add.code !== 0) return { status: "failed", reason: `git worktree add failed: ${add.stderr.trim().slice(0, 300)}`, name: identity.name, branch: identity.branch, path: worktreePath };
		created = true;
		writeWorktreeMeta(worktreePath, { name: identity.name, branch: identity.branch, baseBranch: request.baseRefName, createdAt: Date.now(), note: `read-only PR #${request.number} review workspace` });
	}

	const metadata: PrReviewWorkspaceMetadata = {
		schemaVersion: 1,
		runId: request.runId,
		runDir: request.runDir,
		prUrl: request.prUrl,
		repository: request.repository,
		number: request.number,
		title: request.title,
		baseRefName: request.baseRefName,
		baseSha: request.baseSha,
		headRefName: request.headRefName,
		headSha: request.headSha,
		branch: identity.branch,
		worktreeName: identity.name,
		worktreePath,
		sourceSessionFile: source,
		createdAt: Date.now(),
	};
	writePrReviewWorkspaceMetadata(worktreePath, metadata);

	let sessionFile: string;
	try {
		sessionFile = createReviewSession(ctx, worktreePath, metadata);
	} catch (error) {
		if (created) await cleanupCreatedReviewWorktree(pi, repoRoot, worktreePath, identity.branch);
		return { status: "failed", reason: `PR review session fork failed: ${error instanceof Error ? error.message : String(error)}`, name: identity.name, branch: identity.branch, path: worktreePath };
	}

	const options = switchOptions(worktreePath, metadata, request.afterSwitchFollowUp);
	try {
		if (typeof switchSession === "function") {
			await switchSession.call(ctx, sessionFile, options);
			return { status: "switched", name: identity.name, branch: identity.branch, path: worktreePath, sessionFile, reused, switchMode: "switch" };
		}
		await requestSessionSwitch.call(ctx, sessionFile, options);
		return { status: "switched", name: identity.name, branch: identity.branch, path: worktreePath, sessionFile, reused, switchMode: "request-switch" };
	} catch (error) {
		if (created) await cleanupCreatedReviewWorktree(pi, repoRoot, worktreePath, identity.branch);
		return { status: "failed", reason: `PR review session switch failed: ${error instanceof Error ? error.message : String(error)}`, name: identity.name, branch: identity.branch, path: worktreePath };
	}
}
