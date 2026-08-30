import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { captureUnifiedDiff } from "./evidence.ts";
import { enrichReviewSourceDeclarations } from "./declarations.ts";
import { createPrReviewRun, type PrReviewRunState, type PrReviewTarget } from "./run.ts";

export interface ParsedPrUrl {
	url: string;
	owner: string;
	repo: string;
	number: number;
}

export interface GhPrMetadata {
	number: number;
	title: string;
	url: string;
	body?: string;
	author?: { login?: string };
	baseRefName?: string;
	baseRefOid?: string;
	headRefName?: string;
	headRefOid?: string;
	state?: string;
	isDraft?: boolean;
	mergeable?: string;
}

export function parseGitHubPrUrl(value: string): ParsedPrUrl {
	let parsed: URL;
	try { parsed = new URL(value.trim()); } catch { throw new Error("GitHub PR URL 형식이 아닙니다."); }
	if (parsed.protocol !== "https:" || parsed.hostname.toLowerCase() !== "github.com") throw new Error("https://github.com PR URL만 지원합니다.");
	const parts = parsed.pathname.split("/").filter(Boolean);
	if (parts.length < 4 || parts[2] !== "pull" || !/^\d+$/.test(parts[3]!)) throw new Error("GitHub PR URL은 /owner/repo/pull/123 형식이어야 합니다.");
	const owner = decodeURIComponent(parts[0]!);
	const repo = decodeURIComponent(parts[1]!).replace(/\.git$/, "");
	const number = Number(parts[3]);
	return { url: `https://github.com/${owner}/${repo}/pull/${number}`, owner, repo, number };
}

async function requireExec(pi: ExtensionAPI, command: string, args: string[], cwd: string, timeout: number): Promise<string> {
	const result = await pi.exec(command, args, { cwd, timeout });
	if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed\n${(result.stderr || result.stdout).trim()}`);
	return result.stdout;
}

export async function fetchGitHubPrTarget(pi: ExtensionAPI, cwd: string, input: ParsedPrUrl): Promise<{ target: PrReviewTarget; metadata: GhPrMetadata }> {
	const repoRef = `${input.owner}/${input.repo}`;
	const fields = "number,title,url,body,author,baseRefName,baseRefOid,headRefName,headRefOid,state,isDraft,mergeable";
	const metadataText = await requireExec(pi, "gh", ["pr", "view", String(input.number), "--repo", repoRef, "--json", fields], cwd, 30_000);
	let metadata: GhPrMetadata;
	try { metadata = JSON.parse(metadataText) as GhPrMetadata; } catch { throw new Error("gh pr view 응답을 JSON으로 읽지 못했습니다."); }
	return {
		target: {
			kind: "github-pr",
			url: metadata.url || input.url,
			owner: input.owner,
			repo: input.repo,
			number: metadata.number || input.number,
			title: metadata.title,
			author: metadata.author?.login,
			body: metadata.body,
			baseSha: metadata.baseRefOid,
			headSha: metadata.headRefOid,
			baseRefName: metadata.baseRefName,
			headRefName: metadata.headRefName,
		},
		metadata,
	};
}

function githubContentsEndpoint(repoRef: string, path: string): string {
	return `repos/${repoRef}/contents/${path.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export async function captureGitHubPrRun(
	pi: ExtensionAPI,
	cwd: string,
	input: ParsedPrUrl,
	stateRoot: string,
	now = Date.now(),
): Promise<PrReviewRunState> {
	const repoRef = `${input.owner}/${input.repo}`;
	const { target, metadata } = await fetchGitHubPrTarget(pi, cwd, input);
	const diff = await requireExec(pi, "gh", ["pr", "diff", String(input.number), "--repo", repoRef, "--color", "never"], cwd, 120_000);
	let bundle = captureUnifiedDiff(diff, {
		kind: "github-pr",
		repository: repoRef,
		state: metadata.state,
		isDraft: metadata.isDraft,
		mergeable: metadata.mergeable,
		baseSha: metadata.baseRefOid,
		headSha: metadata.headRefOid,
	});
	bundle = await enrichReviewSourceDeclarations(bundle, async ({ side, path }) => {
		const ref = side === "before" ? metadata.baseRefOid : metadata.headRefOid;
		if (!ref) return undefined;
		return requireExec(pi, "gh", [
			"api",
			githubContentsEndpoint(repoRef, path),
			"--method",
			"GET",
			"-f",
			`ref=${ref}`,
			"-H",
			"Accept: application/vnd.github.raw+json",
		], cwd, 30_000);
	});
	return createPrReviewRun(stateRoot, target, bundle, diff, now);
}
