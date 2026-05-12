import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { expandProfileTemplate, loadPreflightProfiles, type PreflightCheckProfile, type PreflightProfile } from "../utils/private-profiles.ts";

// ─── Config ────────────────────────────────────────────────────────────────

const LOG_FILE = join(homedir(), ".pi", "agent", "state", "preflight-analytics.jsonl");
const BASELINE_CACHE_FILE = join(homedir(), ".pi", "agent", "state", "preflight-baseline-cache.json");
const MAX_LOG_AGE_DAYS = 180;
const DEFAULT_BASELINE_TTL_DAYS = 30;
const MAX_RECENT_VALIDATION_FAILURES = 20;

interface CheckDef {
	name: string;
	command: string;
	cwd?: string; // relative to repo root
	timeoutMs: number;
	triggers: (changedFiles: string[]) => boolean;
}

function profileCheckTriggers(profile: PreflightCheckProfile): (changedFiles: string[]) => boolean {
	return (changedFiles) => changedFiles.some((file) => {
		if ((profile.triggerIncludes ?? []).some((part) => file.includes(part))) return true;
		return (profile.triggerRegexes ?? []).some((pattern) => {
			try { return new RegExp(pattern).test(file); } catch { return false; }
		});
	});
}

function preflightProfileMatches(profile: PreflightProfile, repoRoot: string, remoteUrl?: string): boolean {
	const match = profile.match;
	if (!match) return true;
	const normalizedPath = repoRoot.toLowerCase();
	const normalizedRemote = (remoteUrl ?? "").trim().toLowerCase().replace(/\.git$/, "");
	if ((match.rootBasenames ?? []).includes(basename(repoRoot))) return true;
	if ((match.pathIncludes ?? []).some((part) => normalizedPath.includes(expandProfileTemplate(part).toLowerCase()))) return true;
	if ((match.pathRegexes ?? []).some((pattern) => {
		try { return new RegExp(expandProfileTemplate(pattern), "i").test(normalizedPath); } catch { return false; }
	})) return true;
	if (normalizedRemote && (match.remoteIncludes ?? []).some((part) => normalizedRemote.includes(part.toLowerCase()))) return true;
	return false;
}

function matchingPreflightProfiles(cwd?: string, remoteUrl?: string): PreflightProfile[] {
	return loadPreflightProfiles(cwd).filter((profile) => !cwd || preflightProfileMatches(profile, cwd, remoteUrl));
}

function configuredChecks(cwd?: string, remoteUrl?: string): CheckDef[] {
	return matchingPreflightProfiles(cwd, remoteUrl).flatMap((profile) => (profile.checks ?? []).map((check) => ({
		name: check.name,
		command: check.command,
		cwd: check.cwd,
		timeoutMs: check.timeoutMs ?? 120_000,
		triggers: profileCheckTriggers(check),
	})));
}

function configuredBaseBranchCandidates(cwd?: string, remoteUrl?: string): string[] {
	const candidates = matchingPreflightProfiles(cwd, remoteUrl).flatMap((profile) => profile.baseBranchCandidates ?? []);
	return candidates.length ? [...new Set(candidates)] : ["main", "master", "develop", "development"];
}

// ─── Types ─────────────────────────────────────────────────────────────────

type CheckStatus = "pass" | "fail" | "timeout" | "skip" | "baseline";

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

interface RunLog {
	ts: string;
	epoch: number;
	type: "preflight_run";
	repo: string;
	repoKey?: string;
	branch: string;
	filesChanged: number;
	filesChangedAreas: string[];
	checksPlanned: string[];
	durationTotalMs: number;
	results: CheckResult[];
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

// ─── Logging ───────────────────────────────────────────────────────────────

function appendLog(entry: RunLog) {
	try {
		mkdirSync(dirname(LOG_FILE), { recursive: true });
		appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`);
	} catch {}
}

function readAllLogs(): RunLog[] {
	if (!existsSync(LOG_FILE)) return [];
	try {
		const lines = readFileSync(LOG_FILE, "utf8").split("\n").filter(Boolean);
		const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;
		return lines
			.map((l) => {
				try { return JSON.parse(l) as RunLog; } catch { return null; }
			})
			.filter((e): e is RunLog => e !== null && e.epoch > cutoff);
	} catch {
		return [];
	}
}


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
	if (result.status !== "fail" && result.status !== "timeout") return result;
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

function defaultBaselineExpiresAt(now = Date.now()): string {
	return new Date(now + DEFAULT_BASELINE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function parseExpiresFlag(args: string, now = Date.now()): { cleanedArgs: string; expiresAt: string | undefined } {
	const match = args.match(/(?:^|\s)--expires(?:=|\s+)(\d+)([dw])?/i);
	if (!match) return { cleanedArgs: args.trim(), expiresAt: defaultBaselineExpiresAt(now) };
	const amount = Number(match[1]);
	const unit = (match[2] ?? "d").toLowerCase();
	const days = unit === "w" ? amount * 7 : amount;
	const cleanedArgs = `${args.slice(0, match.index).trim()} ${args.slice((match.index ?? 0) + match[0].length).trim()}`.trim();
	return { cleanedArgs, expiresAt: Number.isFinite(days) && days > 0 ? new Date(now + days * 24 * 60 * 60 * 1000).toISOString() : undefined };
}

function upsertBaselineEntry(cache: KnownBaselineFailure[], repoKey: string, result: CheckResult, sourceBranch: string, note?: string, expiresAt?: string): KnownBaselineFailure {
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
		note: note || undefined,
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

async function handleBaselineCommand(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const trimmed = args.trim();
	const [subcommandRaw, ...rest] = trimmed.split(/\s+/).filter(Boolean);
	const subcommand = subcommandRaw || "list";
	const repo = await getRepoInfo(pi, ctx.cwd);
	const repoKey = repo ? repoKeyFor(repo.root, repo.remoteUrl) : undefined;
	const repoLabel = repo ? basename(repo.root) : undefined;
	let cache = readBaselineCache();
	const now = Date.now();

	if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
		ctx.ui.notify([
			"/preflight baseline list — 현재 repo의 known baseline 실패 목록",
			"/preflight baseline add-last [note] [--expires 14d|2w] — 마지막 preflight 실패를 baseline으로 기록",
			"/preflight baseline clear <id> — baseline 기록 삭제",
			"/preflight baseline prune — 만료된 기록 삭제",
		].join("\n"), "info");
		return;
	}

	if (subcommand === "list") {
		const active = cache.filter((entry) => !baselineExpired(entry, now) && (!repoKey || entry.repoKey === repoKey));
		if (active.length === 0) {
			ctx.ui.notify(repoKey ? "현재 repo에 known baseline preflight 실패가 없습니다." : "known baseline preflight 실패가 없습니다.", "info");
			return;
		}
		ctx.ui.notify([`Known baseline failures${repoLabel ? ` — ${repoLabel}` : ""}:`, "", ...active.map(formatBaselineEntry)].join("\n"), "info");
		return;
	}

	if (subcommand === "prune") {
		const before = cache.length;
		cache = cache.filter((entry) => !baselineExpired(entry, now));
		writeBaselineCache(cache);
		ctx.ui.notify(`만료된 baseline ${before - cache.length}개를 정리했습니다.`, "info");
		return;
	}

	if (subcommand === "clear") {
		const id = rest[0];
		if (!id) { ctx.ui.notify("삭제할 baseline id를 입력하세요. 예: /preflight baseline clear typecheck-abcdef12", "warning"); return; }
		const before = cache.length;
		cache = cache.filter((entry) => entry.id !== id);
		writeBaselineCache(cache);
		ctx.ui.notify(before === cache.length ? `baseline id를 찾지 못했습니다: ${id}` : `baseline 삭제: ${id}`, before === cache.length ? "warning" : "info");
		return;
	}

	if (subcommand === "add-last") {
		if (!repo || !repoKey) { ctx.ui.notify("baseline add-last는 git repository 안에서 실행해야 합니다.", "error"); return; }
		const logs = readAllLogs();
		const lastRun = [...logs].reverse().find((log) => {
			return (log.repoKey && log.repoKey === repoKey) || (!log.repoKey && log.repo === repoLabel);
		});
		if (!lastRun) { ctx.ui.notify("현재 repo의 preflight 실행 기록이 없습니다.", "warning"); return; }
		const failures = lastRun.results.filter((result) => result.status === "fail" || result.status === "timeout");
		if (failures.length === 0) { ctx.ui.notify("마지막 preflight에 baseline으로 기록할 실패가 없습니다.", "info"); return; }
		const noteArgs = parseExpiresFlag(rest.join(" "), now);
		const note = noteArgs.cleanedArgs || undefined;
		const added = failures.map((result) => upsertBaselineEntry(cache, repoKey, result, lastRun.branch || repo.branch, note, noteArgs.expiresAt));
		writeBaselineCache(cache);
		ctx.ui.notify([
			`${added.length}개 preflight 실패를 known baseline으로 기록했습니다.`,
			`다음 실행부터 같은 signature는 자동 분석 대상에서 제외됩니다.`,
			"",
			...added.map(formatBaselineEntry),
		].join("\n"), "info");
		return;
	}

	ctx.ui.notify(`알 수 없는 baseline subcommand: ${subcommand}\n/preflight baseline help를 확인하세요.`, "warning");
}


function validationCheckNameFromCommand(command: string): string | null {
	const compact = command.toLowerCase().replace(/\s+/g, " ").trim();
	if (!compact) return null;
	if (/\b(git diff --check)\b/.test(compact)) return "diff-check";
	if (/\b(biome|eslint|lint)(:|\b)/.test(compact)) return "lint";
	if (/\b(typecheck|type-check|check-types|tsc|vue-tsc)\b/.test(compact) || /\btsc\b.*--noemit/.test(compact)) return "typecheck";
	if (/\b(test|vitest|jest|playwright|cypress|mocha|ava)(:|\b)/.test(compact)) return "test";
	if (/\b(build|next build|turbo build|tsup|vite build)(:|\b)/.test(compact)) return "build";
	if (/\b(check|verify|preflight)(:|\b)/.test(compact)) return "validation";
	return null;
}

function contentToText(content: Array<{ type: string; text?: string }>): string {
	return content
		.map((part) => part.type === "text" && typeof part.text === "string" ? part.text : "")
		.filter(Boolean)
		.join("\n");
}

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

function toolText(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

async function currentRepoKey(pi: ExtensionAPI, cwd: string): Promise<{ repoKey: string; repo: Awaited<ReturnType<typeof getRepoInfo>> } | null> {
	const repo = await getRepoInfo(pi, cwd);
	if (!repo) return null;
	return { repoKey: repoKeyFor(repo.root, repo.remoteUrl), repo };
}

async function handlePreflightBaselineTool(pi: ExtensionAPI, params: any, cwd: string) {
	const repoInfo = await currentRepoKey(pi, cwd);
	if (!repoInfo || !repoInfo.repo) throw new Error("preflight_baseline requires a git repository");
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
			`최근 validation failure 1개를 known baseline으로 기록했습니다.`,
			"다음 동일 signature 실패는 bash/preflight 결과에서 baseline으로 자동 주석 처리됩니다.",
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
	if (!repoInfo || !repoInfo.repo) return undefined;
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
		"Preflight baseline automation:",
		"- Do not ask the user to run /preflight baseline commands during normal work.",
		"- When validation/lint/typecheck/test/build fails, read the full output first and decide whether it is caused by the current diff.",
		"- If the bash result is annotated as [preflight] Known baseline failure, separate it as Known baseline/unrelated instead of re-debugging it, unless the current diff changes its signature or affected area.",
		"- If you determine a new validation failure is unrelated baseline noise after root-cause review, call the preflight_baseline tool with action=add_last and a concise note. Do not ask the user to type a slash command.",
		"- Never record a failure as baseline if it may be caused by the current diff or if required evidence is missing.",
		active.length ? `Active known baselines: ${active.map((entry) => `${entry.check}:${entry.id}`).join(", ")}` : "Active known baselines: none for this repo/session yet.",
	].join("\n");
}

// ─── Git helpers ───────────────────────────────────────────────────────────

async function getRepoInfo(pi: ExtensionAPI, cwd: string): Promise<{ root: string; branch: string; baseBranch: string; remoteUrl: string } | null> {
	const rootR = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	if (rootR.code !== 0) return null;
	const root = rootR.stdout?.trim() ?? cwd;

	const branchR = await pi.exec("git", ["branch", "--show-current"], { cwd: root });
	const branch = branchR.code === 0 ? branchR.stdout?.trim() ?? "HEAD" : "HEAD";

	const remoteR = await pi.exec("git", ["config", "--get", "remote.origin.url"], { cwd: root });
	const remoteUrl = remoteR.code === 0 ? remoteR.stdout?.trim() ?? "" : "";

	// Find base branch from configured profile candidates.
	const candidates = configuredBaseBranchCandidates(root, remoteUrl);
	let baseBranch = candidates[0] ?? "main";
	for (const candidate of candidates) {
		const checkR = await pi.exec("git", ["rev-parse", "--verify", `origin/${candidate}`], { cwd: root });
		if (checkR.code === 0) { baseBranch = candidate; break; }
	}

	return { root, branch, baseBranch, remoteUrl };
}

async function getChangedFiles(pi: ExtensionAPI, cwd: string, baseBranch: string): Promise<string[]> {
	// Try merge-base diff first (more accurate for branches)
	const mergeBaseR = await pi.exec("git", ["merge-base", "HEAD", `origin/${baseBranch}`], { cwd });
	const mergeBase = mergeBaseR.code === 0 ? mergeBaseR.stdout?.trim() : null;

	const target = mergeBase ?? `origin/${baseBranch}`;
	const r = await pi.exec("git", ["diff", "--name-only", target, "--"], { cwd });
	if (r.code !== 0 || !r.stdout) return [];
	return r.stdout.split("\n").filter(Boolean);
}

function summarizeAreas(files: string[]): string[] {
	const areas = new Set<string>();
	for (const f of files) {
		const parts = f.split("/");
		if (parts.length >= 3) areas.add(parts.slice(0, 3).join("/"));
		else if (parts.length >= 2) areas.add(parts.slice(0, 2).join("/"));
		else areas.add(parts[0]);
	}
	return [...areas].slice(0, 5);
}

// ─── Check execution ───────────────────────────────────────────────────────

async function runCheck(pi: ExtensionAPI, check: CheckDef, repoRoot: string): Promise<CheckResult> {
	const start = Date.now();
	const cwd = check.cwd ? join(repoRoot, check.cwd) : repoRoot;

	try {
		const result = await pi.exec("bash", ["-lc", check.command], {
			cwd,
			timeout: check.timeoutMs,
		});

		const duration = Date.now() - start;

		if (result.code === 0) {
			return { check: check.name, status: "pass", durationMs: duration };
		}

		// Failure: extract concise summary
		const stderr = result.stderr?.trim() ?? "";
		const stdout = result.stdout?.trim() ?? "";
		const combined = `${stdout}\n${stderr}`.trim();

		const failSummary = extractFailSummary(combined, check.name);

		return {
			check: check.name,
			status: "fail",
			durationMs: duration,
			failSummary,
			stderr: combined.slice(-2000), // last 2KB for analysis
		};
	} catch (e) {
		const duration = Date.now() - start;
		const message = e instanceof Error ? e.message : String(e);
		const isTimeout = message.includes("timeout") || message.includes("ETIMEDOUT");
		return {
			check: check.name,
			status: isTimeout ? "timeout" : "fail",
			durationMs: duration,
			failSummary: isTimeout ? `Timeout after ${check.timeoutMs / 1000}s` : message,
		};
	}
}

function extractFailSummary(output: string, checkName: string): string {
	const lines = output.split("\n");

	// Test-specific patterns
	if (checkName.startsWith("test")) {
		const failLines = lines.filter((l) => /✕|✗|FAIL\s|failed:|Error:/i.test(l));
		if (failLines.length > 0) return failLines.slice(0, 3).join(" | ").slice(0, 300);
	}

	// TypeScript errors
	if (checkName.startsWith("typecheck")) {
		const tsErrors = lines.filter((l) => /error TS\d+:/.test(l));
		if (tsErrors.length > 0) return `${tsErrors.length} TS error(s): ${tsErrors[0].slice(0, 200)}`;
	}

	// Lint errors
	if (checkName === "lint") {
		const errLines = lines.filter((l) => /error|✖/i.test(l) && !l.includes("warnings"));
		if (errLines.length > 0) return errLines.slice(0, 2).join(" | ").slice(0, 300);
	}

	// Generic: last non-empty meaningful line
	const meaningful = lines.filter((l) => l.trim() && !/^[\s>$]/.test(l)).slice(-3);
	return meaningful.join(" | ").slice(0, 300) || "Unknown failure";
}

// ─── Format output ─────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatResults(results: CheckResult[], totalDuration: number): string {
	const passed = results.filter((r) => r.status === "pass").length;
	const baseline = results.filter((r) => r.status === "baseline").length;
	const total = results.length;
	const failures = results.filter((r) => r.status === "fail" || r.status === "timeout");

	const lines: string[] = [];
	const prefix = failures.length === 0 ? "✅" : "⚠️";
	lines.push(`${prefix} Preflight ${passed}/${total} passed${baseline ? ` · ${baseline} known baseline` : ""} (${formatDuration(totalDuration)})`);
	lines.push("");

	for (const r of results) {
		const icon = r.status === "pass" ? "✓" : r.status === "skip" ? "⊘" : r.status === "baseline" ? "≈" : "✗";
		const baselineSuffix = r.status === "baseline" ? ` [baseline:${r.baselineId ?? r.signature ?? "known"}]${r.baselineNote ? ` ${r.baselineNote}` : ""}` : "";
		lines.push(`${icon} ${r.check.padEnd(22)} ${formatDuration(r.durationMs).padStart(8)}${r.failSummary ? ` — ${r.failSummary.slice(0, 100)}` : ""}${baselineSuffix}`);
	}

	if (failures.length > 0) {
		lines.push("");
		lines.push(`Failed: ${failures.map((f) => f.check).join(", ")}`);
		lines.push(`반복 baseline이면 원인 확인 후 agent가 baseline cache에 기록합니다.`);
	}

	return lines.join("\n");
}

// ─── Main /preflight handler ───────────────────────────────────────────────

async function handlePreflight(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const trimmed = args.trim();

	if (trimmed === "stats") {
		await showStatsOverlay(ctx);
		return;
	}

	if (trimmed === "baseline" || trimmed.startsWith("baseline ")) {
		await handleBaselineCommand(pi, trimmed.replace(/^baseline\s*/, ""), ctx);
		return;
	}

	const all = trimmed.includes("--all");
	const skipAnalysis = trimmed.includes("--no-analysis");

	const repo = await getRepoInfo(pi, ctx.cwd);
	if (!repo) { ctx.ui.notify("Not a git repository", "error"); return; }

	ctx.ui.notify(`Detecting changes (vs origin/${repo.baseBranch})…`, "info");
	const changedFiles = await getChangedFiles(pi, repo.root, repo.baseBranch);

	if (changedFiles.length === 0) {
		ctx.ui.notify(`No changes vs origin/${repo.baseBranch}. Nothing to check.`, "info");
		return;
	}

	const checks = configuredChecks(repo.root, repo.remoteUrl);
	if (checks.length === 0) {
		ctx.ui.notify("No preflight checks are configured for this repository.", "info");
		return;
	}
	const planned = all ? checks : checks.filter((c) => c.triggers(changedFiles));
	if (planned.length === 0) {
		ctx.ui.notify(`No applicable checks for these changes (${changedFiles.length} files).`, "info");
		return;
	}

	const areas = summarizeAreas(changedFiles);
	ctx.ui.notify(
		`Files: ${changedFiles.length} (${areas.slice(0, 3).join(", ")}${areas.length > 3 ? "..." : ""})\nChecks: ${planned.map((c) => c.name).join(", ")}\n\nRunning…`,
		"info",
	);

	const start = Date.now();
	const results: CheckResult[] = [];
	const baselineCache = readBaselineCache();
	const repoKey = repoKeyFor(repo.root, repo.remoteUrl);

	// Run sequentially with progress notification
	for (const check of planned) {
		ctx.ui.setStatus("preflight", `running ${check.name}…`);
		const result = await runCheck(pi, check, repo.root);
		results.push(annotateBaselineResult(result, repoKey, baselineCache));
		ctx.ui.setStatus("preflight", undefined);
	}
	if (results.some((result) => result.status === "baseline")) writeBaselineCache(baselineCache);

	const totalDuration = Date.now() - start;
	const repoName = repo.root.split("/").pop() ?? "unknown";

	// Log
	appendLog({
		ts: new Date().toISOString(),
		epoch: Date.now(),
		type: "preflight_run",
		repo: repoName,
		repoKey,
		branch: repo.branch,
		filesChanged: changedFiles.length,
		filesChangedAreas: areas,
		checksPlanned: planned.map((c) => c.name),
		durationTotalMs: totalDuration,
		results,
	});

	// Display summary
	const summary = formatResults(results, totalDuration);
	const actionableFailures = results.filter((r) => r.status === "fail" || r.status === "timeout");
	ctx.ui.notify(summary, actionableFailures.length === 0 ? "info" : "warning");

	// Auto-analysis if actionable failures remain. Known baseline failures stay visible but do not re-open the repair loop.
	const failures = actionableFailures;
	if (failures.length > 0 && !skipAnalysis) {
		const analysisPrompt = buildAnalysisPrompt(failures, changedFiles, repo.branch);
		pi.sendUserMessage(analysisPrompt, { deliverAs: "followUp" });
	}
}

function buildAnalysisPrompt(failures: CheckResult[], changedFiles: string[], branch: string): string {
	const lines: string[] = [
		`[/preflight 자동 분석] 다음 ${failures.length}개 체크가 실패했습니다. 원인을 분석하고 어떻게 고칠지 제안해주세요.`,
		``,
		`현재 브랜치: ${branch}`,
		`변경 파일 ${changedFiles.length}개 중 일부:`,
		...changedFiles.slice(0, 10).map((f) => `  - ${f}`),
		changedFiles.length > 10 ? `  ... 외 ${changedFiles.length - 10}개` : "",
		``,
		`실패한 체크:`,
	];

	for (const f of failures) {
		lines.push("");
		lines.push(`### ${f.check} (${f.status}, ${formatDuration(f.durationMs)})`);
		if (f.failSummary) lines.push(`요약: ${f.failSummary}`);
		if (f.stderr) {
			lines.push("에러 출력:");
			lines.push("```");
			lines.push(f.stderr.slice(0, 1500));
			lines.push("```");
		}
	}

	return lines.filter(Boolean).join("\n");
}

// ─── Stats overlay ─────────────────────────────────────────────────────────

type Period = "day" | "week" | "month";
type Tab = "overview" | "checks" | "failures";

function periodCutoff(period: Period): number {
	const days = period === "day" ? 1 : period === "week" ? 7 : 30;
	return Date.now() - days * 24 * 60 * 60 * 1000;
}

function filterByPeriod(logs: RunLog[], period: Period): RunLog[] {
	const cutoff = periodCutoff(period);
	return logs.filter((l) => l.epoch >= cutoff);
}

function bar(value: number, max: number, width: number): string {
	if (max === 0) return " ".repeat(width);
	const filled = Math.round((value / max) * width);
	return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

function renderOverview(logs: RunLog[], period: Period, theme: { fg: (c: ThemeColor, t: string) => string }): string[] {
	const filtered = filterByPeriod(logs, period);
	if (filtered.length === 0) {
		return [theme.fg("border", `데이터 없음 (${period})`)];
	}

	const total = filtered.length;
	const allResults = filtered.flatMap((l) => l.results);
	const passed = filtered.filter((l) => l.results.every((r) => r.status === "pass" || r.status === "baseline")).length;
	const avgDuration = filtered.reduce((s, l) => s + l.durationTotalMs, 0) / total;

	const lines: string[] = [];
	lines.push(`총 실행: ${theme.fg("accent", String(total))}회`);
	lines.push(`성공률: ${theme.fg("success", `${Math.round((passed / total) * 100)}%`)} (${passed}/${total})`);
	lines.push(`평균 시간: ${formatDuration(avgDuration)}`);
	lines.push("");

	// Most run checks
	const checkCounts = new Map<string, number>();
	for (const r of allResults) {
		checkCounts.set(r.check, (checkCounts.get(r.check) ?? 0) + 1);
	}
	const sortedRun = [...checkCounts.entries()].sort((a, b) => b[1] - a[1]);
	const maxRun = sortedRun[0]?.[1] ?? 1;

	lines.push(theme.fg("accent", "자주 실행된 체크:"));
	for (const [name, count] of sortedRun.slice(0, 8)) {
		lines.push(`  ${name.padEnd(20)} ${bar(count, maxRun, 24)} ${count}`);
	}
	lines.push("");

	// Most failed
	const failCounts = new Map<string, { fail: number; total: number }>();
	for (const r of allResults) {
		const cur = failCounts.get(r.check) ?? { fail: 0, total: 0 };
		cur.total++;
		if (r.status === "fail" || r.status === "timeout") cur.fail++;
		failCounts.set(r.check, cur);
	}
	const sortedFail = [...failCounts.entries()].filter(([, v]) => v.fail > 0).sort((a, b) => b[1].fail - a[1].fail);

	if (sortedFail.length > 0) {
		lines.push(theme.fg("error", "자주 실패한 체크:"));
		const maxFail = sortedFail[0][1].fail;
		for (const [name, { fail, total }] of sortedFail.slice(0, 5)) {
			const pct = Math.round((fail / total) * 100);
			lines.push(`  ${name.padEnd(20)} ${theme.fg("error", bar(fail, maxFail, 24))} ${fail}/${total} (${pct}%)`);
		}
	}

	return lines;
}

function renderChecks(logs: RunLog[], period: Period, theme: { fg: (c: ThemeColor, t: string) => string }): string[] {
	const filtered = filterByPeriod(logs, period);
	const allResults = filtered.flatMap((l) => l.results);

	const stats = new Map<string, { count: number; pass: number; baseline: number; fail: number; totalMs: number; minMs: number; maxMs: number }>();
	for (const r of allResults) {
		const cur = stats.get(r.check) ?? { count: 0, pass: 0, baseline: 0, fail: 0, totalMs: 0, minMs: Number.POSITIVE_INFINITY, maxMs: 0 };
		cur.count++;
		if (r.status === "pass") cur.pass++;
		else if (r.status === "baseline") cur.baseline++;
		else cur.fail++;
		cur.totalMs += r.durationMs;
		cur.minMs = Math.min(cur.minMs, r.durationMs);
		cur.maxMs = Math.max(cur.maxMs, r.durationMs);
		stats.set(r.check, cur);
	}

	const lines: string[] = [];
	if (stats.size === 0) return [theme.fg("border", `데이터 없음`)];

	lines.push("체크".padEnd(22) + "실행".padStart(6) + "성공".padStart(6) + "베이스".padStart(8) + "실패".padStart(6) + "평균".padStart(10) + "최소".padStart(10) + "최대".padStart(10));
	for (const [name, s] of [...stats.entries()].sort((a, b) => b[1].count - a[1].count)) {
		const avg = s.totalMs / s.count;
		lines.push(
			name.padEnd(22) +
			String(s.count).padStart(6) +
			theme.fg("success", String(s.pass).padStart(6)) +
			theme.fg("warning", String(s.baseline).padStart(8)) +
			theme.fg(s.fail > 0 ? "error" : "muted", String(s.fail).padStart(6)) +
			formatDuration(avg).padStart(10) +
			formatDuration(s.minMs).padStart(10) +
			formatDuration(s.maxMs).padStart(10),
		);
	}
	return lines;
}

function renderFailures(logs: RunLog[], period: Period, theme: { fg: (c: ThemeColor, t: string) => string }): string[] {
	const filtered = filterByPeriod(logs, period);
	const failures = filtered.flatMap((l) => l.results.filter((r) => r.status === "fail" || r.status === "timeout").map((r) => ({ ...r, branch: l.branch, ts: l.ts })));

	if (failures.length === 0) return [theme.fg("success", `실패 없음 (${period})`)];

	// Group by failSummary (rough clustering)
	const clusters = new Map<string, { check: string; count: number; samples: string[]; firstTs: string }>();
	for (const f of failures) {
		const key = `${f.check}:${(f.failSummary ?? "").slice(0, 60)}`;
		const cur = clusters.get(key) ?? { check: f.check, count: 0, samples: [], firstTs: f.ts };
		cur.count++;
		if (cur.samples.length < 3 && f.failSummary) cur.samples.push(f.failSummary);
		clusters.set(key, cur);
	}

	const sorted = [...clusters.values()].sort((a, b) => b.count - a.count);

	const lines: string[] = [];
	lines.push(`${failures.length}건 실패, ${sorted.length}개 패턴 (period: ${period})`);
	lines.push("");

	for (const c of sorted.slice(0, 10)) {
		lines.push(`${theme.fg("error", `[${c.count}회]`)} ${theme.fg("accent", c.check)}`);
		for (const s of c.samples) {
			lines.push(`  ${s.slice(0, 80)}`);
		}
		lines.push("");
	}

	return lines;
}

async function showStatsOverlay(ctx: ExtensionCommandContext) {
	const logs = readAllLogs();

	if (!ctx.hasUI) {
		ctx.ui.notify(`Stats overlay requires UI. Logs: ${logs.length} entries`, "warning");
		return;
	}

	let tab: Tab = "overview";
	let period: Period = "week";
	let scrollOffset = 0;

	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			const renderTabs = () => {
				const t = (label: string, t2: Tab, key: string) =>
					tab === t2 ? theme.fg("accent", theme.bold(`[${key}] ${label}`)) : theme.fg("border", `[${key}] ${label}`);
				return `${t("Overview", "overview", "1")}  ${t("Checks", "checks", "2")}  ${t("Failures", "failures", "3")}`;
			};
			const renderPeriod = () => {
				const p = (label: string, p2: Period, key: string) =>
					period === p2 ? theme.fg("accent", theme.bold(`[${key}] ${label}`)) : theme.fg("border", `[${key}] ${label}`);
				return `Period: ${p("Day", "day", "d")} ${p("Week", "week", "w")} ${p("Month", "month", "m")}`;
			};

			return {
				render: (w: number) => {
					const lines: string[] = [];
					lines.push(theme.fg("accent", "─".repeat(w)));
					lines.push(`  ${theme.bold("Preflight Stats")}  ${renderTabs()}                  ${renderPeriod()}`);
					lines.push(theme.fg("accent", "─".repeat(w)));

					const body =
						tab === "overview" ? renderOverview(logs, period, theme) :
						tab === "checks" ? renderChecks(logs, period, theme) :
						renderFailures(logs, period, theme);

					const visibleHeight = Math.max(5, ((tui as any).terminal?.rows ?? 30) - 6);
					const maxOffset = Math.max(0, body.length - visibleHeight);
					if (scrollOffset > maxOffset) scrollOffset = maxOffset;

					for (let i = scrollOffset; i < Math.min(body.length, scrollOffset + visibleHeight); i++) {
						lines.push(truncateToWidth(body[i], w, ""));
					}

					lines.push(theme.fg("accent", "─".repeat(w)));
					lines.push(`  ${theme.fg("border", "↑↓/jk 스크롤  ·  1/2/3 탭  ·  d/w/m 기간  ·  q/Esc 닫기")}`);

					return lines;
				},
				handleInput: (data: string) => {
					if (data === "q" || matchesKey(data, Key.escape)) { done(undefined); return; }
					if (data === "1") tab = "overview";
					else if (data === "2") tab = "checks";
					else if (data === "3") tab = "failures";
					else if (data === "d") period = "day";
					else if (data === "w") period = "week";
					else if (data === "m") period = "month";
					else if (matchesKey(data, Key.up) || data === "k") scrollOffset = Math.max(0, scrollOffset - 1);
					else if (matchesKey(data, Key.down) || data === "j") scrollOffset++;
					else if (matchesKey(data, Key.pageUp)) scrollOffset = Math.max(0, scrollOffset - 10);
					else if (matchesKey(data, Key.pageDown)) scrollOffset += 10;
					(tui as any).requestRender?.();
				},
				invalidate: () => {},
			};
		},
		{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
	);
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
		label: "Preflight Baseline",
		description: "Automatically inspect/list or record known unrelated validation baseline failures after lint/typecheck/test/build failures. Use this tool yourself; do not ask the user to run /preflight baseline.",
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

	pi.registerCommand("preflight", {
		description: "Run CI-equivalent checks locally. Subcommands: stats, baseline list/add-last/clear/prune",
		handler: (args, ctx) => handlePreflight(pi, args, ctx),
	});
}
