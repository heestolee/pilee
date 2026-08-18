import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@mariozechner/pi-ai";
import { DEFAULT_MAX_BYTES, truncateHead, type ExtensionAPI, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { expandProfileTemplate, loadPrReviewProfiles, type PrReviewCorpusProfile } from "../utils/private-profiles.ts";
import { runPrReviewWorktreeFromCommandContext } from "../worktree/pr-review.ts";
import { searchPrReviewCorpus } from "./corpus.ts";
import { captureUnifiedDiff, renderInspectionChunk, type ReviewSourceBundle } from "./evidence.ts";
import { closePrReviewStudios, openPrReviewStudio } from "./studio.ts";
import {
	createPrReviewRun,
	loadInspection,
	loadPrReviewRun,
	markChunkInspected,
	readJson,
	runLabel,
	saveReviewCards,
	type PrReviewRunState,
	type PrReviewTarget,
	type ReviewCardInput,
} from "./run.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILL_PATH = join(PACKAGE_ROOT, "skills", "human-pr-review", "SKILL.md");
const SHIM_CUSTOM_TYPE = "pilee-pr-review-command";
const DEFAULT_STATE_ROOT = join(homedir(), ".pi", "agent", "state", "pr-review");

const HELP = `PR Review — human-centered read-only review harness

Usage:
  /pr-review <GitHub PR URL>
  /pr-review help

Output:
  exact diff code + review draft + explanation + LLM recurrence-prevention meta perspective

Safety:
  read-only · no checkout · no code changes · no GitHub review posting`;

export interface ParsedPrUrl {
	url: string;
	owner: string;
	repo: string;
	number: number;
}

interface GhPrMetadata {
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

interface RegisterOptions {
	stateRoot?: string;
	now?: () => number;
	corpora?: PrReviewCorpusProfile[];
	openStudio?: boolean;
	switchToReviewWorkspace?: boolean;
	reviewWorkspaceRunner?: typeof runPrReviewWorktreeFromCommandContext;
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

export async function captureGitHubPrRun(
	pi: ExtensionAPI,
	cwd: string,
	input: ParsedPrUrl,
	stateRoot: string,
	now = Date.now(),
): Promise<PrReviewRunState> {
	const repoRef = `${input.owner}/${input.repo}`;
	const fields = "number,title,url,body,author,baseRefName,baseRefOid,headRefName,headRefOid,state,isDraft,mergeable";
	const metadataText = await requireExec(pi, "gh", ["pr", "view", String(input.number), "--repo", repoRef, "--json", fields], cwd, 30_000);
	const diff = await requireExec(pi, "gh", ["pr", "diff", String(input.number), "--repo", repoRef, "--color", "never"], cwd, 120_000);
	let metadata: GhPrMetadata;
	try { metadata = JSON.parse(metadataText) as GhPrMetadata; } catch { throw new Error("gh pr view 응답을 JSON으로 읽지 못했습니다."); }
	const target: PrReviewTarget = {
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
	};
	const bundle = captureUnifiedDiff(diff, {
		kind: "github-pr",
		repository: repoRef,
		state: metadata.state,
		isDraft: metadata.isDraft,
		mergeable: metadata.mergeable,
		baseSha: metadata.baseRefOid,
		headSha: metadata.headRefOid,
	});
	return createPrReviewRun(stateRoot, target, bundle, diff, now);
}

function inlinedSkill(): string {
	const content = readFileSync(SKILL_PATH, "utf8").trimEnd();
	return [
		"----- BEGIN INLINED PILEE SKILL: human-pr-review -----",
		`Location: ${SKILL_PATH}`,
		`References are relative to: ${dirname(SKILL_PATH)}`,
		"",
		content,
		"----- END INLINED PILEE SKILL: human-pr-review -----",
	].join("\n");
}

export function buildPrReviewPrompt(state: PrReviewRunState): string {
	return [
		"# pilee /pr-review command",
		"",
		`Review target: ${state.target.url}`,
		`Run id: ${state.runId}`,
		`Run directory: ${state.runDir}`,
		`Head SHA: ${state.target.headSha ?? "unknown"}`,
		"",
		"Execution rules:",
		"- Follow the inlined human-pr-review skill as the authoritative workflow.",
		"- Start with pr_review_run action=status, then inspect every pending chunk.",
		"- Do not use historical review corpus before producing blind findings. After blind findings exist, use pr_review_run action=search per candidate when a corpus is configured.",
		"- Do not modify the target repository or post GitHub comments.",
		"- Submit final cards through pr_review_run action=submit. Empty cards are valid.",
		"- After submit, read the generated review.md and report its path and coverage to the user.",
		"",
		"## Target PR body",
		state.target.body?.trim() || "(PR body 없음)",
		"",
		"## Inlined skill",
		inlinedSkill(),
	].join("\n");
}

function assertRunId(runId: string): void {
	if (!/^[a-zA-Z0-9._-]+$/.test(runId)) throw new Error("invalid runId");
}

function runFromId(stateRoot: string, runId: string): PrReviewRunState {
	assertRunId(runId);
	return loadPrReviewRun(join(stateRoot, "runs", runId));
}

function configuredCorpora(cwd: string, repository: string): PrReviewCorpusProfile[] {
	const normalized = repository.toLowerCase();
	return loadPrReviewProfiles(cwd)
		.flatMap((profile) => profile.corpora ?? [])
		.filter((corpus) => !corpus.repositories?.length || corpus.repositories.map((value) => value.toLowerCase()).includes(normalized))
		.map((corpus) => ({ ...corpus, corpusDir: expandProfileTemplate(corpus.corpusDir) }));
}

function statusText(state: PrReviewRunState, source: ReviewSourceBundle, corpora: PrReviewCorpusProfile[] = []): string {
	const inspection = loadInspection(state);
	const pending = source.chunks.filter((chunk) => !inspection.inspectedChunkIds.includes(chunk.id));
	return [
		`PR review run: ${runLabel(state)}`,
		`target: ${state.target.url}`,
		`head: ${state.target.headSha ?? "unknown"}`,
		`source: ${source.stats.files} files, +${source.stats.additions}/-${source.stats.deletions}, ${source.stats.chunks} chunks`,
		`inspection: ${inspection.inspectedChunkIds.length}/${source.chunks.length}`,
		`pending chunks: ${pending.map((chunk) => chunk.id).join(", ") || "none"}`,
		`human review corpus: ${corpora.map((corpus) => corpus.id).join(", ") || "not configured"}`,
		"files:",
		...source.files.map((file) => `- ${file.id} ${file.status} +${file.additions}/-${file.deletions} ${file.path}`),
	].join("\n");
}

export function registerPrReview(pi: ExtensionAPI, options: RegisterOptions = {}): void {
	const stateRoot = options.stateRoot ?? DEFAULT_STATE_ROOT;
	const now = options.now ?? (() => Date.now());
	let latestRunId: string | undefined;

	pi.registerTool({
		name: "pr_review_run",
		label: "PR Review Run",
		description: "Inspect an immutable PR diff run, search configured human-review precedents after blind findings, submit evidence-anchored review cards, and reopen Review Studio. Actions: status, inspect, search, submit, open.",
		promptSnippet: "Inspect /pr-review source chunks and submit exact-evidence review cards",
		promptGuidelines: [
			"Use pr_review_run only after /pr-review starts a run; inspect every chunk before submit and never invent code outside D evidence anchors.",
		],
		parameters: Type.Object({
			action: StringEnum(["status", "inspect", "search", "submit", "open"] as const),
			runId: Type.Optional(Type.String()),
			chunkId: Type.Optional(Type.String()),
			query: Type.Optional(Type.String()),
			paths: Type.Optional(Type.Array(Type.String())),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
			cards: Type.Optional(Type.Array(Type.Any())),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) throw new Error("PR review run cancelled");
			const runId = params.runId ?? latestRunId;
			if (!runId) throw new Error("active PR review run이 없습니다. /pr-review <URL>로 시작하세요.");
			const state = runFromId(stateRoot, runId);
			const source = readJson<ReviewSourceBundle>(state.sourcePath);
			const repository = `${state.target.owner}/${state.target.repo}`;
			const corpora = (options.corpora ?? configuredCorpora(state.runDir, repository))
				.filter((corpus) => !corpus.repositories?.length || corpus.repositories.map((value) => value.toLowerCase()).includes(repository.toLowerCase()))
				.map((corpus) => ({ ...corpus, corpusDir: expandProfileTemplate(corpus.corpusDir) }));
			if (params.action === "status") {
				return { content: [{ type: "text", text: statusText(state, source, corpora) }], details: { state, stats: source.stats, inspection: loadInspection(state), corpora } };
			}
			if (params.action === "open") {
				const studio = await openPrReviewStudio(pi, ctx, state);
				return { content: [{ type: "text", text: `PR Review Studio ${studio.mode}: ${studio.url}` }], details: { runId, ...studio } };
			}
			if (params.action === "inspect") {
				if (!params.chunkId) throw new Error("inspect에는 chunkId가 필요합니다.");
				const text = renderInspectionChunk(source, params.chunkId);
				const truncated = truncateHead(text, { maxBytes: DEFAULT_MAX_BYTES, maxLines: 2_000 });
				if (truncated.truncated) throw new Error(`chunk ${params.chunkId}가 tool output 한도를 넘었습니다. 더 작은 chunk로 다시 캡처해야 합니다.`);
				markChunkInspected(state, params.chunkId);
				return { content: [{ type: "text", text }], details: { runId, chunkId: params.chunkId, inspection: loadInspection(state) } };
			}
			const inspection = loadInspection(state);
			if (params.action === "search") {
				const pending = source.chunks.filter((chunk) => !inspection.inspectedChunkIds.includes(chunk.id));
				if (pending.length) throw new Error(`human review corpus는 blind source inspection 뒤에만 검색할 수 있습니다: ${pending.map((chunk) => chunk.id).join(", ")}`);
				if (!params.query?.trim()) throw new Error("search에는 blind finding에서 만든 query가 필요합니다.");
				const corpus = corpora[0];
				if (!corpus) {
					return { content: [{ type: "text", text: `Human review corpus not configured for ${repository}. Continue with blind review.` }], details: { runId, repository, configured: false } };
				}
				const result = searchPrReviewCorpus(
					{ id: corpus.id, corpusDir: corpus.corpusDir, repositories: corpus.repositories },
					{ repository, query: params.query, paths: params.paths, limit: params.limit },
				);
				return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], details: { runId, configured: true, result } };
			}

			const pending = source.chunks.filter((chunk) => !inspection.inspectedChunkIds.includes(chunk.id));
			if (pending.length) throw new Error(`submit 전에 모든 chunk를 inspect해야 합니다: ${pending.map((chunk) => chunk.id).join(", ")}`);
			onUpdate?.({ content: [{ type: "text", text: "ReviewCard 근거를 검증하고 artifact를 만드는 중..." }] });
			const cards = saveReviewCards(state, (params.cards ?? []) as ReviewCardInput[]);
			return {
				content: [{ type: "text", text: `PR review cards saved: ${cards.length}\n${state.reportPath}` }],
				details: { runId, cardCount: cards.length, reportPath: state.reportPath, cardsPath: state.cardsPath, coverage: { inspectedChunks: inspection.inspectedChunkIds.length, totalChunks: source.chunks.length } },
				terminate: true,
			};
		},
	});

	pi.on("session_shutdown", () => closePrReviewStudios());

	pi.registerCommand("pr-review", {
		description: "GitHub PR을 코드·리뷰 초안·설명·LLM 재발 방지 메타 관점 카드로 읽기 전용 검토",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			if (!trimmed || trimmed === "help" || trimmed === "--help" || trimmed === "-h") {
				ctx.ui.notify(HELP, trimmed ? "info" : "warning");
				return;
			}
			try {
				const parsed = parseGitHubPrUrl(trimmed.split(/\s+/)[0]!);
				ctx.ui.setStatus("pr-review", `PR #${parsed.number} 캡처 중`);
				const state = await captureGitHubPrRun(pi, ctx.cwd ?? process.cwd(), parsed, stateRoot, now());
				latestRunId = state.runId;
				if (options.switchToReviewWorkspace !== false && ctx.hasUI) {
					if (!state.target.baseSha || !state.target.headSha || !state.target.baseRefName) throw new Error("PR worktree에는 base/head SHA와 base branch가 필요합니다.");
					ctx.ui.setStatus("pr-review", "PR review worktree 준비 중");
					const workspacePrompt = [
						"# PR review workspace ready",
						"",
						"이 세션은 해당 PR head에 checkout된 read-only review workspace다.",
						"1. `.pi/pr-review.json`과 `git rev-parse HEAD`를 대조한다.",
						`2. \`pr_review_run\` action=\"open\", runId=\"${state.runId}\"로 Guided Review Studio를 연다.`,
						"3. run이 ready면 기존 ReviewCard를 유지하고 사용자 질문을 기다린다. 아직 reviewing이면 아래 human-pr-review workflow를 끝낸다.",
						"4. 사용자가 Glimpse에서 질문하면 이 worktree의 실제 source·callsite·test를 조사해 답한다. 사용자 요청 없이는 repository를 수정하지 않는다.",
						"5. `/diff`는 `.pi/pr-review.json`의 base/head를 사용해야 한다.",
						"",
						buildPrReviewPrompt(state),
					].join("\n");
					const switched = await (options.reviewWorkspaceRunner ?? runPrReviewWorktreeFromCommandContext)(pi, ctx, {
						repo: state.target.repo,
						runId: state.runId,
						runDir: state.runDir,
						prUrl: state.target.url,
						repository: `${state.target.owner}/${state.target.repo}`,
						number: state.target.number,
						title: state.target.title,
						baseRefName: state.target.baseRefName,
						baseSha: state.target.baseSha,
						headRefName: state.target.headRefName,
						headSha: state.target.headSha,
						afterSwitchFollowUp: {
							customType: "pilee-pr-review-workspace-ready",
							content: workspacePrompt,
							display: true,
							details: { runId: state.runId, runDir: state.runDir, target: state.target },
						},
					});
					ctx.ui.setStatus("pr-review", undefined);
					if (switched.status !== "switched") throw new Error(switched.reason);
					return;
				}

				let studioMode = "disabled";
				if (options.openStudio !== false && ctx.hasUI) studioMode = (await openPrReviewStudio(pi, ctx, state)).mode;
				ctx.ui.setStatus("pr-review", undefined);
				ctx.ui.notify(`🔎 PR Review 시작 · ${state.target.owner}/${state.target.repo}#${state.target.number} · Studio ${studioMode}`, "info");
				pi.sendMessage(
					{
						customType: SHIM_CUSTOM_TYPE,
						content: buildPrReviewPrompt(state),
						display: false,
						details: { command: "pr-review", runId: state.runId, runDir: state.runDir, target: state.target, skillPath: SKILL_PATH },
					},
					{ deliverAs: "followUp", triggerTurn: true },
				);
			} catch (error) {
				ctx.ui.setStatus("pr-review", undefined);
				ctx.ui.notify(`pilee /pr-review failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}

export default function (pi: ExtensionAPI): void {
	registerPrReview(pi);
}
