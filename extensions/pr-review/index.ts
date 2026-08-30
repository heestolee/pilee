import { existsSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StringEnum } from "@mariozechner/pi-ai";
import { DEFAULT_MAX_BYTES, truncateHead, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { normalizeQuestionExecution } from "../questions/runtime.ts";
import { expandProfileTemplate, loadPrReviewProfiles, type PrReviewCorpusProfile } from "../utils/private-profiles.ts";
import { runPrReviewWorktreeFromCommandContext } from "../worktree/pr-review.ts";
import { readPrReviewWorkspaceMetadata, writePrReviewWorkspaceMetadata } from "./workspace.ts";
import { startStudyHardStudio } from "../study-hard/studio.ts";
import type { MetaReviewDocumentInput, MetaReviewFileGuideInput } from "./guidance.ts";
import { captureGitHubPrRun, fetchGitHubPrTarget, parseGitHubPrUrl } from "./github-source.ts";
export { captureGitHubPrRun, fetchGitHubPrTarget, parseGitHubPrUrl } from "./github-source.ts";
import { attachMetaReviewRevision, decideMetaReviewRefresh } from "./revision.ts";
import { seedIncrementalMetaReviewRevision } from "./incremental.ts";
import {
	answerPrReviewQuestion,
	failPrReviewQuestion,
	loadPrReviewQuestions,
	publishPrReviewQuestionTranscript,
	type PrReviewQuestionEvidence,
} from "./chat.ts";
import { searchPrReviewCorpus } from "./corpus.ts";
import {
	applyPrReviewQuestionWorkerResult,
	buildPrReviewQuestionWorkerTask,
	claimPrReviewQuestionWorkerLaunch,
	failPrReviewQuestionWorker,
	launchPrReviewQuestionWorker,
	markPrReviewQuestionWorkerStarted,
	reservePrReviewQuestionWorkerLaunch,
	routePrReviewQuestion,
} from "./question-worker.ts";
import { captureUnifiedDiff, renderInspectionChunk, type ReviewSourceBundle } from "./evidence.ts";
import { closePrReviewStudios } from "./studio.ts";
import {
	createPrReviewRun,
	loadInspection,
	loadPrReviewRun,
	markChunkInspected,
	readJson,
	runLabel,
	saveMetaReviewSubmission,
	type PrReviewRunState,
	type PrReviewTarget,
	type ReviewCardInput,
} from "./run.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILL_PATH = join(PACKAGE_ROOT, "skills", "meta-review", "SKILL.md");
const SHIM_CUSTOM_TYPE = "pilee-meta-review-command";
const DEFAULT_STATE_ROOT = join(homedir(), ".pi", "agent", "state", "pr-review");
const META_REVIEW_SUBMISSION_BASENAME = "submission.json";
const MAX_META_REVIEW_SUBMISSION_BYTES = 5 * 1024 * 1024;

interface MetaReviewSubmissionArtifact {
	document?: MetaReviewDocumentInput;
	guides: MetaReviewFileGuideInput[];
	cards: ReviewCardInput[];
}

function metaReviewSubmissionPath(runDir: string): string {
	return join(runDir, META_REVIEW_SUBMISSION_BASENAME);
}

function readMetaReviewSubmissionArtifact(state: PrReviewRunState, artifactPath: string): MetaReviewSubmissionArtifact {
	const expectedPath = resolve(metaReviewSubmissionPath(state.runDir));
	const requestedPath = resolve(artifactPath);
	if (requestedPath !== expectedPath) throw new Error(`submissionPath는 현재 run의 ${META_REVIEW_SUBMISSION_BASENAME}만 허용합니다.`);
	if (!existsSync(requestedPath)) throw new Error(`Meta Review submission artifact가 없습니다: ${requestedPath}`);
	const expectedRealPath = join(realpathSync(state.runDir), META_REVIEW_SUBMISSION_BASENAME);
	if (realpathSync(requestedPath) !== expectedRealPath) throw new Error("Meta Review submission artifact symlink는 허용하지 않습니다.");
	const stats = statSync(requestedPath);
	if (!stats.isFile()) throw new Error("Meta Review submission artifact는 일반 파일이어야 합니다.");
	if (stats.size <= 0 || stats.size > MAX_META_REVIEW_SUBMISSION_BYTES) throw new Error("Meta Review submission artifact는 1 byte 이상 5MB 이하여야 합니다.");
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(requestedPath, "utf8"));
	} catch (error) {
		throw new Error(`Meta Review submission artifact는 유효한 JSON이어야 합니다: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!value || typeof value !== "object" || !Array.isArray((value as MetaReviewSubmissionArtifact).guides) || !Array.isArray((value as MetaReviewSubmissionArtifact).cards)) {
		throw new Error("Meta Review submission artifact에는 guides와 cards 배열이 필요합니다.");
	}
	return value as MetaReviewSubmissionArtifact;
}

const HELP = `Meta Review — guided diff walkthrough and human-centered review harness

Usage:
  /meta-review <GitHub PR URL>
  /meta-review help

Output:
  모든 변경 파일·diff 설명 + exact evidence review draft + LLM 재발 방지 meta perspective

Safety:
  read-only exact checkout · source panel 보존 · no code changes · no GitHub review posting`;

interface RegisterOptions {
	stateRoot?: string;
	now?: () => number;
	corpora?: PrReviewCorpusProfile[];
	openStudio?: boolean;
	switchToReviewWorkspace?: boolean;
	reviewWorkspaceRunner?: typeof runPrReviewWorktreeFromCommandContext;
	openMetaReview?: typeof openMetaReviewInStudyHard;
}

async function gitText(pi: ExtensionAPI, cwd: string, args: string[], allowDiffExit = false): Promise<string> {
	const result = await pi.exec("git", args, { cwd, timeout: 120_000 });
	if (result.code !== 0 && !(allowDiffExit && result.code === 1)) throw new Error(`git ${args.join(" ")} failed\n${(result.stderr || result.stdout).trim()}`);
	return result.stdout;
}

function remoteRepository(remote: string, fallback: string): { owner: string; repo: string; url: string } {
	const match = remote.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (!match) return { owner: "local", repo: fallback, url: `https://local.invalid/${encodeURIComponent(fallback)}` };
	return { owner: match[1]!, repo: match[2]!, url: `https://github.com/${match[1]}/${match[2]}` };
}

async function currentWorkBase(pi: ExtensionAPI, root: string, branch: string): Promise<{ baseSha?: string; baseRefName?: string }> {
	const candidates: string[] = [];
	try {
		const worktree = JSON.parse(readFileSync(join(root, ".pi", "worktree-meta.json"), "utf8")) as Record<string, unknown>;
		if (worktree.branch === branch && typeof worktree.baseBranch === "string") candidates.push(worktree.baseBranch);
	} catch {}
	if (branch.startsWith("hotfix/") || branch.startsWith("hotfeature/")) candidates.push("production");
	try {
		const result = await pi.exec("gh", ["pr", "view", branch, "--json", "baseRefName"], { cwd: root, timeout: 30_000 });
		if (result.code === 0) {
			const parsed = JSON.parse(result.stdout) as { baseRefName?: string };
			if (parsed.baseRefName) candidates.unshift(parsed.baseRefName);
		}
	} catch {}
	try {
		const originHead = await gitText(pi, root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
		if (originHead.trim()) candidates.push(originHead.trim().replace(/^origin\//, ""));
	} catch {}
	candidates.push("main", "master", "development", "develop", "production");
	for (const candidate of [...new Set(candidates.filter((value) => value && value !== branch))]) {
		for (const ref of [`origin/${candidate}`, candidate]) {
			const result = await pi.exec("git", ["merge-base", "HEAD", ref], { cwd: root, timeout: 30_000 });
			if (result.code === 0 && result.stdout.trim()) return { baseSha: result.stdout.trim(), baseRefName: candidate };
		}
	}
	return {};
}

export async function captureCurrentWorkRun(
	pi: ExtensionAPI,
	cwd: string,
	stateRoot: string,
	now = Date.now(),
): Promise<PrReviewRunState> {
	const root = (await gitText(pi, cwd, ["rev-parse", "--show-toplevel"])).trim();
	const branch = (await gitText(pi, root, ["branch", "--show-current"])).trim() || "HEAD";
	const headSha = (await gitText(pi, root, ["rev-parse", "HEAD"])).trim();
	const base = await currentWorkBase(pi, root, branch);
	let diff = await gitText(pi, root, ["diff", "--no-color", "--find-renames", base.baseSha ?? "HEAD"]);
	const untracked = (await gitText(pi, root, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
	for (const path of untracked) {
		const addition = await gitText(pi, root, ["diff", "--no-index", "--no-color", "--", "/dev/null", path], true);
		diff += `${diff && !diff.endsWith("\n") ? "\n" : ""}${addition}`;
	}
	if (!diff.trim()) throw new Error("현재 worktree에 Meta Review로 설명할 변경이 없습니다.");
	let remote = "";
	try { remote = await gitText(pi, root, ["remote", "get-url", "origin"]); } catch {}
	const repository = remoteRepository(remote, basename(root));
	const rootHash = createHash("sha256").update(root).digest("hex").slice(0, 12);
	const target: PrReviewTarget = {
		kind: "current-work",
		url: repository.url,
		owner: repository.owner,
		repo: repository.repo,
		number: 0,
		title: `${repository.repo} · ${branch} 현재 변경`,
		baseSha: base.baseSha,
		headSha,
		baseRefName: base.baseRefName,
		headRefName: branch,
		root,
		rootHash,
		branch,
	};
	const bundle = captureUnifiedDiff(diff, { kind: "current-work", root, branch, baseSha: base.baseSha, headSha, rootHash });
	return createPrReviewRun(stateRoot, target, bundle, diff, now);
}

function inlinedSkill(): string {
	const content = readFileSync(SKILL_PATH, "utf8").trimEnd();
	return [
		"----- BEGIN INLINED PILEE SKILL: meta-review -----",
		`Location: ${SKILL_PATH}`,
		`References are relative to: ${dirname(SKILL_PATH)}`,
		"",
		content,
		"----- END INLINED PILEE SKILL: meta-review -----",
	].join("\n");
}

export function buildPrReviewPrompt(state: PrReviewRunState): string {
	return [
		"# pilee /meta-review command",
		"",
		`Review target: ${state.target.url}`,
		`Run id: ${state.runId}`,
		`Run directory: ${state.runDir}`,
		`Head SHA: ${state.target.headSha ?? "unknown"}`,
		"",
		"Execution rules:",
		"- Follow the inlined meta-review skill as the authoritative workflow.",
		"- Start with meta_review_run action=status, then inspect every pending chunk.",
		"- Explain every changed file and every addition/deletion evidence before final submission.",
		"- Submit a document overview plus structured changed-file relationships and a complete reading order. Choose flowchart for static layer/data dependencies and sequence for ordered runtime calls.",
		"- Do not use historical review corpus before producing blind findings. After blind findings exist, use meta_review_run action=search per candidate when a corpus is configured.",
		"- Do not modify the target repository or post GitHub comments.",
		"- Submit complete guides and final cards through meta_review_run action=submit. Empty finding cards are valid, empty guides are not.",
		"- After submit, read the generated review.md and report its path and coverage to the user.",
		"",
		"## Target PR body",
		state.target.body?.trim() || "(PR body 없음)",
		"",
		"## Inlined skill",
		inlinedSkill(),
	].join("\n");
}

async function openMetaReviewInStudyHard(pi: ExtensionAPI, ctx: ExtensionCommandContext | ExtensionContext, state: PrReviewRunState, source: ReviewSourceBundle) {
	const studyRunId = `meta-review-${state.target.repo}-${state.target.number || state.target.rootHash || "current"}-${(state.target.headSha || source.sourceSha256).slice(0, 8)}`.replace(/[^a-zA-Z0-9가-힣._-]+/g, "-").slice(0, 96);
	const studio = await startStudyHardStudio(pi, ctx, {
		url: state.target.url,
		title: state.target.kind === "current-work" ? `Meta Review · ${state.target.title}` : `Meta Review · #${state.target.number} ${state.target.title}`,
		runId: studyRunId,
		initialPatch: {
			sourceTitle: state.target.title,
			sourceKind: "code",
			learningPhase: "trace",
			activeSurface: "review",
			metaReview: { runId: state.runId, runDir: state.runDir, source: state.target.kind === "current-work" ? "current-work" : "github-pr", linkedAt: Date.now() },
		},
	});
	return { studio, studyRunId };
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
		`Meta Review run: ${runLabel(state)}`,
		`target: ${state.target.url}`,
		`head: ${state.target.headSha ?? "unknown"}`,
		`source: ${source.stats.files} files, +${source.stats.additions}/-${source.stats.deletions}, ${source.stats.chunks} chunks`,
		`inspection: ${inspection.inspectedChunkIds.length}/${source.chunks.length}`,
		`pending chunks: ${pending.map((chunk) => chunk.id).join(", ") || "none"}`,
		`human review corpus: ${corpora.map((corpus) => corpus.id).join(", ") || "not configured"}`,
		`large submission artifact: ${metaReviewSubmissionPath(state.runDir)}`,
		"files:",
		...source.files.map((file) => `- ${file.id} ${file.status} +${file.additions}/-${file.deletions} ${file.path}`),
	].join("\n");
}

export function registerPrReview(pi: ExtensionAPI, options: RegisterOptions = {}): void {
	const stateRoot = options.stateRoot ?? DEFAULT_STATE_ROOT;
	const now = options.now ?? (() => Date.now());
	let latestRunId: string | undefined;

	pi.registerTool({
		name: "meta_review_run",
		label: "Meta Review Run",
		description: "Inspect an immutable diff run, submit complete evidence-anchored explanations and review cards, search human-review precedents after blind findings, refresh revisions, and open the Code Review surface. Actions: status, inspect, search, submit, open.",
		promptSnippet: "Inspect /meta-review source chunks and submit complete guided diff explanations plus review findings",
		promptGuidelines: [
			"Use meta_review_run only after /meta-review starts a run; inspect every chunk, explain every changed addition/deletion evidence, and never invent code outside D evidence anchors.",
			"For a large complete Meta Review snapshot, write guides/cards to the exact run-local submissionPath returned by meta_review_run status and submit by path; do not collapse semantic hunks merely to fit tool arguments.",
		],
		parameters: Type.Object({
			action: StringEnum(["status", "inspect", "search", "submit", "open", "refresh"] as const),
			runId: Type.Optional(Type.String()),
			chunkId: Type.Optional(Type.String()),
			query: Type.Optional(Type.String()),
			paths: Type.Optional(Type.Array(Type.String())),
			limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
			mode: Type.Optional(StringEnum(["auto", "full"] as const)),
			document: Type.Optional(Type.Any()),
			guides: Type.Optional(Type.Array(Type.Any())),
			cards: Type.Optional(Type.Array(Type.Any())),
			submissionPath: Type.Optional(Type.String({ description: "Large complete snapshot transport. Must equal the current run's submission.json path returned by status." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			if (signal?.aborted) throw new Error("Meta Review run cancelled");
			const runId = params.runId ?? latestRunId;
			if (!runId) throw new Error("active Meta Review run이 없습니다. /meta-review [PR URL]로 시작하세요.");
			const state = runFromId(stateRoot, runId);
			const source = readJson<ReviewSourceBundle>(state.sourcePath);
			const repository = `${state.target.owner}/${state.target.repo}`;
			const corpora = (options.corpora ?? configuredCorpora(state.runDir, repository))
				.filter((corpus) => !corpus.repositories?.length || corpus.repositories.map((value) => value.toLowerCase()).includes(repository.toLowerCase()))
				.map((corpus) => ({ ...corpus, corpusDir: expandProfileTemplate(corpus.corpusDir) }));
			if (params.action === "status") {
				return { content: [{ type: "text", text: statusText(state, source, corpora) }], details: { state, stats: source.stats, inspection: loadInspection(state), corpora, submissionPath: metaReviewSubmissionPath(state.runDir) } };
			}
			if (params.action === "open") {
				const opened = await (options.openMetaReview ?? openMetaReviewInStudyHard)(pi, ctx, state, source);
				return { content: [{ type: "text", text: `Study Hard 코드 리뷰 탭 opened: ${opened.studio.url}` }], details: { runId, studyRunId: opened.studyRunId, url: opened.studio.url, surface: "review" } };
			}
			if (params.action === "refresh") {
				const isCurrentWork = state.target.kind === "current-work";
				const parsed = isCurrentWork ? undefined : parseGitHubPrUrl(state.target.url);
				onUpdate?.({ content: [{ type: "text", text: isCurrentWork ? "현재 worktree diff를 다시 캡처하는 중..." : `PR #${parsed!.number} 최신 head와 diff를 확인하는 중...` }] });
				const captured = isCurrentWork
					? await captureCurrentWorkRun(pi, state.target.root || ctx.cwd || process.cwd(), stateRoot, now())
					: await captureGitHubPrRun(pi, ctx.cwd ?? process.cwd(), parsed!, stateRoot, now());
				let capturedSource = readJson<ReviewSourceBundle>(captured.sourcePath);
				if (params.mode !== "full" && captured.target.headSha === state.target.headSha && capturedSource.sourceSha256 === source.sourceSha256) {
					rmSync(captured.runDir, { recursive: true, force: true });
					return { content: [{ type: "text", text: "Meta Review가 이미 최신 head와 diff를 보고 있습니다." }], details: { runId: state.runId, mode: "none", reason: "same-head-and-source" }, terminate: true };
				}
				let previousIsAncestor = isCurrentWork;
				if (!isCurrentWork && state.target.headSha && captured.target.headSha) {
					await pi.exec("git", ["fetch", "origin", `+refs/pull/${parsed!.number}/head:refs/remotes/origin/pilee-review/pr-${parsed!.number}`], { cwd: ctx.cwd, timeout: 120_000 });
					const ancestry = await pi.exec("git", ["merge-base", "--is-ancestor", state.target.headSha, captured.target.headSha], { cwd: ctx.cwd, timeout: 30_000 });
					previousIsAncestor = ancestry.code === 0;
				}
				const decision = decideMetaReviewRefresh(state.target, captured.target, { forceFull: params.mode === "full", previousIsAncestor, sourceChanged: capturedSource.sourceSha256 !== source.sourceSha256 });
				if (decision.mode === "none") {
					rmSync(captured.runDir, { recursive: true, force: true });
					return { content: [{ type: "text", text: decision.reason }], details: { runId: state.runId, ...decision }, terminate: true };
				}
				const linked = attachMetaReviewRevision(captured, capturedSource.sourceSha256, decision.mode, state, now());
				const incrementalSeed = decision.mode === "incremental" ? seedIncrementalMetaReviewRevision(state, linked.run) : undefined;
				latestRunId = linked.run.runId;
				const seedSummary = incrementalSeed ? `\nunchanged files reused: ${incrementalSeed.unchangedPaths.length}\nimpacted files: ${incrementalSeed.impactedPaths.join(", ") || "none"}` : "";
				return {
					content: [{ type: "text", text: `Meta Review revision ${linked.revision.number} captured · ${decision.mode}\n${decision.reason}${seedSummary}\nrunId: ${linked.run.runId}\npending chunk만 inspect하고 impacted file guides/cards를 submit하세요.` }],
					details: { previousRunId: state.runId, runId: linked.run.runId, runDir: linked.run.runDir, series: linked.series, revision: linked.revision, mode: decision.mode, reason: decision.reason, incrementalSeed },
				};
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
			onUpdate?.({ content: [{ type: "text", text: "전체 diff 설명 coverage와 ReviewCard 근거를 검증하는 중..." }] });
			if (params.submissionPath && (params.document !== undefined || params.guides !== undefined || params.cards !== undefined)) throw new Error("submissionPath와 inline document/guides/cards는 함께 제출할 수 없습니다.");
			const artifact = params.submissionPath ? readMetaReviewSubmissionArtifact(state, params.submissionPath) : undefined;
			const submission = saveMetaReviewSubmission(
				state,
				(artifact?.guides ?? params.guides ?? []) as MetaReviewFileGuideInput[],
				(artifact?.cards ?? params.cards ?? []) as ReviewCardInput[],
				(artifact?.document ?? params.document) as MetaReviewDocumentInput | undefined,
			);
			if (params.submissionPath) rmSync(resolve(params.submissionPath), { force: true });
			return {
				content: [{ type: "text", text: `Meta Review saved: ${submission.guides.length} files explained, ${submission.cards.length} findings\n${state.reportPath}` }],
				details: { runId, guideCount: submission.guides.length, cardCount: submission.cards.length, relationshipCount: submission.document?.relationships.relations.length ?? 0, reportPath: state.reportPath, guidesPath: state.guidesPath, documentPath: state.documentPath, cardsPath: state.cardsPath, submissionTransport: artifact ? "run-artifact" : "inline", coverage: { inspectedChunks: inspection.inspectedChunkIds.length, totalChunks: source.chunks.length } },
				terminate: true,
			};
		},
	});

	pi.registerTool({
		name: "meta_review_chat",
		label: "Meta Review Chat",
		description: "Route, complete, or inspect a contextual question submitted from the Code Review surface. Answer only after inspecting the exact checked-out source workspace.",
		promptSnippet: "Route and answer Code Review surface questions from the exact source workspace",
		promptGuidelines: [
			"Route by work shape, not word/file counts: direct when current review context closes the question, worker for external research, executable verification, independent comparisons, or whole-PR re-analysis.",
			"Use meta_review_chat action=answer as the final step for a direct Code Review surface question, with source evidence and uncertainty separated. Never mutate the reviewed repository unless the user separately requests a fix.",
		],
		parameters: Type.Object({
			action: StringEnum(["status", "route", "answer", "fail", "worker_started", "apply_worker_result"] as const),
			runId: Type.String(),
			questionId: Type.Optional(Type.String()),
			executionMode: Type.Optional(StringEnum(["direct", "worker"] as const)),
			routeReason: Type.Optional(Type.String()),
			answer: Type.Optional(Type.String()),
			uncertainty: Type.Optional(Type.String()),
			error: Type.Optional(Type.String()),
			workerResultPath: Type.Optional(Type.String()),
			workerRunId: Type.Optional(Type.Integer({ minimum: 1 })),
			dispatchToken: Type.Optional(Type.String()),
			completionToken: Type.Optional(Type.String()),
			evidence: Type.Optional(Type.Array(Type.Object({
				label: Type.String(),
				path: Type.Optional(Type.String()),
				line: Type.Optional(Type.Integer({ minimum: 1 })),
				url: Type.Optional(Type.String()),
				note: Type.Optional(Type.String()),
			}))),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const state = runFromId(stateRoot, params.runId);
			if (params.action === "status") {
				const questions = loadPrReviewQuestions(state.runDir);
				return { content: [{ type: "text", text: JSON.stringify(questions, null, 2) }], details: { runId: state.runId, questions } };
			}
			if (!params.questionId) throw new Error(`${params.action}에는 questionId가 필요합니다.`);
			if (params.action === "route") {
				if (params.executionMode !== "direct" && params.executionMode !== "worker") throw new Error("route executionMode은 direct 또는 worker여야 합니다.");
				if (!params.routeReason?.trim()) throw new Error("route에는 routeReason이 필요합니다.");
				const routedAt = now();
				const routed = routePrReviewQuestion(state, params.questionId, params.executionMode, params.routeReason, routedAt);
				let workerLaunched = false;
				if (routed.mode === "worker" && routed.workerLaunchRequired) {
					const reservation = reservePrReviewQuestionWorkerLaunch(state, routed.question.id, routedAt);
					if (reservation.dispatchRequired) {
						workerLaunched = launchPrReviewQuestionWorker(pi, state, routed.question, ctx.cwd, reservation.dispatchToken, routedAt);
						if (!workerLaunched) {
							pi.sendMessage({
								customType: "pilee-meta-review-worker-request",
								display: false,
								content: `${buildPrReviewQuestionWorkerTask(state, routed.question, ctx.cwd)}\n\n## P0 fallback\n1. meta_review_chat action=\"worker_started\", runId=\"${state.runId}\", questionId=\"${routed.question.id}\", dispatchToken=\"${reservation.dispatchToken}\"를 먼저 호출하세요.\n2. 응답 details.claimed가 true일 때만 details.completionToken을 보관하고 subagent run meta-review-question-worker --isolated로 위 task를 실행한 뒤 즉시 turn을 끝내세요. false면 tool이 이 turn을 종료하며 worker를 실행할 권한이 없습니다.\n3. launch 자체가 실패하면 meta_review_chat action=\"fail\", runId=\"${state.runId}\", questionId=\"${routed.question.id}\", completionToken=\"<worker_started 응답값>\"로 기록하세요.\n4. 완료 후 meta_review_chat action=\"apply_worker_result\", runId=\"${state.runId}\", questionId=\"${routed.question.id}\", completionToken=\"<worker_started 응답값>\", workerResultPath=\"${routed.question.workerResultPath}\"를 호출하세요. apply/fail은 claim 승자의 completion capability와 coordinator lease pin만 사용합니다.`,
								details: { runId: state.runId, questionId: routed.question.id, workerResultPath: routed.question.workerResultPath, dispatchToken: reservation.dispatchToken },
							}, { deliverAs: "followUp", triggerTurn: true });
						}
					}
				}
				return {
					content: [{ type: "text", text: `Meta Review question routed ${routed.mode}: ${routed.question.id}` }],
					details: { runId: state.runId, question: routed.question, executionMode: routed.mode, routeReason: params.routeReason, workerLaunched },
					terminate: routed.mode === "worker",
				};
			}
			if (params.action === "worker_started") {
				if (!params.dispatchToken) throw new Error("worker_started에는 coordinator dispatchToken이 필요합니다.");
				const claimedAt = now();
				const claimed = claimPrReviewQuestionWorkerLaunch(state, params.questionId, params.dispatchToken, claimedAt);
				const question = claimed.claimed && claimed.completionToken
					? markPrReviewQuestionWorkerStarted(state, params.questionId, claimed.completionToken, params.workerRunId, claimedAt)
					: claimed.question;
				const text = claimed.claimed && claimed.completionToken
					? `Meta Review question worker launch claimed: ${question.id}\ncompletionToken: ${claimed.completionToken}\n이 token은 이 claim 승자의 apply_worker_result 또는 fail에만 사용하세요.`
					: `Meta Review question worker launch not claimed: ${question.id}\nworker를 실행하지 말고 이 turn을 종료하세요.`;
				return {
					content: [{ type: "text", text }],
					details: { runId: state.runId, question, claimed: claimed.claimed, ...(claimed.completionToken ? { completionToken: claimed.completionToken } : {}) },
					terminate: !claimed.claimed,
				};
			}
			if (params.action === "apply_worker_result") {
				if (!params.workerResultPath) throw new Error("apply_worker_result에는 workerResultPath가 필요합니다.");
				if (!params.completionToken) throw new Error("apply_worker_result에는 claim winner completionToken이 필요합니다.");
				const question = await applyPrReviewQuestionWorkerResult(
					pi,
					state,
					params.questionId,
					params.workerResultPath,
					ctx.cwd,
					params.completionToken,
					params.workerRunId,
				);
				return { content: [{ type: "text", text: question.answer ?? `Meta Review question ${question.status}: ${question.id}` }], details: { runId: state.runId, question }, terminate: true };
			}
			const current = loadPrReviewQuestions(state.runDir).find((question) => question.id === params.questionId);
			if (!current) throw new Error(`unknown Meta Review question: ${params.questionId}`);
			if (params.action === "fail") {
				if (normalizeQuestionExecution(current.execution)?.mode === "worker" || params.completionToken) {
					if (!params.completionToken) throw new Error("worker 질문 fail에는 claim winner completionToken이 필요합니다.");
					const question = failPrReviewQuestionWorker(pi, state, params.questionId, params.completionToken, params.error ?? "질문 조사에 실패했습니다.", params.workerRunId);
					return { content: [{ type: "text", text: `Meta Review question failed: ${question.id}` }], details: { runId: state.runId, question }, terminate: true };
				}
				const failed = failPrReviewQuestion(state.runDir, params.questionId, params.error ?? "질문 조사에 실패했습니다.");
				const question = failed.status === "failed" ? publishPrReviewQuestionTranscript(pi, state, failed, "failed") : failed;
				return { content: [{ type: "text", text: `Meta Review question failed: ${question.id}` }], details: { runId: state.runId, question }, terminate: true };
			}
			if (!params.answer?.trim()) throw new Error("answer에는 실제 조사 결과가 필요합니다.");
			if (normalizeQuestionExecution(current.execution)?.mode === "worker") throw new Error("worker 질문은 apply_worker_result로 완료해야 합니다.");
			const answered = answerPrReviewQuestion(
				state.runDir,
				params.questionId,
				params.answer,
				(params.evidence ?? []) as PrReviewQuestionEvidence[],
				params.uncertainty,
			);
			const question = answered.status === "answered" ? publishPrReviewQuestionTranscript(pi, state, answered, "answer") : answered;
			return { content: [{ type: "text", text: question.answer ?? "" }], details: { runId: state.runId, question }, terminate: true };
		},
	});

	pi.on("session_shutdown", () => closePrReviewStudios());

	pi.registerCommand("meta-review", {
		description: "현재 작업 또는 GitHub PR을 거의 모든 diff 설명·리뷰 초안·메타 관점으로 읽기 전용 검토",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			if (trimmed === "help" || trimmed === "--help" || trimmed === "-h") {
				ctx.ui.notify(HELP, "info");
				return;
			}
			try {
				if (!trimmed) {
					ctx.ui.setStatus("meta-review", "현재 review source 캡처 중");
					const workspace = readPrReviewWorkspaceMetadata(ctx.cwd);
					let state: PrReviewRunState;
					if (workspace?.runId && workspace.runDir) {
						state = loadPrReviewRun(workspace.runDir);
					} else if (workspace?.prUrl) {
						const captured = await captureGitHubPrRun(pi, ctx.cwd, parseGitHubPrUrl(workspace.prUrl), stateRoot, now());
						const capturedSource = readJson<ReviewSourceBundle>(captured.sourcePath);
						state = attachMetaReviewRevision(captured, capturedSource.sourceSha256, "initial", undefined, now()).run;
						writePrReviewWorkspaceMetadata(ctx.cwd, { ...workspace, runId: state.runId, runDir: state.runDir, activationIntent: "meta-review", diffAutoOpenPending: false });
					} else {
						const captured = await captureCurrentWorkRun(pi, ctx.cwd, stateRoot, now());
						const capturedSource = readJson<ReviewSourceBundle>(captured.sourcePath);
						state = attachMetaReviewRevision(captured, capturedSource.sourceSha256, "initial", undefined, now()).run;
					}
					if (!state.seriesId) {
						const currentSource = readJson<ReviewSourceBundle>(state.sourcePath);
						state = attachMetaReviewRevision(state, currentSource.sourceSha256, "initial", undefined, now()).run;
					}
					latestRunId = state.runId;
					const source = readJson<ReviewSourceBundle>(state.sourcePath);
					const opened = await (options.openMetaReview ?? openMetaReviewInStudyHard)(pi, ctx, state, source);
					ctx.ui.setStatus("meta-review", undefined);
					ctx.ui.notify(`🔎 Meta Review · ${state.target.title} · 코드 리뷰 탭`, "info");
					if (state.status !== "ready") {
						pi.sendMessage({ customType: SHIM_CUSTOM_TYPE, content: buildPrReviewPrompt(state), display: false, details: { command: "meta-review", runId: state.runId, runDir: state.runDir, studyRunId: opened.studyRunId, target: state.target, skillPath: SKILL_PATH } }, { deliverAs: "followUp", triggerTurn: true });
					}
					return;
				}
				const parsed = parseGitHubPrUrl(trimmed.split(/\s+/)[0]!);
				ctx.ui.setStatus("meta-review", `PR #${parsed.number} 캡처 중`);
				const captured = await captureGitHubPrRun(pi, ctx.cwd ?? process.cwd(), parsed, stateRoot, now());
				const capturedSource = readJson<ReviewSourceBundle>(captured.sourcePath);
				const state = attachMetaReviewRevision(captured, capturedSource.sourceSha256, "initial", undefined, now()).run;
				latestRunId = state.runId;
				if (options.switchToReviewWorkspace !== false && ctx.hasUI) {
					if (!state.target.baseSha || !state.target.headSha || !state.target.baseRefName) throw new Error("PR worktree에는 base/head SHA와 base branch가 필요합니다.");
					ctx.ui.setStatus("meta-review", "Meta Review worktree 준비 중");
					const workspacePrompt = [
						"# Meta Review workspace ready",
						"",
						"이 세션은 해당 PR head에 checkout된 read-only review workspace다.",
						"1. `.pi/review-context.json` 또는 legacy `.pi/pr-review.json`과 `git rev-parse HEAD`를 대조한다.",
						`2. \`meta_review_run\` action=\"open\", runId=\"${state.runId}\"로 Study Hard의 코드 리뷰 surface를 연다.`,
						"3. run이 ready면 기존 설명·ReviewCard를 유지하고 사용자 질문을 기다린다. 아직 reviewing이면 meta-review workflow를 끝낸다.",
						"4. 사용자가 Glimpse에서 질문하면 이 worktree의 실제 source·callsite·test를 조사해 답한다. 사용자 요청 없이는 repository를 수정하지 않는다.",
						"5. `/diff`는 review context의 base/head를 사용해야 한다.",
						"",
						buildPrReviewPrompt(state),
					].join("\n");
					const activated = await (options.reviewWorkspaceRunner ?? runPrReviewWorktreeFromCommandContext)(pi, ctx, {
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
							customType: "pilee-meta-review-workspace-ready",
							content: workspacePrompt,
							display: true,
							details: { runId: state.runId, runDir: state.runDir, target: state.target },
						},
					});
					ctx.ui.setStatus("meta-review", undefined);
					if (activated.status !== "activated") throw new Error(activated.reason);
					return;
				}

				let studioMode = "disabled";
				if (options.openStudio !== false && ctx.hasUI) {
					await (options.openMetaReview ?? openMetaReviewInStudyHard)(pi, ctx, state, readJson<ReviewSourceBundle>(state.sourcePath));
					studioMode = "study-hard";
				}
				ctx.ui.setStatus("meta-review", undefined);
				ctx.ui.notify(`🔎 Meta Review 시작 · ${state.target.owner}/${state.target.repo}#${state.target.number} · 코드 리뷰 ${studioMode}`, "info");
				pi.sendMessage(
					{
						customType: SHIM_CUSTOM_TYPE,
						content: buildPrReviewPrompt(state),
						display: false,
						details: { command: "meta-review", runId: state.runId, runDir: state.runDir, target: state.target, skillPath: SKILL_PATH },
					},
					{ deliverAs: "followUp", triggerTurn: true },
				);
			} catch (error) {
				ctx.ui.setStatus("meta-review", undefined);
				ctx.ui.notify(`pilee /meta-review failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}

export default function (pi: ExtensionAPI): void {
	registerPrReview(pi);
}
