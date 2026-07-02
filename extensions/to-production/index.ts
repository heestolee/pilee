import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_BASE_REF = "origin/production";
const DEFAULT_SOURCE_BASE_CANDIDATES = ["origin/development", "origin/develop", "origin/main", "origin/master", "origin/HEAD"];
const ARTIFACT_ROOT = join(homedir(), ".pi", "agent", "to-production");
const CUSTOM_TYPE = "pilee-to-production-report";

type UntrackedMode = "ask" | "skip" | "commit" | "block";

interface ParsedArgs {
	branch?: string;
	baseRef: string;
	range?: string;
	untrackedMode: UntrackedMode;
	untrackedCommitMessage?: string;
	yes: boolean;
	dryRun: boolean;
	help: boolean;
}

interface ExecResult {
	code: number;
	stdout?: string;
	stderr?: string;
}

interface SourceSnapshot {
	repoRoot: string;
	branch: string | null;
	head: string;
	upstream: string | null;
	statusShort: string;
	porcelain: string;
	commits: string[];
	commitRange: string | null;
	commitRangeSource: string | null;
	dirtyPatch: string;
	untrackedFiles: string[];
	skippedUntrackedFiles: string[];
	committedUntrackedCommit: string | null;
}

interface PreparedArtifacts {
	artifactDir: string;
	metadataPath: string;
	commitsListPath: string | null;
	dirtyPatchPath: string | null;
	untrackedListPath: string | null;
	backupBranch: string;
}

interface Plan {
	source: SourceSnapshot;
	baseRef: string;
	fetchRemote: string;
	fetchBranch: string;
	targetBranch: string;
	worktreePath: string;
}

interface RunResult {
	report: string;
	level: "info" | "warning" | "error";
	status: "help" | "dry_run" | "cancelled" | "success";
	plan?: Plan;
	artifacts?: PreparedArtifacts;
}

interface ToProductionActivationResult {
	activated: boolean;
	reason?: string;
}

interface ToProductionToolParams {
	args?: string;
	branch?: string;
	base?: string;
	path?: string;
	range?: string;
	message?: string;
	includeUntracked?: boolean;
	untrackedMode?: string;
	untrackedCommitMessage?: string;
	dryRun?: boolean;
	yes?: boolean;
}

function normalizeUntrackedMode(value: string | undefined): UntrackedMode {
	const mode = (value ?? "ask").trim().toLowerCase();
	if (["ask", "skip", "commit", "block"].includes(mode)) return mode as UntrackedMode;
	if (mode === "include") throw new Error("/to-production in-place 전환에서는 untracked include를 지원하지 않습니다. 필요한 파일은 먼저 commit하거나 --commit-untracked를 사용하세요.");
	throw new Error(`지원하지 않는 untracked 처리 방식입니다: ${value}. ask/skip/commit/block 중 하나를 사용하세요.`);
}

function setUntrackedMode(parsed: ParsedArgs, mode: UntrackedMode, sourceFlag: string): void {
	if (parsed.untrackedMode !== "ask") throw new Error(`untracked 처리 옵션은 하나만 사용할 수 있습니다. 이미 ${parsed.untrackedMode}인데 ${sourceFlag}를 받았습니다.`);
	parsed.untrackedMode = mode;
}

function splitArgs(input: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	let escaping = false;

	for (const char of input) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\" && quote !== "'") {
			escaping = true;
			continue;
		}
		if ((char === '"' || char === "'") && quote === null) {
			quote = char;
			continue;
		}
		if (char === quote) {
			quote = null;
			continue;
		}
		if (/\s/u.test(char) && quote === null) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}

	if (escaping) current += "\\";
	if (quote) throw new Error("닫히지 않은 따옴표가 있습니다.");
	if (current) tokens.push(current);
	return tokens;
}

function parseArgs(args: string): ParsedArgs {
	const tokens = splitArgs(args.trim());
	const parsed: ParsedArgs = {
		baseRef: DEFAULT_BASE_REF,
		untrackedMode: "ask",
		yes: false,
		dryRun: false,
		help: false,
	};
	const positionals: string[] = [];

	for (let i = 0; i < tokens.length; i += 1) {
		const token = tokens[i];
		const nextValue = (): string => {
			const next = tokens[i + 1];
			if (!next || next.startsWith("-")) throw new Error(`${token}에는 값이 필요합니다.`);
			i += 1;
			return next;
		};

		if (token === "--help" || token === "-h") parsed.help = true;
		else if (token === "--yes" || token === "-y") parsed.yes = true;
		else if (token === "--dry-run") parsed.dryRun = true;
		else if (token === "--skip-untracked") setUntrackedMode(parsed, "skip", token);
		else if (token === "--commit-untracked") setUntrackedMode(parsed, "commit", token);
		else if (token === "--include-untracked") throw new Error("/to-production in-place 전환에서는 --include-untracked를 지원하지 않습니다. 필요한 파일은 먼저 commit하거나 --commit-untracked를 사용하세요.");
		else if (token === "--untracked-mode") setUntrackedMode(parsed, normalizeUntrackedMode(nextValue()), token);
		else if (token === "--untracked-message") parsed.untrackedCommitMessage = nextValue();
		else if (token === "--branch" || token === "-b") parsed.branch = nextValue();
		else if (token === "--base") parsed.baseRef = normalizeBaseRef(nextValue());
		else if (token === "--range") parsed.range = nextValue();
		else if (token === "--path") throw new Error("/to-production은 새 worktree를 만들지 않습니다. 별도 worktree가 필요하면 /wt fork --hotfix를 사용하세요.");
		else if (token === "--message" || token === "-m") throw new Error("/to-production은 미커밋 diff를 자동 commit하지 않습니다. 먼저 commit한 뒤 cherry-pick 대상으로 만들거나 중단하세요.");
		else if (token.startsWith("-")) throw new Error(`지원하지 않는 옵션입니다: ${token}`);
		else positionals.push(token);
	}

	if (!parsed.branch && positionals.length > 0) parsed.branch = positionals[0];
	if (positionals.length > 1) throw new Error(`알 수 없는 위치 인자가 있습니다: ${positionals.slice(1).join(" ")}`);
	parsed.baseRef = normalizeBaseRef(parsed.baseRef);
	return parsed;
}

function normalizeBaseRef(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return DEFAULT_BASE_REF;
	if (!trimmed.includes("/")) return `origin/${trimmed}`;
	return trimmed;
}

function parseRemoteRef(ref: string): { remote: string; branch: string } {
	const [remote, ...branchParts] = ref.split("/");
	const branch = branchParts.join("/");
	if (!remote || !branch) throw new Error(`원격 base ref를 해석할 수 없습니다: ${ref}`);
	return { remote, branch };
}

function safeSlug(value: string | null | undefined, fallback = "change"): string {
	const slug = (value ?? "")
		.replace(/^refs\/heads\//u, "")
		.replace(/^(feature|fix|hotfix|hotfeature|docs|chore|refactor|test)\//u, "")
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/gu, "-")
		.replace(/-{2,}/gu, "-")
		.replace(/^[-/.]+|[-/.]+$/gu, "")
		.slice(0, 80);
	return slug || fallback;
}

function timestamp(): string {
	return new Date().toISOString().replace(/[-:]/gu, "").replace(/\./u, "");
}

function short(value: string): string {
	return value.slice(0, 10);
}

function formatFileList(files: string[], limit = 12): string {
	return `${files.slice(0, limit).join(", ")}${files.length > limit ? " ..." : ""}`;
}

function hasUnmergedStatus(porcelain: string): boolean {
	return porcelain.split("\n").some((line) => {
		const status = line.slice(0, 2);
		return status.includes("U") || status === "AA" || status === "DD";
	});
}

function branchRefLooksUnsafe(branch: string): boolean {
	return (
		!branch.trim() ||
		/\s/u.test(branch) ||
		branch.includes("..") ||
		branch.includes("@{") ||
		branch.includes("\\") ||
		branch.startsWith("/") ||
		branch.endsWith("/") ||
		branch.includes("//")
	);
}

async function execGit(pi: ExtensionAPI, cwd: string, args: string[], timeout = 120_000): Promise<ExecResult> {
	return pi.exec("git", args, { cwd, timeout }) as Promise<ExecResult>;
}

async function gitCaptureRaw(pi: ExtensionAPI, cwd: string, args: string[], timeout?: number): Promise<string> {
	const result = await execGit(pi, cwd, args, timeout);
	if (result.code !== 0) {
		throw new Error(`git ${args.join(" ")} 실패\n${result.stderr || result.stdout || ""}`.trim());
	}
	return result.stdout ?? "";
}

async function gitCapture(pi: ExtensionAPI, cwd: string, args: string[], timeout?: number): Promise<string> {
	return (await gitCaptureRaw(pi, cwd, args, timeout)).trimEnd();
}

async function gitCode(pi: ExtensionAPI, cwd: string, args: string[], timeout?: number): Promise<number> {
	const result = await execGit(pi, cwd, args, timeout);
	return result.code;
}

async function tryGitCapture(pi: ExtensionAPI, cwd: string, args: string[], timeout?: number): Promise<string | null> {
	const result = await execGit(pi, cwd, args, timeout);
	if (result.code !== 0) return null;
	const text = (result.stdout ?? "").trim();
	return text || null;
}

async function findRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string> {
	return gitCapture(pi, cwd, ["rev-parse", "--show-toplevel"]);
}

async function commitsForRange(pi: ExtensionAPI, repoRoot: string, range: string, source: string): Promise<{ range: string; source: string; commits: string[] }> {
	const commitText = await gitCapture(pi, repoRoot, ["rev-list", "--reverse", range]);
	const commits = commitText.split("\n").map((line) => line.trim()).filter(Boolean);
	if (commits.length === 0) return { range, source, commits };

	const mergeCommitText = await gitCapture(pi, repoRoot, ["rev-list", "--merges", range]);
	const mergeCommits = mergeCommitText.split("\n").map((line) => line.trim()).filter(Boolean);
	if (mergeCommits.length > 0) {
		throw new Error([
			"/to-production은 merge commit 자동 cherry-pick을 지원하지 않습니다.",
			`merge commits: ${mergeCommits.map(short).join(", ")}`,
			"필요한 commit range를 선형으로 정리한 뒤 다시 실행하세요.",
		].join("\n"));
	}
	return { range, source, commits };
}

function sameRef(a: string | null | undefined, b: string | null | undefined): boolean {
	return Boolean(a && b && a.trim() === b.trim());
}

function sourceBaseCandidateRefs(parsed: ParsedArgs, upstream: string | null): string[] {
	const seen = new Set<string>();
	const candidates: string[] = [];
	for (const ref of DEFAULT_SOURCE_BASE_CANDIDATES) {
		if (sameRef(ref, upstream) || sameRef(ref, parsed.baseRef)) continue;
		if (seen.has(ref)) continue;
		seen.add(ref);
		candidates.push(ref);
	}
	return candidates;
}

async function resolveCommitRange(pi: ExtensionAPI, repoRoot: string, parsed: ParsedArgs, upstream: string | null): Promise<{ range: string | null; source: string | null; commits: string[] }> {
	if (parsed.range) return commitsForRange(pi, repoRoot, parsed.range, "explicit --range");

	if (upstream) {
		const mergeBase = await gitCapture(pi, repoRoot, ["merge-base", "HEAD", upstream]);
		const upstreamRange = await commitsForRange(pi, repoRoot, `${mergeBase}..HEAD`, `upstream ${upstream}`);
		if (upstreamRange.commits.length > 0) return upstreamRange;
	}

	for (const ref of sourceBaseCandidateRefs(parsed, upstream)) {
		const exists = await tryGitCapture(pi, repoRoot, ["rev-parse", "--verify", ref]);
		if (!exists) continue;
		const mergeBase = await gitCapture(pi, repoRoot, ["merge-base", "HEAD", ref]);
		const candidateRange = await commitsForRange(pi, repoRoot, `${mergeBase}..HEAD`, `source base ${ref}`);
		if (candidateRange.commits.length > 0) return candidateRange;
	}

	return { range: null, source: null, commits: [] };
}

function defaultUntrackedCommitMessage(branch: string | null): string {
	return `chore: ${branch ? `${branch} ` : ""}untracked 파일 보존`;
}

async function commitUntrackedFiles(pi: ExtensionAPI, source: SourceSnapshot, parsed: ParsedArgs): Promise<string> {
	if (parsed.range && !/\bHEAD\b/u.test(parsed.range)) {
		throw new Error("--commit-untracked는 새 source commit을 cherry-pick 대상에 포함해야 하므로 --range는 `...HEAD`처럼 HEAD를 포함해야 합니다.");
	}
	const message = parsed.untrackedCommitMessage?.trim() || defaultUntrackedCommitMessage(source.branch);
	await gitCapture(pi, source.repoRoot, ["add", "--", ...source.untrackedFiles], 120_000);
	await gitCapture(pi, source.repoRoot, ["commit", "-m", message, "--", ...source.untrackedFiles], 120_000);
	return gitCapture(pi, source.repoRoot, ["rev-parse", "HEAD"]);
}

async function readSourceSnapshot(pi: ExtensionAPI, repoRoot: string, parsed: ParsedArgs): Promise<SourceSnapshot> {
	const [branch, head, upstream, statusShort, porcelain, dirtyPatch, untrackedRaw] = await Promise.all([
		tryGitCapture(pi, repoRoot, ["branch", "--show-current"]),
		gitCapture(pi, repoRoot, ["rev-parse", "HEAD"]),
		tryGitCapture(pi, repoRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]),
		gitCapture(pi, repoRoot, ["status", "--short", "--branch"]),
		gitCapture(pi, repoRoot, ["status", "--porcelain=v1"]),
		gitCaptureRaw(pi, repoRoot, ["diff", "--binary", "HEAD", "--"], 120_000),
		gitCaptureRaw(pi, repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
	]);

	if (hasUnmergedStatus(porcelain)) {
		throw new Error("현재 worktree에 충돌 상태 파일이 있어 production 기반 브랜치 전환을 중단합니다.");
	}

	const commitRange = await resolveCommitRange(pi, repoRoot, parsed, upstream);
	return {
		repoRoot,
		branch,
		head,
		upstream,
		statusShort,
		porcelain,
		commits: commitRange.commits,
		commitRange: commitRange.range,
		commitRangeSource: commitRange.source,
		dirtyPatch,
		untrackedFiles: untrackedRaw.split("\0").filter(Boolean),
		skippedUntrackedFiles: [],
		committedUntrackedCommit: null,
	};
}

async function chooseUntrackedMode(ctx: ExtensionContext | undefined, files: string[]): Promise<UntrackedMode> {
	if (!ctx?.hasUI) return "block";
	const options = [
		"그대로 두고 브랜치 전환",
		"source에 커밋 후 cherry-pick",
		"중단하고 직접 정리",
	];
	const choice = await ctx.ui.select(`/to-production untracked ${files.length}개 처리`, options);
	if (choice === options[0]) return "skip";
	if (choice === options[1]) return "commit";
	return "block";
}

async function resolveUntrackedFiles(pi: ExtensionAPI, ctx: ExtensionContext | undefined, parsed: ParsedArgs, source: SourceSnapshot, allowSourceMutation: boolean): Promise<SourceSnapshot> {
	if (source.untrackedFiles.length === 0) return source;
	const mode = parsed.untrackedMode === "ask" ? await chooseUntrackedMode(ctx, source.untrackedFiles) : parsed.untrackedMode;
	if (mode === "skip") {
		return { ...source, skippedUntrackedFiles: source.untrackedFiles, untrackedFiles: [] };
	}
	if (mode === "commit") {
		if (!allowSourceMutation) throw new Error("dry-run에서는 source에 untracked commit을 만들지 않습니다. --dry-run을 제거하거나 --skip-untracked/--commit-untracked 중 하나를 선택하세요.");
		const committed = await commitUntrackedFiles(pi, source, parsed);
		const next = await readSourceSnapshot(pi, source.repoRoot, parsed);
		return { ...next, committedUntrackedCommit: committed };
	}
	throw new Error([
		"untracked 파일이 있어 in-place production 전환을 중단합니다.",
		"untracked는 현재 worktree에 그대로 남기거나 source commit으로 만든 뒤 cherry-pick해야 합니다.",
		"UI에서는 그대로 두기/커밋/중단을 선택할 수 있고, 비대화 모드에서는 `--skip-untracked` 또는 `--commit-untracked`를 명시하세요.",
		`untracked: ${formatFileList(source.untrackedFiles)}`,
	].join("\n"));
}

async function buildPlan(pi: ExtensionAPI, cwd: string, parsed: ParsedArgs, ctx?: ExtensionContext, options: { allowSourceMutation?: boolean } = {}): Promise<Plan> {
	const repoRoot = await findRepoRoot(pi, cwd);
	const source = await resolveUntrackedFiles(pi, ctx, parsed, await readSourceSnapshot(pi, repoRoot, parsed), options.allowSourceMutation ?? true);
	if (source.dirtyPatch.trim().length > 0) {
		throw new Error([
			"tracked/staged diff가 있어 /to-production in-place 전환을 중단합니다.",
			"/to-production은 현재 worktree에서 production 기반 새 브랜치로 switch한 뒤 기존 commit을 cherry-pick합니다.",
			"미커밋 diff는 먼저 commit하거나, 별도 작업공간이 필요하면 /wt fork --hotfix를 사용하세요.",
		].join("\n"));
	}

	const { remote, branch } = parseRemoteRef(parsed.baseRef);
	const stamp = timestamp();
	const sourceSlug = safeSlug(parsed.branch ?? source.branch ?? basename(repoRoot));
	const targetBranch = parsed.branch ?? `hotfix/${sourceSlug}-${stamp.toLowerCase().replace(/z$/u, "")}`;
	if (branchRefLooksUnsafe(targetBranch)) throw new Error(`안전하지 않은 target branch 이름입니다: ${targetBranch}`);
	return {
		source,
		baseRef: parsed.baseRef,
		fetchRemote: remote,
		fetchBranch: branch,
		targetBranch,
		worktreePath: repoRoot,
	};
}

function metadataFor(plan: Plan, artifacts?: Partial<PreparedArtifacts>): Record<string, unknown> {
	return {
		createdAt: new Date().toISOString(),
		mode: "in-place-branch-switch",
		source: {
			repoRoot: plan.source.repoRoot,
			branch: plan.source.branch,
			head: plan.source.head,
			upstream: plan.source.upstream,
			commitRange: plan.source.commitRange,
			commitRangeSource: plan.source.commitRangeSource,
			commits: plan.source.commits,
			hasDirtyPatch: plan.source.dirtyPatch.trim().length > 0,
			untrackedFiles: plan.source.untrackedFiles,
			skippedUntrackedFiles: plan.source.skippedUntrackedFiles,
			committedUntrackedCommit: plan.source.committedUntrackedCommit,
			statusShort: plan.source.statusShort,
		},
		target: {
			baseRef: plan.baseRef,
			branch: plan.targetBranch,
			worktreePath: plan.worktreePath,
		},
		artifacts,
	};
}

async function prepareArtifacts(pi: ExtensionAPI, plan: Plan): Promise<PreparedArtifacts> {
	const repoHash = createHash("sha1").update(plan.source.repoRoot).digest("hex").slice(0, 10);
	const stamp = timestamp();
	const artifactDir = join(ARTIFACT_ROOT, `${basename(plan.source.repoRoot)}-${repoHash}`, stamp);
	mkdirSync(artifactDir, { recursive: true });

	let commitsListPath: string | null = null;
	if (plan.source.commits.length > 0) {
		commitsListPath = join(artifactDir, "cherry-pick-commits.txt");
		writeFileSync(commitsListPath, `${plan.source.commits.join("\n")}\n`);
	}

	let dirtyPatchPath: string | null = null;
	if (plan.source.dirtyPatch.trim().length > 0) {
		dirtyPatchPath = join(artifactDir, "dirty.patch");
		writeFileSync(dirtyPatchPath, plan.source.dirtyPatch);
	}

	let untrackedListPath: string | null = null;
	if (plan.source.skippedUntrackedFiles.length > 0) {
		untrackedListPath = join(artifactDir, "skipped-untracked-files.txt");
		writeFileSync(untrackedListPath, `${plan.source.skippedUntrackedFiles.join("\n")}\n`);
	}

	const backupBranch = `to-production/source-backup/${safeSlug(plan.source.branch ?? basename(plan.source.repoRoot))}-${stamp.toLowerCase().replace(/z$/u, "")}`;
	await gitCapture(pi, plan.source.repoRoot, ["branch", backupBranch, "HEAD"]);
	const metadataPath = join(artifactDir, "metadata.json");
	const artifacts: PreparedArtifacts = { artifactDir, metadataPath, commitsListPath, dirtyPatchPath, untrackedListPath, backupBranch };
	writeFileSync(metadataPath, `${JSON.stringify(metadataFor(plan, artifacts), null, 2)}\n`);
	return artifacts;
}

async function assertTargetSafe(pi: ExtensionAPI, plan: Plan): Promise<void> {
	await gitCapture(pi, plan.source.repoRoot, ["check-ref-format", "--branch", plan.targetBranch]);
	const branchExists = await gitCode(pi, plan.source.repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${plan.targetBranch}`]);
	if (branchExists === 0) throw new Error(`target branch가 이미 존재합니다: ${plan.targetBranch}`);
}

async function fetchBase(pi: ExtensionAPI, plan: Plan): Promise<void> {
	await gitCapture(pi, plan.source.repoRoot, ["fetch", plan.fetchRemote, plan.fetchBranch], 300_000);
	await gitCapture(pi, plan.source.repoRoot, ["rev-parse", "--verify", plan.baseRef]);
}

async function applyInPlace(pi: ExtensionAPI, plan: Plan, artifacts: PreparedArtifacts): Promise<void> {
	try {
		await gitCapture(pi, plan.source.repoRoot, ["switch", "-c", plan.targetBranch, "--track", plan.baseRef], 300_000);
		for (const commit of plan.source.commits) {
			await gitCapture(pi, plan.source.repoRoot, ["cherry-pick", commit], 300_000);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error([
			"현재 worktree에서 production 기반 브랜치 전환/cherry-pick 중 멈췄습니다.",
			`backup branch: ${artifacts.backupBranch}`,
			`artifact: ${artifacts.artifactDir}`,
			"현재 worktree가 새 target branch 또는 cherry-pick conflict 상태일 수 있습니다. git status를 확인한 뒤 conflict를 해결하거나 git cherry-pick --abort 후 backup branch를 기준으로 복구하세요.",
			message,
		].join("\n"));
	}
}

function buildPlanReport(plan: Plan, artifacts?: PreparedArtifacts): string {
	const skippedUntracked = plan.source.skippedUntrackedFiles.length > 0;
	return [
		"## /to-production plan",
		"",
		"현재 worktree에서 production 기반 새 branch로 전환합니다. 새 worktree는 만들지 않습니다.",
		"",
		"### Current worktree",
		`- repo: \`${plan.source.repoRoot}\``,
		`- current branch: \`${plan.source.branch ?? "(detached)"}\` @ \`${short(plan.source.head)}\``,
		`- current upstream: \`${plan.source.upstream ?? "none"}\``,
		`- commits to cherry-pick: ${plan.source.commits.length}${plan.source.commitRange ? ` (range \`${plan.source.commitRange}\`, ${plan.source.commitRangeSource})` : ""}`,
		`- dirty tracked/staged diff: ${plan.source.dirtyPatch.trim().length > 0 ? "yes" : "no"}`,
		skippedUntracked ? `- untracked kept in worktree: ${plan.source.skippedUntrackedFiles.length} (${formatFileList(plan.source.skippedUntrackedFiles)})` : "- untracked: 0",
		plan.source.committedUntrackedCommit ? `- source untracked commit: \`${short(plan.source.committedUntrackedCommit)}\`` : null,
		"",
		"### Target branch",
		`- base: \`${plan.baseRef}\``,
		`- branch: \`${plan.targetBranch}\``,
		`- worktree: current path \`${plan.worktreePath}\``,
		"",
		"### Safety",
		"- 새 worktree를 만들지 않습니다. 현재 worktree가 target branch로 전환됩니다.",
		"- 전환 전에 backup branch와 artifact를 남깁니다.",
		"- 기존 작업 commit은 target branch 위로 순서대로 cherry-pick합니다.",
		"- 미커밋 diff는 자동 처리하지 않습니다. 먼저 commit하거나 /wt fork --hotfix를 사용하세요.",
		artifacts ? `- artifact: \`${artifacts.artifactDir}\`` : "- artifact: 실행 시 생성",
		artifacts ? `- backup branch: \`${artifacts.backupBranch}\`` : "- backup branch: 실행 시 생성",
	].filter(Boolean).join("\n");
}

async function buildSuccessReport(pi: ExtensionAPI, plan: Plan, artifacts: PreparedArtifacts): Promise<string> {
	const targetStatus = await gitCapture(pi, plan.worktreePath, ["status", "--short", "--branch"]);
	const targetLog = await gitCapture(pi, plan.worktreePath, ["log", "--oneline", "--decorate", "-5"]);
	const summary = plan.source.commits.length > 0
		? `현재 worktree를 \`${plan.targetBranch}\`로 전환하고 기존 작업 commit ${plan.source.commits.length}개를 production 기반 위에 cherry-pick했습니다.`
		: `현재 worktree를 \`${plan.targetBranch}\`로 전환했습니다. 이식할 commit/diff가 없어 production 기반 빈 branch로 준비했습니다.`;
	return [
		"## /to-production 완료",
		"",
		summary,
		"",
		`- previous branch: \`${plan.source.branch ?? "(detached)"}\` @ \`${short(plan.source.head)}\``,
		`- backup branch: \`${artifacts.backupBranch}\``,
		`- artifact: \`${artifacts.artifactDir}\``,
		`- current branch: \`${plan.targetBranch}\``,
		`- base: \`${plan.baseRef}\``,
		plan.source.committedUntrackedCommit ? `- source untracked commit: \`${short(plan.source.committedUntrackedCommit)}\`` : null,
		plan.source.skippedUntrackedFiles.length > 0 ? `- untracked kept in worktree: ${formatFileList(plan.source.skippedUntrackedFiles)}` : null,
		"",
		"### Current status",
		"```text",
		targetStatus,
		"```",
		"",
		"### Current log",
		"```text",
		targetLog,
		"```",
		"",
		"다음 단계: 현재 worktree에서 필요한 커밋 정리/검증 후 push/PR을 진행하세요.",
	].filter(Boolean).join("\n");
}

function helpText(): string {
	return [
		"/to-production [target-branch] [options]",
		"",
		"현재 worktree에서 production 기반 새 branch로 전환합니다. 새 worktree는 만들지 않습니다.",
		"기존 작업 commit이 있으면 backup branch를 만든 뒤 새 branch 위로 cherry-pick합니다.",
		"",
		"Options:",
		"  -b, --branch <name>       target branch 이름. 기본: hotfix/<source>-<timestamp>",
		"  --base <remote/branch>    production base. 기본: origin/production",
		"  --range <rev-range>       cherry-pick할 commit range를 명시. 기본: 현재 workspace 작업 commit 자동 추론",
		"  --skip-untracked          untracked 파일은 현재 worktree에 그대로 두고 전환",
		"  --commit-untracked        untracked 파일을 source에 commit한 뒤 그 commit까지 cherry-pick",
		"  --untracked-message <msg> --commit-untracked source commit 메시지",
		"  --dry-run                 계획만 출력",
		"  -y, --yes                 확인창 생략",
		"",
		"Notes:",
		"  새 worktree가 필요하면 /wt fork --hotfix를 사용하세요.",
		"  미커밋 tracked/staged diff는 자동 처리하지 않습니다. 먼저 commit한 뒤 실행하세요.",
	].join("\n");
}

function publish(pi: ExtensionAPI, ctx: ExtensionContext, report: string, level: "info" | "warning" | "error" = "info", details: Record<string, unknown> = {}): void {
	if (ctx.hasUI) ctx.ui.notify(report.split("\n")[0] ?? "/to-production", level);
	pi.sendMessage({ customType: CUSTOM_TYPE, content: report, display: true, details }, { triggerTurn: false });
}

function toolParamsToParsed(params: ToProductionToolParams): ParsedArgs {
	const rawArgs = params.args?.trim();
	const structuredKeys: Array<keyof ToProductionToolParams> = ["branch", "base", "path", "range", "message", "includeUntracked", "untrackedMode", "untrackedCommitMessage", "dryRun", "yes"];
	const hasStructured = structuredKeys.some((key) => params[key] !== undefined);
	if (rawArgs && hasStructured) throw new Error("to_production tool에서는 args와 구조화 옵션을 함께 쓰지 않습니다. 하나만 선택하세요.");
	if (rawArgs) return parseArgs(rawArgs);
	if (params.path?.trim()) throw new Error("to_production tool의 path 옵션은 더 이상 지원하지 않습니다. 새 worktree가 필요하면 /wt fork --hotfix를 사용하세요.");
	if (params.message?.trim()) throw new Error("to_production tool은 미커밋 diff 자동 commit 메시지를 받지 않습니다. 먼저 commit한 뒤 실행하세요.");
	if (params.includeUntracked) throw new Error("includeUntracked는 in-place /to-production에서 지원하지 않습니다. 필요한 파일은 먼저 commit하거나 untrackedMode='commit'을 사용하세요.");
	const untrackedMode = normalizeUntrackedMode(params.untrackedMode);
	return {
		branch: params.branch?.trim() || undefined,
		baseRef: normalizeBaseRef(params.base ?? DEFAULT_BASE_REF),
		range: params.range?.trim() || undefined,
		untrackedMode,
		untrackedCommitMessage: params.untrackedCommitMessage?.trim() || undefined,
		yes: Boolean(params.yes),
		dryRun: Boolean(params.dryRun),
		help: false,
	};
}

async function executeToProduction(pi: ExtensionAPI, ctx: ExtensionContext, parsed: ParsedArgs): Promise<RunResult> {
	if (parsed.help) return { report: helpText(), level: "info", status: "help" };

	const plan = await buildPlan(pi, ctx.cwd, parsed, ctx, { allowSourceMutation: !parsed.dryRun });
	await fetchBase(pi, plan);
	await assertTargetSafe(pi, plan);
	const planReport = buildPlanReport(plan);
	if (parsed.dryRun) return { report: `${planReport}\n\nDry-run이라 branch/artifact를 만들지 않았습니다.`, level: "info", status: "dry_run", plan };
	if (!parsed.yes) {
		if (!ctx.hasUI) throw new Error("비대화 모드에서는 --yes 없이는 실행하지 않습니다.");
		const confirmed = await ctx.ui.confirm("/to-production 실행", `${planReport}\n\n진행할까요?`);
		if (!confirmed) return { report: `${planReport}\n\n사용자가 취소했습니다. 현재 worktree는 변경하지 않았습니다.`, level: "warning", status: "cancelled", plan };
	}

	const artifacts = await prepareArtifacts(pi, plan);
	await applyInPlace(pi, plan, artifacts);
	return { report: await buildSuccessReport(pi, plan, artifacts), level: "info", status: "success", plan, artifacts };
}

async function executeToProductionAndActivate(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	parsed: ParsedArgs,
): Promise<{ result: RunResult; activation?: ToProductionActivationResult; publish: boolean }> {
	if (!parsed.help && !parsed.dryRun && !parsed.yes && !ctx.hasUI) {
		return {
			result: {
				report: errorReport(new Error("비대화 모드에서는 --yes 없이는 실행하지 않습니다.")),
				level: "error",
				status: "cancelled",
			},
			activation: { activated: false, reason: "confirmation-required" },
			publish: true,
		};
	}

	const result = await executeToProduction(pi, ctx, parsed);
	return { result, activation: result.status === "success" ? { activated: true } : undefined, publish: true };
}

function resultDetails(result: RunResult, activation?: ToProductionActivationResult): Record<string, unknown> {
	return {
		status: result.status,
		level: result.level,
		mode: "in-place-branch-switch",
		source: result.plan
			? {
				repoRoot: result.plan.source.repoRoot,
				branch: result.plan.source.branch,
				head: result.plan.source.head,
				commitRange: result.plan.source.commitRange,
				commits: result.plan.source.commits,
				untrackedFiles: result.plan.source.untrackedFiles,
				skippedUntrackedFiles: result.plan.source.skippedUntrackedFiles,
				committedUntrackedCommit: result.plan.source.committedUntrackedCommit,
			}
			: undefined,
		target: result.plan
			? {
				baseRef: result.plan.baseRef,
				branch: result.plan.targetBranch,
				worktreePath: result.plan.worktreePath,
			}
			: undefined,
		artifacts: result.artifacts,
		activation,
	};
}

function errorReport(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `## /to-production 중단\n\n${message}\n\n자동 reset/clean/stash는 실행하지 않았습니다.`;
}

export default function toProduction(pi: ExtensionAPI) {
	pi.registerCommand("to-production", {
		description: "현재 worktree를 production 기반 새 branch로 전환하고 기존 commit을 cherry-pick",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				const parsed = parseArgs(args);
				const { result, activation, publish: shouldPublish } = await executeToProductionAndActivate(pi, ctx, parsed);
				if (shouldPublish) publish(pi, ctx, result.report, result.level, resultDetails(result, activation));
			} catch (error) {
				publish(pi, ctx, errorReport(error), "error", { blocked: true, mode: "in-place-branch-switch" });
			}
		},
	});

	pi.registerTool({
		name: "to_production",
		label: "To Production",
		description: "Make the current worktree continue from a production-based branch in-place.",
		promptSnippet: "Use to_production when the user asks to make the current workspace/worktree point at production/hotfix/hotfeature or says '/to-production으로 해줘' in natural language.",
		promptGuidelines: [
			"Use this dedicated tool instead of worktree_fork, worktree_create, manual git worktree add, checkout, stash, reset, or clean when the task is to make the current workspace continue on production/hotfix/hotfeature.",
			"The user-facing contract is: the current worktree switches to a production-based target branch. Do not create a sibling worktree; if a new worktree is needed, tell the user to use /wt fork --hotfix.",
			"If the current branch has existing work commits, the command/tool backs up the current HEAD and cherry-picks those commits onto the new production-based branch in the same worktree.",
			"If the current worktree has tracked/staged dirty diff, stop and ask the user to commit first or use /wt fork --hotfix; do not stash/reset/clean automatically.",
			"If the user provided an exact /to-production argument string, pass it as args. Otherwise prefer structured parameters such as branch, base, range, untrackedMode, dryRun, and yes. Omit range unless the user explicitly supplied one.",
			"When untracked files matter, choose untrackedMode explicitly: skip leaves them in the current worktree, commit creates a source commit before the in-place switch/cherry-pick, block stops. UI contexts may ask.",
			"Do not pass yes:true unless the user explicitly approved execution or asked you to run it now; without yes, UI contexts show the same confirmation as the slash command and headless contexts stop safely.",
			"If this tool is unavailable in the current runtime, ask the user to submit the standalone /to-production command rather than emulating it with generic worktree tools.",
		],
		parameters: Type.Object({
			args: Type.Optional(Type.String({ description: "Raw /to-production argument string, e.g. '--range abc..HEAD --branch hotfix/COM-123/foo'. Do not combine with structured options." })),
			branch: Type.Optional(Type.String({ description: "Target branch name." })),
			base: Type.Optional(Type.String({ description: "Production base ref. Defaults to origin/production." })),
			range: Type.Optional(Type.String({ description: "Commit range to cherry-pick, e.g. abc123..HEAD." })),
			untrackedMode: Type.Optional(Type.String({ description: "How to handle source untracked files: ask|skip|commit|block. UI default is ask; headless default blocks unless explicit." })),
			untrackedCommitMessage: Type.Optional(Type.String({ description: "Source commit message when untrackedMode='commit'." })),
			dryRun: Type.Optional(Type.Boolean({ description: "Plan only; do not create branch/artifacts or source untracked commits." })),
			yes: Type.Optional(Type.Boolean({ description: "Skip confirmation only when the user explicitly approved execution." })),
		}),
		async execute(_toolCallId, params: ToProductionToolParams, _signal, _onUpdate, ctx: ExtensionContext) {
			try {
				const { result, activation } = await executeToProductionAndActivate(pi, ctx, toolParamsToParsed(params));
				return { content: [{ type: "text", text: result.report }], details: resultDetails(result, activation) };
			} catch (error) {
				return { content: [{ type: "text", text: errorReport(error) }], details: { blocked: true, mode: "in-place-branch-switch" } };
			}
		},
	});
}

export const __toProductionForTests = {
	parseArgs,
	toolParamsToParsed,
	buildPlan,
	applyInPlace,
	helpText,
};
