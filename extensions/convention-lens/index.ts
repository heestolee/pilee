import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
	expandProfileTemplate,
	loadConventionLensProfiles,
	type ConventionLensConsumerProfile,
	type ConventionLensMode,
	type ConventionLensProfile,
	type WorktreeRepoMatchProfile,
} from "../utils/private-profiles.ts";
import { factsFromDiff, loadConventionGraph, selectConventionLenses } from "./graph.ts";
import { captureConventionLensBaseline, selectConventionLensReviewTarget } from "./review-target.ts";
import {
	buildConventionLensFollowUpMessage,
	CONVENTION_LENS_FOLLOWUP_MARKER,
	writeConventionLensReviewArtifact,
} from "./reviewer.ts";
import { validateConventionLensSubmission, type ConventionLensSubmission } from "./submission.ts";
import type {
	ConventionLensFactSet,
	ConventionLensGraph,
	ConventionLensRunBaseline,
	ConventionLensRuntimeRecord,
	ConventionLensSelection,
} from "./types.ts";

const STATE_ENTRY = "convention-lens-state";
const DEFAULT_STATE_DIR = join(homedir(), ".pi", "agent", "state", "convention-lens");
const DEFAULT_GENERATED_PATTERNS = [
	"(^|/)(node_modules|dist|build|coverage|__generated__)(/|$)",
	"(^|/)(generated|graphql/generated)(/|$)",
	"\\.(snap|min\\.js)$",
	"(^|/)(pnpm-lock\\.yaml|package-lock\\.json|yarn\\.lock)$",
];

interface RegisterOptions {
	profiles?: ConventionLensProfile[];
	stateDir?: string;
	now?: () => number;
	disableStateFile?: boolean;
}

interface PendingMainReview {
	profileId: string;
	mode: ConventionLensMode;
	startedAt: number;
	diffFingerprint: string;
	targetKind: ConventionLensRuntimeRecord["targetKind"];
	paths: string[];
	selected: ConventionLensRuntimeRecord["selected"];
	artifactPath: string;
	artifact: ReturnType<typeof writeConventionLensReviewArtifact>["artifact"];
	submission?: ConventionLensSubmission;
}

interface RuntimeState {
	ctx?: ExtensionContext;
	profile?: ConventionLensProfile;
	graph?: ConventionLensGraph;
	modeOverride?: ConventionLensMode;
	baseline?: ConventionLensRunBaseline;
	processing: boolean;
	pendingReview?: PendingMainReview;
	repairAuthorized: boolean;
	cycle: number;
	lastFingerprint?: string;
	lastRecord?: ConventionLensRuntimeRecord;
}

interface RepoInfo {
	root: string;
	remote: string;
}

function textResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

async function repoInfo(pi: ExtensionAPI, cwd: string): Promise<RepoInfo | undefined> {
	const root = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 10_000 });
	if (root.code !== 0 || !root.stdout.trim()) return undefined;
	const remote = await pi.exec("git", ["remote", "get-url", "origin"], { cwd, timeout: 10_000 });
	return { root: root.stdout.trim(), remote: remote.code === 0 ? remote.stdout.trim() : "" };
}

function safeRegex(value: string, input: string): boolean {
	try { return new RegExp(value).test(input); } catch { return false; }
}

function matchesRepo(match: WorktreeRepoMatchProfile | undefined, info: RepoInfo): boolean {
	if (!match) return true;
	const checks: boolean[] = [];
	if (match.rootBasenames?.length) checks.push(match.rootBasenames.includes(basename(info.root)));
	if (match.pathIncludes?.length) checks.push(match.pathIncludes.some((value) => info.root.includes(value)));
	if (match.pathRegexes?.length) checks.push(match.pathRegexes.some((value) => safeRegex(value, info.root)));
	if (match.remoteIncludes?.length) checks.push(match.remoteIncludes.some((value) => info.remote.includes(value)));
	if (match.registeredNames?.length) checks.push(match.registeredNames.includes(basename(info.root)));
	return checks.length === 0 || checks.some(Boolean);
}

async function resolveProfile(pi: ExtensionAPI, cwd: string, profiles: ConventionLensProfile[]): Promise<ConventionLensProfile | undefined> {
	const info = await repoInfo(pi, cwd);
	if (!info) return undefined;
	return profiles.find((profile) => profile.enabled !== false && matchesRepo(profile.match, info));
}

function effectiveMode(state: RuntimeState): ConventionLensMode {
	return state.modeOverride ?? state.profile?.mode ?? "off";
}

function generatedOnly(paths: string[], profile: ConventionLensProfile): boolean {
	if (!profile.skipGeneratedOnly || paths.length === 0) return false;
	const patterns = profile.generatedPathPatterns?.length ? profile.generatedPathPatterns : DEFAULT_GENERATED_PATTERNS;
	return paths.every((path) => patterns.some((pattern) => safeRegex(pattern, path)));
}

function stateDir(profile: ConventionLensProfile | undefined, fallback?: string): string {
	return profile?.stateDir ? expandProfileTemplate(profile.stateDir) : fallback ?? DEFAULT_STATE_DIR;
}

function persistRecord(
	pi: ExtensionAPI,
	state: RuntimeState,
	record: ConventionLensRuntimeRecord,
	options: RegisterOptions,
	persistOptions: { appendEntry?: boolean; directory?: string } = {},
): void {
	state.lastRecord = record;
	if (persistOptions.appendEntry !== false) pi.appendEntry(STATE_ENTRY, record);
	if (options.disableStateFile) return;
	const dir = persistOptions.directory ?? stateDir(state.profile, options.stateDir);
	mkdirSync(dir, { recursive: true });
	appendFileSync(join(dir, "events.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
}

function recordFor(
	state: RuntimeState,
	cwd: string,
	mode: ConventionLensMode,
	now: number,
	startedAt: number,
	input: Partial<ConventionLensRuntimeRecord>,
): ConventionLensRuntimeRecord {
	return {
		schemaVersion: 1,
		timestamp: now,
		profileId: state.profile?.id ?? "unconfigured",
		mode,
		cwdHash: hash(cwd).slice(0, 16),
		paths: [],
		selected: [],
		status: "skipped",
		latencyMs: Math.max(0, now - startedAt),
		...input,
	};
}

function selectedSummary(selection: ConventionLensSelection) {
	return selection.candidates.map((candidate) => ({
		id: candidate.node.id,
		score: candidate.score,
		authority: candidate.node.authority,
		status: candidate.node.status,
	}));
}

function applyConsumerSeeds(
	selection: ConventionLensSelection,
	graph: ConventionLensGraph,
	consumer: ConventionLensConsumerProfile | undefined,
	limit: number,
): ConventionLensSelection {
	if (!consumer?.seedIds?.length) return selection;
	const candidates = [...selection.candidates];
	const selected = new Set(candidates.map((candidate) => candidate.node.id));
	for (const id of consumer.seedIds) {
		if (selected.has(id) || candidates.length >= limit) continue;
		const node = graph.nodes.find((candidate) => candidate.id === id && candidate.status !== "deprecated");
		if (!node) continue;
		candidates.unshift({
			node,
			score: Number.MAX_SAFE_INTEGER,
			matchedSignals: [],
			matchedPaths: [],
			reasons: [`consumer:${consumer.id}`],
		});
		selected.add(id);
	}
	return { ...selection, candidates: candidates.slice(0, limit) };
}

function queryFacts(query: string, paths: string[] = []): ConventionLensFactSet {
	const terms = [...new Set(`${query} ${paths.join(" ")}`.toLowerCase().split(/[^\p{L}\p{N}._/-]+/u).filter((term) => term.length >= 2))];
	return { paths, terms, changedLines: [query] };
}

function isMutatingBash(command: string): boolean {
	const withoutDiscardRedirects = command
		.replace(/\b\d*>\s*\/dev\/null\b/g, "")
		.replace(/\b\d*>\s*&\d\b/g, "");
	return /(?:^|[;&|]\s*|\s)(?:rm|mv|cp|touch|mkdir|install|tee)\b|\bsed\s+-i\b|\bperl\s+-pi\b|\bgit\s+(?:add|commit|push|reset|checkout|switch|clean)\b|(?:^|[^<\d])>{1,2}\s*[^&]/i.test(withoutDiscardRedirects);
}

function restoreRuntimeRecords(ctx: ExtensionContext): { lastRecord?: ConventionLensRuntimeRecord; lastFingerprint?: string } {
	let lastRecord: ConventionLensRuntimeRecord | undefined;
	let lastFingerprint: string | undefined;
	for (const entry of [...ctx.sessionManager.getEntries()].reverse()) {
		const candidate = entry as { type?: string; customType?: string; data?: unknown };
		if (candidate.type !== "custom" || candidate.customType !== STATE_ENTRY || !candidate.data || typeof candidate.data !== "object") continue;
		const record = candidate.data as ConventionLensRuntimeRecord;
		lastRecord ??= record;
		lastFingerprint ??= record.diffFingerprint;
		if (lastRecord && lastFingerprint) break;
	}
	return { lastRecord, lastFingerprint };
}

export function registerConventionLens(pi: ExtensionAPI, options: RegisterOptions = {}): void {
	const state: RuntimeState = { processing: false, repairAuthorized: false, cycle: 0 };
	const now = options.now ?? (() => Date.now());

	pi.on("session_start", async (_event, ctx) => {
		state.ctx = ctx;
		state.processing = false;
		state.pendingReview = undefined;
		state.repairAuthorized = false;
		state.cycle = 0;
		state.baseline = undefined;
		const restored = restoreRuntimeRecords(ctx);
		state.lastRecord = restored.lastRecord;
		state.lastFingerprint = restored.lastFingerprint;
		const profiles = options.profiles ?? loadConventionLensProfiles();
		state.profile = await resolveProfile(pi, ctx.cwd, profiles);
		state.graph = state.profile ? loadConventionGraph(state.profile, ctx.cwd) : undefined;
	});

	pi.on("before_agent_start", (event) => {
		if (!event.prompt.startsWith(CONVENTION_LENS_FOLLOWUP_MARKER)) state.cycle = 0;
	});

	pi.on("agent_start", async (_event, ctx) => {
		state.ctx = ctx;
		if (!state.profile || effectiveMode(state) === "off" || state.baseline) return;
		try {
			state.baseline = await captureConventionLensBaseline(pi, ctx.cwd);
		} catch {
			state.baseline = undefined;
		}
	});

	pi.on("tool_call", (event) => {
		if (!state.pendingReview || state.repairAuthorized || event.toolName === "convention_lens") return;
		const mutating = ["edit", "write", "auto_commit"].includes(event.toolName)
			|| (event.toolName === "bash" && isMutatingBash(String((event.input as { command?: unknown })?.command ?? "")));
		if (!mutating) return;
		return {
			block: true,
			reason: "Convention Lens review 판정을 convention_lens action=submit으로 제출하기 전에는 파일 수정이 차단됩니다.",
		};
	});

	pi.on("agent_settled", async (_event, ctx) => {
		state.ctx = ctx;
		if (state.pendingReview) {
			const pending = state.pendingReview;
			state.pendingReview = undefined;
			state.repairAuthorized = false;
			persistRecord(pi, state, recordFor(state, ctx.cwd, pending.mode, now(), pending.startedAt, {
				profileId: pending.profileId,
				status: pending.submission ? "review-done" : "review-error",
				reason: pending.submission ? `submission:${pending.submission.verdict}` : "missing-structured-submission",
				diffFingerprint: pending.diffFingerprint,
				targetKind: pending.targetKind,
				paths: pending.paths,
				selected: pending.selected,
			}), options);
		}
		if (!state.profile || !state.graph || !state.baseline || state.processing) return;
		const mode = effectiveMode(state);
		const baseline = state.baseline;
		state.baseline = undefined;
		if (mode === "off") return;
		state.processing = true;
		const startedAt = now();
		try {
			const target = await selectConventionLensReviewTarget(pi, ctx.cwd, baseline);
			if (!target) {
				persistRecord(pi, state, recordFor(state, ctx.cwd, mode, now(), startedAt, { reason: "no-run-change" }), options);
				return;
			}
			if (target.fingerprint === state.lastFingerprint) {
				persistRecord(pi, state, recordFor(state, ctx.cwd, mode, now(), startedAt, {
					status: "suppressed",
					reason: "same-fingerprint",
					diffFingerprint: target.fingerprint,
					targetKind: target.kind,
					paths: target.paths,
				}), options);
				return;
			}
			if (generatedOnly(target.paths, state.profile)) {
				persistRecord(pi, state, recordFor(state, ctx.cwd, mode, now(), startedAt, {
					reason: "generated-only",
					diffFingerprint: target.fingerprint,
					targetKind: target.kind,
					paths: target.paths,
				}), options);
				return;
			}
			const selection = selectConventionLenses(state.graph, factsFromDiff(target.bundle), {
				threshold: state.profile.candidateThreshold,
				limit: state.profile.maxSelectedNodes,
				includeDraft: mode === "shadow",
			});
			state.lastFingerprint = target.fingerprint;
			const selected = selectedSummary(selection);
			if (!selected.length || mode === "shadow") {
				persistRecord(pi, state, recordFor(state, ctx.cwd, mode, now(), startedAt, {
					status: selected.length ? "shadow" : "skipped",
					reason: selected.length ? "candidate-found" : "no-candidate",
					diffFingerprint: target.fingerprint,
					targetKind: target.kind,
					paths: target.paths,
					selected,
				}), options);
				return;
			}
			if (ctx.mode === "print" || ctx.mode === "json") {
				persistRecord(pi, state, recordFor(state, ctx.cwd, mode, now(), startedAt, {
					status: "review-error",
					reason: "non-persistent-mode",
					diffFingerprint: target.fingerprint,
					targetKind: target.kind,
					paths: target.paths,
					selected,
				}), options);
				return;
			}
			const maxCycles = Math.max(1, state.profile.maxCycles ?? 2);
			if (state.cycle >= maxCycles) {
				persistRecord(pi, state, recordFor(state, ctx.cwd, mode, now(), startedAt, {
					status: "suppressed",
					reason: "max-cycle",
					diffFingerprint: target.fingerprint,
					targetKind: target.kind,
					paths: target.paths,
					selected,
				}), options);
				return;
			}
			const directory = stateDir(state.profile, options.stateDir);
			const written = writeConventionLensReviewArtifact(directory, ctx.cwd, mode, target, selection);
			state.cycle += 1;
			state.pendingReview = {
				profileId: state.profile.id,
				mode,
				startedAt,
				diffFingerprint: target.fingerprint,
				targetKind: target.kind,
				paths: target.paths,
				selected,
				artifactPath: written.artifactPath,
				artifact: written.artifact,
			};
			persistRecord(pi, state, recordFor(state, ctx.cwd, mode, now(), startedAt, {
				status: "review-started",
				reason: "main-follow-up",
				diffFingerprint: target.fingerprint,
				targetKind: target.kind,
				paths: target.paths,
				selected,
			}), options);
			try {
				pi.sendMessage(buildConventionLensFollowUpMessage(written.artifactPath, written.artifact), {
					deliverAs: "followUp",
					triggerTurn: true,
				});
			} catch (error) {
				state.pendingReview = undefined;
				persistRecord(pi, state, recordFor(state, ctx.cwd, mode, now(), startedAt, {
					status: "review-error",
					reason: error instanceof Error ? error.message : String(error),
					diffFingerprint: target.fingerprint,
					targetKind: target.kind,
					paths: target.paths,
					selected,
				}), options);
			}
		} catch (error) {
			persistRecord(pi, state, recordFor(state, ctx.cwd, mode, now(), startedAt, {
				reason: `shadow-error:${error instanceof Error ? error.message : String(error)}`,
			}), options);
		} finally {
			state.processing = false;
		}
	});

	pi.on("session_shutdown", () => {
		state.ctx = undefined;
		state.profile = undefined;
		state.graph = undefined;
		state.baseline = undefined;
		state.processing = false;
		state.pendingReview = undefined;
		state.repairAuthorized = false;
		state.cycle = 0;
	});

	pi.registerTool({
		name: "convention_lens",
		label: "Convention Lens",
		description: "Inspect the active event-driven convention lens profile, query its graph, or replay current text facts. Normal operation is automatic at agent_settled; this tool is for diagnosis and explicit fallback.",
		parameters: Type.Object({
			action: StringEnum(["status", "query", "submit"] as const),
			query: Type.Optional(Type.String()),
			paths: Type.Optional(Type.Array(Type.String())),
			consumerId: Type.Optional(Type.String()),
			verdict: Type.Optional(StringEnum(["KEEP", "AUTO_FIX", "ASK", "INFO", "NO_MATCH"] as const)),
			summary: Type.Optional(Type.String()),
			findings: Type.Optional(Type.Array(Type.Any())),
		}),
		async execute(_id, params) {
			if (params.action === "submit") {
				if (!state.pendingReview) throw new Error("제출할 pending Convention Lens review가 없습니다.");
				const submission = validateConventionLensSubmission({
					verdict: params.verdict,
					summary: params.summary,
					findings: params.findings,
				}, state.pendingReview.artifact, state.pendingReview.mode);
				state.pendingReview.submission = submission;
				state.repairAuthorized = submission.repairAuthorized;
				const instruction = submission.repairAuthorized
					? "repairAuthorized=true. AUTO_FIX finding만 최소 수정하고 가장 가까운 검증을 실행하세요."
					: "repairAuthorized=false. 코드를 수정하지 말고 KEEP/ASK/INFO 판정과 근거를 보고하세요.";
				return textResult(`${instruction}\n${JSON.stringify(submission, null, 2)}`, { submission });
			}
			if (params.action === "status") {
				return textResult(JSON.stringify({
					profile: state.profile?.id,
					mode: effectiveMode(state),
					graph: state.graph ? { version: state.graph.version, nodes: state.graph.nodes.length, errors: state.graph.errors, warnings: state.graph.warnings } : undefined,
					lastRecord: state.lastRecord,
				}, null, 2), { profile: state.profile, graph: state.graph, lastRecord: state.lastRecord });
			}
			if (!state.graph || !state.profile) throw new Error("active convention lens profile이 없습니다.");
			if (!params.query?.trim()) throw new Error("query action에는 query가 필요합니다.");
			const limit = state.profile.maxSelectedNodes ?? 3;
			const consumer = state.profile.consumers?.find((candidate) => candidate.id === params.consumerId);
			const selection = applyConsumerSeeds(selectConventionLenses(state.graph, queryFacts(params.query, params.paths), {
				threshold: 1,
				limit,
				includeDraft: true,
			}), state.graph, consumer, limit);
			return textResult(JSON.stringify(selection, null, 2), { selection, consumer });
		},
	});

	pi.registerCommand("convention", {
		description: "Convention Lens 진단: /convention status | mode <off|shadow|review|repair> | query <text>",
		handler: async (args, ctx) => {
			const [command = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			if (command === "mode") {
				const mode = rest[0] as ConventionLensMode | undefined;
				if (!mode || !["off", "shadow", "review", "repair"].includes(mode)) {
					ctx.ui.notify("사용법: /convention mode <off|shadow|review|repair>", "warning");
					return;
				}
				state.modeOverride = mode;
				ctx.ui.notify(`Convention Lens mode: ${mode}`, "info");
				return;
			}
			if (command === "query") {
				if (!state.graph || !state.profile) {
					ctx.ui.notify("active convention lens profile이 없습니다.", "warning");
					return;
				}
				const selection = selectConventionLenses(state.graph, queryFacts(rest.join(" ")), { threshold: 1, limit: state.profile.maxSelectedNodes, includeDraft: true });
				ctx.ui.notify(selection.candidates.map((candidate) => `${candidate.node.id} (${candidate.score})`).join("\n") || "matching lens 없음", "info");
				return;
			}
			ctx.ui.notify(`Convention Lens · ${state.profile?.id ?? "inactive"} · mode=${effectiveMode(state)} · nodes=${state.graph?.nodes.length ?? 0}`, "info");
		},
	});
}

export default function conventionLens(pi: ExtensionAPI): void {
	registerConventionLens(pi);
}

export const __test = { matchesRepo, generatedOnly, queryFacts, restoreRuntimeRecords, applyConsumerSeeds, isMutatingBash };
