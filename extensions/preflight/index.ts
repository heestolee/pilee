import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

// ─── Config ────────────────────────────────────────────────────────────────

const BASELINE_CACHE_FILE = join(homedir(), ".pi", "agent", "state", "preflight-baseline-cache.json");
const DEFAULT_BASELINE_TTL_DAYS = 30;
const MAX_RECENT_VALIDATION_FAILURES = 20;

// ─── Types ─────────────────────────────────────────────────────────────────

type CheckStatus = "fail" | "timeout" | "baseline";

interface CheckResult {
	check: string;
	status: CheckStatus;
	durationMs: number;
	failSummary?: string;
	stderr?: string;
	signature?: string;
	baselineId?: string;
	baselineNote?: string;
}

interface KnownBaselineFailure {
	id: string;
	repoKey: string;
	check: string;
	signature: string;
	failSummary: string;
	note?: string;
	sourceBranch?: string;
	createdAt: string;
	updatedAt: string;
	expiresAt?: string;
	hits: number;
}

interface RepoInfo {
	root: string;
	branch: string;
	remoteUrl: string;
}

interface ObservedValidationFailure {
	repoKey: string;
	repoRoot: string;
	branch: string;
	command: string;
	result: CheckResult;
	observedAt: string;
}

const recentValidationFailures = new Map<string, ObservedValidationFailure[]>();

const preflightBaselineToolSchema = Type.Object({
	action: Type.Union([
		Type.Literal("list"),
		Type.Literal("add_last"),
		Type.Literal("clear"),
		Type.Literal("prune"),
	], { description: "Baseline cache action. Use add_last after you have determined the latest validation failure is unrelated baseline noise." }),
	note: Type.Optional(Type.String({ description: "Why this failure is unrelated baseline noise. Required for add_last." })),
	check: Type.Optional(Type.String({ description: "Optional check name filter, e.g. typecheck, lint, test, build." })),
	expiresDays: Type.Optional(Type.Number({ description: "Optional expiration in days. Default 30." })),
	id: Type.Optional(Type.String({ description: "Baseline id for clear." })),
});

// ─── Baseline failure cache ────────────────────────────────────────────────

function repoKeyFor(repoRoot: string, remoteUrl?: string): string {
	const normalizedRemote = (remoteUrl ?? "").trim().toLowerCase().replace(/\.git$/, "");
	return normalizedRemote || basename(repoRoot).toLowerCase();
}

function readBaselineCache(): KnownBaselineFailure[] {
	if (!existsSync(BASELINE_CACHE_FILE)) return [];
	try {
		const parsed = JSON.parse(readFileSync(BASELINE_CACHE_FILE, "utf8"));
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((entry): entry is KnownBaselineFailure => {
			return typeof entry?.id === "string" && typeof entry.repoKey === "string" && typeof entry.check === "string" && typeof entry.signature === "string";
		});
	} catch {
		return [];
	}
}

function writeBaselineCache(entries: KnownBaselineFailure[]) {
	try {
		mkdirSync(dirname(BASELINE_CACHE_FILE), { recursive: true });
		writeFileSync(BASELINE_CACHE_FILE, `${JSON.stringify(entries, null, 2)}\n`);
	} catch {}
}

function baselineExpired(entry: KnownBaselineFailure, now = Date.now()): boolean {
	if (!entry.expiresAt) return false;
	const ts = Date.parse(entry.expiresAt);
	return Number.isFinite(ts) && ts < now;
}

function normalizeFailureText(text: string): string {
	const home = homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return text
		.replace(/\x1b\[[0-9;]*m/g, "")
		.replace(new RegExp(home, "g"), "~")
		.replace(/\b\d+:\d+\b/g, "<line:col>")
		.replace(/\bline\s+\d+/gi, "line <n>")
		.replace(/\bcolumn\s+\d+/gi, "column <n>")
		.replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 1600);
}

function failureSignature(result: CheckResult): string {
	const normalized = normalizeFailureText(`${result.check}\n${result.failSummary ?? ""}\n${result.stderr ?? ""}`);
	return createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

function baselineIdFor(check: string, signature: string): string {
	const prefix = check.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "check";
	return `${prefix}-${signature.slice(0, 8)}`;
}

function annotateBaselineResult(result: CheckResult, repoKey: string, cache: KnownBaselineFailure[], now = Date.now()): CheckResult {
	const signature = failureSignature(result);
	const match = cache.find((entry) => entry.repoKey === repoKey && entry.check === result.check && entry.signature === signature && !baselineExpired(entry, now));
	if (!match) return { ...result, signature };
	match.hits = (match.hits ?? 0) + 1;
	match.updatedAt = new Date(now).toISOString();
	return {
		...result,
		status: "baseline",
		signature,
		baselineId: match.id,
		baselineNote: match.note,
	};
}

function upsertBaselineEntry(cache: KnownBaselineFailure[], repoKey: string, result: CheckResult, sourceBranch: string, note: string, expiresAt: string): KnownBaselineFailure {
	const signature = result.signature ?? failureSignature(result);
	const nowIso = new Date().toISOString();
	const existing = cache.find((entry) => entry.repoKey === repoKey && entry.check === result.check && entry.signature === signature);
	if (existing) {
		existing.updatedAt = nowIso;
		existing.sourceBranch = sourceBranch;
		existing.failSummary = result.failSummary ?? existing.failSummary;
		existing.note = note || existing.note;
		existing.expiresAt = expiresAt;
		return existing;
	}
	const entry: KnownBaselineFailure = {
		id: baselineIdFor(result.check, signature),
		repoKey,
		check: result.check,
		signature,
		failSummary: result.failSummary ?? "Unknown failure",
		note,
		sourceBranch,
		createdAt: nowIso,
		updatedAt: nowIso,
		expiresAt,
		hits: 0,
	};
	cache.push(entry);
	return entry;
}

function formatBaselineEntry(entry: KnownBaselineFailure): string {
	const expires = entry.expiresAt ? entry.expiresAt.slice(0, 10) : "no-expiry";
	const note = entry.note ? ` — ${entry.note}` : "";
	return `${entry.id} · ${entry.check} · hits ${entry.hits ?? 0} · expires ${expires}\n  ${entry.failSummary.slice(0, 140)}${note}`;
}

// ─── Git / command helpers ────────────────────────────────────────────────

async function getRepoInfo(pi: ExtensionAPI, cwd: string): Promise<RepoInfo | null> {
	const rootR = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	if (rootR.code !== 0) return null;
	const root = rootR.stdout?.trim() ?? cwd;

	const branchR = await pi.exec("git", ["branch", "--show-current"], { cwd: root });
	const branch = branchR.code === 0 ? branchR.stdout?.trim() ?? "HEAD" : "HEAD";

	const remoteR = await pi.exec("git", ["config", "--get", "remote.origin.url"], { cwd: root });
	const remoteUrl = remoteR.code === 0 ? remoteR.stdout?.trim() ?? "" : "";

	return { root, branch, remoteUrl };
}

async function currentRepoKey(pi: ExtensionAPI, cwd: string): Promise<{ repoKey: string; repo: RepoInfo } | null> {
	const repo = await getRepoInfo(pi, cwd);
	if (!repo) return null;
	return { repoKey: repoKeyFor(repo.root, repo.remoteUrl), repo };
}

function validationCheckNameFromCommand(command: string): string | null {
	const compact = command.toLowerCase().replace(/\s+/g, " ").trim();
	if (!compact) return null;
	if (/\b(git diff --check)\b/.test(compact)) return "diff-check";
	if (/\b(biome|eslint|lint)(:|\b)/.test(compact)) return "lint";
	if (/\b(typecheck|type-check|check-types|tsc|vue-tsc)\b/.test(compact) || /\btsc\b.*--noemit/.test(compact)) return "typecheck";
	if (/\b(test|vitest|jest|playwright|cypress|mocha|ava)(:|\b)/.test(compact)) return "test";
	if (/\b(build|next build|turbo build|tsup|vite build)(:|\b)/.test(compact)) return "build";
	if (/\b(check|verify)(:|\b)/.test(compact)) return "validation";
	return null;
}

function contentToText(content: Array<{ type: string; text?: string }>): string {
	return content
		.map((part) => part.type === "text" && typeof part.text === "string" ? part.text : "")
		.filter(Boolean)
		.join("\n");
}

function extractFailSummary(output: string, checkName: string): string {
	const lines = output.split("\n");

	if (checkName.startsWith("test")) {
		const failLines = lines.filter((l) => /✕|✗|FAIL\s|failed:|Error:/i.test(l));
		if (failLines.length > 0) return failLines.slice(0, 3).join(" | ").slice(0, 300);
	}

	if (checkName.startsWith("typecheck")) {
		const tsErrors = lines.filter((l) => /error TS\d+:/.test(l));
		if (tsErrors.length > 0) return `${tsErrors.length} TS error(s): ${tsErrors[0].slice(0, 200)}`;
	}

	if (checkName === "lint") {
		const errLines = lines.filter((l) => /error|✖/i.test(l) && !l.includes("warnings"));
		if (errLines.length > 0) return errLines.slice(0, 2).join(" | ").slice(0, 300);
	}

	const meaningful = lines.filter((l) => l.trim() && !/^[\s>$]/.test(l)).slice(-3);
	return meaningful.join(" | ").slice(0, 300) || "Unknown failure";
}

// ─── Observed validation failures ─────────────────────────────────────────

function rememberObservedValidationFailure(observed: ObservedValidationFailure) {
	const entries = recentValidationFailures.get(observed.repoKey) ?? [];
	entries.unshift(observed);
	recentValidationFailures.set(observed.repoKey, entries.slice(0, MAX_RECENT_VALIDATION_FAILURES));
}

function recentFailuresFor(repoKey: string, check?: string): ObservedValidationFailure[] {
	const entries = recentValidationFailures.get(repoKey) ?? [];
	return check ? entries.filter((entry) => entry.result.check === check) : entries;
}

function formatObservedFailure(entry: ObservedValidationFailure): string {
	const status = entry.result.status === "baseline" ? `baseline:${entry.result.baselineId ?? entry.result.signature ?? "known"}` : entry.result.status;
	return `${entry.result.check} · ${status} · ${entry.result.failSummary ?? "Unknown failure"}\n  command: ${entry.command.slice(0, 160)}`;
}

// ─── Agent tool / bash result annotation ──────────────────────────────────

function toolText(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

async function handlePreflightBaselineTool(pi: ExtensionAPI, params: any, cwd: string) {
	const repoInfo = await currentRepoKey(pi, cwd);
	if (!repoInfo) throw new Error("preflight_baseline requires a git repository");
	const { repoKey, repo } = repoInfo;
	let cache = readBaselineCache();
	const now = Date.now();

	if (params.action === "list") {
		const active = cache.filter((entry) => entry.repoKey === repoKey && !baselineExpired(entry, now));
		const recent = recentFailuresFor(repoKey, params.check);
		return toolText([
			active.length ? "Known baseline failures:" : "Known baseline failures: none",
			...active.map(formatBaselineEntry),
			"",
			recent.length ? "Recent observed validation failures:" : "Recent observed validation failures: none",
			...recent.slice(0, 8).map(formatObservedFailure),
		].join("\n"), { action: params.action, repoKey, known: active.length, recent: recent.length });
	}

	if (params.action === "prune") {
		const before = cache.length;
		cache = cache.filter((entry) => !baselineExpired(entry, now));
		writeBaselineCache(cache);
		return toolText(`만료된 baseline ${before - cache.length}개를 정리했습니다.`, { action: params.action, pruned: before - cache.length });
	}

	if (params.action === "clear") {
		if (!params.id) throw new Error("id is required for clear");
		const before = cache.length;
		cache = cache.filter((entry) => entry.id !== params.id);
		writeBaselineCache(cache);
		return toolText(before === cache.length ? `baseline id를 찾지 못했습니다: ${params.id}` : `baseline 삭제: ${params.id}`, { action: params.action, removed: before - cache.length });
	}

	if (params.action === "add_last") {
		const note = String(params.note ?? "").trim();
		if (!note) throw new Error("note is required for add_last; explain why this failure is unrelated baseline noise");
		const recent = recentFailuresFor(repoKey, params.check).filter((entry) => entry.result.status === "fail" || entry.result.status === "timeout");
		if (recent.length === 0) throw new Error("No recent non-baseline validation failure found for this repository/check");
		const expiresDays = Number.isFinite(params.expiresDays) && params.expiresDays > 0 ? params.expiresDays : DEFAULT_BASELINE_TTL_DAYS;
		const expiresAt = new Date(now + expiresDays * 24 * 60 * 60 * 1000).toISOString();
		const target = recent[0];
		const added = upsertBaselineEntry(cache, repoKey, target.result, repo.branch, note, expiresAt);
		writeBaselineCache(cache);
		return toolText([
			"최근 validation failure 1개를 known baseline으로 기록했습니다.",
			"다음 동일 signature 실패는 bash 결과에서 baseline으로 자동 주석 처리됩니다.",
			"",
			formatBaselineEntry(added),
		].join("\n"), { action: params.action, added: [added.id], repoKey });
	}

	throw new Error(`Unsupported action: ${params.action}`);
}

async function annotateBashValidationFailure(pi: ExtensionAPI, event: any, ctx: { cwd: string }) {
	if (event.toolName !== "bash" || !event.isError) return undefined;
	const command = String(event.input?.command ?? "");
	const check = validationCheckNameFromCommand(command);
	if (!check) return undefined;
	const repoInfo = await currentRepoKey(pi, ctx.cwd);
	if (!repoInfo) return undefined;
	const output = contentToText(event.content ?? []);
	const result: CheckResult = {
		check,
		status: "fail",
		durationMs: 0,
		failSummary: extractFailSummary(output, check),
		stderr: output.slice(-2000),
	};
	const cache = readBaselineCache();
	const annotated = annotateBaselineResult(result, repoInfo.repoKey, cache);
	rememberObservedValidationFailure({
		repoKey: repoInfo.repoKey,
		repoRoot: repoInfo.repo.root,
		branch: repoInfo.repo.branch,
		command,
		result: annotated,
		observedAt: new Date().toISOString(),
	});

	if (annotated.status === "baseline") {
		writeBaselineCache(cache);
		const note = [
			"",
			"[preflight] Known baseline failure detected.",
			`- check: ${annotated.check}`,
			`- baseline: ${annotated.baselineId ?? annotated.signature}`,
			annotated.baselineNote ? `- note: ${annotated.baselineNote}` : "",
			"- Treat as unrelated unless the current diff changes this failure signature or affected area.",
		].filter(Boolean).join("\n");
		return {
			content: [...(event.content ?? []), { type: "text" as const, text: note }],
			details: { ...(event.details ?? {}), preflightBaseline: { id: annotated.baselineId, signature: annotated.signature, note: annotated.baselineNote } },
			isError: event.isError,
		};
	}
	return undefined;
}

function buildPreflightSystemPrompt(cache: KnownBaselineFailure[]): string {
	const active = cache.filter((entry) => !baselineExpired(entry)).slice(0, 5);
	return [
		"Validation baseline automation:",
		"- There is no user-facing /preflight command in the normal workflow.",
		"- When validation/lint/typecheck/test/build fails, read the full output first and decide whether it is caused by the current diff.",
		"- If the bash result is annotated as [preflight] Known baseline failure, separate it as Known baseline/unrelated instead of re-debugging it, unless the current diff changes its signature or affected area.",
		"- If you determine a new validation failure is unrelated baseline noise after root-cause review, call the preflight_baseline tool with action=add_last and a concise note. Do not ask the user to run a slash command.",
		"- Never record a failure as baseline if it may be caused by the current diff or if required evidence is missing.",
		active.length ? `Active known baselines: ${active.map((entry) => `${entry.check}:${entry.id}`).join(", ")}` : "Active known baselines: none for this repo/session yet.",
	].join("\n");
}

// ─── Extension entry ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.on("before_agent_start", async (_event, ctx) => {
		const repoInfo = await currentRepoKey(pi, ctx.cwd);
		if (!repoInfo) return;
		const cache = readBaselineCache().filter((entry) => entry.repoKey === repoInfo.repoKey);
		return { systemPrompt: buildPreflightSystemPrompt(cache) };
	});

	pi.on("tool_result", async (event, ctx) => annotateBashValidationFailure(pi, event, ctx));

	pi.registerTool({
		name: "preflight_baseline",
		label: "Validation Baseline",
		description: "Inspect/list or record known unrelated validation baseline failures after lint/typecheck/test/build failures. This is an agent tool, not a user-facing command.",
		promptSnippet: "Use preflight_baseline after validation failure triage to separate known unrelated baseline failures from actionable failures.",
		promptGuidelines: [
			"Do not use this tool to hide a failure that may be caused by the current diff.",
			"Use action=list before re-debugging repeated validation failures if the bash result was not already annotated.",
			"Use action=add_last only after reading the full failure and deciding it is unrelated baseline noise.",
		],
		parameters: preflightBaselineToolSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			return handlePreflightBaselineTool(pi, params, ctx.cwd);
		},
	});
}
