import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { loadPrShipProfiles, type PrShipProfile } from "../utils/private-profiles.ts";
import {
	classifyPrShipReviewAuthor,
	resolvePrShipExternalWritePolicy,
} from "./pr-ship-policy.ts";

const writeParameters = Type.Object({
	action: StringEnum(["reply", "rerequest"] as const),
	repository: Type.String({ description: "GitHub owner/repo" }),
	pullNumber: Type.Integer({ minimum: 1 }),
	commentId: Type.Optional(Type.Integer({ minimum: 1 })),
	body: Type.Optional(Type.String()),
	reviewer: Type.Optional(Type.String()),
});

interface ReviewCommentSnapshot {
	author: string | null;
	pullNumber: number | null;
}

function parseRepository(repository: string): { owner: string; repo: string; fullName: string } {
	const match = repository.trim().match(/^([^/\s]+)\/([^/\s]+)$/u);
	if (!match) throw new Error(`Invalid repository: ${repository}`);
	return { owner: match[1], repo: match[2], fullName: `${match[1]}/${match[2]}` };
}

function parseJson(stdout: string | undefined, label: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(stdout ?? "") as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
		return parsed as Record<string, unknown>;
	} catch (error) {
		throw new Error(`${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function readCommentSnapshot(value: Record<string, unknown>): ReviewCommentSnapshot {
	const user = value.user && typeof value.user === "object" && !Array.isArray(value.user)
		? value.user as Record<string, unknown>
		: null;
	const author = typeof user?.login === "string" && user.login.trim() ? user.login.trim() : null;
	const pullRequestUrl = typeof value.pull_request_url === "string" ? value.pull_request_url : "";
	const numberMatch = pullRequestUrl.match(/\/pulls\/(\d+)$/u);
	return { author, pullNumber: numberMatch ? Number(numberMatch[1]) : null };
}

function requireAllowedAuthor(repository: string, author: string | null, profiles: PrShipProfile[]): void {
	const policy = resolvePrShipExternalWritePolicy(repository, profiles);
	if (classifyPrShipReviewAuthor(author, policy) === "external-write-eligible") return;
	throw new Error(
		`Blocked pr-ship external write: ${author ?? "unknown"} is not an allowlisted reviewer for ${repository}. `
		+ "Protected human/unknown reviews are local-analysis-only.",
	);
}

function isWriteMethod(command: string): boolean {
	return /(?:--method|-X)\s*(?:=\s*)?(?:POST|PUT|PATCH|DELETE)\b/iu.test(command);
}

export function isDirectPrShipReviewWriteCommand(command: string): boolean {
	const normalized = command.replace(/\\\r?\n/gu, " ").replace(/\s+/gu, " ").trim();
	if (/\bgh\s+pr\s+(?:review|comment)\b/iu.test(normalized)) return true;
	if (/\bgh\s+pr\s+edit\b[^\n]*(?:--add-reviewer|--remove-reviewer)/iu.test(normalized)) return true;
	if (/\bgh\s+issue\s+comment\b/iu.test(normalized)) return true;
	if (!/\bgh\s+api\b/iu.test(normalized)) return false;

	if (/\bgraphql\b/iu.test(normalized)) {
		return /\bmutation\b|resolveReviewThread|unresolveReviewThread|requestReviews|addPullRequestReview/iu.test(normalized);
	}

	return isWriteMethod(normalized) || /(?:^|\s)(?:-f|-F|--field|--raw-field)(?:\s|=)/u.test(normalized);
}

export function registerPrShipReviewWriteTool(
	pi: ExtensionAPI,
	options: { loadProfiles?: () => PrShipProfile[] } = {},
): void {
	const loadProfiles = options.loadProfiles ?? (() => loadPrShipProfiles());
	pi.registerTool({
		name: "pr_ship_review_write",
		label: "PR Ship Review Write",
		description: "Guarded GitHub review reply/re-request for /pr-ship. Re-fetches the target actor and rejects every reviewer not explicitly allowlisted by a trusted private profile.",
		promptSnippet: "Reply to or re-request only an allowlisted automated PR reviewer during /pr-ship",
		promptGuidelines: [
			"Use pr_ship_review_write for every GitHub review reply or re-request performed by /pr-ship; never use raw gh/API writes for those actions.",
		],
		parameters: writeParameters,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const repository = parseRepository(params.repository);
			if (params.action === "reply") {
				if (!params.commentId || typeof params.body !== "string" || !params.body.trim()) {
					throw new Error("reply requires commentId and a non-empty body");
				}
				const commentResult = await pi.exec("gh", [
					"api",
					`repos/${repository.fullName}/pulls/comments/${params.commentId}`,
				], { cwd: ctx.cwd, signal });
				if (commentResult.code !== 0) {
					throw new Error(`Failed to inspect review comment ${params.commentId}: ${commentResult.stderr || commentResult.stdout}`);
				}
				const snapshot = readCommentSnapshot(parseJson(commentResult.stdout, "review comment lookup"));
				if (snapshot.pullNumber !== params.pullNumber) {
					throw new Error(`Comment ${params.commentId} belongs to PR #${snapshot.pullNumber ?? "unknown"}, not #${params.pullNumber}`);
				}
				requireAllowedAuthor(repository.fullName, snapshot.author, loadProfiles());

				const replyResult = await pi.exec("gh", [
					"api",
					`repos/${repository.fullName}/pulls/${params.pullNumber}/comments/${params.commentId}/replies`,
					"--method",
					"POST",
					"-f",
					`body=${params.body}`,
				], { cwd: ctx.cwd, signal });
				if (replyResult.code !== 0) {
					throw new Error(`Failed to post guarded review reply: ${replyResult.stderr || replyResult.stdout}`);
				}
				const posted = parseJson(replyResult.stdout, "review reply");
				if (posted.body !== params.body) throw new Error("Posted review reply body did not match the requested body");
				return {
					content: [{ type: "text", text: `Allowlisted review reply posted: ${String(posted.html_url ?? "(URL unavailable)")}` }],
					details: { action: params.action, repository: repository.fullName, pullNumber: params.pullNumber, commentId: params.commentId, author: snapshot.author, htmlUrl: posted.html_url ?? null },
				};
			}

			if (!params.reviewer?.trim()) throw new Error("rerequest requires reviewer");
			const reviewer = params.reviewer.trim();
			requireAllowedAuthor(repository.fullName, reviewer, loadProfiles());
			const requestResult = await pi.exec("gh", [
				"api",
				`repos/${repository.fullName}/pulls/${params.pullNumber}/requested_reviewers`,
				"--method",
				"POST",
				"-f",
				`reviewers[]=${reviewer}`,
			], { cwd: ctx.cwd, signal });
			if (requestResult.code !== 0) {
				throw new Error(`Failed to re-request allowlisted reviewer ${reviewer}: ${requestResult.stderr || requestResult.stdout}`);
			}
			return {
				content: [{ type: "text", text: `Review re-requested from allowlisted reviewer: ${reviewer}` }],
				details: { action: params.action, repository: repository.fullName, pullNumber: params.pullNumber, reviewer },
			};
		},
	});
}
