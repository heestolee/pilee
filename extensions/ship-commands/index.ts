import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { loadPrShipProfiles } from "../utils/private-profiles.ts";
import {
	fetchCurrentPullRequestInfo,
	fetchUnresolvedPullRequestReviewComments,
	formatUnresolvedReviewCommentsForEditor,
	parseGitHubPullUrl,
	type PullRequestInfo,
	type PullRequestReviewCommentsSummary,
} from "../utils/github-pr-review-comments.ts";
import {
	classifyPrShipReviewAuthor,
	formatPrShipExternalWritePolicy,
	resolvePrShipExternalWritePolicy,
	type ResolvedPrShipExternalWritePolicy,
} from "./pr-ship-policy.ts";
import {
	isDirectPrShipReviewWriteCommand,
	registerPrShipReviewWriteTool,
} from "./pr-ship-write-tool.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILLS_DIR = join(PACKAGE_ROOT, "skills");
const SHIM_CUSTOM_TYPE = "pilee-ship-command-shim";
const MAX_COLLECTED_CONTEXT_CHARS = 18_000;

export type ShipCommandName = "ship" | "pr-ship" | "ci-ship";
export type ParallelAnalysisCommandName = "ci-ship" | "pr-ship" | "self-healing";
export type ParallelAnalysisSource = "command" | "steering";

export const PARALLEL_WORKFLOW_ANALYSIS_EVENT = "pilee:parallel-workflow-analysis";

type ShipContext = Pick<ExtensionContext, "cwd" | "sessionManager"> & { hasUI?: boolean; ui?: ExtensionCommandContext["ui"] };

export interface ParallelWorkflowAnalysisRequest {
	command: ParallelAnalysisCommandName;
	args: string;
	cwd: string;
	source: ParallelAnalysisSource;
	requestedAt: string;
	sessionFile: string | null;
	sessionName: string | null;
	leafId: string | null;
	panelLabel: string;
}

interface RepoInfo {
	owner: string;
	repo: string;
}

interface CommentTarget {
	owner: string;
	repo: string;
	number: number;
	commentId: number;
	url: string;
}

interface ReviewTarget {
	owner: string;
	repo: string;
	number: number;
	reviewId: number;
	url: string;
}

interface ReviewCommentDetail {
	id: number | null;
	body: string;
	path: string | null;
	line: number | null;
	originalLine: number | null;
	diffHunk: string | null;
	htmlUrl: string | null;
	author: string | null;
	commitId: string | null;
	inReplyToId: number | null;
}

interface PullRequestReviewDetail {
	id: number | null;
	body: string;
	htmlUrl: string | null;
	author: string | null;
	state: string | null;
}

interface PrShipOptions {
	pushOnly: boolean;
	remainingArgs: string;
	matchedFlags: string[];
}

interface ActionsJobTarget {
	owner: string;
	repo: string;
	runId: string;
	jobId: string;
	url: string;
}

interface ActionsRunContext {
	databaseId: number | null;
	displayTitle: string | null;
	event: string | null;
	headBranch: string | null;
	headSha: string | null;
	workflowName: string | null;
	status: string | null;
	conclusion: string | null;
	url: string | null;
}

interface CiCheckSummary {
	name: string;
	workflowName: string | null;
	status: string | null;
	conclusion: string | null;
	detailsUrl: string | null;
	startedAt: string | null;
	completedAt: string | null;
}

function skillPath(skillName: string): string {
	return join(SKILLS_DIR, skillName, "SKILL.md");
}

function readSkill(skillName: string): { name: string; path: string; content: string } {
	const path = skillPath(skillName);
	return { name: skillName, path, content: readFileSync(path, "utf-8").trimEnd() };
}

function formatInlinedSkill(skill: { name: string; path: string; content: string }): string {
	return [
		`----- BEGIN INLINED PILEE SKILL: ${skill.name} -----`,
		`Location: ${skill.path}`,
		`References are relative to: ${dirname(skill.path)}`,
		"",
		skill.content,
		`----- END INLINED PILEE SKILL: ${skill.name} -----`,
	].join("\n");
}

function notify(ctx: ShipContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui?.notify(message, level);
}

function truncateText(text: string, maxChars = MAX_COLLECTED_CONTEXT_CHARS): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[truncated: ${text.length - maxChars} chars omitted; run gh commands again if more context is needed]`;
}

function truncateTailText(text: string, maxChars = MAX_COLLECTED_CONTEXT_CHARS): string {
	if (text.length <= maxChars) return text;
	return `[truncated: first ${text.length - maxChars} chars omitted; showing log tail]\n\n${text.slice(-maxChars)}`;
}

function fence(text: string, language = ""): string {
	const safe = text.replace(/```/gu, "```\u200b");
	return `\`\`\`${language}\n${safe}\n\`\`\``;
}

function parseCommentUrl(args: string): CommentTarget | null {
	const match = args.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/[^#\s]*)?#discussion_r(\d+)/u);
	if (!match) return null;
	return {
		owner: match[1],
		repo: match[2],
		number: Number(match[3]),
		commentId: Number(match[4]),
		url: match[0],
	};
}

export function parsePullRequestReviewUrl(args: string): ReviewTarget | null {
	const match = args.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)#pullrequestreview-(\d+)/u);
	if (!match) return null;
	return {
		owner: match[1],
		repo: match[2],
		number: Number(match[3]),
		reviewId: Number(match[4]),
		url: match[0],
	};
}

function parsePrShipOptions(args: string): PrShipOptions {
	const tokens = args.trim().split(/\s+/u).filter(Boolean);
	const pushOnlyFlags = new Set(["--push-only", "--no-comment", "--draft-only", "--manual-comment"]);
	const matchedFlags: string[] = [];
	const remainingTokens: string[] = [];
	for (const token of tokens) {
		if (pushOnlyFlags.has(token)) {
			matchedFlags.push(token);
			continue;
		}
		remainingTokens.push(token);
	}
	return {
		pushOnly: matchedFlags.length > 0,
		remainingArgs: remainingTokens.join(" "),
		matchedFlags,
	};
}

function formatPrShipMode(options: PrShipOptions): string {
	if (!options.pushOnly) {
		return [
			"## pr-ship requested mode",
			"",
			"- requested mode: full-response",
			"- effective mode is determined by the authoritative actor policy below.",
			"- allowlisted actor: fix/verify/commit/push → guarded thread reply → same-login re-request.",
			"- protected human/unknown actor: local read-only analysis and report only.",
		].join("\n");
	}
	return [
		"## pr-ship requested mode",
		"",
		"- requested mode: push-only / manual-comment",
		`- flags: ${options.matchedFlags.join(", ")}`,
		"- effective mode is still actor-gated; protected human/unknown reviews remain local-analysis-only with no draft.",
		"- for an allowlisted actor: fix/verify/commit/push, then include a manual-posting draft without GitHub comment/re-request.",
	].join("\n");
}

function parseActionsJobUrl(args: string): ActionsJobTarget | null {
	const match = args.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/job\/(\d+)/u);
	if (!match) return null;
	return { owner: match[1], repo: match[2], runId: match[3], jobId: match[4], url: match[0] };
}

function parseBareNumber(args: string): number | null {
	const trimmed = args.trim();
	const match = trimmed.match(/^#?(\d+)$/u);
	return match ? Number(match[1]) : null;
}

export function parseParallelAnalysisCommand(raw: string): { command: ParallelAnalysisCommandName; args: string } | null {
	const match = raw.trim().match(/^\/(ci-ship|pr-ship|self-healing)(?:\s+([\s\S]*))?$/u);
	if (!match) return null;
	return {
		command: match[1] as ParallelAnalysisCommandName,
		args: match[2]?.trim() ?? "",
	};
}

export function buildParallelAnalysisRequest(
	ctx: ShipContext,
	command: ParallelAnalysisCommandName,
	args: string,
	source: ParallelAnalysisSource,
): ParallelWorkflowAnalysisRequest {
	return {
		command,
		args,
		cwd: ctx.cwd,
		source,
		requestedAt: new Date().toISOString(),
		sessionFile: ctx.sessionManager.getSessionFile() ?? null,
		sessionName: ctx.sessionManager.getSessionName?.() ?? null,
		leafId: ctx.sessionManager.getLeafId?.() ?? null,
		panelLabel: process.env.PI_FORK_PANEL_LABEL?.trim() || "P0",
	};
}

async function fetchRepoInfo(pi: ExtensionAPI, cwd: string): Promise<RepoInfo | null> {
	const result = await pi.exec("gh", ["repo", "view", "--json", "nameWithOwner"], { cwd });
	if (result.code !== 0) return null;
	try {
		const parsed = JSON.parse(result.stdout ?? "") as { nameWithOwner?: unknown };
		if (typeof parsed.nameWithOwner !== "string") return null;
		const [owner, repo] = parsed.nameWithOwner.split("/");
		if (!owner || !repo) return null;
		return { owner, repo };
	} catch {
		return null;
	}
}

function readString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readAuthor(value: unknown): string | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const login = (value as { login?: unknown }).login;
	return readString(login);
}

async function fetchReviewCommentDetail(pi: ExtensionAPI, cwd: string, target: CommentTarget): Promise<ReviewCommentDetail | null> {
	const result = await pi.exec("gh", ["api", `repos/${target.owner}/${target.repo}/pulls/comments/${target.commentId}`], { cwd });
	if (result.code !== 0) return null;
	try {
		const parsed = JSON.parse(result.stdout ?? "") as Record<string, unknown>;
		return {
			id: readNumber(parsed.id),
			body: typeof parsed.body === "string" ? parsed.body : "",
			path: readString(parsed.path),
			line: readNumber(parsed.line),
			originalLine: readNumber(parsed.original_line),
			diffHunk: readString(parsed.diff_hunk),
			htmlUrl: readString(parsed.html_url),
			author: readAuthor(parsed.user),
			commitId: readString(parsed.commit_id),
			inReplyToId: readNumber(parsed.in_reply_to_id),
		};
	} catch {
		return null;
	}
}

async function fetchPullRequestReviewDetail(pi: ExtensionAPI, cwd: string, target: ReviewTarget): Promise<PullRequestReviewDetail | null> {
	const result = await pi.exec("gh", ["api", `repos/${target.owner}/${target.repo}/pulls/${target.number}/reviews/${target.reviewId}`], { cwd });
	if (result.code !== 0) return null;
	try {
		const parsed = JSON.parse(result.stdout ?? "") as Record<string, unknown>;
		return {
			id: readNumber(parsed.id),
			body: typeof parsed.body === "string" ? parsed.body : "",
			htmlUrl: readString(parsed.html_url),
			author: readAuthor(parsed.user),
			state: readString(parsed.state),
		};
	} catch {
		return null;
	}
}

async function resolvePullRequestFromArgs(pi: ExtensionAPI, ctx: ShipContext, args: string): Promise<PullRequestInfo | null> {
	const trimmed = args.trim();
	const commentTarget = parseCommentUrl(trimmed);
	if (commentTarget) {
		return {
			number: commentTarget.number,
			title: null,
			url: `https://github.com/${commentTarget.owner}/${commentTarget.repo}/pull/${commentTarget.number}`,
			owner: commentTarget.owner,
			repo: commentTarget.repo,
		};
	}

	const reviewTarget = parsePullRequestReviewUrl(trimmed);
	if (reviewTarget) {
		return {
			number: reviewTarget.number,
			title: null,
			url: `https://github.com/${reviewTarget.owner}/${reviewTarget.repo}/pull/${reviewTarget.number}`,
			owner: reviewTarget.owner,
			repo: reviewTarget.repo,
		};
	}

	if (parseActionsJobUrl(trimmed)) return null;

	const prUrl = parseGitHubPullUrl(trimmed);
	if (prUrl) {
		return {
			number: prUrl.number,
			title: null,
			url: `https://github.com/${prUrl.owner}/${prUrl.repo}/pull/${prUrl.number}`,
			owner: prUrl.owner,
			repo: prUrl.repo,
		};
	}

	const bareNumber = parseBareNumber(trimmed);
	if (bareNumber) {
		const repo = await fetchRepoInfo(pi, ctx.cwd);
		if (!repo) return null;
		return {
			number: bareNumber,
			title: null,
			url: `https://github.com/${repo.owner}/${repo.repo}/pull/${bareNumber}`,
			owner: repo.owner,
			repo: repo.repo,
		};
	}

	const currentPrResult = await fetchCurrentPullRequestInfo(pi, ctx.cwd);
	return currentPrResult.ok ? currentPrResult.pullRequest : null;
}

function formatSessionRefs(ctx: ShipContext): string {
	const currentSessionFile = ctx.sessionManager.getSessionFile() ?? "(unknown)";
	const currentSessionName = ctx.sessionManager.getSessionName?.() ?? "(unnamed)";
	const parentSessionFile = process.env.PI_FORK_PARENT?.trim() || "(none)";
	const panelLabel = process.env.PI_FORK_PANEL_LABEL?.trim() || "P0";
	return [
		"## Session / parent context references",
		"",
		`- cwd: ${ctx.cwd}`,
		`- panel: ${panelLabel}`,
		`- current session: ${currentSessionFile}`,
		`- current session title: ${currentSessionName}`,
		`- parent session: ${parentSessionFile}`,
		"",
		"Before deciding, inspect the parent/current conversation and local work history when useful. If a parent session is unavailable, reconstruct from git/PR/local context files and say so.",
	].join("\n");
}

function formatCommentDetail(
	target: CommentTarget,
	detail: ReviewCommentDetail | null,
	policy: ResolvedPrShipExternalWritePolicy,
): string {
	if (!detail) {
		return [
			"## Specific review comment",
			"",
			`- URL: ${target.url}`,
			`- comment id: ${target.commentId}`,
			"- actor route: local-analysis-only (author lookup failed; fail closed)",
			"- detail fetch: failed; fetch it again with `gh api repos/<owner>/<repo>/pulls/comments/<comment_id>` before responding.",
		].join("\n");
	}
	const lines = [
		"## Specific review comment",
		"",
		`- URL: ${detail.htmlUrl ?? target.url}`,
		`- comment id: ${detail.id ?? target.commentId}`,
		`- author: ${detail.author ?? "unknown"}`,
		`- actor route: ${classifyPrShipReviewAuthor(detail.author, policy)}`,
		`- file: ${detail.path ?? "unknown"}${detail.line ?? detail.originalLine ? `:${detail.line ?? detail.originalLine}` : ""}`,
		`- commit: ${detail.commitId ?? "unknown"}`,
	];
	if (detail.inReplyToId) lines.push(`- reply-to comment id: ${detail.inReplyToId}`);
	lines.push("", "### Body", fence(detail.body || "(empty)", "markdown"));
	if (detail.diffHunk) lines.push("", "### Diff hunk", fence(detail.diffHunk, "diff"));
	return lines.join("\n");
}

function formatPullRequestReviewDetail(
	target: ReviewTarget,
	detail: PullRequestReviewDetail | null,
	policy: ResolvedPrShipExternalWritePolicy,
): string {
	if (!detail) {
		return [
			"## Specific pull request review",
			"",
			`- URL: ${target.url}`,
			`- review id: ${target.reviewId}`,
			"- actor route: local-analysis-only (author lookup failed; fail closed)",
		].join("\n");
	}
	return [
		"## Specific pull request review",
		"",
		`- URL: ${detail.htmlUrl ?? target.url}`,
		`- review id: ${detail.id ?? target.reviewId}`,
		`- author: ${detail.author ?? "unknown"}`,
		`- state: ${detail.state ?? "unknown"}`,
		`- actor route: ${classifyPrShipReviewAuthor(detail.author, policy)}`,
		"",
		"### Body",
		fence(detail.body || "(empty)", "markdown"),
	].join("\n");
}

function formatPrShipThreadRouting(
	summary: PullRequestReviewCommentsSummary,
	policy: ResolvedPrShipExternalWritePolicy,
): string {
	const lines = [
		"## Unresolved review thread actor routing",
		"",
		"Only each thread's root comment author determines whether that thread may enter the write workflow.",
		"",
	];
	if (summary.threads.length === 0) {
		lines.push("(no unresolved review threads)");
		return lines.join("\n");
	}
	for (const [index, thread] of summary.threads.entries()) {
		const root = thread.comments[0];
		lines.push(
			`- ${index + 1}. ${root?.url ?? thread.id} — author=${root?.author ?? "unknown"} — route=${classifyPrShipReviewAuthor(root?.author ?? null, policy)}`,
		);
	}
	return lines.join("\n");
}

async function buildPrShipCollectedContext(pi: ExtensionAPI, ctx: ShipContext, args: string): Promise<string> {
	const options = parsePrShipOptions(args);
	const lookupArgs = options.remainingArgs || args;
	const commentTarget = parseCommentUrl(lookupArgs.trim());
	const reviewTarget = parsePullRequestReviewUrl(lookupArgs.trim());
	const pullRequest = await resolvePullRequestFromArgs(pi, ctx, lookupArgs);
	const sections: string[] = [formatSessionRefs(ctx), formatPrShipMode(options)];

	if (!pullRequest) {
		sections.push(
			[
				"## PR context",
				"",
				"PR을 자동 식별하지 못했습니다. 모든 actor는 fail-closed local-analysis-only입니다.",
			].join("\n"),
		);
		sections.push(formatPrShipExternalWritePolicy(resolvePrShipExternalWritePolicy(null, loadPrShipProfiles())));
		return sections.join("\n\n---\n\n");
	}

	const repository = `${pullRequest.owner}/${pullRequest.repo}`;
	const policy = resolvePrShipExternalWritePolicy(repository, loadPrShipProfiles());
	sections.push([
		"## PR context",
		"",
		`- PR: #${pullRequest.number}`,
		`- URL: ${pullRequest.url}`,
		`- repo: ${repository}`,
		pullRequest.title ? `- title: ${pullRequest.title}` : "- title: (not fetched)",
	].join("\n"));
	sections.push(formatPrShipExternalWritePolicy(policy));

	if (commentTarget) {
		sections.push(formatCommentDetail(commentTarget, await fetchReviewCommentDetail(pi, ctx.cwd, commentTarget), policy));
	}
	if (reviewTarget) {
		sections.push(formatPullRequestReviewDetail(reviewTarget, await fetchPullRequestReviewDetail(pi, ctx.cwd, reviewTarget), policy));
	}

	const summary = await fetchUnresolvedPullRequestReviewComments(pi, ctx.cwd, pullRequest);
	if (summary) {
		sections.push(formatPrShipThreadRouting(summary, policy));
		const formatted = formatUnresolvedReviewCommentsForEditor(summary);
		sections.push([
			"## Unresolved review comments snapshot",
			"",
			formatted.trim() ? truncateText(formatted) : "미해결 inline review comment가 없습니다.",
		].join("\n"));
	} else {
		sections.push([
			"## Unresolved review comments snapshot",
			"",
			"조회 실패. actor identity도 확정할 수 없으므로 fail-closed local-analysis-only로 유지하세요.",
		].join("\n"));
	}

	return sections.join("\n\n---\n\n");
}

function isFailingCheck(check: CiCheckSummary): boolean {
	const conclusion = check.conclusion?.toUpperCase();
	if (conclusion && !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(conclusion)) return true;
	const status = check.status?.toUpperCase();
	return status === "FAILURE" || status === "ERROR";
}

export function isCiShipExcludedByDefaultCheck(check: CiCheckSummary): boolean {
	const haystack = [check.name, check.workflowName].filter(Boolean).join(" ");
	return /fixme-alert|FIXME\s*코멘트\s*체크|FIXME|TODO\s*comment|comment\s*policy/iu.test(haystack);
}

function parseCiChecks(snapshot: Record<string, unknown> | null): CiCheckSummary[] {
	const rollup = Array.isArray(snapshot?.statusCheckRollup) ? snapshot.statusCheckRollup : [];
	return rollup
		.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item))
		.map((item) => ({
			name: readString(item.name) ?? "(unnamed check)",
			workflowName: readString(item.workflowName),
			status: readString(item.status),
			conclusion: readString(item.conclusion),
			detailsUrl: readString(item.detailsUrl) ?? readString(item.targetUrl),
			startedAt: readString(item.startedAt),
			completedAt: readString(item.completedAt),
		}));
}

async function fetchPrStatusSnapshot(pi: ExtensionAPI, cwd: string, pullRequest: PullRequestInfo): Promise<Record<string, unknown> | null> {
	const result = await pi.exec("gh", [
		"pr",
		"view",
		pullRequest.url,
		"--json",
		"number,title,url,headRefName,headRefOid,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup",
	], { cwd });
	if (result.code !== 0) return null;
	try {
		return JSON.parse(result.stdout ?? "") as Record<string, unknown>;
	} catch {
		return null;
	}
}

async function fetchActionsRunContext(pi: ExtensionAPI, cwd: string, target: ActionsJobTarget): Promise<ActionsRunContext | null> {
	const result = await pi.exec("gh", [
		"run",
		"view",
		target.runId,
		"--repo",
		`${target.owner}/${target.repo}`,
		"--json",
		"databaseId,displayTitle,event,headBranch,headSha,workflowName,status,conclusion,url",
	], { cwd, timeout: 60_000 });
	if (result.code !== 0) return null;
	try {
		const parsed = JSON.parse(result.stdout ?? "") as Record<string, unknown>;
		return {
			databaseId: readNumber(parsed.databaseId),
			displayTitle: readString(parsed.displayTitle),
			event: readString(parsed.event),
			headBranch: readString(parsed.headBranch),
			headSha: readString(parsed.headSha),
			workflowName: readString(parsed.workflowName),
			status: readString(parsed.status),
			conclusion: readString(parsed.conclusion),
			url: readString(parsed.url),
		};
	} catch {
		return null;
	}
}

async function resolvePullRequestFromJob(pi: ExtensionAPI, cwd: string, target: ActionsJobTarget): Promise<PullRequestInfo | null> {
	const run = await fetchActionsRunContext(pi, cwd, target);
	if (!run?.headBranch) return null;
	const result = await pi.exec("gh", [
		"pr",
		"list",
		"--repo",
		`${target.owner}/${target.repo}`,
		"--head",
		run.headBranch,
		"--state",
		"all",
		"--limit",
		"20",
		"--json",
		"number,title,url,headRefName,headRefOid,baseRefName,state",
	], { cwd, timeout: 60_000 });
	if (result.code !== 0) return null;
	try {
		const prs = JSON.parse(result.stdout ?? "[]") as Array<Record<string, unknown>>;
		const best = prs.find((pr) => readString(pr.state) === "OPEN" && (!run.headSha || readString(pr.headRefOid) === run.headSha))
			?? prs.find((pr) => readString(pr.state) === "OPEN")
			?? prs.find((pr) => !run.headSha || readString(pr.headRefOid) === run.headSha)
			?? prs[0];
		const url = readString(best?.url);
		const parsed = parseGitHubPullUrl(url);
		if (!best || !url || !parsed) return null;
		return {
			number: readNumber(best.number) ?? parsed.number,
			title: readString(best.title),
			url,
			owner: parsed.owner,
			repo: parsed.repo,
		};
	} catch {
		return null;
	}
}

async function fetchFailedJobLog(pi: ExtensionAPI, cwd: string, target: ActionsJobTarget): Promise<string> {
	const result = await pi.exec("gh", ["run", "view", target.runId, "--repo", `${target.owner}/${target.repo}`, "--job", target.jobId, "--log-failed"], { cwd, timeout: 120_000 });
	const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
	if (!output) return `(no failed log output; exit code ${result.code})`;
	return truncateTailText(output, 12_000);
}

function formatCiChecks(checks: CiCheckSummary[]): string {
	if (checks.length === 0) return "(no checks found)";
	return checks.map((check, index) => [
		`### ${index + 1}. ${check.workflowName ? `${check.workflowName} / ` : ""}${check.name}`,
		`- status: ${check.status ?? "unknown"}`,
		`- conclusion: ${check.conclusion ?? "unknown"}`,
		check.detailsUrl ? `- details: ${check.detailsUrl}` : "- details: (none)",
		check.startedAt ? `- started: ${check.startedAt}` : null,
		check.completedAt ? `- completed: ${check.completedAt}` : null,
	].filter(Boolean).join("\n")).join("\n\n");
}

function formatRunContext(run: ActionsRunContext | null): string {
	if (!run) return "(run metadata fetch failed)";
	return [
		`- run: ${run.databaseId ?? "unknown"}`,
		`- workflow: ${run.workflowName ?? "unknown"}`,
		`- title: ${run.displayTitle ?? "unknown"}`,
		`- event: ${run.event ?? "unknown"}`,
		`- head: ${run.headBranch ?? "unknown"}${run.headSha ? ` @ ${run.headSha}` : ""}`,
		`- status: ${run.status ?? "unknown"}`,
		`- conclusion: ${run.conclusion ?? "unknown"}`,
		run.url ? `- url: ${run.url}` : null,
	].filter(Boolean).join("\n");
}

function formatExecBlock(label: string, result: { stdout?: string; stderr?: string; code?: number | null } | null): string {
	if (!result) return `### ${label}\n\n(command unavailable)`;
	const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || `(no output; exit ${result.code ?? "unknown"})`;
	return [`### ${label}`, "", fence(truncateTailText(output, 8_000), "text")].join("\n");
}

async function buildGenericWorkflowCollectedContext(pi: ExtensionAPI, ctx: ShipContext): Promise<string> {
	const sections: string[] = [formatSessionRefs(ctx), "## Command-time repository snapshot"];
	const commands: Array<[string, string, string[]]> = [
		["git status", "git", ["status", "--short", "--branch"]],
		["git HEAD", "git", ["rev-parse", "HEAD"]],
		["recent commits", "git", ["log", "--oneline", "--decorate", "-5"]],
		["current PR", "gh", ["pr", "view", "--json", "number,title,url,headRefName,headRefOid,baseRefName,mergeStateStatus,reviewDecision"]],
	];
	for (const [label, command, args] of commands) {
		try {
			sections.push(formatExecBlock(label, await pi.exec(command, args, { cwd: ctx.cwd, timeout: 60_000 })));
		} catch (error) {
			sections.push(`### ${label}\n\n${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return sections.join("\n\n---\n\n");
}

function formatParallelAnalysisMode(command: ParallelAnalysisCommandName, request?: ParallelWorkflowAnalysisRequest): string {
	return [
		"## Parallel analysis mode",
		"",
		`- command: /${command}${request?.args ? ` ${request.args}` : ""}`,
		`- source: ${request?.source ?? "unknown"}`,
		`- capturedAt: ${request?.requestedAt ?? new Date().toISOString()}`,
		`- basis cwd: ${request?.cwd ?? "(current cwd)"}`,
		`- basis session: ${request?.sessionFile ?? "(unknown)"}`,
		`- basis leaf: ${request?.leafId ?? "(unknown)"}`,
		"",
		"Hard mode override:",
		"- READ-ONLY ANALYSIS ONLY. Do not edit/write files, commit, push, rerun CI, post PR comments, request review, resolve threads, or run worker fixes.",
		"- Treat collected context as the command-time snapshot. Include the basis SHA/check/comment ids in your result when available.",
		"- If you find actionable work, report it as a Writer Queue Proposal for the main writer to apply after it rechecks latest HEAD.",
		"- If the underlying skill normally performs a write phase, stop before that phase and explain exactly what the writer should do next.",
		"- User-facing prose must be Korean; preserve commands, paths, URLs, SHAs, and raw logs exactly.",
	].join("\n");
}

function formatParallelAnalysisFinalContract(): string {
	return [
		"## Required final shape",
		"",
		"```markdown",
		"## Snapshot",
		"- basis: <PR/check/comment/diff SHA or session leaf>",
		"",
		"## Read-only Findings",
		"- <what was checked and root cause/risk>",
		"",
		"## Writer Queue Proposal",
		"- Must fix now: <items with file/command evidence>",
		"- Ask user: <items needing product/security/UX decision>",
		"- Ignore/defer: <non-actionable or out-of-scope items>",
		"",
		"## Writer Safety Notes",
		"- latest HEAD recheck needed: yes/no + why",
		"- commands to verify after applying: `<command>`",
		"```",
	].join("\n");
}

async function buildCiShipCollectedContext(pi: ExtensionAPI, ctx: ShipContext, args: string): Promise<string> {
	const explicitJob = parseActionsJobUrl(args.trim());
	const pullRequest = await resolvePullRequestFromArgs(pi, ctx, args) ?? (explicitJob ? await resolvePullRequestFromJob(pi, ctx.cwd, explicitJob) : null);
	const sections: string[] = [formatSessionRefs(ctx)];

	if (!pullRequest) {
		sections.push([
			"## PR / CI context",
			"",
			"PR을 자동 식별하지 못했습니다. `gh pr view` 또는 사용자가 준 PR URL/job URL로 다시 확인하세요.",
		].join("\n"));
	} else {
		const snapshot = await fetchPrStatusSnapshot(pi, ctx.cwd, pullRequest);
		const checks = parseCiChecks(snapshot);
		const failingChecks = checks.filter(isFailingCheck);
		const excludedChecks = failingChecks.filter(isCiShipExcludedByDefaultCheck);
		const actionableChecks = failingChecks.filter((check) => !isCiShipExcludedByDefaultCheck(check));
		sections.push([
			"## PR status check snapshot",
			"",
			snapshot ? fence(JSON.stringify(snapshot, null, 2), "json") : `PR status check 조회 실패: ${pullRequest.url}`,
		].join("\n"));
		sections.push([
			"## Failing / non-success checks (actionable by default)",
			"",
			formatCiChecks(actionableChecks),
		].join("\n"));
		if (excludedChecks.length > 0) {
			sections.push([
				"## Excluded by default checks",
				"",
				"이 check들은 PR rollup에는 남기지만, 사용자가 명시적으로 요청하지 않는 한 `/ci-ship`은 의도적 주석/policy gate를 자동 수정하지 않습니다.",
				"",
				formatCiChecks(excludedChecks),
			].join("\n"));
		}

		const logTargets = actionableChecks
			.map((check) => check.detailsUrl ? parseActionsJobUrl(check.detailsUrl) : null)
			.filter((target): target is ActionsJobTarget => target !== null)
			.slice(0, 4);
		for (const target of logTargets) {
			sections.push([
				`## Failed job log excerpt — run ${target.runId} job ${target.jobId}`,
				"",
				`URL: ${target.url}`,
				"",
				fence(await fetchFailedJobLog(pi, ctx.cwd, target), "text"),
			].join("\n"));
		}
	}

	if (explicitJob) {
		sections.push([
			`## Explicit job metadata — run ${explicitJob.runId} job ${explicitJob.jobId}`,
			"",
			`URL: ${explicitJob.url}`,
			"",
			formatRunContext(await fetchActionsRunContext(pi, ctx.cwd, explicitJob)),
		].join("\n"));
		sections.push([
			`## Explicit job log excerpt — run ${explicitJob.runId} job ${explicitJob.jobId}`,
			"",
			`URL: ${explicitJob.url}`,
			"",
			fence(await fetchFailedJobLog(pi, ctx.cwd, explicitJob), "text"),
		].join("\n"));
	}

	return sections.join("\n\n---\n\n");
}

function buildShipPrompt(command: ShipCommandName, args: string, cwd: string, collectedContext = "", delegationMode: "main" | "subagent" = "main"): string {
	const skill = readSkill(command);
	const isSubagent = delegationMode === "subagent";
	return [
		isSubagent ? "# pilee delegated ship skill for subagent" : "# pilee ship command shim",
		"",
		`You are executing \`/${command}${args.trim() ? ` ${args.trim()}` : ""}\` through pilee's ${isSubagent ? "subagent skill delegation" : "extension command shim"}.`,
		"",
		"Hard routing rules:",
		`- Use the inlined pilee \`${command}\` SKILL.md below as the authoritative workflow for this invocation.`,
		"- Do not ask the user to re-invoke `/skill:*`; continue now using the inlined instructions.",
		"- Do not treat this prompt as a literal slash command; slash commands are not executed inside subagent prompt text.",
		"- Preserve commands, file paths, URLs, and raw logs exactly; user-facing prose should be Korean.",
		...(isSubagent
			? [
				"- You are a subagent branch. Work independently, report concise progress/final result back to the parent, and avoid asking the parent to do mechanical steps you can do yourself.",
				"- Respect the target skill's write boundaries. If the skill permits commit/push for this workflow, you may perform it; never merge, force-push, resolve review threads, or run external side effects beyond the skill contract.",
			]
			: []),
		"",
		`Current cwd: ${cwd}`,
		"",
		"Original command arguments:",
		"----- BEGIN ORIGINAL ARGUMENTS -----",
		args.trim() || "(none)",
		"----- END ORIGINAL ARGUMENTS -----",
		...(collectedContext ? ["", "## Read-only collected context", collectedContext] : []),
		"",
		"## Inlined target skill",
		formatInlinedSkill(skill),
		"",
		"Now execute the target skill for the original command.",
	].join("\n");
}

export async function buildShipCommandPromptForSubagent(pi: ExtensionAPI, ctx: ShipContext, command: ShipCommandName, args: string): Promise<string> {
	if (command === "ship") return buildShipPrompt(command, args, ctx.cwd, "", "subagent");
	if (command === "pr-ship") {
		const collectedContext = await buildPrShipCollectedContext(pi, ctx, args);
		return buildShipPrompt(command, args, ctx.cwd, collectedContext, "subagent");
	}
	const collectedContext = await buildCiShipCollectedContext(pi, ctx, args);
	return buildShipPrompt(command, args, ctx.cwd, collectedContext, "subagent");
}

export async function buildParallelAnalysisPromptForSubagent(
	pi: ExtensionAPI,
	ctx: ShipContext,
	command: ParallelAnalysisCommandName,
	args: string,
	request?: ParallelWorkflowAnalysisRequest,
): Promise<string> {
	const collectedContext = command === "ci-ship"
		? await buildCiShipCollectedContext(pi, ctx, args)
		: command === "pr-ship"
			? await buildPrShipCollectedContext(pi, ctx, args)
			: await buildGenericWorkflowCollectedContext(pi, ctx);
	const skillNames = command === "self-healing"
		? ["tft-guidelines", "ask-user-question-rules", "stress-interview", "self-healing"]
		: [command];
	const inlinedSkills = skillNames.map((skillName) => formatInlinedSkill(readSkill(skillName))).join("\n\n");
	return [
		"# pilee parallel workflow analysis",
		"",
		`You are analyzing \`/${command}${args.trim() ? ` ${args.trim()}` : ""}\` while the main session may already have an active writer turn.`,
		"",
		formatParallelAnalysisMode(command, request),
		"",
		"## Read-only collected context",
		collectedContext,
		"",
		"## Inlined workflow skill reference",
		inlinedSkills,
		"",
		formatParallelAnalysisFinalContract(),
		"",
		"Now perform only the read-only analysis/review part of this workflow and return the Writer Queue Proposal. Do not proceed to any write phase.",
	].join("\n");
}

function emitParallelAnalysisRequest(
	pi: ExtensionAPI,
	ctx: ShipContext,
	command: ParallelAnalysisCommandName,
	args: string,
	source: ParallelAnalysisSource,
): void {
	const request = buildParallelAnalysisRequest(ctx, command, args, source);
	pi.events.emit(PARALLEL_WORKFLOW_ANALYSIS_EVENT, request);
	notify(
		ctx,
		`/${command} 병렬 분석을 subagent queue로 보냈습니다. 실제 수정/커밋/push는 현재 writer 완료 후 최신 HEAD 기준으로 처리하세요.`,
		"info",
	);
}

function sendPrompt(pi: ExtensionAPI, ctx: ShipContext, command: ShipCommandName, args: string, prompt: string): void {
	pi.sendMessage(
		{
			customType: SHIM_CUSTOM_TYPE,
			content: prompt,
			display: false,
			details: { command, args, skillPath: skillPath(command) },
		},
		{ deliverAs: "followUp", triggerTurn: true },
	);
	notify(ctx, `pilee /${command}: SKILL.md를 인라인해 실행합니다.`, "info");
}

export default function shipCommands(pi: ExtensionAPI) {
	let prShipWriteGuardActive = false;
	registerPrShipReviewWriteTool(pi);

	pi.on("before_agent_start", (event) => {
		if (/executing `\/pr-ship(?:\s|`)|# pr-ship —/u.test(event.prompt)) {
			prShipWriteGuardActive = true;
		}
	});
	pi.on("tool_call", (event) => {
		if (!prShipWriteGuardActive || event.toolName !== "bash") return;
		const input = event.input as { command?: unknown };
		if (typeof input.command !== "string" || !isDirectPrShipReviewWriteCommand(input.command)) return;
		return {
			block: true,
			reason: "Blocked raw GitHub review write during /pr-ship. Use pr_ship_review_write; it re-checks the exact allowlisted reviewer login and rejects humans/unknown actors.",
		};
	});
	pi.on("agent_settled", () => {
		prShipWriteGuardActive = false;
	});
	pi.on("session_shutdown", () => {
		prShipWriteGuardActive = false;
	});

	pi.registerCommand("ship", {
		description: "pilee /ship — PR 전 변경사항을 의도 단위 커밋·검증·push",
		handler: async (args, ctx) => {
			try {
				sendPrompt(pi, ctx, "ship", args, buildShipPrompt("ship", args, ctx.cwd));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notify(ctx, `/ship 실행 준비 실패: ${message}`, "error");
			}
		},
	});

	pi.registerCommand("pr-ship", {
		description: "pilee /pr-ship — allowlisted 자동 리뷰만 대응·답글/re-request, 인간 리뷰는 로컬 분석 전용 (--push-only 지원)",
		handler: async (args, ctx) => {
			try {
				if (!ctx.isIdle()) {
					emitParallelAnalysisRequest(pi, ctx, "pr-ship", args, "command");
					return;
				}
				const collectedContext = await buildPrShipCollectedContext(pi, ctx, args);
				prShipWriteGuardActive = true;
				sendPrompt(pi, ctx, "pr-ship", args, buildShipPrompt("pr-ship", args, ctx.cwd, collectedContext));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notify(ctx, `/pr-ship 실행 준비 실패: ${message}`, "error");
			}
		},
	});

	pi.registerCommand("ci-ship", {
		description: "pilee /ci-ship — PR CI 실패 check/log를 분석하고 근본 대응·검증·커밋·push 진행",
		handler: async (args, ctx) => {
			try {
				if (!ctx.isIdle()) {
					emitParallelAnalysisRequest(pi, ctx, "ci-ship", args, "command");
					return;
				}
				const collectedContext = await buildCiShipCollectedContext(pi, ctx, args);
				sendPrompt(pi, ctx, "ci-ship", args, buildShipPrompt("ci-ship", args, ctx.cwd, collectedContext));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notify(ctx, `/ci-ship 실행 준비 실패: ${message}`, "error");
			}
		},
	});
}
