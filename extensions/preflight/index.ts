import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { expandProfileTemplate, loadPreflightProfiles, type PreflightCheckProfile, type PreflightProfile } from "../utils/private-profiles.ts";

// ─── Config ────────────────────────────────────────────────────────────────

const LOG_FILE = join(homedir(), ".pi", "agent", "state", "preflight-analytics.jsonl");
const MAX_LOG_AGE_DAYS = 180;

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

type CheckStatus = "pass" | "fail" | "timeout" | "skip";

interface CheckResult {
	check: string;
	status: CheckStatus;
	durationMs: number;
	failSummary?: string;
	stderr?: string;
}

interface RunLog {
	ts: string;
	epoch: number;
	type: "preflight_run";
	repo: string;
	branch: string;
	filesChanged: number;
	filesChangedAreas: string[];
	checksPlanned: string[];
	durationTotalMs: number;
	results: CheckResult[];
}

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
	const total = results.length;

	const lines: string[] = [];
	lines.push(`✅ Preflight ${passed}/${total} passed (${formatDuration(totalDuration)})`);
	lines.push("");

	for (const r of results) {
		const icon = r.status === "pass" ? "✓" : r.status === "skip" ? "⊘" : "✗";
		lines.push(`${icon} ${r.check.padEnd(22)} ${formatDuration(r.durationMs).padStart(8)}${r.failSummary ? ` — ${r.failSummary.slice(0, 100)}` : ""}`);
	}

	const failures = results.filter((r) => r.status === "fail" || r.status === "timeout");
	if (failures.length > 0) {
		lines.push("");
		lines.push(`Failed: ${failures.map((f) => f.check).join(", ")}`);
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

	// Run sequentially with progress notification
	for (const check of planned) {
		ctx.ui.setStatus("preflight", `running ${check.name}…`);
		const result = await runCheck(pi, check, repo.root);
		results.push(result);
		ctx.ui.setStatus("preflight", undefined);
	}

	const totalDuration = Date.now() - start;
	const repoName = repo.root.split("/").pop() ?? "unknown";

	// Log
	appendLog({
		ts: new Date().toISOString(),
		epoch: Date.now(),
		type: "preflight_run",
		repo: repoName,
		branch: repo.branch,
		filesChanged: changedFiles.length,
		filesChangedAreas: areas,
		checksPlanned: planned.map((c) => c.name),
		durationTotalMs: totalDuration,
		results,
	});

	// Display summary
	const summary = formatResults(results, totalDuration);
	ctx.ui.notify(summary, results.every((r) => r.status === "pass") ? "info" : "warning");

	// Auto-analysis if failures
	const failures = results.filter((r) => r.status === "fail" || r.status === "timeout");
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
	const passed = filtered.filter((l) => l.results.every((r) => r.status === "pass")).length;
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

	const stats = new Map<string, { count: number; pass: number; fail: number; totalMs: number; minMs: number; maxMs: number }>();
	for (const r of allResults) {
		const cur = stats.get(r.check) ?? { count: 0, pass: 0, fail: 0, totalMs: 0, minMs: Number.POSITIVE_INFINITY, maxMs: 0 };
		cur.count++;
		if (r.status === "pass") cur.pass++;
		else cur.fail++;
		cur.totalMs += r.durationMs;
		cur.minMs = Math.min(cur.minMs, r.durationMs);
		cur.maxMs = Math.max(cur.maxMs, r.durationMs);
		stats.set(r.check, cur);
	}

	const lines: string[] = [];
	if (stats.size === 0) return [theme.fg("border", `데이터 없음`)];

	lines.push("체크".padEnd(22) + "실행".padStart(6) + "성공".padStart(6) + "실패".padStart(6) + "평균".padStart(10) + "최소".padStart(10) + "최대".padStart(10));
	for (const [name, s] of [...stats.entries()].sort((a, b) => b[1].count - a[1].count)) {
		const avg = s.totalMs / s.count;
		lines.push(
			name.padEnd(22) +
			String(s.count).padStart(6) +
			theme.fg("success", String(s.pass).padStart(6)) +
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
	pi.registerCommand("preflight", {
		description: "Run CI-equivalent checks locally (smart selection by changed files). Subcommand: stats",
		handler: (args, ctx) => handlePreflight(pi, args, ctx),
	});
}
