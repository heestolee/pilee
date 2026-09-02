import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import {
	expandProfileTemplate,
	loadWorktreeRepoProfiles,
	type WorktreeRepoProfile,
} from "../utils/private-profiles.ts";
import {
	createWorkspaceActivationContract,
	explicitWorkspaceAuthorization,
	type WorkspaceActivationContract,
	type WorkspaceContinuation,
} from "../utils/workspace-activation-contract.ts";
import {
	prReviewWorkspacePath,
	prReviewWorktreeIdentity,
	readPrReviewWorkspaceMetadata,
	writePrReviewWorkspaceMetadata,
	type PrReviewWorkspaceMetadata,
} from "../pr-review/workspace.ts";
import {
	activateWorkspaceInNewPanel,
	buildNewPanelActivationContract,
	type WorkspacePanelActivationResult,
} from "./panel-activation.ts";

const REGISTRY_PATH = join(homedir(), ".pi", "worktree-repos.json");

export interface WorktreeAfterSwitchFollowUp {
	customType: string;
	content: string;
	display?: boolean;
	details?: Record<string, unknown>;
}

export interface PrReviewWorktreeRequest {
	repo: string;
	intent?: "meta-review" | "diff";
	runId?: string;
	runDir?: string;
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

export type PrReviewOpenTarget = "current" | "tab";

export type PrReviewWorktreeResult =
	| {
		status: "activated";
		name: string;
		branch: string;
		path: string;
		sessionFile: string;
		reused: boolean;
		activation: Extract<WorkspacePanelActivationResult, { status: "activated" }>;
	}
	| {
		status: "switched";
		name: string;
		branch: string;
		path: string;
		sessionFile: string;
		reused: boolean;
		contract: WorkspaceActivationContract;
		continuationDispatched: boolean;
	}
	| { status: "blocked" | "failed"; reason: string; name?: string; branch?: string; path?: string; activation?: WorkspacePanelActivationResult };

export interface PrReviewWorktreeRuntime {
	buildContract?: typeof buildNewPanelActivationContract;
	activate?: typeof activateWorkspaceInNewPanel;
}

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

interface CurrentPanelRevision {
	head: string;
	branch?: string;
}

const PR_REVIEW_OPEN_TARGET_OPTIONS: ReadonlyArray<{ target: PrReviewOpenTarget; label: string }> = [
	{ target: "current", label: "현재 패널" },
	{ target: "tab", label: "새 탭" },
];

export function prReviewCurrentPanelHeadNotice(
	current: CurrentPanelRevision | null,
	target: Pick<PrReviewWorktreeRequest, "number" | "headSha">,
): string | null {
	if (!current || current.head === target.headSha) return null;
	const currentLabel = current.branch?.trim() || "detached HEAD";
	return [
		`현재 패널은 ${currentLabel} (${current.head.slice(0, 8)})를 보고 있습니다.`,
		`“현재 패널”을 선택하면 기존 worktree의 branch/HEAD는 수정하지 않고, 이 패널을 PR #${target.number} HEAD ${target.headSha.slice(0, 8)} review session으로 전환합니다.`,
		`“새 탭”을 선택하면 현재 패널은 그대로 유지합니다.`,
	].join("\n");
}

async function currentPanelRevision(pi: ExtensionAPI, cwd: string): Promise<CurrentPanelRevision | null> {
	const head = await git(pi, cwd, ["rev-parse", "HEAD"]);
	if (head.code !== 0 || !head.stdout.trim()) return null;
	const branch = await git(pi, cwd, ["branch", "--show-current"]);
	return { head: head.stdout.trim(), branch: branch.code === 0 ? branch.stdout.trim() || undefined : undefined };
}

async function choosePrReviewOpenTarget(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	request: PrReviewWorktreeRequest,
): Promise<PrReviewOpenTarget | null> {
	if (!ctx.hasUI) return "current";
	const notice = prReviewCurrentPanelHeadNotice(await currentPanelRevision(pi, ctx.cwd), request);
	if (notice) ctx.ui.notify(notice, "warning");
	const selected = await ctx.ui.select(
		`PR #${request.number} review를 어디에서 열까요?`,
		PR_REVIEW_OPEN_TARGET_OPTIONS.map((option) => option.label),
	);
	return PR_REVIEW_OPEN_TARGET_OPTIONS.find((option) => option.label === selected)?.target ?? null;
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

function sessionDirForWorktree(worktreePath: string): string {
	return join(homedir(), ".pi", "agent", "sessions", `--${worktreePath.slice(1).replace(/\//g, "-")}--`);
}

function appendSessionEntry(session: SessionManager, entry: Record<string, unknown>): void {
	const path = session.getSessionFile();
	if (!path) throw new Error("target PR review session file is missing");
	appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function createReviewSession(source: string | null, worktreePath: string, metadata: PrReviewWorkspaceMetadata, activationId: string): string {
	const session = source
		? SessionManager.forkFrom(source, worktreePath)
		: SessionManager.create(worktreePath, sessionDirForWorktree(worktreePath));
	const sessionFile = session.getSessionFile();
	if (!sessionFile) throw new Error("target PR review session file is missing");
	if (!source) {
		const header = session.getHeader();
		if (!header) throw new Error("fresh PR review session header is missing");
		writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, "utf8");
	}
	const fullTranscriptCopied = Boolean(source);
	const contextMode = source ? "full-transcript" : "fresh";
	let parentId = session.getLeafId();
	const now = new Date().toISOString();
	const infoId = `pr_review_info_${Date.now().toString(36)}`;
	appendSessionEntry(session, {
		type: "session_info",
		id: infoId,
		parentId,
		timestamp: now,
		name: `${metadata.activationIntent === "diff" ? "Diff" : "Meta Review"} · PR #${metadata.number} · ${metadata.title}`,
	});
	parentId = infoId;
	appendSessionEntry(session, {
		type: "custom_message",
		customType: "review-workspace-context",
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
			metadata.runId ? `- Meta Review run: ${metadata.runId}` : "- Meta Review run: 아직 연결되지 않음",
			`- Metadata: ${prReviewWorkspacePath(worktreePath)}`,
			...(source ? [
				`- Source conversation: ${source}`,
				`- Reopen source: /archive ${source}`,
				"- Source conversation 전문과 parentSession lineage를 계승했다. checkout metadata가 /diff와 /meta-review가 공유하는 source truth다.",
			] : [
				"- Source conversation: 없음 (fresh review session)",
				"- 복사할 기존 대화 파일이 없어 PR checkout/run metadata만으로 새 리뷰 세션을 시작했다.",
			]),
			"- 이 worktree는 read-only review workspace다. 사용자가 별도 수정을 요청하기 전에는 repository를 변경하지 않는다.",
		].join("\n"),
		details: {
			metadataPath: prReviewWorkspacePath(worktreePath),
			sourceSessionFile: source ?? undefined,
			fullTranscriptCopied,
			contextMode,
			activationId,
		},
	});
	return sessionFile;
}

function worktreeMetaPath(worktreePath: string): string {
	return join(worktreePath, ".pi", "worktree-meta.json");
}

function readWorktreeMeta(worktreePath: string): Record<string, unknown> {
	try { return JSON.parse(readFileSync(worktreeMetaPath(worktreePath), "utf8")) as Record<string, unknown>; } catch { return {}; }
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

function cleanupReviewSession(sessionFile: string | undefined): void {
	if (!sessionFile) return;
	const dir = dirname(sessionFile);
	rmSync(sessionFile, { force: true });
	try {
		if (existsSync(dir) && readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
	} catch {}
}

async function cleanupCreatedReviewWorktree(pi: ExtensionAPI, repoRoot: string, worktreePath: string, branch: string): Promise<void> {
	if (existsSync(worktreePath)) await git(pi, repoRoot, ["worktree", "remove", "--force", worktreePath]);
	await git(pi, repoRoot, ["branch", "-D", branch]);
}

function reviewContinuation(request: PrReviewWorktreeRequest): WorkspaceContinuation {
	const followUp = request.afterSwitchFollowUp;
	const intent = request.intent ?? "meta-review";
	return {
		workflow: intent,
		customType: followUp?.customType ?? (intent === "diff" ? "pilee-diff-workspace-ready" : "pilee-meta-review-workspace-ready"),
		content: followUp?.content ?? (intent === "diff" ? [
			"# External PR diff workspace ready",
			"",
			"Exact checkout/session READY가 확인됐다. 이 세션의 /diff는 .pi/review-context.json의 base/head를 사용한다.",
		].join("\n") : [
			"# Meta Review workspace ready",
			"",
			"Exact checkout/session READY가 확인됐다.",
			`meta_review_run action=\"open\", runId=\"${request.runId}\"로 코드 리뷰 탭을 연다.`,
			"/diff는 .pi/review-context.json의 base/head를 사용한다.",
		].join("\n")),
		display: followUp?.display ?? true,
		details: { ...followUp?.details, intent, runId: request.runId, runDir: request.runDir, prUrl: request.prUrl },
	};
}

export async function runPrReviewWorktreeFromCommandContext(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	request: PrReviewWorktreeRequest,
	runtime: PrReviewWorktreeRuntime = {},
): Promise<PrReviewWorktreeResult> {
	const sourceCandidate = sourceSessionFile(ctx);
	const source = sourceCandidate && existsSync(sourceCandidate) ? sourceCandidate : null;
	const contextMode = source ? "full-transcript" : "fresh";
	const repoRoot = await resolveRepoRoot(pi, ctx, request.repo);
	if (!repoRoot) return { status: "blocked", reason: `등록된 repository를 찾지 못했습니다: ${request.repo}` };

	const identity = prReviewWorktreeIdentity(request.number, request.headSha);
	const rootDir = reviewRootDir(repoRoot, request.repo);
	const worktreePath = join(rootDir, identity.name);
	const existedBefore = existsSync(worktreePath);
	const openTarget = await choosePrReviewOpenTarget(pi, ctx, request);
	if (!openTarget) return { status: "blocked", reason: "열기 위치를 선택하지 않아 PR review worktree를 만들거나 열지 않았습니다.", name: identity.name, branch: identity.branch, path: worktreePath };

	const activationId = `pr-review-${request.number}-${request.headSha.slice(0, 8)}-${Date.now().toString(36)}`;
	const workspaceAction = existedBefore ? "use-existing-worktree" : "create-worktree";
	const contractContextMode = source ? "full" : "clean";
	const authorizationSourceId = request.intent === "diff" ? "/diff" : "/meta-review";
	const continuation = reviewContinuation(request);
	let contract: WorkspaceActivationContract | null;
	if (openTarget === "tab") {
		const buildContract = runtime.buildContract ?? buildNewPanelActivationContract;
		contract = await buildContract({
			id: activationId,
			ctx,
			workspaceAction,
			contextMode: contractContextMode,
			authorizationSource: "command",
			authorizationSourceId,
			continuation,
			placement: "tab",
		});
	} else {
		contract = createWorkspaceActivationContract({
			id: activationId,
			workspaceAction,
			activationTarget: "current-panel",
			contextMode: contractContextMode,
			continuation,
			authorization: explicitWorkspaceAuthorization({
				source: ctx.hasUI ? "tui" : "command",
				sourceId: `${authorizationSourceId}:open-current-panel`,
				action: workspaceAction,
				decision: "allow",
				activationTarget: "current-panel",
			}),
		});
	}
	if (!contract) return { status: "blocked", reason: "새 탭 activation contract를 만들지 못해 PR review worktree를 만들거나 열지 않았습니다.", name: identity.name, branch: identity.branch, path: worktreePath };

	mkdirSync(rootDir, { recursive: true });
	let reused = false;
	let created = false;
	const previousMetadata = existedBefore ? readPrReviewWorkspaceMetadata(worktreePath) : null;

	if (existedBefore) {
		const existing = previousMetadata;
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
		sourceSessionFile: source ?? undefined,
		contextMode,
		activationContractId: contract.id,
		activationIntent: request.intent ?? "meta-review",
		diffAutoOpenPending: request.intent === "diff",
		createdAt: Date.now(),
	};
	writePrReviewWorkspaceMetadata(worktreePath, metadata);

	let sessionFile: string | undefined;
	try {
		sessionFile = createReviewSession(source, worktreePath, metadata, contract.id);
		writePrReviewWorkspaceMetadata(worktreePath, { ...metadata, targetSessionFile: sessionFile });
	} catch (error) {
		cleanupReviewSession(sessionFile);
		if (created) await cleanupCreatedReviewWorktree(pi, repoRoot, worktreePath, identity.branch);
		else if (previousMetadata) writePrReviewWorkspaceMetadata(worktreePath, previousMetadata);
		return { status: "failed", reason: `PR review session creation failed: ${error instanceof Error ? error.message : String(error)}`, name: identity.name, branch: identity.branch, path: worktreePath };
	}
	if (!sessionFile) return { status: "failed", reason: "PR review session path가 만들어지지 않았습니다.", name: identity.name, branch: identity.branch, path: worktreePath };

	const rollbackPreparedTarget = async () => {
		cleanupReviewSession(sessionFile);
		if (created) await cleanupCreatedReviewWorktree(pi, repoRoot, worktreePath, identity.branch);
		else if (previousMetadata) writePrReviewWorkspaceMetadata(worktreePath, previousMetadata);
		else rmSync(prReviewWorkspacePath(worktreePath), { force: true });
	};

	if (openTarget === "current") {
		let replacementStarted = false;
		let continuationDispatched = false;
		try {
			const switched = await ctx.switchSession(sessionFile, {
				withSession: async (newCtx) => {
					replacementStarted = true;
					newCtx.ui.setStatus(request.intent === "diff" ? "diff" : "meta-review", undefined);
					const switchedAt = new Date().toISOString();
					try {
						writePrReviewWorkspaceMetadata(worktreePath, {
							...metadata,
							targetSessionFile: sessionFile,
							activation: { target: "current-panel", switchedAt },
						});
						writeWorktreeMeta(worktreePath, {
							...readWorktreeMeta(worktreePath),
							context: { mode: contextMode, sourceSessionFile: source ?? undefined, targetSessionFile: sessionFile, fullTranscriptCopied: Boolean(source), createdAt: Date.now() },
							activation: { contract, status: "switched", sessionFile, switchedAt },
						});
					} catch (error) {
						newCtx.ui.notify(`PR review 전환 기록 저장 실패: ${error instanceof Error ? error.message : String(error)}`, "warning");
					}

					newCtx.ui.notify(`✓ PR #${request.number} review를 현재 패널에서 이어갑니다.`, "info");
					try {
						const followUp = contract.continuation;
						if (followUp) {
							await newCtx.sendMessage(
								{
									customType: followUp.customType,
									content: followUp.content,
									display: followUp.display ?? false,
									details: { ...followUp.details, activationTarget: "current-panel", worktreePath, sessionFile },
								},
								{ deliverAs: "followUp", triggerTurn: true },
							);
						}
						continuationDispatched = true;
					} catch (error) {
						newCtx.ui.notify(`PR review session 전환은 완료됐지만 자동 시작 메시지 전달에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`, "warning");
					}
				},
			});
			if (switched.cancelled && !replacementStarted) {
				await rollbackPreparedTarget();
				return { status: "blocked", reason: "현재 패널의 PR review session 전환을 취소했습니다.", name: identity.name, branch: identity.branch, path: worktreePath };
			}
			if (!replacementStarted) {
				return { status: "failed", reason: `현재 패널 전환 완료를 확인하지 못해 worktree/session을 보존했습니다: ${worktreePath}`, name: identity.name, branch: identity.branch, path: worktreePath };
			}
			return { status: "switched", name: identity.name, branch: identity.branch, path: worktreePath, sessionFile, reused, contract, continuationDispatched };
		} catch (error) {
			if (replacementStarted) {
				return { status: "switched", name: identity.name, branch: identity.branch, path: worktreePath, sessionFile, reused, contract, continuationDispatched };
			}
			await rollbackPreparedTarget();
			return { status: "failed", reason: `현재 패널의 PR review session 전환 실패: ${error instanceof Error ? error.message : String(error)}`, name: identity.name, branch: identity.branch, path: worktreePath };
		}
	}

	const activate = runtime.activate ?? activateWorkspaceInNewPanel;
	const activation = await activate(pi, ctx, {
		contract,
		cwd: worktreePath,
		sessionFile,
		sourceSessionFile: source ?? undefined,
		title: `PR #${request.number} review · ${request.title}`,
	});
	if (activation.status !== "activated") {
		if (!activation.safeToDeleteTarget) {
			return {
				status: activation.status,
				reason: `PR review new-panel activation failed: ${activation.reason}. worktree/session/metadata를 recovery artifact로 보존했습니다.${activation.descriptorPath ? ` descriptor: ${activation.descriptorPath}` : ""}`,
				name: identity.name,
				branch: identity.branch,
				path: worktreePath,
				activation,
			};
		}
		cleanupReviewSession(sessionFile);
		if (created) await cleanupCreatedReviewWorktree(pi, repoRoot, worktreePath, identity.branch);
		else if (previousMetadata) writePrReviewWorkspaceMetadata(worktreePath, previousMetadata);
		else rmSync(prReviewWorkspacePath(worktreePath), { force: true });
		return { status: activation.status, reason: `PR review new-panel activation failed: ${activation.reason}`, name: identity.name, branch: identity.branch, path: worktreePath, activation };
	}

	const activatedMetadata: PrReviewWorkspaceMetadata = {
		...metadata,
		targetSessionFile: sessionFile,
		activation: {
			target: "new-panel",
			placement: contract.placement!,
			panelLabel: activation.panelLabel,
			forkId: activation.forkId,
			readyAt: activation.readyAt,
		},
	};
	writePrReviewWorkspaceMetadata(worktreePath, activatedMetadata);
	writeWorktreeMeta(worktreePath, {
		...readWorktreeMeta(worktreePath),
		context: { mode: contextMode, sourceSessionFile: source ?? undefined, targetSessionFile: sessionFile, fullTranscriptCopied: Boolean(source), createdAt: Date.now() },
		activation: { contract, status: "activated", sessionFile, panelLabel: activation.panelLabel, forkId: activation.forkId, readyAt: activation.readyAt },
	});
	return { status: "activated", name: identity.name, branch: identity.branch, path: worktreePath, sessionFile, reused, activation };
}
