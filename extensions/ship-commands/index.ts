import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
	fetchCurrentPullRequestInfo,
	fetchUnresolvedPullRequestReviewComments,
	formatUnresolvedReviewCommentsForEditor,
	parseGitHubPullUrl,
	type PullRequestInfo,
} from "../utils/github-pr-review-comments.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILLS_DIR = join(PACKAGE_ROOT, "skills");
const SHIM_CUSTOM_TYPE = "pilee-ship-command-shim";
const MAX_COLLECTED_CONTEXT_CHARS = 18_000;

type ShipCommandName = "ship" | "pr-ship";

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

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

function truncateText(text: string, maxChars = MAX_COLLECTED_CONTEXT_CHARS): string {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[truncated: ${text.length - maxChars} chars omitted; run gh commands again if more context is needed]`;
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

function parseBareNumber(args: string): number | null {
	const trimmed = args.trim();
	const match = trimmed.match(/^#?(\d+)$/u);
	return match ? Number(match[1]) : null;
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

async function resolvePullRequestFromArgs(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<PullRequestInfo | null> {
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

function formatSessionRefs(ctx: ExtensionCommandContext): string {
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

function formatCommentDetail(target: CommentTarget, detail: ReviewCommentDetail | null): string {
	if (!detail) {
		return [
			"## Specific review comment",
			"",
			`- URL: ${target.url}`,
			`- comment id: ${target.commentId}`,
			"- detail fetch: failed; fetch it again with `gh api repos/<owner>/<repo>/pulls/comments/<comment_id>` before responding.",
		].join("\n");
	}
	const lines = [
		"## Specific review comment",
		"",
		`- URL: ${detail.htmlUrl ?? target.url}`,
		`- comment id: ${detail.id ?? target.commentId}`,
		`- author: ${detail.author ?? "unknown"}`,
		`- file: ${detail.path ?? "unknown"}${detail.line ?? detail.originalLine ? `:${detail.line ?? detail.originalLine}` : ""}`,
		`- commit: ${detail.commitId ?? "unknown"}`,
	];
	if (detail.inReplyToId) lines.push(`- reply-to comment id: ${detail.inReplyToId}`);
	lines.push("", "### Body", fence(detail.body || "(empty)", "markdown"));
	if (detail.diffHunk) lines.push("", "### Diff hunk", fence(detail.diffHunk, "diff"));
	return lines.join("\n");
}

async function buildPrShipCollectedContext(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: string): Promise<string> {
	const commentTarget = parseCommentUrl(args.trim());
	const pullRequest = await resolvePullRequestFromArgs(pi, ctx, args);
	const sections: string[] = [formatSessionRefs(ctx)];

	if (!pullRequest) {
		sections.push(
			[
				"## PR context",
				"",
				"PR을 자동 식별하지 못했습니다. `gh pr view` 또는 사용자가 준 PR/comment URL로 다시 확인하세요.",
			].join("\n"),
		);
		return sections.join("\n\n---\n\n");
	}

	sections.push([
		"## PR context",
		"",
		`- PR: #${pullRequest.number}`,
		`- URL: ${pullRequest.url}`,
		`- repo: ${pullRequest.owner}/${pullRequest.repo}`,
		pullRequest.title ? `- title: ${pullRequest.title}` : "- title: (not fetched)",
	].join("\n"));

	if (commentTarget) {
		sections.push(formatCommentDetail(commentTarget, await fetchReviewCommentDetail(pi, ctx.cwd, commentTarget)));
	}

	const summary = await fetchUnresolvedPullRequestReviewComments(pi, ctx.cwd, pullRequest);
	if (summary) {
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
			"조회 실패. `gh api graphql`로 reviewThreads를 다시 확인하세요.",
		].join("\n"));
	}

	return sections.join("\n\n---\n\n");
}

function buildShipPrompt(command: ShipCommandName, args: string, cwd: string, collectedContext = ""): string {
	const skill = readSkill(command);
	return [
		"# pilee ship command shim",
		"",
		`You are executing \`/${command}${args.trim() ? ` ${args.trim()}` : ""}\` through pilee's extension command shim.`,
		"",
		"Hard routing rules:",
		`- Use the inlined pilee \`${command}\` SKILL.md below as the authoritative workflow for this invocation.`,
		"- Do not ask the user to re-invoke `/skill:*`; continue now using the inlined instructions.",
		"- Preserve commands, file paths, URLs, and raw logs exactly; user-facing prose should be Korean.",
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

function sendPrompt(pi: ExtensionAPI, ctx: ExtensionCommandContext, command: ShipCommandName, args: string, prompt: string): void {
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
		description: "pilee /pr-ship — PR 리뷰 코멘트를 근본 대응하고 커밋·push·스레드 답글까지 진행",
		handler: async (args, ctx) => {
			try {
				const collectedContext = await buildPrShipCollectedContext(pi, ctx, args);
				sendPrompt(pi, ctx, "pr-ship", args, buildShipPrompt("pr-ship", args, ctx.cwd, collectedContext));
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				notify(ctx, `/pr-ship 실행 준비 실패: ${message}`, "error");
			}
		},
	});
}
