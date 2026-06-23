import { readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "typebox";
import { buildCommitReadinessDiagnostic, formatCommitReadinessDiagnostic, pathsFromGitStatus } from "../utils/commit-readiness.ts";
import { withRepoStatusPaused } from "../utils/repo-status-coordination.ts";

interface CommitPlanEntry {
	message: string;
	paths: string[];
}

interface PushPlan {
	remote?: string;
	branch?: string;
	forceWithLease?: boolean;
	noVerify?: boolean;
}

type PushPolicy = "commit-only" | "push-if-tracking" | "push";
type AutoCommitMode = "apply" | "split-head" | "quick";
type AutoCommitCompletion = "committed_and_pushed" | "committed_not_pushed";
type PushExecutionStatus = "done" | "not_requested" | "skipped_no_safe_target" | "failed";

interface PushExecution {
	status: PushExecutionStatus;
	requested: boolean;
	policy: PushPolicy;
	remote?: string;
	branch?: string;
	error?: string;
}

interface AutoCommitPlan {
	expectedHead?: string;
	resetTo?: string;
	backupBranch?: string;
	allowLeftovers?: boolean;
	rejectScopeParentheses?: boolean;
	commitNoVerify?: boolean;
	commits: CommitPlanEntry[];
	push?: PushPlan;
	pushPolicy?: PushPolicy;
}

interface AutoCommitResult {
	mode: AutoCommitMode;
	backupBranch?: string;
	commits: Array<{ message: string; hash: string; paths: string[] }>;
	leftovers: string[];
	pushed: boolean;
	push: PushExecution;
	completion: AutoCommitCompletion;
	warnings: string[];
}

const pushPolicySchema = StringEnum(["commit-only", "push-if-tracking", "push"] as const);
const autoCommitToolSchema = Type.Object({
	action: StringEnum(["status", "apply", "split-head", "quick"] as const),
	planPath: Type.Optional(Type.String({ description: "Path to an auto-commit JSON plan file." })),
	message: Type.Optional(Type.String({ description: "Commit message for action=quick." })),
	paths: Type.Optional(Type.Array(Type.String(), { description: "Explicit file paths to commit for action=quick." })),
	pushPolicy: Type.Optional(pushPolicySchema),
	allowLeftovers: Type.Optional(Type.Boolean({ description: "Allow unrelated dirty files to remain outside action=quick paths." })),
});

type AutoCommitToolInput = Static<typeof autoCommitToolSchema>;

type ExecHost = Pick<ExtensionAPI, "exec">;
type CommandCtx = Pick<ExtensionContext, "cwd" | "hasUI"> & { ui?: ExtensionCommandContext["ui"] };

interface GitExecOptions {
	optionalLocks?: boolean;
	retryStaleLock?: boolean;
}

const INDEX_LOCK_PATTERN = /Unable to create '([^']*index\.lock)'/u;
const STALE_INDEX_LOCK_MIN_AGE_MS = 1_500;
const GIT_STATUS_OWNER_WAIT_MS = 1_500;
const GIT_STATUS_OWNER_POLL_MS = 100;

function lines(text: string | undefined): string[] {
	return (text ?? "")
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

export function extractGitIndexLockPath(stderr: string | undefined, stdout = ""): string | undefined {
	const match = `${stderr ?? ""}\n${stdout}`.match(INDEX_LOCK_PATTERN);
	return match?.[1];
}

export function shouldRemoveStaleIndexLockAfterLsof(result: { code?: number; stdout?: string; stderr?: string }): boolean {
	if ((result.stdout ?? "").trim()) return false;
	if ((result.code ?? 1) !== 0 && (result.stderr ?? "").trim()) return false;
	return true;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function extractLsofPids(output: string | undefined): string[] {
	return lines(output)
		.filter((line) => !line.startsWith("COMMAND "))
		.map((line) => line.split(/\s+/u)[1])
		.filter((pid): pid is string => Boolean(pid) && /^\d+$/u.test(pid));
}

export function isRepoStatusGitStatusCommand(command: string): boolean {
	return /\bgit\s+(?:--no-optional-locks\s+)?status\s+--porcelain=v2\s+--branch\s+--untracked-files=normal\b/u.test(command);
}

async function readOwnerCommands(pi: ExecHost, cwd: string, pids: string[]): Promise<string> {
	if (pids.length === 0) return "";
	const ps = await pi.exec("ps", ["-o", "pid=,command=", "-p", pids.join(",")], { cwd }).catch((error: unknown) => ({ code: 1, stdout: "", stderr: String(error) }));
	return [ps.stdout ?? "", ps.stderr ?? ""].filter(Boolean).join("\n").trim();
}

async function lockExists(lockPath: string): Promise<boolean> {
	try {
		await stat(lockPath);
		return true;
	} catch {
		return false;
	}
}

async function lockAgeMs(lockPath: string): Promise<number> {
	try {
		const info = await stat(lockPath);
		return Math.max(0, Date.now() - info.mtimeMs);
	} catch {
		return Number.POSITIVE_INFINITY;
	}
}

async function waitForLockToDisappear(lockPath: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (!(await lockExists(lockPath))) return true;
		await sleep(GIT_STATUS_OWNER_POLL_MS);
	}
	return !(await lockExists(lockPath));
}

async function retryLsof(pi: ExecHost, cwd: string, lockPath: string): Promise<{ code?: number; stdout?: string; stderr?: string }> {
	return await pi.exec("lsof", [lockPath], { cwd, timeout: 5_000 }).catch((error: unknown) => ({ code: 1, stdout: "", stderr: String(error) }));
}

async function handleGitStatusLockOwner(pi: ExecHost, cwd: string, lockPath: string, lsofOutput: string): Promise<string> {
	const pids = extractLsofPids(lsofOutput);
	const ownerCommands = await readOwnerCommands(pi, cwd, pids);
	if (!ownerCommands || !ownerCommands.split(/\r?\n/u).every(isRepoStatusGitStatusCommand)) {
		return `index.lock is still owned; not removing: ${lockPath}\n${lsofOutput.trim()}`;
	}

	if (await waitForLockToDisappear(lockPath, GIT_STATUS_OWNER_WAIT_MS)) {
		return `index.lock owner git status finished; retried: ${lockPath}`;
	}

	await pi.exec("kill", pids, { cwd }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
	if (await waitForLockToDisappear(lockPath, GIT_STATUS_OWNER_WAIT_MS)) {
		return `stopped repo-status git status owner and retried: ${lockPath}`;
	}

	return `index.lock is still owned by repo-status git status; not removing: ${lockPath}\n${ownerCommands}`;
}

async function removeStaleIndexLockIfSafe(pi: ExecHost, cwd: string, stderr: string, stdout: string): Promise<string | undefined> {
	const lockPath = extractGitIndexLockPath(stderr, stdout);
	if (!lockPath) return undefined;
	let lsof = await retryLsof(pi, cwd, lockPath);
	if ((lsof.stdout ?? "").trim()) {
		return await handleGitStatusLockOwner(pi, cwd, lockPath, lsof.stdout ?? "");
	}
	if (!shouldRemoveStaleIndexLockAfterLsof(lsof)) {
		return `index.lock owner check failed; not removing: ${lockPath}`;
	}

	const age = await lockAgeMs(lockPath);
	if (age < STALE_INDEX_LOCK_MIN_AGE_MS) {
		await sleep(STALE_INDEX_LOCK_MIN_AGE_MS - age);
		lsof = await retryLsof(pi, cwd, lockPath);
		if ((lsof.stdout ?? "").trim()) {
			return await handleGitStatusLockOwner(pi, cwd, lockPath, lsof.stdout ?? "");
		}
		if (!shouldRemoveStaleIndexLockAfterLsof(lsof)) {
			return `index.lock owner check failed; not removing: ${lockPath}`;
		}
	}

	await rm(lockPath, { force: true });
	return `removed stale index.lock and retried: ${lockPath}`;
}

async function execGit(
	pi: ExecHost,
	cwd: string,
	args: string[],
	options: GitExecOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
	const command = options.optionalLocks ? "env" : "git";
	const finalArgs = options.optionalLocks ? ["GIT_OPTIONAL_LOCKS=0", "git", ...args] : args;
	let result = await pi.exec(command, finalArgs, { cwd });
	let stdout = result.stdout ?? "";
	let stderr = result.stderr ?? "";
	if ((result.code ?? 1) !== 0 && options.retryStaleLock !== false && !options.optionalLocks) {
		const retryNote = await removeStaleIndexLockIfSafe(pi, cwd, stderr, stdout);
		if (retryNote?.includes("retried")) {
			result = await pi.exec(command, finalArgs, { cwd });
			stdout = result.stdout ?? "";
			stderr = [retryNote, result.stderr ?? ""].filter(Boolean).join("\n");
		} else if (retryNote) {
			stderr = [retryNote, stderr].filter(Boolean).join("\n");
		}
	}
	return { code: result.code ?? 1, stdout, stderr };
}

async function git(pi: ExecHost, cwd: string, args: string[], label = `git ${args.join(" ")}`, options: GitExecOptions = {}): Promise<string> {
	const result = await execGit(pi, cwd, args, options);
	if (result.code !== 0) {
		const stderr = result.stderr.trim();
		const stdout = result.stdout.trim();
		throw new Error([`${label} failed`, stderr, stdout].filter(Boolean).join("\n"));
	}
	return result.stdout;
}

async function gitCode(pi: ExecHost, cwd: string, args: string[], options: GitExecOptions = {}): Promise<{ code: number; stdout: string; stderr: string }> {
	return execGit(pi, cwd, args, options);
}

async function statusLines(pi: ExecHost, cwd: string): Promise<string[]> {
	return lines(await git(pi, cwd, ["status", "--porcelain", "--untracked-files=all"], "git status --porcelain --untracked-files=all", { optionalLocks: true }));
}

async function rawStatusLines(pi: ExecHost, cwd: string): Promise<string[]> {
	return (await git(pi, cwd, ["status", "--porcelain", "--untracked-files=all"], "git status --porcelain --untracked-files=all", { optionalLocks: true }))
		.split(/\r?\n/u)
		.filter(Boolean);
}

async function currentHead(pi: ExecHost, cwd: string): Promise<string> {
	return (await git(pi, cwd, ["rev-parse", "HEAD"])).trim();
}

const PROTECTED_PUSH_BRANCHES = new Set(["main", "master", "development", "production"]);

function normalizeGitPath(path: string): string {
	return path.trim().replace(/^\.\//u, "").replace(/\\/g, "/").replace(/\/$/u, "");
}

function stripQuotes(value: string): string {
	const trimmed = value.trim();
	if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
	try {
		return JSON.parse(trimmed) as string;
	} catch {
		return trimmed.slice(1, -1);
	}
}

function extractStatusPaths(raw: string): string[] {
	const rest = raw.slice(3).trim();
	if (!rest) return [];
	const renameParts = rest.split(/\s+->\s+/u);
	if (renameParts.length === 2) return renameParts.map(stripQuotes).map(normalizeGitPath).filter(Boolean);
	return [normalizeGitPath(stripQuotes(rest))].filter(Boolean);
}

function pathCoveredByPlan(path: string, plannedPaths: string[]): boolean {
	const normalized = normalizeGitPath(path);
	return plannedPaths.some((planned) => {
		const candidate = normalizeGitPath(planned);
		return normalized === candidate || normalized.startsWith(`${candidate}/`);
	});
}

const LOGICAL_ATOM_WARN_PRIMARY_PATHS = 3;
const LOGICAL_ATOM_BLOCK_PRIMARY_PATHS = 6;
const LOGICAL_ATOM_WARN_FILE_CHANGED_LINES = 300;
const LOGICAL_ATOM_BLOCK_FILE_CHANGED_LINES = 1000;
const LOGICAL_ATOM_WARN_TOTAL_CHANGED_LINES = 500;
const LOGICAL_ATOM_BLOCK_TOTAL_CHANGED_LINES = 1500;
const LOGICAL_ATOM_CLUSTER_FANOUT_LIMIT = 4;

type LogicalAtomPathRole = "primary" | "companion";
type LogicalAtomGateDecision = "pass" | "warn" | "block";

interface LogicalAtomPathClassification {
	path: string;
	role: LogicalAtomPathRole;
	reason?: string;
}

export interface LogicalAtomDiffStat {
	path: string;
	additions: number;
	deletions: number;
	changedLines: number;
	binary?: boolean;
}

export interface LogicalAtomGateResult {
	decision: LogicalAtomGateDecision;
	warnings: string[];
	blocks: string[];
}

function companionReason(path: string): string | undefined {
	const normalized = normalizeGitPath(path);
	const fileName = normalized.split("/").at(-1) ?? normalized;
	if (/(^|\/)(__generated__|generated|gen)(\/|$)/u.test(normalized)) return "generated";
	if (/^(generated|schema|types)\.[cm]?[tj]sx?$/u.test(fileName)) return "generated";
	if (/\.generated\.[cm]?[tj]sx?$/u.test(fileName)) return "generated";
	if (/\.d\.ts$/u.test(fileName)) return "generated";
	if (/^(schema\.(gql|graphql)|graphql-schema\.(json|graphql))$/u.test(fileName)) return "schema";
	if (/^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(fileName)) return "package-metadata";
	if (/\.(test|spec)\.[cm]?[tj]sx?$/u.test(fileName)) return "test";
	if (/(^|\/)(__tests__|tests)(\/|$)/u.test(normalized)) return "test";
	return undefined;
}

function classifyLogicalAtomPaths(paths: string[]): LogicalAtomPathClassification[] {
	return paths.map((path) => {
		const normalized = normalizeGitPath(path);
		const reason = companionReason(normalized);
		return reason ? { path: normalized, role: "companion", reason } : { path: normalized, role: "primary" };
	});
}

function logicalAtomCluster(path: string): string {
	const normalized = normalizeGitPath(path);
	const parts = normalized.split("/").filter(Boolean);
	const backendModule = normalized.match(/^backend\/apps\/([^/]+)\/src\/modules\/([^/]+)/u);
	if (backendModule) return `backend/apps/${backendModule[1]}/modules/${backendModule[2]}`;
	const backendApp = normalized.match(/^backend\/apps\/([^/]+)/u);
	if (backendApp) return `backend/apps/${backendApp[1]}`;
	const backendLib = normalized.match(/^backend\/libs\/([^/]+)/u);
	if (backendLib) return `backend/libs/${backendLib[1]}`;
	const frontendDomain = normalized.match(/^frontend\/apps\/([^/]+)\/domain\/([^/]+)(?:\/([^/]+))?/u);
	if (frontendDomain) return `frontend/apps/${frontendDomain[1]}/domain/${frontendDomain[2]}${frontendDomain[3] ? `/${frontendDomain[3]}` : ""}`;
	const frontendApp = normalized.match(/^frontend\/apps\/([^/]+)/u);
	if (frontendApp) return `frontend/apps/${frontendApp[1]}`;
	const frontendPackage = normalized.match(/^frontend\/packages\/([^/]+)/u);
	if (frontendPackage) return `frontend/packages/${frontendPackage[1]}`;
	const extension = normalized.match(/^extensions\/([^/]+)/u);
	if (extension) return `extensions/${extension[1]}`;
	const skill = normalized.match(/^skills\/([^/]+)/u);
	if (skill) return `skills/${skill[1]}`;
	if (normalized.startsWith("docs/knowledge/")) return "docs/knowledge";
	return parts.slice(0, Math.min(2, parts.length)).join("/") || normalized;
}

function logicalAtomLayer(path: string): string {
	const normalized = normalizeGitPath(path);
	const parts = normalized.split("/").filter(Boolean);
	if (normalized.startsWith("backend/apps/")) return parts.slice(0, 3).join("/");
	if (normalized.startsWith("backend/libs/")) return parts.slice(0, 3).join("/");
	if (normalized.startsWith("frontend/apps/")) return parts.slice(0, 3).join("/");
	if (normalized.startsWith("frontend/packages/")) return parts.slice(0, 3).join("/");
	if (normalized.startsWith("extensions/")) return parts.slice(0, 2).join("/");
	if (normalized.startsWith("skills/")) return "skills";
	if (normalized.startsWith("docs/")) return "docs";
	return parts[0] || normalized;
}

function formatPathList(paths: string[], prefix = "  - "): string[] {
	return paths.length > 0 ? paths.map((path) => `${prefix}${path}`) : [`${prefix}(none)`];
}

function formatSuggestedLogicalAtomSplits(primaryPaths: string[], companionPaths: LogicalAtomPathClassification[]): string[] {
	const rows = primaryPaths.map((path, index) => `  ${index + 1}. ${path}`);
	if (companionPaths.length > 0) {
		rows.push("  companion paths는 source/test/generated/schema/package metadata 보조 관계가 닫히는 원자에만 붙이세요:");
		for (const companion of companionPaths) rows.push(`    - ${companion.path}${companion.reason ? ` (${companion.reason})` : ""}`);
	}
	return rows;
}

function statForPath(path: string, stats: LogicalAtomDiffStat[]): LogicalAtomDiffStat | undefined {
	const normalized = normalizeGitPath(path);
	const exact = stats.find((stat) => normalizeGitPath(stat.path) === normalized);
	if (exact) return exact;
	const children = stats.filter((stat) => normalizeGitPath(stat.path).startsWith(`${normalized}/`));
	if (children.length === 0) return undefined;
	return {
		path: normalized,
		additions: children.reduce((sum, stat) => sum + stat.additions, 0),
		deletions: children.reduce((sum, stat) => sum + stat.deletions, 0),
		changedLines: children.reduce((sum, stat) => sum + stat.changedLines, 0),
		binary: children.some((stat) => stat.binary),
	};
}

function statSummary(path: string, stats: LogicalAtomDiffStat[]): string {
	const stat = statForPath(path, stats);
	if (!stat) return path;
	const binary = stat.binary ? " · binary" : "";
	return `${path} (+${stat.additions}/-${stat.deletions}, ${stat.changedLines} lines${binary})`;
}

export function evaluateLogicalAtomGate(
	plan: { commits: Array<{ message: string; paths: string[] }> },
	diffStatsByCommit: LogicalAtomDiffStat[][] = [],
): LogicalAtomGateResult {
	const warnings: string[] = [];
	const blocks: string[] = [];
	for (const [index, entry] of plan.commits.entries()) {
		const stats = diffStatsByCommit[index] ?? [];
		const actualPaths = stats.length > 0 ? stats.map((stat) => stat.path) : entry.paths;
		const classifications = classifyLogicalAtomPaths(actualPaths);
		const primaryItems = classifications.filter((item) => item.role === "primary");
		const companionPaths = classifications.filter((item) => item.role === "companion");
		const primaryPaths = primaryItems.map((item) => item.path);
		const primaryStats = primaryPaths.map((path) => statForPath(path, stats)).filter((stat): stat is LogicalAtomDiffStat => Boolean(stat));
		const totalChangedLines = primaryStats.reduce((sum, stat) => sum + stat.changedLines, 0);
		const maxChangedLines = primaryStats.reduce((max, stat) => Math.max(max, stat.changedLines), 0);
		const clusters = new Set(primaryPaths.map(logicalAtomCluster));
		const layers = new Set(primaryPaths.map(logicalAtomLayer));
		const reasons: string[] = [];
		const warnReasons: string[] = [];

		if (primaryPaths.length >= LOGICAL_ATOM_BLOCK_PRIMARY_PATHS) reasons.push(`${primaryPaths.length} primary paths >= ${LOGICAL_ATOM_BLOCK_PRIMARY_PATHS}`);
		if (maxChangedLines >= LOGICAL_ATOM_BLOCK_FILE_CHANGED_LINES) reasons.push(`single primary diff ${maxChangedLines} lines >= ${LOGICAL_ATOM_BLOCK_FILE_CHANGED_LINES}`);
		if (totalChangedLines >= LOGICAL_ATOM_BLOCK_TOTAL_CHANGED_LINES) reasons.push(`total primary diff ${totalChangedLines} lines >= ${LOGICAL_ATOM_BLOCK_TOTAL_CHANGED_LINES}`);
		if (primaryPaths.length >= LOGICAL_ATOM_WARN_PRIMARY_PATHS && layers.size >= 2) reasons.push(`layer-mixed primary paths (${[...layers].join(", ")})`);
		if (primaryPaths.length >= LOGICAL_ATOM_WARN_PRIMARY_PATHS && clusters.size >= LOGICAL_ATOM_CLUSTER_FANOUT_LIMIT) reasons.push(`surface fan-out ${clusters.size} clusters >= ${LOGICAL_ATOM_CLUSTER_FANOUT_LIMIT}`);
		if (primaryPaths.length >= LOGICAL_ATOM_WARN_PRIMARY_PATHS && clusters.size >= 3 && totalChangedLines >= LOGICAL_ATOM_WARN_TOTAL_CHANGED_LINES) {
			reasons.push(`cluster fan-out ${clusters.size} clusters with ${totalChangedLines} changed lines`);
		}

		if (primaryPaths.length >= LOGICAL_ATOM_WARN_PRIMARY_PATHS) warnReasons.push(`${primaryPaths.length} primary paths`);
		if (maxChangedLines >= LOGICAL_ATOM_WARN_FILE_CHANGED_LINES) warnReasons.push(`single primary diff ${maxChangedLines} lines`);
		if (totalChangedLines >= LOGICAL_ATOM_WARN_TOTAL_CHANGED_LINES) warnReasons.push(`total primary diff ${totalChangedLines} lines`);
		if (clusters.size >= 2) warnReasons.push(`${clusters.size} clusters`);

		const summary = [
			`commits[${index}] "${entry.message}"`,
			`primary=${primaryPaths.length}, companion=${companionPaths.length}, clusters=${clusters.size}, layers=${layers.size}, totalPrimaryLines=${totalChangedLines}, maxPrimaryLines=${maxChangedLines}`,
			"primary paths:",
			...formatPathList(primaryPaths.map((path) => statSummary(path, stats))),
			"companion paths:",
			...formatPathList(companionPaths.map((item) => `${statSummary(item.path, stats)}${item.reason ? ` (${item.reason})` : ""}`)),
			"suggested logical atom split:",
			...formatSuggestedLogicalAtomSplits(primaryPaths, companionPaths),
		].join("\n");

		if (reasons.length > 0) {
			blocks.push([summary, `block reasons: ${reasons.join("; ")}`].join("\n"));
		} else if (warnReasons.length > 0) {
			warnings.push([summary, `warning reasons: ${warnReasons.join("; ")}`].join("\n"));
		}
	}
	return { decision: blocks.length > 0 ? "block" : warnings.length > 0 ? "warn" : "pass", warnings, blocks };
}

export function buildLogicalAtomGateReport(
	plan: { commits: Array<{ message: string; paths: string[] }> },
	diffStatsByCommit: LogicalAtomDiffStat[][] = [],
): string | undefined {
	const result = evaluateLogicalAtomGate(plan, diffStatsByCommit);
	if (result.blocks.length === 0) return undefined;
	return [
		"auto-commit logical atom gate blocked this plan",
		"큰 commit entry는 파일 수뿐 아니라 diff 양, layer mix, cluster/surface fan-out을 함께 봅니다. 작은 동일 cluster fan-out은 warning으로 허용하지만, 큰 diff 또는 layer-mixed 변경은 reviewable logical atom으로 쪼개야 합니다.",
		"",
		...result.blocks,
	].join("\n");
}

export function assertLogicalAtomGate(
	plan: { commits: Array<{ message: string; paths: string[] }> },
	diffStatsByCommit: LogicalAtomDiffStat[][] = [],
): void {
	const report = buildLogicalAtomGateReport(plan, diffStatsByCommit);
	if (report) throw new Error(report);
}

async function assertNoUnplannedChanges(pi: ExecHost, cwd: string, plan: AutoCommitPlan): Promise<void> {
	if (plan.allowLeftovers) return;
	const plannedPaths = plan.commits.flatMap((commit) => commit.paths).map(normalizeGitPath).filter(Boolean);
	const changedPaths = (await rawStatusLines(pi, cwd)).flatMap(extractStatusPaths);
	const unplanned = [...new Set(changedPaths.filter((path) => !pathCoveredByPlan(path, plannedPaths)))].sort((a, b) => a.localeCompare(b));
	if (unplanned.length > 0) {
		throw new Error(`auto-commit plan has unplanned changes before commit:\n${unplanned.join("\n")}`);
	}
}

function pushPlanFromUpstream(branch: string, upstream: string | undefined): PushPlan | undefined {
	if (!branch || PROTECTED_PUSH_BRANCHES.has(branch)) return undefined;
	if (!upstream) return undefined;
	const slash = upstream.indexOf("/");
	if (slash <= 0 || slash === upstream.length - 1) return undefined;
	const remoteBranch = upstream.slice(slash + 1);
	if (PROTECTED_PUSH_BRANCHES.has(remoteBranch)) return undefined;
	return { remote: upstream.slice(0, slash), branch: remoteBranch };
}

async function currentBranch(pi: ExecHost, cwd: string): Promise<string> {
	return (await git(pi, cwd, ["branch", "--show-current"])).trim();
}

async function upstreamBranch(pi: ExecHost, cwd: string): Promise<string | undefined> {
	const result = await gitCode(pi, cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { optionalLocks: true });
	if (result.code !== 0) return undefined;
	return result.stdout.trim() || undefined;
}

async function resolvePushPlan(pi: ExecHost, cwd: string, explicitPush: PushPlan | undefined, policy: PushPolicy): Promise<PushPlan | undefined> {
	if (explicitPush) return explicitPush;
	if (policy === "commit-only") return undefined;
	const branch = await currentBranch(pi, cwd);
	const fromUpstream = pushPlanFromUpstream(branch, await upstreamBranch(pi, cwd));
	if (fromUpstream) return fromUpstream;
	if (policy !== "push") return undefined;
	if (!branch || PROTECTED_PUSH_BRANCHES.has(branch)) return undefined;
	return { remote: "origin", branch };
}

async function runPush(pi: ExecHost, cwd: string, push: PushPlan | undefined, pushPolicy: PushPolicy | undefined): Promise<PushExecution> {
	const policy = pushPolicy ?? (push ? "push" : "commit-only");
	const requested = Boolean(push) || policy !== "commit-only";
	if (!requested) return { status: "not_requested", requested: false, policy };

	const resolved = await resolvePushPlan(pi, cwd, push, policy);
	if (!resolved) {
		return { status: "skipped_no_safe_target", requested: true, policy, error: "safe push target was not detected" };
	}

	const remote = resolved.remote ?? "origin";
	const branch = resolved.branch ?? (await currentBranch(pi, cwd));
	if (!branch) return { status: "skipped_no_safe_target", requested: true, policy, remote, error: "push.branch is required when HEAD is detached" };

	const args = ["push"];
	if (resolved.forceWithLease) args.push("--force-with-lease");
	if (resolved.noVerify) args.push("--no-verify");
	args.push(remote, `HEAD:${branch}`);
	try {
		await git(pi, cwd, args, `git push ${remote} HEAD:${branch}`);
		return { status: "done", requested: true, policy, remote, branch };
	} catch (error) {
		return { status: "failed", requested: true, policy, remote, branch, error: error instanceof Error ? error.message : String(error) };
	}
}

function completionFromPush(push: PushExecution): AutoCommitCompletion {
	return push.status === "done" ? "committed_and_pushed" : "committed_not_pushed";
}

async function describePushReadiness(pi: ExecHost, cwd: string): Promise<string> {
	const branch = await currentBranch(pi, cwd).catch(() => "");
	if (!branch) return "push: no safe target (detached HEAD)";
	if (PROTECTED_PUSH_BRANCHES.has(branch)) return `push: disabled on protected branch ${branch}`;
	const upstream = await upstreamBranch(pi, cwd);
	const plan = pushPlanFromUpstream(branch, upstream);
	if (!plan) return upstream ? `push: no safe target for upstream ${upstream}` : "push: no upstream; quick path would need pushPolicy=push to create origin/<branch>";
	const counts = await gitCode(pi, cwd, ["rev-list", "--left-right", "--count", "@{u}...HEAD"], { optionalLocks: true });
	const [behind = "?", ahead = "?"] = counts.code === 0 ? counts.stdout.trim().split(/\s+/u) : [];
	return `push: ${plan.remote}/${plan.branch} (ahead ${ahead}, behind ${behind})`;
}

function assertPlan(plan: AutoCommitPlan): void {
	if (!plan || typeof plan !== "object") throw new Error("auto-commit plan must be an object");
	if (!Array.isArray(plan.commits) || plan.commits.length === 0) {
		throw new Error("auto-commit plan requires at least one commit entry");
	}
	if (plan.pushPolicy && !["commit-only", "push-if-tracking", "push"].includes(plan.pushPolicy)) {
		throw new Error(`auto-commit plan has invalid pushPolicy: ${plan.pushPolicy}`);
	}

	for (const [index, entry] of plan.commits.entries()) {
		if (!entry || typeof entry !== "object") throw new Error(`commits[${index}] must be an object`);
		if (typeof entry.message !== "string" || entry.message.trim().length === 0) {
			throw new Error(`commits[${index}].message is required`);
		}
		if ((plan.rejectScopeParentheses ?? true) && /^[a-z]+\([^)]*\):/iu.test(entry.message.trim())) {
			throw new Error(`commits[${index}].message must not use scope parentheses: ${entry.message}`);
		}
		if (!Array.isArray(entry.paths) || entry.paths.length === 0) {
			throw new Error(`commits[${index}].paths requires at least one path`);
		}
		for (const path of entry.paths) {
			if (typeof path !== "string" || path.trim().length === 0) {
				throw new Error(`commits[${index}].paths contains an invalid path`);
			}
		}
	}
}

async function loadPlan(cwd: string, planPath: string): Promise<AutoCommitPlan> {
	const absolutePath = resolve(cwd, planPath.replace(/^@/u, ""));
	const content = await readFile(absolutePath, "utf-8");
	const plan = JSON.parse(content) as AutoCommitPlan;
	assertPlan(plan);
	return plan;
}

async function maybeCreateBackupBranch(pi: ExecHost, cwd: string, branch: string | undefined): Promise<void> {
	if (!branch) return;
	const existing = await gitCode(pi, cwd, ["rev-parse", "--verify", branch]);
	if (existing.code === 0) return;
	await git(pi, cwd, ["branch", branch, "HEAD"], `git branch ${branch} HEAD`);
}

async function assertExpectedHead(pi: ExecHost, cwd: string, expectedHead: string | undefined): Promise<void> {
	if (!expectedHead) return;
	const head = await currentHead(pi, cwd);
	if (!head.startsWith(expectedHead) && expectedHead !== head) {
		throw new Error(`HEAD mismatch: expected ${expectedHead}, actual ${head}`);
	}
}

function parseNumstatLine(line: string): LogicalAtomDiffStat | undefined {
	const [additionsRaw, deletionsRaw, ...pathParts] = line.split(/	/u);
	const path = normalizeGitPath(pathParts.join("	"));
	if (!path) return undefined;
	const binary = additionsRaw === "-" || deletionsRaw === "-";
	const additions = binary ? LOGICAL_ATOM_BLOCK_FILE_CHANGED_LINES : Number(additionsRaw);
	const deletions = binary ? 0 : Number(deletionsRaw);
	return {
		path,
		additions: Number.isFinite(additions) ? additions : 0,
		deletions: Number.isFinite(deletions) ? deletions : 0,
		changedLines: binary ? LOGICAL_ATOM_BLOCK_FILE_CHANGED_LINES : Math.max(0, (Number.isFinite(additions) ? additions : 0) + (Number.isFinite(deletions) ? deletions : 0)),
		binary,
	};
}

function countTextLines(content: Buffer): number {
	if (content.length === 0) return 0;
	let lines = 1;
	for (const byte of content) if (byte === 10) lines += 1;
	return lines;
}

async function statUntrackedFile(cwd: string, path: string): Promise<LogicalAtomDiffStat> {
	const content = await readFile(join(cwd, path));
	const binary = content.includes(0);
	const changedLines = binary ? LOGICAL_ATOM_BLOCK_FILE_CHANGED_LINES : countTextLines(content);
	return { path: normalizeGitPath(path), additions: changedLines, deletions: 0, changedLines, binary };
}

async function collectCommitEntryDiffStats(pi: ExecHost, cwd: string, entry: CommitPlanEntry): Promise<LogicalAtomDiffStat[]> {
	const diff = await git(pi, cwd, ["diff", "--numstat", "--", ...entry.paths], `git diff --numstat -- ${entry.paths.join(" ")}`, { optionalLocks: true });
	const stats = lines(diff).map(parseNumstatLine).filter((stat): stat is LogicalAtomDiffStat => Boolean(stat));
	const seen = new Set(stats.map((stat) => normalizeGitPath(stat.path)));
	const others = await git(pi, cwd, ["ls-files", "--others", "--exclude-standard", "--", ...entry.paths], `git ls-files --others -- ${entry.paths.join(" ")}`, { optionalLocks: true });
	for (const rawPath of lines(others).map(normalizeGitPath).filter(Boolean)) {
		if (seen.has(rawPath)) continue;
		stats.push(await statUntrackedFile(cwd, rawPath));
		seen.add(rawPath);
	}
	return stats;
}

async function assertLogicalAtomGateForWorkingTree(pi: ExecHost, cwd: string, plan: AutoCommitPlan): Promise<string[]> {
	const diffStatsByCommit = await Promise.all(plan.commits.map((entry) => collectCommitEntryDiffStats(pi, cwd, entry)));
	const result = evaluateLogicalAtomGate(plan, diffStatsByCommit);
	if (result.blocks.length > 0) {
		throw new Error([
			"auto-commit logical atom gate blocked this plan",
			"큰 commit entry는 파일 수뿐 아니라 diff 양, layer mix, cluster/surface fan-out을 함께 봅니다. 작은 동일 cluster fan-out은 warning으로 허용하지만, 큰 diff 또는 layer-mixed 변경은 reviewable logical atom으로 쪼개야 합니다.",
			"",
			...result.blocks,
		].join("\n"));
	}
	return result.warnings;
}

async function commitEntry(
	pi: ExecHost,
	cwd: string,
	entry: CommitPlanEntry,
	commitNoVerify: boolean | undefined,
): Promise<{ message: string; hash: string; paths: string[] }> {
	await git(pi, cwd, ["reset"], "git reset");
	await git(pi, cwd, ["add", "--", ...entry.paths], `git add -- ${entry.paths.join(" ")}`);
	const diff = await gitCode(pi, cwd, ["diff", "--cached", "--quiet"]);
	if (diff.code === 0) {
		throw new Error(`No staged changes for commit: ${entry.message}`);
	}

	const args = ["commit"];
	if (commitNoVerify) args.push("--no-verify");
	args.push("-m", entry.message);
	await git(pi, cwd, args, `git commit -m ${entry.message}`);
	const hash = (await git(pi, cwd, ["rev-parse", "--short=12", "HEAD"])).trim();
	return { message: entry.message, hash, paths: [...entry.paths] };
}

async function applyPlan(pi: ExecHost, cwd: string, mode: AutoCommitMode, plan: AutoCommitPlan): Promise<AutoCommitResult> {
	await assertExpectedHead(pi, cwd, plan.expectedHead);
	return await withRepoStatusPaused(cwd, async () => {
		if (mode === "split-head") {
			const currentStatus = await statusLines(pi, cwd);
			if (currentStatus.length > 0) {
				throw new Error(`split-head requires a clean worktree before reset. Dirty entries:\n${currentStatus.join("\n")}`);
			}
			await maybeCreateBackupBranch(pi, cwd, plan.backupBranch);
			await git(pi, cwd, ["reset", "--mixed", plan.resetTo ?? "HEAD~1"], "git reset --mixed");
		}

		await assertNoUnplannedChanges(pi, cwd, plan);
		const warnings = await assertLogicalAtomGateForWorkingTree(pi, cwd, plan);

		const commits: AutoCommitResult["commits"] = [];
		try {
			for (const entry of plan.commits) {
				commits.push(await commitEntry(pi, cwd, entry, plan.commitNoVerify));
			}
			await git(pi, cwd, ["reset"], "git reset");
			const leftovers = await statusLines(pi, cwd);
			if (leftovers.length > 0 && !plan.allowLeftovers) {
				throw new Error(`auto-commit plan left unstaged changes:\n${leftovers.join("\n")}`);
			}
			const push = await runPush(pi, cwd, plan.push, plan.pushPolicy);
			return { mode, backupBranch: plan.backupBranch, commits, leftovers, pushed: push.status === "done", push, completion: completionFromPush(push), warnings };
		} catch (error) {
			await gitCode(pi, cwd, ["reset"]);
			throw error;
		}
	}, { reason: `auto_commit:${mode}` });
}

function buildQuickPlan(params: { message?: string; paths?: string[]; pushPolicy?: PushPolicy; allowLeftovers?: boolean }): AutoCommitPlan {
	const message = params.message?.trim();
	if (!message) throw new Error("action=quick requires message");
	const paths = (params.paths ?? []).map((path) => path.trim()).filter(Boolean);
	if (paths.length === 0) throw new Error("action=quick requires explicit paths");
	const plan: AutoCommitPlan = {
		allowLeftovers: params.allowLeftovers ?? false,
		commits: [{ message, paths }],
		pushPolicy: params.pushPolicy ?? "push-if-tracking",
	};
	assertPlan(plan);
	return plan;
}

function formatPush(push: PushExecution): string {
	const target = push.remote && push.branch ? ` ${push.remote}/${push.branch}` : "";
	const error = push.error ? ` (${push.error.split(/\r?\n/u)[0]})` : "";
	return `push: ${push.status}${target}${error}`;
}

export function formatResult(result: AutoCommitResult): string {
	const rows = result.commits.map((commit, index) => `${index + 1}. ${commit.hash} ${commit.message}`).join("\n");
	const needsPushFollowUp = result.completion === "committed_not_pushed";
	const next = needsPushFollowUp
		? result.push.status === "failed"
			? "next: push가 실패했습니다. fetch/rebase/충돌 해결 후 push를 완료하기 전까지는 이 작업을 완료로 보고하지 마세요."
			: "next: 사용자가 push 보류를 명시하지 않았다면 지금 바로 push까지 완료한 뒤 보고하세요."
		: null;
	const extras = [
		result.backupBranch ? `backup: ${result.backupBranch}` : null,
		result.warnings?.length ? `warnings:\n${result.warnings.join("\n\n")}` : null,
		`status: ${result.completion}`,
		formatPush(result.push),
		next,
		result.leftovers.length > 0 ? `leftovers:\n${result.leftovers.join("\n")}` : "leftovers: none",
	].filter(Boolean);
	return [`auto-commit ${result.mode} 완료`, rows, ...extras].join("\n");
}

async function runStatus(pi: ExecHost, cwd: string): Promise<string> {
	const [branch, head, status, push] = await Promise.all([
		currentBranch(pi, cwd).catch(() => ""),
		currentHead(pi, cwd).catch(() => ""),
		rawStatusLines(pi, cwd).catch((error: unknown) => [`status failed: ${String(error)}`]),
		describePushReadiness(pi, cwd).catch((error: unknown) => `push: status failed (${String(error)})`),
	]);
	const diagnostic = buildCommitReadinessDiagnostic(pathsFromGitStatus(status));
	return [
		`branch: ${branch || "(detached)"}`,
		`HEAD: ${head}`,
		push,
		"",
		formatCommitReadinessDiagnostic(diagnostic),
		"",
		status.length > 0 ? status.join("\n") : "working tree clean",
	].join("\n");
}

function parseQuickCommandArgs(args: string): { message: string; paths: string[] } {
	const body = args.replace(/^quick\s*/u, "");
	const parts = body.split(/\s+--\s+/u);
	if (parts.length !== 2) throw new Error("/auto-commit quick requires: quick <message> -- <path...>");
	return { message: parts[0].trim(), paths: parts[1].trim().split(/\s+/u).filter(Boolean) };
}

async function runFromArgs(pi: ExecHost, ctx: CommandCtx, args: string): Promise<string> {
	const [rawMode, ...rest] = args.trim().split(/\s+/u).filter(Boolean);
	const mode = rawMode === "apply" || rawMode === "split-head" || rawMode === "status" || rawMode === "quick" ? rawMode : "apply";
	if (mode === "status") return runStatus(pi, ctx.cwd);
	if (mode === "quick") return formatResult(await applyPlan(pi, ctx.cwd, "quick", buildQuickPlan(parseQuickCommandArgs(args))));

	const planPath = mode === rawMode ? rest.join(" ") : args.trim();
	if (!planPath) throw new Error(`/${"auto-commit"} ${mode} requires a plan JSON path`);
	const plan = await loadPlan(ctx.cwd, planPath);
	return formatResult(await applyPlan(pi, ctx.cwd, mode, plan));
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("auto-commit", {
		description: "Apply a JSON commit plan, run a quick explicit-path hotfix commit, or split HEAD into focused commits.",
		handler: async (args, ctx) => {
			try {
				const output = await runFromArgs(pi, ctx, args);
				if (ctx.hasUI) ctx.ui.notify(output, "info");
				else console.log(output);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else console.error(message);
				throw error;
			}
		},
	});

	pi.registerTool({
		name: "auto_commit",
		label: "Auto Commit",
		description: "Apply an explicit JSON commit plan, run a quick explicit-path hotfix commit, optionally split HEAD, and report push-aware completion.",
		promptSnippet: "Create focused git commits from an explicit JSON plan or quick explicit-path hotfix input.",
		promptGuidelines: [
			"Use auto_commit with an explicit JSON commit plan whose file groups and messages are reviewable, or action=quick with explicit message+paths for tiny hotfix/copy changes.",
			"auto_commit enforces a diff-aware logical atom gate: 3+ primary files, large diffs, layer mix, and surface fan-out are evaluated before commit; small same-cluster fan-out may pass with warnings.",
			"For action=quick, default pushPolicy=push-if-tracking commits and pushes to the safe upstream feature branch when available.",
			"Treat status=committed_not_pushed as incomplete when the user expected push; do not report done until push is resolved.",
			"auto_commit rejects conventional commit scope parentheses by default; use messages like 'feat: 한글 설명'.",
		],
		parameters: autoCommitToolSchema,
		async execute(_toolCallId, params: AutoCommitToolInput, _signal, _onUpdate, ctx) {
			if (params.action === "status") {
				const output = await runStatus(pi, ctx.cwd);
				return { content: [{ type: "text", text: output }], details: { action: params.action } };
			}
			if (params.action === "quick") {
				const result = await applyPlan(pi, ctx.cwd, "quick", buildQuickPlan(params));
				return { content: [{ type: "text", text: formatResult(result) }], details: result };
			}
			if (!params.planPath) throw new Error("planPath is required");
			const plan = await loadPlan(ctx.cwd, params.planPath);
			const result = await applyPlan(pi, ctx.cwd, params.action, params.pushPolicy ? { ...plan, pushPolicy: params.pushPolicy } : plan);
			return { content: [{ type: "text", text: formatResult(result) }], details: result };
		},
	});
}
