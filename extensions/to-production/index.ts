import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const DEFAULT_BASE_REF = "origin/production";
const ARTIFACT_ROOT = join(homedir(), ".pi", "agent", "to-production");
const CUSTOM_TYPE = "pilee-to-production-report";

interface ParsedArgs {
	branch?: string;
	baseRef: string;
	targetPath?: string;
	message?: string;
	range?: string;
	includeUntracked: boolean;
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
}

interface PreparedArtifacts {
	artifactDir: string;
	metadataPath: string;
	commitsPatchPath: string | null;
	dirtyPatchPath: string | null;
	untrackedRoot: string | null;
	backupBranch: string;
}

interface Plan {
	source: SourceSnapshot;
	baseRef: string;
	fetchRemote: string;
	fetchBranch: string;
	targetBranch: string;
	targetPath: string;
	message: string;
	includeUntracked: boolean;
}

interface RunResult {
	report: string;
	level: "info" | "warning" | "error";
	status: "help" | "dry_run" | "cancelled" | "success";
	plan?: Plan;
	artifacts?: PreparedArtifacts;
}

interface ToProductionToolParams {
	args?: string;
	branch?: string;
	base?: string;
	path?: string;
	range?: string;
	message?: string;
	includeUntracked?: boolean;
	dryRun?: boolean;
	yes?: boolean;
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
		includeUntracked: false,
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
		else if (token === "--include-untracked") parsed.includeUntracked = true;
		else if (token === "--branch" || token === "-b") parsed.branch = nextValue();
		else if (token === "--base") parsed.baseRef = normalizeBaseRef(nextValue());
		else if (token === "--path") parsed.targetPath = nextValue();
		else if (token === "--message" || token === "-m") parsed.message = nextValue();
		else if (token === "--range") parsed.range = nextValue();
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

async function resolveCommitRange(pi: ExtensionAPI, repoRoot: string, parsed: ParsedArgs, upstream: string | null): Promise<{ range: string | null; source: string | null; commits: string[] }> {
	let range: string | null = null;
	let source: string | null = null;
	if (parsed.range) {
		range = parsed.range;
		source = "explicit --range";
	} else if (upstream) {
		const mergeBase = await gitCapture(pi, repoRoot, ["merge-base", "HEAD", upstream]);
		range = `${mergeBase}..HEAD`;
		source = `upstream ${upstream}`;
	}

	if (!range) return { range: null, source: null, commits: [] };
	const commitText = await gitCapture(pi, repoRoot, ["rev-list", "--reverse", range]);
	const commits = commitText.split("\n").map((line) => line.trim()).filter(Boolean);
	if (commits.length === 0) return { range, source, commits };

	const mergeCommitText = await gitCapture(pi, repoRoot, ["rev-list", "--merges", range]);
	const mergeCommits = mergeCommitText.split("\n").map((line) => line.trim()).filter(Boolean);
	if (mergeCommits.length > 0) {
		throw new Error([
			"/to-production MVP는 merge commit 자동 이식을 지원하지 않습니다.",
			`merge commits: ${mergeCommits.map(short).join(", ")}`,
			"원본은 변경하지 않았습니다. 필요한 commit range를 수동으로 정리한 뒤 다시 실행하세요.",
		].join("\n"));
	}
	return { range, source, commits };
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
		throw new Error("현재 source worktree에 충돌 상태 파일이 있어 안전하게 이식할 수 없습니다. 원본은 변경하지 않았습니다.");
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
	};
}

async function buildPlan(pi: ExtensionAPI, cwd: string, parsed: ParsedArgs): Promise<Plan> {
	const repoRoot = await findRepoRoot(pi, cwd);
	const source = await readSourceSnapshot(pi, repoRoot, parsed);
	const hasDirty = source.dirtyPatch.trim().length > 0;
	const hasUntracked = source.untrackedFiles.length > 0;
	if (source.commits.length === 0 && !hasDirty && !hasUntracked) {
		throw new Error("production으로 옮길 commit/diff/untracked 변경이 없습니다.");
	}
	if (hasUntracked && !parsed.includeUntracked) {
		throw new Error([
			"untracked 파일이 있어 자동 이식을 중단합니다.",
			"원본은 변경하지 않았습니다. untracked까지 옮기려면 `/to-production --include-untracked ...`로 다시 실행하세요.",
			`untracked: ${source.untrackedFiles.slice(0, 12).join(", ")}${source.untrackedFiles.length > 12 ? " ..." : ""}`,
		].join("\n"));
	}

	const { remote, branch } = parseRemoteRef(parsed.baseRef);
	const stamp = timestamp();
	const sourceSlug = safeSlug(parsed.branch ?? source.branch ?? basename(repoRoot));
	const targetBranch = parsed.branch ?? `hotfix/${sourceSlug}-${stamp.toLowerCase().replace(/z$/u, "")}`;
	if (branchRefLooksUnsafe(targetBranch)) throw new Error(`안전하지 않은 target branch 이름입니다: ${targetBranch}`);
	const targetPath = parsed.targetPath
		? (isAbsolute(parsed.targetPath) ? parsed.targetPath : resolve(dirname(repoRoot), parsed.targetPath))
		: join(dirname(repoRoot), `${basename(repoRoot)}-production-${stamp.toLowerCase().replace(/z$/u, "")}`);
	const message = parsed.message ?? "chore: production base로 미커밋 변경 이식";
	return {
		source,
		baseRef: parsed.baseRef,
		fetchRemote: remote,
		fetchBranch: branch,
		targetBranch,
		targetPath,
		message,
		includeUntracked: parsed.includeUntracked,
	};
}

function metadataFor(plan: Plan, artifacts?: Partial<PreparedArtifacts>): Record<string, unknown> {
	return {
		createdAt: new Date().toISOString(),
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
			statusShort: plan.source.statusShort,
		},
		target: {
			baseRef: plan.baseRef,
			branch: plan.targetBranch,
			path: plan.targetPath,
			message: plan.message,
		},
		artifacts,
	};
}

function copyUntrackedFiles(repoRoot: string, files: string[], artifactDir: string): string {
	const untrackedRoot = join(artifactDir, "untracked");
	mkdirSync(untrackedRoot, { recursive: true });
	for (const relativePath of files) {
		const source = resolve(repoRoot, relativePath);
		if (!source.startsWith(`${repoRoot}/`) && source !== repoRoot) {
			throw new Error(`repo 밖 untracked 경로는 복사하지 않습니다: ${relativePath}`);
		}
		if (!existsSync(source)) continue;
		const target = join(untrackedRoot, relativePath);
		mkdirSync(dirname(target), { recursive: true });
		cpSync(source, target, { recursive: true, errorOnExist: false, force: true, verbatimSymlinks: true });
	}
	return untrackedRoot;
}

async function prepareArtifacts(pi: ExtensionAPI, plan: Plan): Promise<PreparedArtifacts> {
	const repoHash = createHash("sha1").update(plan.source.repoRoot).digest("hex").slice(0, 10);
	const stamp = timestamp();
	const artifactDir = join(ARTIFACT_ROOT, `${basename(plan.source.repoRoot)}-${repoHash}`, stamp);
	mkdirSync(artifactDir, { recursive: true });

	let commitsPatchPath: string | null = null;
	if (plan.source.commits.length > 0 && plan.source.commitRange) {
		const patch = await gitCaptureRaw(pi, plan.source.repoRoot, ["format-patch", "--stdout", plan.source.commitRange], 120_000);
		commitsPatchPath = join(artifactDir, "commits.patch");
		writeFileSync(commitsPatchPath, patch);
	}

	let dirtyPatchPath: string | null = null;
	if (plan.source.dirtyPatch.trim().length > 0) {
		dirtyPatchPath = join(artifactDir, "dirty.patch");
		writeFileSync(dirtyPatchPath, plan.source.dirtyPatch);
	}

	let untrackedRoot: string | null = null;
	if (plan.source.untrackedFiles.length > 0) {
		untrackedRoot = copyUntrackedFiles(plan.source.repoRoot, plan.source.untrackedFiles, artifactDir);
		writeFileSync(join(artifactDir, "untracked-files.txt"), `${plan.source.untrackedFiles.join("\n")}\n`);
	}

	const backupBranch = `to-production/source-backup/${safeSlug(plan.source.branch ?? basename(plan.source.repoRoot))}-${stamp.toLowerCase().replace(/z$/u, "")}`;
	await gitCapture(pi, plan.source.repoRoot, ["branch", backupBranch, "HEAD"]);
	const metadataPath = join(artifactDir, "metadata.json");
	const artifacts: PreparedArtifacts = { artifactDir, metadataPath, commitsPatchPath, dirtyPatchPath, untrackedRoot, backupBranch };
	writeFileSync(metadataPath, `${JSON.stringify(metadataFor(plan, artifacts), null, 2)}\n`);
	return artifacts;
}

async function assertTargetSafe(pi: ExtensionAPI, plan: Plan): Promise<void> {
	await gitCapture(pi, plan.source.repoRoot, ["check-ref-format", "--branch", plan.targetBranch]);
	const branchExists = await gitCode(pi, plan.source.repoRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${plan.targetBranch}`]);
	if (branchExists === 0) throw new Error(`target branch가 이미 존재합니다: ${plan.targetBranch}`);
	if (existsSync(plan.targetPath)) throw new Error(`target worktree path가 이미 존재합니다: ${plan.targetPath}`);
}

async function fetchBase(pi: ExtensionAPI, plan: Plan): Promise<void> {
	await gitCapture(pi, plan.source.repoRoot, ["fetch", plan.fetchRemote, plan.fetchBranch], 300_000);
	await gitCapture(pi, plan.source.repoRoot, ["rev-parse", "--verify", plan.baseRef]);
}

function copyUntrackedToTarget(untrackedRoot: string, files: string[], targetPath: string): void {
	for (const relativePath of files) {
		const source = join(untrackedRoot, relativePath);
		if (!existsSync(source)) continue;
		const target = join(targetPath, relativePath);
		mkdirSync(dirname(target), { recursive: true });
		cpSync(source, target, { recursive: true, errorOnExist: false, force: true, verbatimSymlinks: true });
	}
}

async function applyArtifacts(pi: ExtensionAPI, plan: Plan, artifacts: PreparedArtifacts): Promise<void> {
	mkdirSync(dirname(plan.targetPath), { recursive: true });
	await gitCapture(pi, plan.source.repoRoot, ["worktree", "add", "-b", plan.targetBranch, plan.targetPath, plan.baseRef], 300_000);

	try {
		if (artifacts.commitsPatchPath) {
			await gitCapture(pi, plan.targetPath, ["am", "--3way", artifacts.commitsPatchPath], 300_000);
		}

		let shouldCommitDirty = false;
		if (artifacts.dirtyPatchPath) {
			await gitCapture(pi, plan.targetPath, ["apply", "--3way", "--index", artifacts.dirtyPatchPath], 300_000);
			shouldCommitDirty = true;
		}
		if (artifacts.untrackedRoot && plan.includeUntracked) {
			copyUntrackedToTarget(artifacts.untrackedRoot, plan.source.untrackedFiles, plan.targetPath);
			await gitCapture(pi, plan.targetPath, ["add", "--", ...plan.source.untrackedFiles], 120_000);
			shouldCommitDirty = true;
		}

		if (shouldCommitDirty) {
			const stagedCode = await gitCode(pi, plan.targetPath, ["diff", "--cached", "--quiet"]);
			if (stagedCode !== 0) await gitCapture(pi, plan.targetPath, ["commit", "-m", plan.message], 120_000);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error([
			"target worktree 생성 후 변경 적용 중 멈췄습니다.",
			"source worktree는 checkout/stash/reset/clean 없이 그대로 보존했습니다.",
			`target: ${plan.targetPath}`,
			`artifact: ${artifacts.artifactDir}`,
			message,
		].join("\n"));
	}
}

function buildPlanReport(plan: Plan, artifacts?: PreparedArtifacts): string {
	const dirty = plan.source.dirtyPatch.trim().length > 0;
	return [
		"## /to-production plan",
		"",
		"### Source — 절대 수정하지 않음",
		`- repo: \`${plan.source.repoRoot}\``,
		`- branch: \`${plan.source.branch ?? "(detached)"}\` @ \`${short(plan.source.head)}\``,
		`- upstream: \`${plan.source.upstream ?? "none"}\``,
		`- commits: ${plan.source.commits.length}${plan.source.commitRange ? ` (range \`${plan.source.commitRange}\`, ${plan.source.commitRangeSource})` : ""}`,
		`- dirty tracked/staged diff: ${dirty ? "yes" : "no"}`,
		`- untracked: ${plan.source.untrackedFiles.length}${plan.source.untrackedFiles.length > 0 ? ` (${plan.includeUntracked ? "include" : "blocked"})` : ""}`,
		"",
		"### Target",
		`- base: \`${plan.baseRef}\``,
		`- branch: \`${plan.targetBranch}\``,
		`- worktree: \`${plan.targetPath}\``,
		`- dirty commit message: \`${plan.message}\``,
		"",
		"### Safety",
		"- source worktree에는 checkout/stash/reset/clean을 실행하지 않습니다.",
		"- source HEAD backup branch와 patch artifact를 먼저 만든 뒤 target worktree에만 적용합니다.",
		artifacts ? `- artifact: \`${artifacts.artifactDir}\`` : "- artifact: 실행 시 생성",
		artifacts ? `- backup branch: \`${artifacts.backupBranch}\`` : "- backup branch: 실행 시 생성",
	].join("\n");
}

async function buildSuccessReport(pi: ExtensionAPI, plan: Plan, artifacts: PreparedArtifacts): Promise<string> {
	const targetStatus = await gitCapture(pi, plan.targetPath, ["status", "--short", "--branch"]);
	const targetLog = await gitCapture(pi, plan.targetPath, ["log", "--oneline", "--decorate", "-5"]);
	return [
		"## /to-production 완료",
		"",
		"source worktree는 그대로 보존했고, production 기반 target worktree에 변경을 이식했습니다.",
		"",
		`- source: \`${plan.source.repoRoot}\` @ \`${short(plan.source.head)}\``,
		`- backup branch: \`${artifacts.backupBranch}\``,
		`- artifact: \`${artifacts.artifactDir}\``,
		`- target branch: \`${plan.targetBranch}\``,
		`- target worktree: \`${plan.targetPath}\``,
		"",
		"### Target status",
		"```text",
		targetStatus,
		"```",
		"",
		"### Target log",
		"```text",
		targetLog,
		"```",
		"",
		"다음 단계: target worktree에서 필요한 검증을 실행한 뒤 push/PR을 진행하세요.",
	].join("\n");
}

function helpText(): string {
	return [
		"/to-production [target-branch] [options]",
		"",
		"현재 worktree의 local commits/미커밋 diff를 source에 손대지 않고 최신 origin/production 기반 새 worktree로 이식합니다.",
		"",
		"Options:",
		"  -b, --branch <name>       target branch 이름. 기본: hotfix/<source>-<timestamp>",
		"  --base <remote/branch>    production base. 기본: origin/production",
		"  --path <path>             target worktree path. 기본: source sibling path",
		"  --range <rev-range>       이식할 commit range를 명시. 기본: @{upstream} merge-base..HEAD",
		"  -m, --message <message>   미커밋 diff를 commit할 메시지",
		"  --include-untracked       untracked 파일도 artifact 백업 후 target에 복사/commit",
		"  --dry-run                 계획만 출력",
		"  -y, --yes                 확인창 생략",
		"",
		"Safety:",
		"  source worktree에는 checkout/stash/reset/clean을 실행하지 않습니다.",
		"  먼저 ~/.pi/agent/to-production 아래 patch artifact와 source backup branch를 남깁니다.",
	].join("\n");
}

function publish(pi: ExtensionAPI, ctx: ExtensionContext, report: string, level: "info" | "warning" | "error" = "info", details: Record<string, unknown> = {}): void {
	if (ctx.hasUI) ctx.ui.notify(report.split("\n")[0] ?? "/to-production", level);
	pi.sendMessage({ customType: CUSTOM_TYPE, content: report, display: true, details }, { triggerTurn: false });
}

function toolParamsToParsed(params: ToProductionToolParams): ParsedArgs {
	const rawArgs = params.args?.trim();
	const structuredKeys: Array<keyof ToProductionToolParams> = ["branch", "base", "path", "range", "message", "includeUntracked", "dryRun", "yes"];
	const hasStructured = structuredKeys.some((key) => params[key] !== undefined);
	if (rawArgs && hasStructured) throw new Error("to_production tool에서는 args와 구조화 옵션을 함께 쓰지 않습니다. 하나만 선택하세요.");
	if (rawArgs) return parseArgs(rawArgs);
	return {
		branch: params.branch?.trim() || undefined,
		baseRef: normalizeBaseRef(params.base ?? DEFAULT_BASE_REF),
		targetPath: params.path?.trim() || undefined,
		message: params.message?.trim() || undefined,
		range: params.range?.trim() || undefined,
		includeUntracked: Boolean(params.includeUntracked),
		yes: Boolean(params.yes),
		dryRun: Boolean(params.dryRun),
		help: false,
	};
}

async function executeToProduction(pi: ExtensionAPI, ctx: ExtensionContext, parsed: ParsedArgs): Promise<RunResult> {
	if (parsed.help) return { report: helpText(), level: "info", status: "help" };

	const plan = await buildPlan(pi, ctx.cwd, parsed);
	await fetchBase(pi, plan);
	await assertTargetSafe(pi, plan);
	const planReport = buildPlanReport(plan);
	if (parsed.dryRun) return { report: `${planReport}\n\nDry-run이라 branch/worktree/artifact를 만들지 않았습니다.`, level: "info", status: "dry_run", plan };
	if (!parsed.yes) {
		if (!ctx.hasUI) throw new Error("비대화 모드에서는 --yes 없이는 실행하지 않습니다.");
		const confirmed = await ctx.ui.confirm("/to-production 실행", `${planReport}\n\n진행할까요?`);
		if (!confirmed) return { report: `${planReport}\n\n사용자가 취소했습니다. source worktree는 변경하지 않았습니다.`, level: "warning", status: "cancelled", plan };
	}

	const artifacts = await prepareArtifacts(pi, plan);
	await applyArtifacts(pi, plan, artifacts);
	return { report: await buildSuccessReport(pi, plan, artifacts), level: "info", status: "success", plan, artifacts };
}

async function runToProduction(pi: ExtensionAPI, ctx: ExtensionContext, args: string): Promise<RunResult> {
	return executeToProduction(pi, ctx, parseArgs(args));
}

function resultDetails(result: RunResult): Record<string, unknown> {
	return {
		status: result.status,
		level: result.level,
		source: result.plan
			? {
				repoRoot: result.plan.source.repoRoot,
				branch: result.plan.source.branch,
				head: result.plan.source.head,
				commitRange: result.plan.source.commitRange,
				commits: result.plan.source.commits,
			}
			: undefined,
		target: result.plan
			? {
				baseRef: result.plan.baseRef,
				branch: result.plan.targetBranch,
				path: result.plan.targetPath,
			}
			: undefined,
		artifacts: result.artifacts,
	};
}

function errorReport(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `## /to-production 중단\n\n${message}\n\nsource worktree에는 checkout/stash/reset/clean을 실행하지 않았습니다.`;
}

export default function toProduction(pi: ExtensionAPI) {
	pi.registerCommand("to-production", {
		description: "현재 worktree 변경을 source 손상 없이 최신 production 기반 새 worktree/branch로 이식",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				const result = await runToProduction(pi, ctx, args);
				publish(pi, ctx, result.report, result.level, resultDetails(result));
			} catch (error) {
				publish(pi, ctx, errorReport(error), "error", { blocked: true });
			}
		},
	});

	pi.registerTool({
		name: "to_production",
		label: "To Production",
		description: "Run the dedicated /to-production source-preserving production/hotfix migration flow from natural-language requests.",
		promptSnippet: "Use to_production when the user asks to move current work to production/hotfix/hotfeature or says '/to-production으로 해줘' in natural language.",
		promptGuidelines: [
			"Use this dedicated tool instead of worktree_fork, worktree_create, manual git worktree add, checkout, stash, reset, or clean when the task is to move existing source work to production/hotfix/hotfeature.",
			"The tool shares the same execution path as the /to-production slash command and preserves the source worktree by using artifact/backup branch + target worktree application.",
			"If the user provided an exact /to-production argument string, pass it as args. Otherwise prefer structured parameters such as branch, range, base, path, message, includeUntracked, dryRun, and yes.",
			"Do not pass yes:true unless the user explicitly approved execution or asked you to run it now; without yes, UI contexts show the same confirmation as the slash command and headless contexts stop safely.",
			"If this tool is unavailable in the current runtime, ask the user to submit the standalone /to-production command rather than emulating it with generic worktree tools.",
		],
		parameters: Type.Object({
			args: Type.Optional(Type.String({ description: "Raw /to-production argument string, e.g. '--range abc..HEAD --branch hotfeature/COM-123/foo'. Do not combine with structured options." })),
			branch: Type.Optional(Type.String({ description: "Target branch name." })),
			base: Type.Optional(Type.String({ description: "Production base ref. Defaults to origin/production." })),
			path: Type.Optional(Type.String({ description: "Target worktree path." })),
			range: Type.Optional(Type.String({ description: "Commit range to migrate, e.g. abc123..HEAD." })),
			message: Type.Optional(Type.String({ description: "Commit message for migrated dirty/untracked changes." })),
			includeUntracked: Type.Optional(Type.Boolean({ description: "Include untracked files after artifact backup." })),
			dryRun: Type.Optional(Type.Boolean({ description: "Plan only; do not create branch/worktree/artifacts." })),
			yes: Type.Optional(Type.Boolean({ description: "Skip confirmation only when the user explicitly approved execution." })),
		}),
		async execute(_toolCallId, params: ToProductionToolParams, _signal, _onUpdate, ctx: ExtensionContext) {
			try {
				const result = await executeToProduction(pi, ctx, toolParamsToParsed(params));
				return { content: [{ type: "text", text: result.report }], details: resultDetails(result) };
			} catch (error) {
				return { content: [{ type: "text", text: errorReport(error) }], details: { blocked: true } };
			}
		},
	});
}

export const __toProductionForTests = {
	parseArgs,
	toolParamsToParsed,
	buildPlan,
	helpText,
};
