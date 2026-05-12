import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync, rmSync, renameSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, SessionManager } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import {
	expandProfileTemplate,
	loadConductorProfiles,
	loadWorktreeRepoProfiles,
	type WorktreeBootstrapDomainProfile,
	type WorktreeRepoProfile,
} from "../utils/private-profiles.ts";
import { discoverAgents } from "../subagent/agents.ts";
import { getFinalOutput, runSingleAgent } from "../subagent/runner.ts";
import { makeSubagentSessionFile } from "../subagent/session.ts";
import type { SingleResult, SubagentDetails } from "../subagent/types.ts";
import { resolveForkPanelIdentity } from "../utils/fork-panel-identity.ts";

// ─── Repo registry ─────────────────────────────────────────────────────────

const REGISTRY_PATH = join(homedir(), ".pi", "worktree-repos.json");

interface RepoRegistry {
	[name: string]: string; // name → absolute path
}

function loadRegistry(): RepoRegistry {
	if (!existsSync(REGISTRY_PATH)) return {};
	try { return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")); } catch { return {}; }
}

function saveRegistry(reg: RepoRegistry) {
	mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
	writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

function realPathForCompare(path: string): string {
	try { return realpathSync.native(path); } catch { return path; }
}

function samePath(a: string, b: string): boolean {
	return realPathForCompare(a) === realPathForCompare(b);
}

function findRegisteredName(reg: RepoRegistry, repoPath: string): string | null {
	for (const [name, path] of Object.entries(reg)) {
		if (samePath(path, repoPath)) return name;
	}
	return null;
}

function autoRegister(repoRoot: string): { name: string; isNew: boolean } {
	const reg = loadRegistry();
	const existing = findRegisteredName(reg, repoRoot);
	if (existing) return { name: existing, isNew: false };

	let name = basename(repoRoot);
	// Avoid name collision
	let suffix = 1;
	while (reg[name]) {
		name = `${basename(repoRoot)}-${++suffix}`;
	}
	reg[name] = repoRoot;
	saveRegistry(reg);
	return { name, isNew: true };
}

// ─── Config ────────────────────────────────────────────────────────────────

interface WorktreeConfig {
	rootDir: string;
	baseBranch: string;
	productionBranch: string;
	branchPrefix: string;
	setupScript?: string;
	autoOpenInGhostty: boolean;
	ghosttyDirection: "right" | "left" | "down" | "up" | "tab";
	namingScheme: "pokemon" | "city" | "none";
}

const DEFAULT_CONFIG: WorktreeConfig = {
	rootDir: join(homedir(), ".pi", "worktrees"),
	baseBranch: "main",
	productionBranch: "production",
	branchPrefix: "feature",
	autoOpenInGhostty: true,
	ghosttyDirection: "tab",
	namingScheme: "pokemon",
};

function expandHome(p: string): string {
	return p.startsWith("~/") ? join(homedir(), p.slice(2)) : p;
}

async function findRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	return r.code === 0 ? (r.stdout ?? "").trim() || null : null;
}

async function canonicalRepoRoot(pi: ExtensionAPI, repoRoot: string): Promise<string> {
	const worktrees = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
	if (worktrees.code === 0) {
		const main = (worktrees.stdout ?? "").split("\n").find((line) => line.startsWith("worktree "))?.slice("worktree ".length).trim();
		if (main && existsSync(main)) return realPathForCompare(main);
	}
	return realPathForCompare(repoRoot);
}

async function findCanonicalRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const repoRoot = await findRepoRoot(pi, cwd);
	return repoRoot ? canonicalRepoRoot(pi, repoRoot) : null;
}

function getRepoName(repoRoot: string): string {
	return basename(repoRoot);
}

function configPath(repoRoot: string): string {
	return join(repoRoot, ".pi", "worktree.json");
}

function profileConfigDefaults(repoRoot: string): Partial<WorktreeConfig> {
	const profile = getProfiledRepoSync(repoRoot);
	if (!profile) return {};
	return {
		rootDir: profile.rootDir ? expandProfileTemplate(profile.rootDir, { repo: profile.name, repoRoot }) : undefined,
		baseBranch: profile.baseBranch,
		productionBranch: profile.productionBranch,
		branchPrefix: profile.branchPrefix,
		setupScript: profile.setupScript,
		autoOpenInGhostty: profile.autoOpenInGhostty,
		ghosttyDirection: profile.ghosttyDirection,
		namingScheme: profile.namingScheme,
	};
}

function compactWorktreeConfig(config: Partial<WorktreeConfig>): Partial<WorktreeConfig> {
	return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)) as Partial<WorktreeConfig>;
}

function defaultConfigForRepo(repoRoot: string): WorktreeConfig {
	const profileDefaults = compactWorktreeConfig(profileConfigDefaults(repoRoot));
	const rootDir = profileDefaults.rootDir ?? join(DEFAULT_CONFIG.rootDir, getRepoName(repoRoot));
	return { ...DEFAULT_CONFIG, ...profileDefaults, rootDir };
}

function loadConfig(repoRoot: string): WorktreeConfig {
	const p = configPath(repoRoot);
	const defaults = defaultConfigForRepo(repoRoot);
	if (!existsSync(p)) return defaults;
	try {
		const data = JSON.parse(readFileSync(p, "utf8"));
		return { ...defaults, ...data, rootDir: expandHome(data.rootDir ?? defaults.rootDir) };
	} catch {
		return defaults;
	}
}

function saveConfig(repoRoot: string, config: WorktreeConfig) {
	const p = configPath(repoRoot);
	mkdirSync(dirname(p), { recursive: true });
	const out = { ...config };
	if (out.rootDir.startsWith(homedir())) out.rootDir = `~${out.rootDir.slice(homedir().length)}`;
	writeFileSync(p, JSON.stringify(out, null, 2));
}

// ─── Pokemon names (1세대 151마리) ─────────────────────────────────────────

const POKEMONS_GEN1 = [
	"이상해씨", "이상해풀", "이상해꽃", "파이리", "리자드", "리자몽", "꼬부기", "어니부기", "거북왕",
	"캐터피", "단데기", "버터플", "뿔충이", "딱충이", "독침붕", "구구", "피죤", "피죤투", "꼬렛", "레트라",
	"깨비참", "깨비드릴조", "아보", "아보크", "피카츄", "라이츄", "모래두지", "고지", "니드런♀", "니드리나",
	"니드퀸", "니드런♂", "니드리노", "니드킹", "삐삐", "픽시", "식스테일", "나인테일", "푸린", "푸크린",
	"주뱃", "골뱃", "뚜벅쵸", "냄새꼬", "라플레시아", "파라스", "파라섹트", "콘팡", "도나리", "디그다",
	"닥트리오", "나옹", "페르시온", "고라파덕", "골덕", "망키", "성원숭", "가디", "윈디", "발챙이",
	"슈륙챙이", "강챙이", "캐이시", "윤겔라", "후딘", "알통몬", "근육몬", "괴력몬", "모다피", "우츠동",
	"우츠보트", "왕눈해", "독파리", "꼬마돌", "데구리", "딱구리", "포니타", "날쌩마", "야돈", "야도란",
	"코일", "레어코일", "파오리", "두두", "두트리오", "쥬쥬", "쥬레곤", "질뻐기", "질뻐꾸기", "셀러",
	"파르셀", "고오스", "고우스트", "팬텀", "롱스톤", "슬리프", "슬리퍼", "크랩", "킹크랩", "찌리리공",
	"붐볼", "아라리", "나시", "탕구리", "텅구리", "시라소몬", "홍수몬", "내루미", "또가스", "또도가스",
	"뿔카노", "코뿌리", "럭키", "덩쿠리", "캥카", "쏘드라", "시드라", "콘치", "왕콘치", "별가사리",
	"아쿠스타", "마임맨", "스라크", "루주라", "에레브", "마그마", "쁘사이저", "켄타로스", "잉어킹",
	"갸라도스", "라프라스", "메타몽", "이브이", "샤미드", "쥬피썬더", "부스터", "폴리곤", "암나이트",
	"암스타", "투구", "투구푸스", "프테라", "잠만보", "프리져", "썬더", "파이어", "미뇽", "신뇽",
	"망나뇽", "뮤츠", "뮤"
];

const CITIES = [
	"manila", "vancouver", "tokyo", "seoul", "paris", "london", "tokyo", "denpasar",
	"chennai", "bandung", "houston", "abuja", "damascus", "zagreb", "douala", "budapest",
	"abu-dhabi", "san-juan", "albuquerque", "kigali", "monrovia", "munich", "madrid",
	"managua", "rabat", "lima", "atlanta", "amarillo", "algiers", "barcelona",
];

function pickName(scheme: WorktreeConfig["namingScheme"], existing: Set<string>): string {
	if (scheme === "none") return `wt-${Date.now().toString(36)}`;
	const pool = scheme === "pokemon" ? POKEMONS_GEN1 : CITIES;
	const available = pool.filter((n) => !existing.has(n));
	if (available.length === 0) return `${pool[Math.floor(Math.random() * pool.length)]}-${Date.now().toString(36).slice(-4)}`;
	return available[Math.floor(Math.random() * available.length)];
}

// ─── Metadata ──────────────────────────────────────────────────────────────

type WorktreeStatus = "backlog" | "active" | "done" | "archived";

interface WorktreeMeta {
	name: string;
	branch: string;
	baseBranch: string;
	createdAt: number;
	ticket?: string;
	note?: string;
	status?: WorktreeStatus;
	tags?: string[];
	doneAt?: number;
	frame?: {
		path: string;
		updatedAt: number;
		summary?: string;
		canonicalHash?: string;
		sourcePlanningFrame?: string;
	};
}

function metaPath(worktreePath: string): string {
	return join(worktreePath, ".pi", "worktree-meta.json");
}

function readMeta(worktreePath: string): WorktreeMeta | null {
	const p = metaPath(worktreePath);
	if (!existsSync(p)) return null;
	try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function writeMeta(worktreePath: string, meta: WorktreeMeta) {
	const p = metaPath(worktreePath);
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, JSON.stringify(meta, null, 2));
}

const FRAME_PLANNING_ROOT = join(homedir(), ".pi", "agent", "frame-planning");

type FrameDocLoose = Record<string, any>;

type FramePromotionResult =
	| { status: "promoted"; framePath: string; frameMdPath: string; sourcePath: string; canonicalHash?: string }
	| { status: "exists"; framePath: string }
	| { status: "missing-source" }
	| { status: "error"; error: string };

function safeFrameSlug(text: string): string {
	return text
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "untitled";
}

function planningFramePathForTicket(ticket: string | undefined): string | null {
	if (!ticket?.trim()) return null;
	return join(FRAME_PLANNING_ROOT, safeFrameSlug(`planning:ticket:${ticket.trim()}`), "frame.json");
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		const object = value as Record<string, unknown>;
		return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

function frameCanonicalHash(frame: FrameDocLoose): string {
	const copy = JSON.parse(JSON.stringify(frame));
	if (copy.provenance && typeof copy.provenance === "object") copy.provenance.canonicalHash = "";
	return createHash("sha256").update(stableStringify(copy)).digest("hex");
}

function worktreeFrameIdentityKey(worktreePath: string): string {
	return `worktree:${createHash("sha1").update(worktreePath).digest("hex").slice(0, 10)}`;
}

function renderFrameMirror(frame: FrameDocLoose): string {
	const list = (items: unknown[] | undefined) => (items?.length ? items.map((item) => `- ${String(item)}`).join("\n") : "- (none)");
	const successCriteria = Array.isArray(frame.success_criteria) ? frame.success_criteria : [];
	const risks = Array.isArray(frame.risk_register) ? frame.risk_register : [];
	const commands = Array.isArray(frame.verify_plan?.commands) ? frame.verify_plan.commands : [];
	const manualChecks = Array.isArray(frame.verify_plan?.manual_checks) ? frame.verify_plan.manual_checks : [];
	const plan = frame.implementation_plan;
	const planLines = plan && typeof plan === "object"
		? [
			"## Implementation plan synthesis",
			`- status: \`${plan.status ?? "draft"}\``,
			plan.firstSafeStep ? `- firstSafeStep: ${plan.firstSafeStep}` : undefined,
			Array.isArray(plan.gates) && plan.gates.length ? `- gates:\n${list(plan.gates)}` : undefined,
		].filter(Boolean).join("\n")
		: "";
	return [
		`# Frame — ${frame.ticket?.key ?? frame.identity?.displayTitle ?? frame.workspace ?? "worktree"}`,
		"",
		"> Generated from frame.json. Do not edit as source.",
		"",
		`- canonicalHash: \`${frame.provenance?.canonicalHash ?? ""}\``,
		`- updatedAt: \`${frame.updatedAt ?? ""}\``,
		frame.provenance?.transcriptPath ? `- transcriptPath: \`${frame.provenance.transcriptPath}\`` : undefined,
		frame.links?.jira ? `- Jira: ${frame.links.jira}` : undefined,
		"",
		"## Goal",
		frame.goal ?? "",
		"",
		"## Success criteria",
		...successCriteria.map((sc: any) => `- **${sc.id ?? "SC"}**: ${sc.statement ?? ""}${sc.evidence_locator ? `  \\\n  Evidence: \`${sc.evidence_locator}\`` : ""}${sc.verify_command ? `  \\\n  Verify: \`${sc.verify_command}\`` : ""}`),
		"",
		"## Out of scope",
		list(frame.out_of_scope),
		"",
		"## Risks",
		...(risks.length ? risks.map((risk: any) => `- **${risk.id ?? "RISK"}** (${risk.severity ?? "?"}): ${risk.risk ?? ""}  \\\n  Mitigation: ${risk.mitigation ?? ""}`) : ["- (none)"]),
		"",
		"## Verify plan",
		"### Commands",
		list(commands),
		"",
		"### Manual checks",
		list(manualChecks),
		"",
		planLines || undefined,
	].filter((line): line is string => line !== undefined).join("\n");
}

function promotePlanningFrameToWorktree(worktreePath: string, meta: WorktreeMeta): FramePromotionResult {
	const targetFramePath = join(worktreePath, ".pi", "frame.json");
	const targetMdPath = join(worktreePath, ".pi", "frame.md");
	if (existsSync(targetFramePath)) return { status: "exists", framePath: targetFramePath };

	const sourcePath = planningFramePathForTicket(meta.ticket);
	if (!sourcePath || !existsSync(sourcePath)) return { status: "missing-source" };

	try {
		const frame = JSON.parse(readFileSync(sourcePath, "utf8")) as FrameDocLoose;
		const now = Date.now();
		const originalIdentity = frame.identity && typeof frame.identity === "object" ? { ...frame.identity } : undefined;
		frame.identity = {
			...(originalIdentity ?? {}),
			mode: "worktree",
			key: worktreeFrameIdentityKey(worktreePath),
			displayTitle: `Frame · ${meta.name}${meta.ticket ? ` · ${meta.ticket}` : ""}`,
			promotedToWorktree: worktreePath,
		};
		frame.workspace = meta.name;
		frame.worktree = worktreePath;
		frame.updatedAt = now;
		frame.provenance = {
			...(frame.provenance ?? {}),
			canonicalHash: "",
			generatedMirrors: {
				...(frame.provenance?.generatedMirrors ?? {}),
				frame_md: targetMdPath,
			},
			notes: [
				...((Array.isArray(frame.provenance?.notes) ? frame.provenance.notes : []) as string[]),
				`Promoted from planning frame ${sourcePath} to worktree ${worktreePath}.`,
				originalIdentity?.key ? `Original planning identity: ${originalIdentity.key}.` : undefined,
			].filter((note): note is string => Boolean(note)),
		};
		frame.provenance.canonicalHash = frameCanonicalHash(frame);

		mkdirSync(dirname(targetFramePath), { recursive: true });
		const tmp = `${targetFramePath}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(frame, null, 2)}\n`);
		renameSync(tmp, targetFramePath);
		writeFileSync(targetMdPath, renderFrameMirror(frame));

		const nextMeta = readMeta(worktreePath) ?? meta;
		writeMeta(worktreePath, {
			...nextMeta,
			frame: {
				path: targetFramePath,
				updatedAt: now,
				summary: typeof frame.goal === "string" ? frame.goal.slice(0, 160) : undefined,
				canonicalHash: frame.provenance.canonicalHash,
				sourcePlanningFrame: sourcePath,
			},
		});

		return { status: "promoted", framePath: targetFramePath, frameMdPath: targetMdPath, sourcePath, canonicalHash: frame.provenance.canonicalHash };
	} catch (error) {
		return { status: "error", error: error instanceof Error ? error.message : String(error) };
	}
}

function framePromotionContextLabel(result: FramePromotionResult): string {
	if (result.status === "promoted") return " — frame promoted";
	return "";
}

// ─── Worktree operations ───────────────────────────────────────────────────

interface ExistingWorktree {
	name: string;
	path: string;
	branch: string;
	meta: WorktreeMeta | null;
}

function listExistingWorktrees(rootDir: string): ExistingWorktree[] {
	if (!existsSync(rootDir)) return [];
	const result: ExistingWorktree[] = [];
	for (const entry of readdirSync(rootDir)) {
		const path = join(rootDir, entry);
		try {
			if (!statSync(path).isDirectory()) continue;
			const meta = readMeta(path);
			result.push({ name: entry, path, branch: meta?.branch ?? "?", meta });
		} catch {}
	}
	return result.sort((a, b) => (b.meta?.createdAt ?? 0) - (a.meta?.createdAt ?? 0));
}

async function getWorktreeStatus(pi: ExtensionAPI, path: string): Promise<{ changes: number; ahead: number; behind: number } | null> {
	const status = await pi.exec("git", ["status", "--porcelain"], { cwd: path });
	if (status.code !== 0) return null;
	const changes = status.stdout?.trim().split("\n").filter(Boolean).length ?? 0;

	const ahead_behind = await pi.exec("git", ["rev-list", "--left-right", "--count", "HEAD...@{u}"], { cwd: path });
	let ahead = 0, behind = 0;
	if (ahead_behind.code === 0 && ahead_behind.stdout) {
		const parts = ahead_behind.stdout.trim().split(/\s+/);
		ahead = Number.parseInt(parts[0] ?? "0");
		behind = Number.parseInt(parts[1] ?? "0");
	}
	return { changes, ahead, behind };
}

// ─── Argument parsing ──────────────────────────────────────────────────────

interface NewArgs {
	name?: string;
	hotfix: boolean;
	hotfeature: boolean;
	carryContext: boolean;
	from?: string;
	ticket?: string;
	note?: string;
	branch?: string;
	repo?: string;
	contextFile?: string;
}

function tokenize(args: string): string[] {
	const tokens: string[] = [];
	let cur = "";
	let inQuote = false;
	for (const c of args) {
		if (c === '"') { inQuote = !inQuote; continue; }
		if (c === " " && !inQuote) {
			if (cur) tokens.push(cur);
			cur = "";
			continue;
		}
		cur += c;
	}
	if (cur) tokens.push(cur);
	return tokens;
}

function parseNewArgs(args: string): NewArgs {
	const tokens = tokenize(args);
	const result: NewArgs = { hotfix: false, hotfeature: false, carryContext: false };
	const positional: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === "--hotfix") result.hotfix = true;
		else if (t === "--hotfeature") result.hotfeature = true;
		else if (t === "--carry-context" || t === "--context" || t === "--fork-current") result.carryContext = true;
		else if (t === "--from" && i + 1 < tokens.length) result.from = tokens[++i];
		else if (t === "--ticket" && i + 1 < tokens.length) result.ticket = tokens[++i];
		else if (t === "--note" && i + 1 < tokens.length) result.note = tokens[++i];
		else if (t === "--branch" && i + 1 < tokens.length) result.branch = tokens[++i];
		else if (t === "--repo" && i + 1 < tokens.length) result.repo = tokens[++i];
		else if (t === "--context-file" && i + 1 < tokens.length) result.contextFile = tokens[++i];
		else positional.push(t);
	}
	if (positional.length > 0) result.name = positional[0];
	return result;
}

function sessionDirForWorktree(worktreePath: string): string {
	const pathEncoded = "--" + worktreePath.slice(1).replace(/\//g, "-") + "--";
	return join(homedir(), ".pi", "agent", "sessions", pathEncoded);
}

function createEmptySessionFile(worktreePath: string): string {
	const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	const sessionDir = sessionDirForWorktree(worktreePath);
	mkdirSync(sessionDir, { recursive: true });
	const sessionFile = join(sessionDir, `${Date.now()}_${sessionId}.jsonl`);
	writeFileSync(sessionFile, JSON.stringify({
		type: "session", version: 3, id: sessionId,
		timestamp: new Date().toISOString(), cwd: worktreePath,
	}) + "\n");
	return sessionFile;
}

function appendWorktreeContext(session: SessionManager, context: string, source: string) {
	if (!context.trim()) return;
	session.appendCustomMessageEntry(
		"worktree-context",
		`## 워크트리 인계 컨텍스트\n\n${context.trim()}`,
		true,
		{ source },
	);
}

function createWorktreeSession(ctx: ExtensionContext, worktreePath: string, options: {
	carryContext?: boolean;
	contextContent?: string | null;
	sessionName?: string;
} = {}): { sessionFile: string; carriedContext: boolean; appendedContext: boolean } {
	let session: SessionManager | null = null;
	let sessionFile: string | undefined;
	let carriedContext = false;

	const sourceSessionFile = ctx.sessionManager.getSessionFile();
	if (options.carryContext && sourceSessionFile && existsSync(sourceSessionFile)) {
		try {
			session = SessionManager.forkFrom(sourceSessionFile, worktreePath);
			sessionFile = session.getSessionFile();
			carriedContext = true;
		} catch {
			// Fall back to an empty target session; callers still get an actionable session file.
		}
	}

	if (!session || !sessionFile) {
		sessionFile = createEmptySessionFile(worktreePath);
		session = SessionManager.open(sessionFile);
	}

	if (options.sessionName) session.appendSessionInfo(options.sessionName);
	const appendedContext = Boolean(options.contextContent?.trim());
	if (options.contextContent) appendWorktreeContext(session, options.contextContent, "worktree");

	return { sessionFile, carriedContext, appendedContext };
}

function readContextFileOption(ctx: ExtensionContext, path?: string): string | null {
	if (!path) return null;
	const expanded = expandHome(path);
	if (!existsSync(expanded)) {
		ctx.ui.notify(`Context file not found: ${expanded}`, "error");
		return null;
	}
	return readFileSync(expanded, "utf8");
}

function prefillSwitchCommand(ctx: ExtensionContext, command: string): boolean {
	if (!ctx.hasUI) return false;
	ctx.ui.setEditorText(command);
	return true;
}

function markConductorContextLoaded(worktreePath: string): boolean {
	const contextFile = join(worktreePath, ".pi", "conductor-context.md");
	if (!existsSync(contextFile)) return false;
	const loadedFile = contextFile.replace(".md", ".loaded.md");
	try {
		rmSync(loadedFile, { force: true });
		renameSync(contextFile, loadedFile);
		return true;
	} catch {
		return false;
	}
}

function worktreeCwdBindingMessage(wtName: string, wtPath: string, branch: string, contextLabel = ""): string {
	return [
		"## Worktree cwd binding",
		"",
		`활성 worktree: ${wtName}`,
		`절대경로: ${wtPath}`,
		`브랜치: ${branch}`,
		contextLabel ? `컨텍스트: ${contextLabel.replace(/^\s+—\s+/, "")}` : undefined,
		"",
		"세션 전환 후 특정 tool runner가 이전 `pwd`를 계속 보고하더라도, 위 절대경로를 source of truth로 보고 read/edit/bash/frame/verify artifact는 해당 경로 아래에서 수행한다. 세션 전환 자체가 실패한 경우가 아니라면 사용자에게 `/wt switch`를 다시 요구하지 않는다.",
	].filter(Boolean).join("\n");
}

async function switchSessionToWorktree(ctx: ExtensionCommandContext, sessionFile: string, wtName: string, wtPath: string, contextLabel = "") {
	const branch = readMeta(wtPath)?.branch ?? "unknown";
	await (ctx as any).switchSession(sessionFile, {
		cwdOverride: wtPath,
		withSession: async (newCtx: any) => {
			newCtx.ui.notify(`✓ ${wtName} (${branch})${contextLabel}`, "info");
			await newCtx.sendMessage?.(
				{
					customType: "worktree-cwd-binding",
					content: worktreeCwdBindingMessage(wtName, wtPath, branch, contextLabel),
					display: true,
					details: { name: wtName, path: wtPath, branch, contextLabel },
				},
				{ triggerTurn: false },
			);
		},
	});
}

function getProfiledWorktreeRepos(cwd?: string): WorktreeRepoProfile[] {
	return loadWorktreeRepoProfiles(cwd);
}

function profiledRepoLabel(): string {
	const names = getProfiledWorktreeRepos().map((profile) => profile.displayName ?? profile.name);
	return names.length ? names.join("/") : "profiled repos";
}

function regexTest(pattern: string, value: string): boolean {
	try { return new RegExp(pattern, "i").test(value); } catch { return false; }
}

function repoProfileMatches(profile: WorktreeRepoProfile, repoRoot: string, registeredName?: string | null, remoteUrl?: string | null): boolean {
	const match = profile.match ?? {};
	const normalizedPath = repoRoot.toLowerCase();
	const normalizedRemote = (remoteUrl ?? "").trim().toLowerCase().replace(/\.git$/, "");
	const nameCandidates = [registeredName, basename(repoRoot)].filter((value): value is string => Boolean(value));
	if (nameCandidates.some((name) => name === profile.name || (match.registeredNames ?? []).includes(name))) return true;
	if ((match.rootBasenames ?? []).includes(basename(repoRoot))) return true;
	if ((match.pathIncludes ?? []).some((part) => normalizedPath.includes(expandProfileTemplate(part).toLowerCase()))) return true;
	if ((match.pathRegexes ?? []).some((pattern) => regexTest(expandProfileTemplate(pattern), normalizedPath))) return true;
	if (normalizedRemote && (match.remoteIncludes ?? []).some((part) => normalizedRemote.includes(part.toLowerCase()))) return true;
	return false;
}

function getProfiledRepoSync(repoRoot: string): WorktreeRepoProfile | null {
	const registeredName = getKnownRepoName(repoRoot);
	return getProfiledWorktreeRepos(repoRoot).find((profile) => repoProfileMatches(profile, repoRoot, registeredName)) ?? null;
}

function getSessionFileFromContext(ctx?: unknown): string | null {
	const sessionManager = (ctx as { sessionManager?: { getSessionFile?: () => string | null } } | undefined)?.sessionManager;
	try { return sessionManager?.getSessionFile?.() ?? null; } catch { return null; }
}

function getCurrentPanelLabel(ctx?: unknown): string {
	return resolveForkPanelIdentity({ sessionFile: getSessionFileFromContext(ctx) }).panelLabel;
}

function isChildForkPanel(ctx?: unknown): boolean {
	const label = getCurrentPanelLabel(ctx);
	return /^P\d+$/i.test(label) && label.toUpperCase() !== "P0";
}

function getKnownRepoName(repoRoot: string): string {
	return findRegisteredName(loadRegistry(), repoRoot) ?? basename(repoRoot);
}

function getWorktreeCreationPanelGuardMessage(repoRoot: string, ctx?: unknown): string | null {
	if (!isChildForkPanel(ctx)) return null;
	const profile = getProfiledRepoSync(repoRoot);
	if (!profile?.gate?.requireParentPanel) return null;
	const panelLabel = getCurrentPanelLabel(ctx);
	const repoName = profile.displayName ?? profile.name;
	const hotfixHint = profile.gate.hotfixHint ?? (profile.gate.hotfixRequiresExplicitBase ? " 핫픽스라면 --hotfix를 함께 붙이세요." : "");
	return [
		`현재 패널은 ${panelLabel} fork panel입니다.`,
		`${repoName} worktree 생성은 부모 패널(P0)에서 /wt fork로 실행해야 대화 맥락과 base 선택이 깨지지 않습니다.`,
		`이 패널에서는 /handoff로 조사 결과를 부모에 넘긴 뒤, 부모에서 /wt fork --repo ${repoName}를 실행하세요.${hotfixHint}`,
	].join(" ");
}

function hasHotfixIntent(text?: string): boolean {
	return Boolean(text && /(핫픽스|\bhotfix\b|\bproduction\b|\bprod\b)/i.test(text));
}

function getHotfixBaseGuardMessage(
	opts: Pick<NewArgs, "hotfix" | "hotfeature" | "from" | "branch" | "note">,
	actionLabel: string,
): string | null {
	if (opts.hotfix || opts.hotfeature || opts.from) return null;
	const branch = opts.branch?.toLowerCase();
	if (!hasHotfixIntent(opts.note) && !hasHotfixIntent(opts.branch) && !branch?.startsWith("hotfix/")) return null;
	return `${actionLabel}: 핫픽스/production 의도가 보이지만 production base가 지정되지 않았습니다. --hotfix 또는 hotfix: true를 명시하세요.`;
}

// ─── Dependency bootstrap worker ───────────────────────────────────────────

type ProfiledRepoName = string;
type BootstrapDomain = string;
type BootstrapStatus = "running" | "success" | "failed";

interface BootstrapJob {
	cwd: string;
	repoName: ProfiledRepoName;
	domains: BootstrapDomain[];
	startedAt: number;
	status: BootstrapStatus;
	logPath: string;
	promise: Promise<void>;
	kind: "executor" | "subagent-orchestrator";
	agentName?: string;
	reportPath?: string;
	executorScriptPath?: string;
	sessionFile?: string;
}

const dependencyBootstrapJobs = new Map<string, BootstrapJob>();
const DEPENDENCY_BOOTSTRAP_STATUS_ID = "wt-deps";
const DEFAULT_EXPLORATORY_PROMPT_REGEX = "(확인해볼래|조사|분석|왜|어떤|궁금|찾아|알려|정리해|봐봐|look into|investigate|analy[sz]e|explain|why)";
const DEFAULT_IMPLEMENTATION_PROMPT_REGEX = "(구현|수정|작업|진행|이어서|마무리|고쳐|반영|검증|lint|test|커밋|푸시|pr|해줘|implement|fix|edit|change|continue|work on|verify|commit|push)";

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeRemoteUrl(url: string): string {
	return url.trim().replace(/\.git$/, "").toLowerCase();
}

async function detectProfiledRepo(pi: ExtensionAPI, repoRoot: string): Promise<WorktreeRepoProfile | null> {
	const registeredName = getKnownRepoName(repoRoot);
	let remoteUrl = "";
	const remote = await pi.exec("git", ["config", "--get", "remote.origin.url"], { cwd: repoRoot });
	if (remote.code === 0) remoteUrl = normalizeRemoteUrl(remote.stdout ?? "");
	return getProfiledWorktreeRepos(repoRoot).find((profile) => repoProfileMatches(profile, repoRoot, registeredName, remoteUrl)) ?? null;
}

function textMatches(pattern: string | undefined, text: string): boolean {
	if (!pattern) return false;
	return regexTest(pattern, text);
}

function isImplementationStartPrompt(prompt: string, profile?: WorktreeRepoProfile): boolean {
	const text = prompt.trim();
	if (!text || text.startsWith("/")) return false;
	const bootstrap = profile?.bootstrap;
	const exploratoryPattern = bootstrap?.exploratoryPromptRegex ?? DEFAULT_EXPLORATORY_PROMPT_REGEX;
	const implementationPattern = bootstrap?.implementationPromptRegex ?? DEFAULT_IMPLEMENTATION_PROMPT_REGEX;
	if (textMatches(exploratoryPattern, text)) return textMatches(implementationPattern, text);
	return textMatches(implementationPattern, text);
}

function bootstrapDomainProfiles(profile: WorktreeRepoProfile): WorktreeBootstrapDomainProfile[] {
	return profile.bootstrap?.domains ?? [];
}

function orderedBootstrapDomains(profile: WorktreeRepoProfile, domains: Iterable<string>): BootstrapDomain[] {
	const requested = new Set(domains);
	return bootstrapDomainProfiles(profile).map((domain) => domain.name).filter((name) => requested.has(name));
}

function getBootstrapDomains(profile: WorktreeRepoProfile, prompt: string, meta: WorktreeMeta | null): BootstrapDomain[] {
	const bootstrap = profile.bootstrap;
	const domainProfiles = bootstrapDomainProfiles(profile);
	if (!bootstrap?.enabled || domainProfiles.length === 0) return [];
	const text = `${prompt}\n${meta?.branch ?? ""}\n${meta?.ticket ?? ""}\n${meta?.note ?? ""}`.toLowerCase();
	const matched = new Set<string>();
	for (const rule of bootstrap.domainPromptRules ?? []) {
		if (regexTest(rule.regex, text)) matched.add(rule.domain);
	}
	const hasRoot = domainProfiles.some((domain) => domain.name === "root");
	if (matched.size > 0 && hasRoot) matched.add("root");
	const selected = matched.size > 0 ? matched : new Set(bootstrap.defaultDomains ?? domainProfiles.map((domain) => domain.name));
	return orderedBootstrapDomains(profile, selected);
}

function repoRelativePath(repoRoot: string, value: string | undefined): string {
	const expanded = expandProfileTemplate(value ?? ".", { repoRoot });
	return expanded.startsWith("/") ? expanded : join(repoRoot, expanded);
}

function missingBootstrapDomains(repoRoot: string, profile: WorktreeRepoProfile, domains: BootstrapDomain[]): BootstrapDomain[] {
	const byName = new Map(bootstrapDomainProfiles(profile).map((domain) => [domain.name, domain]));
	const missing: BootstrapDomain[] = [];
	for (const domainName of domains) {
		const domain = byName.get(domainName);
		if (!domain) continue;
		const marker = repoRelativePath(repoRoot, domain.marker);
		if (!existsSync(marker)) missing.push(domainName);
	}
	return missing;
}

function bootstrapStateDir(repoRoot: string): string {
	return join(repoRoot, ".pi", "deps-bootstrap");
}

function buildDependencyBootstrapScript(profile: WorktreeRepoProfile, domains: BootstrapDomain[], repoRoot: string, logPath: string, statusPath: string): string {
	const domainProfiles = bootstrapDomainProfiles(profile).filter((domain) => domains.includes(domain.name));
	const steps = domainProfiles.map((domain) => {
		const label = domain.label ?? `${domain.name} dependency install`;
		const marker = repoRelativePath(repoRoot, domain.marker);
		const stepCwd = repoRelativePath(repoRoot, domain.cwd ?? ".");
		return `if [ ! -e ${shellQuote(marker)} ]; then
  run_step ${shellQuote(label)} ${shellQuote(stepCwd)} ${shellQuote(domain.command)}
else
  echo "✓ ${label} ready"
fi`;
	}).join("\n");
	const domainList = domains.join(",");
	return `set -u
mkdir -p ${shellQuote(dirname(logPath))}
printf '{"status":"running","repo":"%s","domains":"%s","startedAt":"%s"}\n' ${shellQuote(profile.name)} ${shellQuote(domainList)} "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > ${shellQuote(statusPath)}
run_step() {
  label="$1"
  step_cwd="$2"
  step_cmd="$3"
  echo "[deps-bootstrap] $label" >> ${shellQuote(logPath)}
  if (cd "$step_cwd" && bash -lc "$step_cmd") >> ${shellQuote(logPath)} 2>&1; then
    echo "✓ $label"
  else
    code=$?
    printf '{"status":"failed","repo":"%s","step":"%s","exitCode":%s,"finishedAt":"%s","log":"%s"}\n' ${shellQuote(profile.name)} "$label" "$code" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${shellQuote(logPath)} > ${shellQuote(statusPath)}
    echo "✗ $label failed; see ${logPath}"
    exit "$code"
  fi
}
${steps}
printf '{"status":"success","repo":"%s","domains":"%s","finishedAt":"%s","log":"%s"}\n' ${shellQuote(profile.name)} ${shellQuote(domainList)} "$(date -u +%Y-%m-%dT%H:%M:%SZ)" ${shellQuote(logPath)} > ${shellQuote(statusPath)}
echo "${profile.name} bootstrap ready: ${domainList}"`;
}

function readBootstrapStatus(statusPath: string): Record<string, unknown> | null {
	if (!existsSync(statusPath)) return null;
	try {
		return JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function bootstrapSucceeded(statusPath: string): boolean {
	return readBootstrapStatus(statusPath)?.status === "success";
}

function bootstrapOrchestratorAgentName(profile: WorktreeRepoProfile): string {
	return profile.bootstrap?.orchestrator?.agent?.trim() || "bootstrapper";
}

function shouldUseBootstrapOrchestrator(profile: WorktreeRepoProfile, mode?: "auto" | "executor" | "orchestrator"): boolean {
	if (mode === "executor") return false;
	if (mode === "orchestrator") return true;
	return Boolean(profile.bootstrap?.orchestrator?.enabled);
}

function findBootstrapOrchestratorAgent(repoRoot: string, profile: WorktreeRepoProfile) {
	const discovery = discoverAgents(repoRoot);
	const agentName = bootstrapOrchestratorAgentName(profile);
	const allowProjectAgent = profile.bootstrap?.orchestrator?.allowProjectAgent === true;
	const agent = discovery.agents.find((candidate) => candidate.name === agentName && (allowProjectAgent || candidate.source === "user"));
	return { discovery, agent, agentName, allowProjectAgent };
}

function buildBootstrapOrchestratorTask(args: {
	repoRoot: string;
	repoName: string;
	domains: BootstrapDomain[];
	missing: BootstrapDomain[];
	executorScriptPath: string;
	logPath: string;
	statusPath: string;
	reportPath: string;
	prompt: string;
}): string {
	return [
		"You are a dependency readiness orchestrator subagent.",
		"Your job is to unblock the main agent by running the supplied deterministic executor, then diagnosing readiness.",
		"Do not edit source files. Do not run unrelated installs or validation commands beyond the executor contract.",
		"",
		`Repo root: ${args.repoRoot}`,
		`Repo/profile: ${args.repoName}`,
		`Requested domains: ${args.domains.join(", ")}`,
		`Missing domains before launch: ${args.missing.join(", ")}`,
		`Original user prompt: ${args.prompt || "(manual bootstrap)"}`,
		"",
		"Executor contract:",
		`1. Run exactly: bash ${shellQuote(args.executorScriptPath)}`,
		`2. Read status JSON: ${args.statusPath}`,
		`3. If the executor failed, inspect the relevant tail of: ${args.logPath}`,
		`4. Write a concise markdown readiness report to: ${args.reportPath}`,
		"",
		"Final response format:",
		"VERDICT: READY | BLOCKED",
		"DOMAINS: <domains checked>",
		"EXECUTOR_STATUS: <status json summary>",
		"EVIDENCE: <commands/files checked>",
		"NEXT: <what the main agent can safely do next>",
	].join("\n");
}

function isSubagentSessionContext(ctx: ExtensionContext | ExtensionCommandContext): boolean {
	try {
		const sessionFile = (ctx as any).sessionManager?.getSessionFile?.();
		return typeof sessionFile === "string" && sessionFile.includes("/sessions/subagents/");
	} catch {
		return false;
	}
}

function isBootstrapOrchestratorPrompt(prompt: string): boolean {
	return prompt.includes("You are a dependency readiness orchestrator subagent")
		&& prompt.includes("Executor contract:")
		&& prompt.includes("orchestrator-report.md");
}

function setDependencyBootstrapStatus(ctx: ExtensionContext | ExtensionCommandContext, status: BootstrapStatus | "ready", text: string) {
	try {
		if ((ctx as any).hasUI === false) return;
		const theme = ctx.ui.theme;
		const color = status === "failed" ? "error" : status === "running" ? "warning" : "success";
		const icon = status === "failed" ? "✗" : status === "running" ? "●" : "✓";
		ctx.ui.setStatus(DEPENDENCY_BOOTSTRAP_STATUS_ID, theme.fg(color, icon) + theme.fg("dim", ` deps ${text}`));
	} catch {
		// Background bootstrap can complete after a non-interactive/old ctx is gone.
	}
}

function notifyDependencyBootstrap(ctx: ExtensionContext | ExtensionCommandContext, message: string, level: "info" | "warning" | "error") {
	try {
		if ((ctx as any).hasUI !== false) ctx.ui.notify(message, level);
	} catch {
		// Ignore stale UI contexts in async completion callbacks.
	}
}

interface DependencyBootstrapResult {
	repoRoot?: string;
	repoName?: ProfiledRepoName;
	domains?: BootstrapDomain[];
	missing?: BootstrapDomain[];
	logPath?: string;
	statusPath?: string;
	reportPath?: string;
	executorScriptPath?: string;
	sessionFile?: string;
	kind?: "executor" | "subagent-orchestrator";
	agentName?: string;
	state: "not-company-repo" | "not-implementation" | "ready" | "running" | "started" | "failed-to-start";
	systemNote?: string;
}

async function ensureDependencyBootstrapWorker(
	pi: ExtensionAPI,
	ctx: ExtensionContext | ExtensionCommandContext,
	prompt: string,
	options: { force?: boolean; domains?: BootstrapDomain[]; reason?: string; mode?: "auto" | "executor" | "orchestrator" } = {},
): Promise<DependencyBootstrapResult> {
	if (!options.force && (isSubagentSessionContext(ctx) || isBootstrapOrchestratorPrompt(prompt))) {
		return { state: "not-implementation" };
	}

	const repoRoot = await findRepoRoot(pi, ctx.cwd);
	if (!repoRoot) return { state: "not-company-repo" };

	const repoProfile = await detectProfiledRepo(pi, repoRoot);
	if (!repoProfile?.bootstrap?.enabled) return { repoRoot, state: "not-company-repo" };
	const repoName = repoProfile.displayName ?? repoProfile.name;
	if (!options.force && !isImplementationStartPrompt(prompt, repoProfile)) return { repoRoot, repoName, state: "not-implementation" };

	const meta = readMeta(repoRoot);
	const domains = [...new Set(options.domains ?? getBootstrapDomains(repoProfile, prompt, meta))];
	const missing = missingBootstrapDomains(repoRoot, repoProfile, domains);
	const stateDir = bootstrapStateDir(repoRoot);
	const logPath = join(stateDir, "bootstrap.log");
	const statusPath = join(stateDir, "status.json");

	if (missing.length === 0) {
		setDependencyBootstrapStatus(ctx, "ready", "ready");
		return { repoRoot, repoName, domains, missing, logPath, statusPath, state: "ready" };
	}

	const existing = dependencyBootstrapJobs.get(repoRoot);
	if (existing?.status === "running") {
		setDependencyBootstrapStatus(ctx, "running", `${existing.domains.join("+")}…`);
		return {
			repoRoot,
			repoName,
			domains: existing.domains,
			missing,
			logPath: existing.logPath,
			statusPath,
			state: "running",
			systemNote: `A worktree bootstrap worker is already running for ${repoName} (${existing.domains.join(", ")}). Do code reading/editing while it runs; before validation, check /wt bootstrap status or wait for readiness. Log: ${existing.logPath}`,
		};
	}

	mkdirSync(stateDir, { recursive: true });
	const runDomains = domains.filter((domain) => missing.includes(domain));
	const script = buildDependencyBootstrapScript(repoProfile, runDomains, repoRoot, logPath, statusPath);
	const executorScriptPath = join(stateDir, "executor.sh");
	const reportPath = join(stateDir, "orchestrator-report.md");
	writeFileSync(executorScriptPath, script, { mode: 0o700 });

	if (shouldUseBootstrapOrchestrator(repoProfile, options.mode)) {
		const { discovery, agent, agentName, allowProjectAgent } = findBootstrapOrchestratorAgent(repoRoot, repoProfile);
		if (agent) {
			setDependencyBootstrapStatus(ctx, "running", `ai:${runDomains.join("+")}…`);
			const task = buildBootstrapOrchestratorTask({
				repoRoot,
				repoName,
				domains: runDomains,
				missing,
				executorScriptPath,
				logPath,
				statusPath,
				reportPath,
				prompt,
			});
			const makeDetails = (results: SingleResult[]): SubagentDetails => ({
				mode: "single",
				inheritMainContext: false,
				projectAgentsDir: discovery.projectAgentsDir,
				results,
			});
			const sessionFile = makeSubagentSessionFile(Date.now() % 1_000_000_000);
			const promise = runSingleAgent(repoRoot, [agent], agent.name, task, undefined, undefined, undefined, makeDetails, { sessionFile }).then((result) => {
				const output = getFinalOutput(result.messages).trim();
				if (output) writeFileSync(reportPath, `${output}\n`);
				const ok = bootstrapSucceeded(statusPath);
				const job = dependencyBootstrapJobs.get(repoRoot);
				if (job) job.status = ok ? "success" : "failed";
				setDependencyBootstrapStatus(ctx, ok ? "success" : "failed", ok ? "ready" : "blocked");
				const summary = output || result.stderr.trim() || "(no subagent output)";
				pi.sendMessage(
					{
						customType: "worktree-dependency-bootstrap",
						content: `[dependency-bootstrap:${agent.name}] ${ok ? "READY" : "BLOCKED"}\nRepo: ${repoName}\nDomains: ${runDomains.join(", ")}\nLog: ${logPath}\nReport: ${reportPath}\n\n${summary.slice(0, 4000)}`,
						display: true,
						details: { repoRoot, repoName, domains: runDomains, status: ok ? "success" : "failed", logPath, reportPath, executorScriptPath, agentName: agent.name, sessionFile, exitCode: result.exitCode },
					},
					{ deliverAs: "followUp", triggerTurn: false },
				);
				notifyDependencyBootstrap(ctx, `AI worktree bootstrap ${ok ? "complete" : "blocked"} (${repoName}: ${runDomains.join(", ")})`, ok ? "info" : "warning");
			}).catch((error) => {
				const job = dependencyBootstrapJobs.get(repoRoot);
				if (job) job.status = "failed";
				setDependencyBootstrapStatus(ctx, "failed", "failed");
				const message = error instanceof Error ? error.message : String(error);
				notifyDependencyBootstrap(ctx, `AI worktree bootstrap orchestrator failed: ${message}`, "warning");
			});

			dependencyBootstrapJobs.set(repoRoot, {
				cwd: repoRoot,
				repoName,
				domains: runDomains,
				startedAt: Date.now(),
				status: "running",
				logPath,
				promise,
				kind: "subagent-orchestrator",
				agentName: agent.name,
				reportPath,
				executorScriptPath,
				sessionFile,
			});

			return {
				repoRoot,
				repoName,
				domains: runDomains,
				missing,
				logPath,
				statusPath,
				reportPath,
				executorScriptPath,
				sessionFile,
				kind: "subagent-orchestrator",
				agentName: agent.name,
				state: "started",
				systemNote: `An AI worktree bootstrap orchestrator subagent (${agent.name}) started for ${repoName} (${runDomains.join(", ")}). It will run the deterministic executor, inspect logs/status, and report readiness. Continue implementation, but before lint/test/type-check/migration/local-dev, confirm it reported READY or run /wt bootstrap status. Log: ${logPath}. Report: ${reportPath}`,
			};
		}
		if (options.mode === "orchestrator") {
			return {
				repoRoot,
				repoName,
				domains: runDomains,
				missing,
				logPath,
				statusPath,
				reportPath,
				executorScriptPath,
				kind: "subagent-orchestrator",
				agentName,
				state: "failed-to-start",
				systemNote: `AI worktree bootstrap orchestrator was requested, but agent "${agentName}" was not found${allowProjectAgent ? "" : " in user agents"}. Run /subagents to inspect available agents or use /wt bootstrap --executor.`,
			};
		}
	}

	setDependencyBootstrapStatus(ctx, "running", `${runDomains.join("+")}…`);
	const promise = pi.exec("bash", ["-lc", script], { cwd: repoRoot }).then((result) => {
		const job = dependencyBootstrapJobs.get(repoRoot);
		if (job) job.status = result.code === 0 ? "success" : "failed";
		if (result.code === 0) {
			setDependencyBootstrapStatus(ctx, "success", "ready");
			notifyDependencyBootstrap(ctx, `✓ Worktree bootstrap complete (${repoName}: ${runDomains.join(", ")})`, "info");
		} else {
			setDependencyBootstrapStatus(ctx, "failed", "failed");
			notifyDependencyBootstrap(ctx, `Worktree bootstrap failed (code ${result.code}). Log: ${logPath}`, "warning");
		}
	}).catch((error) => {
		const job = dependencyBootstrapJobs.get(repoRoot);
		if (job) job.status = "failed";
		setDependencyBootstrapStatus(ctx, "failed", "failed");
		const message = error instanceof Error ? error.message : String(error);
		notifyDependencyBootstrap(ctx, `Worktree bootstrap failed to start: ${message}`, "warning");
	});

	dependencyBootstrapJobs.set(repoRoot, {
		cwd: repoRoot,
		repoName,
		domains: runDomains,
		startedAt: Date.now(),
		status: "running",
		logPath,
		promise,
		kind: "executor",
		executorScriptPath,
	});

	return {
		repoRoot,
		repoName,
		domains: runDomains,
		missing,
		logPath,
		statusPath,
		executorScriptPath,
		kind: "executor",
		state: "started",
		systemNote: `A background worktree bootstrap executor started for ${repoName} (${runDomains.join(", ")}). It only runs missing readiness domains. Continue implementation, but before lint/test/type-check/migration/local-dev, ensure it finished or run /wt bootstrap status. Log: ${logPath}`,
	};
}

async function formatBootstrapStatus(pi: ExtensionAPI, repoRoot: string): Promise<string> {
	const job = dependencyBootstrapJobs.get(repoRoot);
	const statusPath = join(bootstrapStateDir(repoRoot), "status.json");
	const repoProfile = await detectProfiledRepo(pi, repoRoot);
	const lines = ["Worktree bootstrap status:"];
	if (job) {
		const agentLabel = job.agentName ? ` via ${job.agentName}` : "";
		lines.push(`  memory: ${job.status} — ${job.kind}${agentLabel} — ${job.repoName} ${job.domains.join(", ")} (${Math.round((Date.now() - job.startedAt) / 1000)}s ago)`);
		lines.push(`  log: ${job.logPath}`);
		if (job.reportPath) lines.push(`  report: ${job.reportPath}`);
		if (job.executorScriptPath) lines.push(`  executor: ${job.executorScriptPath}`);
		if (job.sessionFile) lines.push(`  subagent session: ${job.sessionFile}`);
	}
	if (repoProfile?.bootstrap?.enabled) {
		lines.push(`  profile: ${repoProfile.displayName ?? repoProfile.name}`);
		for (const domain of bootstrapDomainProfiles(repoProfile)) {
			const marker = repoRelativePath(repoRoot, domain.marker);
			const ready = existsSync(marker);
			const label = domain.label ?? domain.name;
			lines.push(`  ${ready ? "✓" : "✗"} ${domain.name} — ${label} — ${ready ? "ready" : "missing"} (${domain.marker})`);
		}
	}
	if (existsSync(statusPath)) {
		lines.push(`  status file: ${statusPath}`);
		try {
			lines.push(`  ${readFileSync(statusPath, "utf8").trim()}`);
		} catch {}
	} else if (!job) {
		lines.push("  no bootstrap job/status found for this worktree");
	}
	return lines.join("\n");
}

function parseRequestedBootstrapDomains(tokens: string[], profile: WorktreeRepoProfile | null): BootstrapDomain[] {
	const requested = new Set<BootstrapDomain>();
	const profileDomains = profile ? bootstrapDomainProfiles(profile).map((domain) => domain.name) : [];
	const knownDomains = profileDomains.length > 0 ? profileDomains : ["root", "backend", "frontend"];

	const addDomain = (value: string | undefined) => {
		for (const domain of (value ?? "").split(",").map((part) => part.trim()).filter(Boolean)) requested.add(domain);
	};

	if (tokens.includes("--root")) requested.add("root");
	if (tokens.includes("--backend") || tokens.includes("--be")) requested.add("backend");
	if (tokens.includes("--frontend") || tokens.includes("--fe")) requested.add("frontend");
	for (const domain of knownDomains) {
		if (tokens.includes(`--${domain}`)) requested.add(domain);
	}
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token === "--domain" || token === "-d") addDomain(tokens[i + 1]);
		else if (token.startsWith("--domain=")) addDomain(token.slice("--domain=".length));
	}
	if (tokens.includes("--env") || tokens.includes("--runtime-env")) {
		for (const domain of knownDomains.filter((name) => name.includes("env"))) requested.add(domain);
	}
	if (tokens.includes("--all")) return knownDomains;
	return [...requested];
}

async function handleBootstrap(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const tokens = tokenize(args);
	const sub = tokens.find((token) => !token.startsWith("--")) ?? "run";
	const repoRoot = await findRepoRoot(pi, ctx.cwd);
	if (!repoRoot) { ctx.ui.notify("Not a git repository", "error"); return; }
	const repoProfile = await detectProfiledRepo(pi, repoRoot);

	if (sub === "status") {
		ctx.ui.notify(await formatBootstrapStatus(pi, repoRoot), "info");
		return;
	}

	const requestedDomains = parseRequestedBootstrapDomains(tokens, repoProfile);

	const mode = tokens.includes("--executor")
		? "executor"
		: tokens.includes("--ai") || tokens.includes("--orchestrator")
			? "orchestrator"
			: "auto";
	const result = await ensureDependencyBootstrapWorker(pi, ctx, args, {
		force: true,
		domains: requestedDomains.length > 0 ? requestedDomains : undefined,
		reason: "manual",
		mode,
	});
	if (result.state === "not-company-repo") { ctx.ui.notify(`Worktree bootstrap is currently scoped to configured worktree profiles (${profiledRepoLabel()}).`, "info"); return; }
	if (result.state === "ready") { ctx.ui.notify(`Worktree readiness already ready (${result.repoName}: ${result.domains?.join(", ")}).`, "info"); return; }
	if (result.state === "running") { ctx.ui.notify(`Worktree bootstrap already running. Log: ${result.logPath}`, "info"); return; }
	if (result.state === "started") {
		const via = result.kind === "subagent-orchestrator" ? ` via ${result.agentName}` : "";
		ctx.ui.notify(`Worktree bootstrap started${via} (${result.repoName}: ${result.domains?.join(", ")}). Log: ${result.logPath}`, "info");
		return;
	}
	if (result.state === "failed-to-start" && result.systemNote) { ctx.ui.notify(result.systemNote, "warning"); return; }
	ctx.ui.notify("Worktree bootstrap was not started.", "warning");
}

// ─── Ghostty integration ───────────────────────────────────────────────────

async function openInGhostty(pi: ExtensionAPI, cwd: string, direction: WorktreeConfig["ghosttyDirection"]) {
	if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") return false;
	const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
	const cmd = `cd "${esc(cwd)}" && pi`;

	let script: string;
	if (direction === "tab") {
		script = `tell application "Ghostty"
  set newTerm to make new tab in front window
  input text "${esc(cmd)}" to newTerm
  send key "enter" to newTerm
end tell`;
	} else {
		script = `tell application "Ghostty"
  set currentTerm to focused terminal of selected tab of front window
  set newTerm to split currentTerm direction ${direction}
  input text "${esc(cmd)}" to newTerm
  send key "enter" to newTerm
end tell`;
	}

	const result = await pi.exec("osascript", ["-e", script]);
	return result.code === 0;
}

// ─── Commands ──────────────────────────────────────────────────────────────

async function resolveRepoRoot(pi: ExtensionAPI, ctx: ExtensionCommandContext, repoFlag?: string): Promise<string | null> {
	if (repoFlag) {
		const reg = loadRegistry();
		const path = reg[repoFlag];
		if (!path) {
			ctx.ui.notify(`Repo "${repoFlag}" not registered. Available: ${Object.keys(reg).join(", ") || "(none)"}. Use /wt repo add ${repoFlag} <path> first.`, "error");
			return null;
		}
		if (!existsSync(path)) {
			ctx.ui.notify(`Registered repo path missing: ${path}`, "error");
			return null;
		}
		return canonicalRepoRoot(pi, path);
	}
	const repoRoot = await findCanonicalRepoRoot(pi, ctx.cwd);
	if (repoRoot) return repoRoot;

	const reg = loadRegistry();
	const names = Object.keys(reg).filter(n => existsSync(reg[n]));
	if (names.length === 0) {
		ctx.ui.notify("Not a git repository and no repos registered. Use /wt repo add <name> <path>", "error");
		return null;
	}
	if (names.length === 1) return canonicalRepoRoot(pi, reg[names[0]]);
	const choice = await ctx.ui.select("어느 repo에 만들까요?", names);
	if (!choice) return null;
	return canonicalRepoRoot(pi, reg[choice]);
}

async function handleNew(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const parsed = parseNewArgs(args);
	const repoRoot = await resolveRepoRoot(pi, ctx, parsed.repo);
	if (!repoRoot) return;

	const panelGuard = getWorktreeCreationPanelGuardMessage(repoRoot, ctx);
	if (panelGuard) { ctx.ui.notify(panelGuard, "error"); return; }
	const hotfixGuard = getHotfixBaseGuardMessage(parsed, "/wt new");
	if (hotfixGuard) { ctx.ui.notify(hotfixGuard, "error"); return; }

	// Auto-register if not in registry
	const { name: registeredName, isNew: justRegistered } = autoRegister(repoRoot);
	if (justRegistered) ctx.ui.notify(`Registered repo "${registeredName}" → ${repoRoot}`, "info");

	const config = loadConfig(repoRoot);

	// Determine base branch
	let baseBranch: string;
	if (parsed.from) baseBranch = parsed.from;
	else if (parsed.hotfix || parsed.hotfeature) baseBranch = config.productionBranch;
	else baseBranch = config.baseBranch;

	// Determine branch prefix
	let prefix: string;
	if (parsed.hotfix) prefix = "hotfix";
	else if (parsed.hotfeature) prefix = "hotfeature";
	else prefix = config.branchPrefix;

	// Determine name
	mkdirSync(config.rootDir, { recursive: true });
	const existing = new Set(listExistingWorktrees(config.rootDir).map((w) => w.name));
	const name = parsed.name ?? pickName(config.namingScheme, existing);

	if (existing.has(name)) {
		ctx.ui.notify(`Worktree "${name}" already exists at ${config.rootDir}`, "error");
		return;
	}

	const worktreePath = join(config.rootDir, name);

	// Determine branch name
	const branchName = parsed.branch
		? parsed.branch
		: parsed.ticket
			? `${prefix}/${parsed.ticket}/${name}`
			: `${prefix}/${name}`;

	const contextContent = readContextFileOption(ctx, parsed.contextFile);
	if (parsed.contextFile && contextContent === null) return;

	ctx.ui.notify(`Creating worktree "${name}" from origin/${baseBranch}…`, "info");

	// Step 1: fetch
	const fetchR = await pi.exec("git", ["fetch", "origin", baseBranch], { cwd: repoRoot });
	if (fetchR.code !== 0) {
		ctx.ui.notify(`git fetch failed: ${fetchR.stderr?.trim().slice(0, 200) ?? "unknown error"}`, "error");
		return;
	}

	// Step 2: worktree add
	const addR = await pi.exec("git", ["worktree", "add", worktreePath, "-b", branchName, `origin/${baseBranch}`], { cwd: repoRoot });
	if (addR.code !== 0) {
		ctx.ui.notify(`git worktree add failed: ${addR.stderr?.trim().slice(0, 200)}`, "error");
		return;
	}

	// Step 3: write metadata
	writeMeta(worktreePath, {
		name,
		branch: branchName,
		baseBranch,
		createdAt: Date.now(),
		ticket: parsed.ticket,
		note: parsed.note,
	});
	const framePromotion = promotePlanningFrameToWorktree(worktreePath, readMeta(worktreePath) ?? {
		name,
		branch: branchName,
		baseBranch,
		createdAt: Date.now(),
		ticket: parsed.ticket,
		note: parsed.note,
	});
	if (framePromotion.status === "promoted") ctx.ui.notify(`✓ planning frame promoted to ${name}/.pi/frame.json`, "info");
	else if (framePromotion.status === "error") ctx.ui.notify(`Frame promotion skipped: ${framePromotion.error}`, "warning");

	ctx.ui.notify(`✓ ${name} created (${branchName})`, "info");

	// Step 4: setup script
	if (config.setupScript) {
		ctx.ui.notify(`Running setup: ${config.setupScript}…`, "info");
		const setupR = await pi.exec("bash", ["-lc", config.setupScript], { cwd: worktreePath });
		if (setupR.code !== 0) {
			ctx.ui.notify(`Setup script failed (code ${setupR.code}). Worktree created but setup skipped.`, "warning");
		} else {
			ctx.ui.notify(`✓ Setup complete`, "info");
		}
	}

	// Step 5: switch to new session with worktree cwd
	const session = createWorktreeSession(ctx, worktreePath, {
		carryContext: parsed.carryContext,
		contextContent,
		sessionName: `${name} (${branchName})`,
	});
	const contextLabel = `${session.carriedContext ? " — context carried" : session.appendedContext ? " — context loaded" : ""}${framePromotionContextLabel(framePromotion)}`;

	try {
		await switchSessionToWorktree(ctx, session.sessionFile, name, worktreePath, contextLabel);
	} catch (error) {
		const reason = error instanceof Error ? ` (${error.message})` : "";
		ctx.ui.notify(`✓ Created. cwd: ${worktreePath}${reason}`, "info");
	}
}

async function listOneRepo(pi: ExtensionAPI, repoRoot: string, _ctx: ExtensionCommandContext): Promise<{ repo: string; lines: string[] }> {
	const config = loadConfig(repoRoot);
	const reg = loadRegistry();
	const repoName = findRegisteredName(reg, repoRoot) ?? basename(repoRoot);
	const worktrees = listExistingWorktrees(config.rootDir);

	const lines: string[] = [];
	if (worktrees.length === 0) {
		lines.push(`  (no worktrees in ${config.rootDir})`);
		return { repo: repoName, lines };
	}

	for (const w of worktrees) {
		const status = await getWorktreeStatus(pi, w.path);
		const statusStr = status === null ? "?" : status.changes > 0 ? `${status.changes} changes` : status.ahead > 0 ? `${status.ahead} ahead` : status.behind > 0 ? `${status.behind} behind` : "clean";
		const ticket = w.meta?.ticket ? ` [${w.meta.ticket}]` : "";
		const note = w.meta?.note ? ` — ${w.meta.note.slice(0, 40)}` : "";
		lines.push(`  ${w.name.padEnd(15)} ${w.branch.padEnd(35)} ${statusStr}${ticket}${note}`);
	}
	return { repo: repoName, lines };
}

async function handleList(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const all = args.includes("--all") || args.includes("-a");

	if (all) {
		const reg = loadRegistry();
		const names = Object.keys(reg);
		if (names.length === 0) {
			ctx.ui.notify("No repos registered. Use /wt new in a repo to auto-register, or /wt repo add <name> <path>.", "info");
			return;
		}
		const sections: string[] = [];
		let total = 0;
		for (const name of names) {
			const path = reg[name];
			if (!existsSync(path)) {
				sections.push(`[${name}] (path missing: ${path})`);
				continue;
			}
			const result = await listOneRepo(pi, path, ctx);
			sections.push(`[${result.repo}]`);
			sections.push(...result.lines);
			total += result.lines.length;
		}
		ctx.ui.notify([`All worktrees across ${names.length} repos:`, ...sections].join("\n"), "info");
		return;
	}

	const repoRoot = await findRepoRoot(pi, ctx.cwd);
	if (!repoRoot) { ctx.ui.notify("Not a git repository (use --all to see all registered repos)", "error"); return; }
	const result = await listOneRepo(pi, repoRoot, ctx);
	ctx.ui.notify([`Worktrees in ${result.repo}:`, ...result.lines].join("\n"), "info");
}

async function handleRemove(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const repoRoot = await findRepoRoot(pi, ctx.cwd);
	if (!repoRoot) { ctx.ui.notify("Not a git repository", "error"); return; }

	const config = loadConfig(repoRoot);
	const name = args.trim().split(/\s+/)[0];
	if (!name) { ctx.ui.notify("Usage: /wt rm <name> [--force]", "error"); return; }
	const force = args.includes("--force");

	const path = join(config.rootDir, name);
	if (!existsSync(path)) { ctx.ui.notify(`Worktree "${name}" not found`, "error"); return; }

	// Safety check: uncommitted changes
	if (!force) {
		const status = await getWorktreeStatus(pi, path);
		if (status && status.changes > 0) {
			const ok = await ctx.ui.confirm("Uncommitted changes", `${name} has ${status.changes} uncommitted changes. Remove anyway?`);
			if (!ok) { ctx.ui.notify("Cancelled.", "info"); return; }
		}
		if (status && status.ahead > 0) {
			const ok = await ctx.ui.confirm("Unpushed commits", `${name} has ${status.ahead} unpushed commits. Remove anyway?`);
			if (!ok) { ctx.ui.notify("Cancelled.", "info"); return; }
		}
	}

	const removeR = await pi.exec("git", ["worktree", "remove", "--force", path], { cwd: repoRoot });
	if (removeR.code !== 0) {
		ctx.ui.notify(`git worktree remove failed: ${removeR.stderr?.trim().slice(0, 200)}`, "warning");
		// Fallback: rm directory
		try { rmSync(path, { recursive: true, force: true }); } catch {}
	}

	ctx.ui.notify(`✓ ${name} removed`, "info");
}

function normalizeSessionText(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

function extractTextFromMessageContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const record = part as Record<string, unknown>;
			return typeof record.text === "string" ? record.text : "";
		})
		.filter(Boolean)
		.join(" ");
}

function cleanupSessionPromptText(text: string): string {
	let t = normalizeSessionText(text);
	if (/^\[(GENERAL INSTRUCTION|HISTORY)\b[^\]]*\]/i.test(t)) {
		const request = t.match(/\[REQUEST\b[^\]]*\]\s*([\s\S]*)/i)?.[1];
		return request ? normalizeSessionText(request) : "";
	}
	if (/^\[REQUEST\b[^\]]*\]/i.test(t)) {
		t = t.replace(/^\[REQUEST\b[^\]]*\]\s*/i, "");
	}
	if (/^read\s+\/tmp\//i.test(t)) {
		t = t.replace(/^read\s+\/tmp\/\S+\.?\s*/i, "");
	}
	return normalizeSessionText(t);
}

function isMeaninglessSessionPrompt(text: string): boolean {
	const t = text.trim();
	if (!t) return true;
	if (t.startsWith("<system") || t.startsWith("<!--")) return true;
	if (t.startsWith("<skill ") || t.startsWith("Base directory for this skill")) return true;
	if (t.startsWith("[subagent:") || t.startsWith("[fork-panel handoff:")) return true;
	if (t.startsWith("/var/folders/") || t.startsWith("/tmp/")) return true;
	return false;
}

function isGenericSessionPrompt(text: string): boolean {
	const t = text.trim().toLowerCase();
	return ["응", "ㅇㅇ", "넵", "네", "어", "어 해봐", "해줘", "좋아", "1", "2", "3"].includes(t)
		|| /^응\s/.test(t)
		|| /^넵\s/.test(t)
		|| /^ㅇㅇ\s/.test(t);
}

function shortenSessionPrompt(text: string, width = 58): string {
	let t = normalizeSessionText(text);
	const jira = t.match(/browse\/([A-Z][A-Z0-9]+-\d+)/i)?.[1];
	if (t.startsWith("/frame") && jira) return `/frame ${jira}`;
	if (t.startsWith("## Unresolved PR review comments")) return "PR 리뷰 코멘트 대응";
	if (t.includes("migrate: run")) return "마이그레이션 실행";
	if (t.includes("커밋") && t.includes("push")) return "커밋/푸시 정리";
	return truncateToWidth(t, width);
}

function shortenSessionName(text: string): string {
	return truncateToWidth(normalizeSessionText(text), 42);
}

function buildSessionChoiceLabel(opts: {
	filename: string;
	sessionIso?: string;
	sessionName?: string;
	summary: string;
	turns: number;
	shortId: string;
}): string {
	const timestamp = formatSessionTimestamp(opts.filename, opts.sessionIso);
	const title = opts.sessionName ? shortenSessionName(opts.sessionName) : opts.summary;
	const normalizedTitleSource = normalizeSessionText(opts.sessionName ?? title);
	const normalizedSummary = normalizeSessionText(opts.summary);
	const detail = opts.sessionName && normalizedSummary && normalizedSummary !== normalizedTitleSource
		? ` · ${shortenSessionPrompt(opts.summary, 42)}`
		: "";
	return `${timestamp} · ${title}${detail} · ${opts.turns}턴 · ${opts.shortId}`;
}

function formatSessionTimestamp(filename: string, fallbackIso?: string): string {
	const raw = filename.split("_")[0];
	const n = Number(raw);
	const d = Number.isFinite(n) ? new Date(n) : (fallbackIso ? new Date(fallbackIso) : null);
	if (!d || Number.isNaN(d.getTime())) return "날짜 없음";
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	const hh = String(d.getHours()).padStart(2, "0");
	const mi = String(d.getMinutes()).padStart(2, "0");
	return `${mm}-${dd} ${hh}:${mi}`;
}

interface SessionChoiceInfo {
	file: string;
	label: string;
	prompts: string[];
	transcriptKey?: string;
	transcriptMessageKeys: string[];
	sessionName?: string;
}

interface SessionChoiceOption {
	choice: SessionChoiceInfo;
	displayLabel: string;
}

function parseSessionChoiceInfo(sessionPath: string): SessionChoiceInfo {
	const filename = basename(sessionPath).replace(/\.jsonl$/, "");
	const shortId = filename.split("_").slice(1).join("_") || filename.slice(-8);
	let sessionIso: string | undefined;
	let sessionName: string | undefined;
	const prompts: string[] = [];
	const transcriptHash = createHash("sha1");
	const transcriptMessageKeys: string[] = [];

	try {
		const raw = readFileSync(sessionPath, "utf8");
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			let entry: any;
			try { entry = JSON.parse(line); } catch { continue; }
			if (entry?.type === "session" && typeof entry.timestamp === "string") sessionIso = entry.timestamp;
			if (entry?.type === "session_info" && typeof entry.name === "string" && entry.name.trim()) {
				sessionName = normalizeSessionText(entry.name);
			}
			const message = entry?.message;
			if (!message || typeof message.role !== "string") continue;
			const messageKey = createHash("sha1")
				.update(JSON.stringify({ role: message.role, content: message.content ?? null }))
				.digest("hex");
			transcriptHash.update(messageKey).update("\n");
			transcriptMessageKeys.push(messageKey);
			if (message.role !== "user") continue;
			const text = cleanupSessionPromptText(extractTextFromMessageContent(message.content));
			if (isMeaninglessSessionPrompt(text)) continue;
			prompts.push(text);
		}
	} catch {
		// Fall back to filename-only label below.
	}

	const meaningful = [...prompts].reverse().find((p) => !isGenericSessionPrompt(p)) ?? prompts[prompts.length - 1];
	const summary = meaningful ? shortenSessionPrompt(meaningful) : filename;
	return {
		file: basename(sessionPath),
		label: buildSessionChoiceLabel({ filename, sessionIso, sessionName, summary, turns: prompts.length, shortId }),
		prompts,
		transcriptKey: transcriptMessageKeys.length > 0 ? transcriptHash.digest("hex") : undefined,
		transcriptMessageKeys,
		sessionName,
	};
}

function isArrayPrefix(shorter: string[], longer: string[]): boolean {
	if (shorter.length === 0 || shorter.length > longer.length) return false;
	for (let i = 0; i < shorter.length; i += 1) {
		if (shorter[i] !== longer[i]) return false;
	}
	return true;
}

function dedupeSessionChoices(choices: SessionChoiceInfo[]): SessionChoiceInfo[] {
	const firstIndexByExactTranscript = new Map<string, number>();
	choices.forEach((choice, index) => {
		if (!choice.transcriptKey) return;
		if (!firstIndexByExactTranscript.has(choice.transcriptKey)) firstIndexByExactTranscript.set(choice.transcriptKey, index);
	});

	return choices.filter((choice, index) => {
		if (choice.transcriptKey && firstIndexByExactTranscript.get(choice.transcriptKey) !== index) return false;
		if (choice.prompts.length === 0) return true;

		// Older checkpoint of a longer conversation: hide only when both prompts and transcript are prefixes.
		return !choices.some((other, otherIndex) => {
			if (index === otherIndex) return false;
			if (otherIndex > index) return false;
			if (other.prompts.length <= choice.prompts.length) return false;
			return isArrayPrefix(choice.prompts, other.prompts)
				&& isArrayPrefix(choice.transcriptMessageKeys, other.transcriptMessageKeys);
		});
	});
}

function buildUniqueSessionChoiceOptions(choices: SessionChoiceInfo[]): SessionChoiceOption[] {
	const usedLabels = new Set<string>();
	return choices.map((choice) => {
		let displayLabel = choice.label;
		let suffix = 2;
		while (usedLabels.has(displayLabel)) {
			displayLabel = `${choice.label} · #${suffix}`;
			suffix += 1;
		}
		usedLabels.add(displayLabel);
		return { choice, displayLabel };
	});
}

async function switchToWorktree(pi: ExtensionAPI, wtName: string, wtPath: string, ctx: ExtensionCommandContext, options: { hydrateConductor?: boolean; notifyConductorHydration?: boolean } = {}) {
	const meta = readMeta(wtPath);
	const framePromotion = meta ? promotePlanningFrameToWorktree(wtPath, meta) : { status: "missing-source" as const };
	if (framePromotion.status === "promoted") ctx.ui.notify(`✓ planning frame promoted to ${wtName}/.pi/frame.json`, "info");
	else if (framePromotion.status === "error") ctx.ui.notify(`Frame promotion skipped: ${framePromotion.error}`, "warning");

	let conductorHydration: ConductorHydrationResult | null = null;
	if (options.hydrateConductor !== false) {
		conductorHydration = await hydrateConductorSessionsForWorktree(pi, ctx, wtName, wtPath, { notifyAlways: options.notifyConductorHydration });
		if (conductorHydration.created.length > 0 || conductorHydration.existing.length > 0) {
			markConductorContextLoaded(wtPath);
		}
	}

	const sessionDir = sessionDirForWorktree(wtPath);
	let sessionFile: string | null = null;

	if (existsSync(sessionDir)) {
		const files = readdirSync(sessionDir).filter(f => f.endsWith(".jsonl")).sort().reverse();
		if (files.length === 1) {
			sessionFile = join(sessionDir, files[0]);
		} else if (files.length > 1) {
			const choices = dedupeSessionChoices(
				files.map((file) => parseSessionChoiceInfo(join(sessionDir, file))),
			);
			const sessionOptions = buildUniqueSessionChoiceOptions(choices);
			const choice = await ctx.ui.select(`${wtName} 세션 선택:`, sessionOptions.map((option) => option.displayLabel));
			if (!choice) return;
			const selected = sessionOptions.find((option) => option.displayLabel === choice)?.choice;
			if (!selected) return;
			sessionFile = join(sessionDir, selected.file);
		}
	}

	if (!sessionFile) {
		const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		mkdirSync(sessionDir, { recursive: true });
		sessionFile = join(sessionDir, `${Date.now()}_${sessionId}.jsonl`);
		writeFileSync(sessionFile, JSON.stringify({
			type: "session", version: 3, id: sessionId,
			timestamp: new Date().toISOString(), cwd: wtPath,
		}) + "\n");
	}

	try {
		await switchSessionToWorktree(ctx, sessionFile, wtName, wtPath, framePromotionContextLabel(framePromotion));
	} catch {
		ctx.ui.notify(`Switch to: cd ${wtPath}`, "info");
	}
}

interface DashboardWorktree {
	name: string;
	path: string;
	branch: string;
	repoName: string;
	status: WorktreeStatus;
	meta: WorktreeMeta | null;
	gitStatus?: { changes: number; ahead: number; behind: number } | null;
}

async function loadDashboardWorktrees(pi: ExtensionAPI): Promise<DashboardWorktree[]> {
	const reg = loadRegistry();
	const results: DashboardWorktree[] = [];
	const seenRootDirs = new Set<string>();
	const seenWorktreePaths = new Set<string>();
	for (const [repoName, repoPath] of Object.entries(reg)) {
		if (!existsSync(repoPath)) continue;
		const repoRoot = await canonicalRepoRoot(pi, repoPath);
		const config = loadConfig(repoRoot);
		const rootKey = realPathForCompare(config.rootDir);
		if (seenRootDirs.has(rootKey)) continue;
		seenRootDirs.add(rootKey);
		for (const w of listExistingWorktrees(config.rootDir)) {
			const pathKey = realPathForCompare(w.path);
			if (seenWorktreePaths.has(pathKey)) continue;
			seenWorktreePaths.add(pathKey);
			const gs = await getWorktreeStatus(pi, w.path);
			results.push({
				name: w.name, path: w.path, branch: w.branch, repoName,
				status: w.meta?.status ?? "active",
				meta: w.meta, gitStatus: gs,
			});
		}
	}
	return results;
}

function statusIcon(s: WorktreeStatus): string {
	switch (s) {
		case "backlog": return "○";
		case "active": return "●";
		case "done": return "✓";
		case "archived": return "○";
	}
}

function statusColor(s: WorktreeStatus): ThemeColor {
	switch (s) {
		case "backlog": return "warning";
		case "active": return "success";
		case "done": return "accent";
		case "archived": return "warning";
	}
}

const MAIN_STATUSES: WorktreeStatus[] = ["backlog", "active", "done"];
function cycleStatus(current: WorktreeStatus): WorktreeStatus {
	const idx = MAIN_STATUSES.indexOf(current);
	if (idx === -1) return "active";
	return MAIN_STATUSES[(idx + 1) % MAIN_STATUSES.length];
}

function gitStatusStr(gs: { changes: number; ahead: number; behind: number } | null | undefined, theme: any): string {
	if (!gs) return "?";
	const parts: string[] = [];
	if (gs.changes > 0) parts.push(theme.fg("warning", `${gs.changes} changes`));
	if (gs.ahead > 0) parts.push(theme.fg("accent", `↑${gs.ahead}`));
	if (gs.behind > 0) parts.push(theme.fg("error", `↓${gs.behind}`));
	if (parts.length === 0) return theme.fg("success", "clean");
	return parts.join(" ");
}

type DashboardTab = "main" | "archive";

async function showDashboard(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<DashboardWorktree | null> {
	let worktrees = await loadDashboardWorktrees(pi);
	let selectedIdx = 0;
	let currentTab: DashboardTab = "main";
	let showHelp = false;
	let filterMode = false;
	let filterBuffer = "";
	let inputMode: null | "tag" | "note" = null;
	let inputBuffer = "";

	const getVisible = () => {
		let items = currentTab === "main"
			? worktrees.filter(w => w.status !== "archived")
			: worktrees.filter(w => w.status === "archived");
		if (filterBuffer) {
			const q = filterBuffer.toLowerCase();
			items = items.filter(w =>
				w.name.toLowerCase().includes(q) ||
				w.branch.toLowerCase().includes(q) ||
				(w.meta?.ticket ?? "").toLowerCase().includes(q) ||
				(w.meta?.tags ?? []).some(t => t.toLowerCase().includes(q))
			);
		}
		if (currentTab === "main") {
			const order: Record<WorktreeStatus, number> = { active: 0, backlog: 1, done: 2, archived: 3 };
			return [...items].sort((a, b) => order[a.status] - order[b.status] || (b.meta?.createdAt ?? 0) - (a.meta?.createdAt ?? 0));
		}
		return [...items].sort((a, b) => (b.meta?.doneAt ?? b.meta?.createdAt ?? 0) - (a.meta?.doneAt ?? a.meta?.createdAt ?? 0));
	};

	return ctx.ui.custom<DashboardWorktree | null>(
		(tui, theme, _kb, done) => {
			const renderHelp = (w: number): string[] => {
				const lines: string[] = [];
				lines.push(...new DynamicBorder((s: string) => theme.fg("accent", s)).render(w));
				lines.push(`  ${theme.bold("KEYBINDINGS")}`);
				lines.push("");
				lines.push(`  ${theme.fg("warning", "↑/↓, k/j")}  ${theme.fg("border", "항목 이동")}`);
				lines.push(`  ${theme.fg("warning", "Enter")}     ${theme.fg("border", "워크트리 세션 선택/전환")}`);
				lines.push(`  ${theme.fg("warning", "Tab")}       ${theme.fg("border", "메인 ↔ 아카이브 탭 전환")}`);
				lines.push(`  ${theme.fg("warning", "Space")}     ${theme.fg("border", "상태 순환 (backlog → active → done)")}`);
				lines.push(`  ${theme.fg("warning", "a")}         ${theme.fg("border", "아카이브 ↔ 메인 이동")}`);
				lines.push(`  ${theme.fg("warning", "t")}         ${theme.fg("border", "태그 편집")}`);
				lines.push(`  ${theme.fg("warning", "e")}         ${theme.fg("border", "노트 편집")}`);
				lines.push(`  ${theme.fg("warning", "/")}         ${theme.fg("border", "필터 (이름/브랜치/태그)")}`);
				lines.push(`  ${theme.fg("warning", "n")}         ${theme.fg("border", "새 워크트리")}`);
				lines.push(`  ${theme.fg("warning", "d")}         ${theme.fg("border", "삭제")}`);
				lines.push(`  ${theme.fg("warning", ",")}         ${theme.fg("border", "이 도움말")}`);
				lines.push(`  ${theme.fg("warning", "q/Esc")}     ${theme.fg("border", "닫기")}`);
				lines.push("");
				lines.push(`  ${theme.fg("border", "아무 키나 누르면 닫힘")}`);
				lines.push(...new DynamicBorder((s: string) => theme.fg("accent", s)).render(w));
				return lines;
			};

			return {
				render: (w: number) => {
					if (showHelp) return renderHelp(w);
					const visible = getVisible();
					const backlogCount = worktrees.filter(wt => wt.status === "backlog").length;
					const activeCount = worktrees.filter(wt => wt.status === "active").length;
					const doneCount = worktrees.filter(wt => wt.status === "done").length;
					const archivedCount = worktrees.filter(wt => wt.status === "archived").length;
					const mainCount = backlogCount + activeCount + doneCount;

					const lines: string[] = [];
					lines.push(theme.fg("accent", "─".repeat(w)));

					// Tab bar
					const mainTab = currentTab === "main"
						? theme.fg("accent", theme.bold(`● Worktrees (${mainCount})`))
						: `  Worktrees (${mainCount})`;
					const archiveTab = currentTab === "archive"
						? theme.fg("accent", theme.bold(`● Archive (${archivedCount})`))
						: `  Archive (${archivedCount})`;
					lines.push(`  ${mainTab}    ${archiveTab}    ${theme.fg("accent", "Tab 전환")}`);
					lines.push(theme.fg("accent", "─".repeat(w)));

					// Stats for main tab
					if (currentTab === "main") {
						const stats: string[] = [];
						if (activeCount > 0) stats.push(theme.fg("success", `${activeCount} active`));
						if (backlogCount > 0) stats.push(theme.fg("warning", `${backlogCount} backlog`));
						if (doneCount > 0) stats.push(theme.fg("accent", `${doneCount} done`));
						if (stats.length > 0) lines.push(`  ${stats.join(" · ")}`);
					}
					lines.push(theme.fg("accent", "─".repeat(w)));

					if (filterMode || filterBuffer) {
						lines.push(`  ${theme.fg("warning", "[Filter]")} ${filterBuffer}${filterMode ? "│" : ""}`);
						if (filterMode) lines.push(theme.fg("border", "  Enter 확인 · Esc 취소"));
						lines.push(theme.fg("accent", "─".repeat(w)));
					}

					if (inputMode) {
						const labels: Record<string, string> = { tag: "태그 (콤마 구분)", note: "노트" };
						lines.push(`  ${theme.fg("warning", `[${labels[inputMode]}]`)} ${inputBuffer}│`);
						lines.push(theme.fg("border", "  Enter 확인 · Esc 취소"));
						lines.push(theme.fg("accent", "─".repeat(w)));
						return lines;
					}

					if (visible.length === 0) {
						lines.push(theme.fg("border", filterBuffer ? "  검색 결과 없음" : "  워크트리가 없습니다. n으로 추가하세요."));
					} else {
						const termRows = (tui as any).terminal?.rows ?? 24;
						const visibleHeight = Math.max(5, termRows - 10);
						let scrollOffset = 0;
						if (selectedIdx >= scrollOffset + visibleHeight) scrollOffset = selectedIdx - visibleHeight + 1;
						if (selectedIdx < scrollOffset) scrollOffset = selectedIdx;

						let lastStatus: WorktreeStatus | null = null;
						for (let i = scrollOffset; i < Math.min(visible.length, scrollOffset + visibleHeight); i++) {
							const wt = visible[i];
							if (currentTab === "main" && wt.status !== lastStatus) {
								const label = wt.status === "active" ? "ACTIVE" : wt.status === "backlog" ? "BACKLOG" : wt.status === "done" ? "DONE" : "ARCHIVED";
								if (lastStatus !== null) lines.push("");
								lines.push(`  ${theme.fg(statusColor(wt.status), theme.bold(label))}`);
								lastStatus = wt.status;
							}

							const sel = i === selectedIdx;
							const cursor = sel ? theme.fg("accent", "▶") : " ";
							const icon = theme.fg(statusColor(wt.status), statusIcon(wt.status));
							const name = sel ? theme.fg("accent", theme.bold(wt.name)) : wt.name;
							const branchStr = theme.fg("borderAccent", wt.branch.length > 30 ? wt.branch.slice(0, 27) + "..." : wt.branch);
							const gs = gitStatusStr(wt.gitStatus, theme);
							const tags = (wt.meta?.tags ?? []).length > 0 ? " " + (wt.meta!.tags!).map(t => theme.fg("warning", `[${t}]`)).join(" ") : "";
							const ticket = wt.meta?.ticket ? theme.fg("accent", ` ${wt.meta.ticket}`) : "";
							const note = wt.meta?.note ? theme.fg("borderAccent", ` — ${wt.meta.note.slice(0, 25)}`) : "";

							lines.push(truncateToWidth(`${cursor} ${icon} ${name}  ${branchStr}  ${gs}${ticket}${tags}${note}`, w, ""));
						}
					}

					lines.push(theme.fg("accent", "─".repeat(w)));
					const hint = currentTab === "main"
						? "  ↑↓ 이동 · Enter 전환 · Tab 아카이브 · Space 상태순환 · a 아카이브로 · t 태그 · / 필터 · n 새로 · , help"
						: "  ↑↓ 이동 · Enter 전환 · Tab 메인 · a 메인으로 복관 · d 삭제 · / 필터 · , help";
					lines.push(theme.fg("border", hint));
					return lines;
				},

				handleInput: (data: string) => {
					if (showHelp) { showHelp = false; (tui as any).requestRender?.(); return; }

					const visible = getVisible();

					// Filter mode
					if (filterMode) {
						if (matchesKey(data, Key.escape)) { filterMode = false; filterBuffer = ""; selectedIdx = 0; }
						else if (matchesKey(data, Key.enter)) { filterMode = false; selectedIdx = 0; }
						else if (matchesKey(data, Key.backspace)) { filterBuffer = filterBuffer.slice(0, -1); selectedIdx = 0; }
						else if (data.length === 1 && data >= " ") { filterBuffer += data; selectedIdx = 0; }
						(tui as any).requestRender?.();
						return;
					}

					// Input mode (tag/note)
					if (inputMode) {
						if (matchesKey(data, Key.escape)) { inputMode = null; inputBuffer = ""; }
						else if (matchesKey(data, Key.enter)) {
							const wt = visible[selectedIdx];
							if (wt?.meta && inputBuffer.trim()) {
								if (inputMode === "tag") {
									wt.meta.tags = inputBuffer.split(",").map(t => t.trim()).filter(Boolean);
								} else if (inputMode === "note") {
									wt.meta.note = inputBuffer.trim();
								}
								writeMeta(wt.path, wt.meta);
							}
							inputMode = null; inputBuffer = "";
						}
						else if (matchesKey(data, Key.backspace)) { inputBuffer = inputBuffer.slice(0, -1); }
						else if (data.length === 1 && data >= " ") { inputBuffer += data; }
						(tui as any).requestRender?.();
						return;
					}

					// Navigation
					if (data === "q" || matchesKey(data, Key.escape)) { done(null); return; }
					if (matchesKey(data, Key.up) || data === "k") { selectedIdx = Math.max(0, selectedIdx - 1); }
					else if (matchesKey(data, Key.down) || data === "j") { selectedIdx = Math.min(visible.length - 1, selectedIdx + 1); }

					// Enter: switch
					else if (matchesKey(data, Key.enter)) {
						const wt = visible[selectedIdx];
						if (wt) done(wt);
						return;
					}

					// Tab: switch between main and archive
					else if (data === "\t" || matchesKey(data, Key.tab)) {
						currentTab = currentTab === "main" ? "archive" : "main";
						selectedIdx = 0;
						filterBuffer = "";
					}

					// Space: cycle status (backlog → active → done) — main tab only
					else if (data === " " && currentTab === "main") {
						const wt = visible[selectedIdx];
						if (wt?.meta) {
							wt.meta.status = cycleStatus(wt.status);
							wt.meta.doneAt = wt.meta.status === "done" ? Date.now() : undefined;
							wt.status = wt.meta.status;
							writeMeta(wt.path, wt.meta);
						}
					}

					// a: archive (main→archive) or restore (archive→main)
					else if (data === "a") {
						const wt = visible[selectedIdx];
						if (wt?.meta) {
							if (currentTab === "main") {
								wt.meta.status = "archived";
							} else {
								wt.meta.status = "active";
							}
							wt.status = wt.meta.status;
							writeMeta(wt.path, wt.meta);
							const newVisible = getVisible();
							if (selectedIdx >= newVisible.length) selectedIdx = Math.max(0, newVisible.length - 1);
						}
					}

					// t: tag edit
					else if (data === "t") {
						const wt = visible[selectedIdx];
						if (wt?.meta) { inputMode = "tag"; inputBuffer = (wt.meta.tags ?? []).join(", "); }
					}

					// e: note edit
					else if (data === "e") {
						const wt = visible[selectedIdx];
						if (wt?.meta) { inputMode = "note"; inputBuffer = wt.meta.note ?? ""; }
					}

					// /: filter
					else if (data === "/") { filterMode = true; filterBuffer = ""; }

					// ,: help
					else if (matchesKey(data, ",")) { showHelp = true; }

					// n: new worktree (exit overlay, pre-fill command)
					else if (data === "n") { done(null); ctx.ui.setEditorText("/wt new"); return; }

					// d: delete (mark for removal on close)
					else if (data === "d") {
						const wt = visible[selectedIdx];
						if (wt) { done(null); ctx.ui.setEditorText(`/wt rm ${wt.name}`); return; }
					}

					(tui as any).requestRender?.();
				},
				invalidate: () => {},
			};
		},
		{ overlay: true, overlayOptions: { width: "85%", maxHeight: "70%", anchor: "center" } },
	);
}

async function handleFork(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const parsed = parseNewArgs(args);
	const repoRoot = await resolveRepoRoot(pi, ctx, parsed.repo);
	if (!repoRoot) return;

	const panelGuard = getWorktreeCreationPanelGuardMessage(repoRoot, ctx);
	if (panelGuard) { ctx.ui.notify(panelGuard, "error"); return; }
	const hotfixGuard = getHotfixBaseGuardMessage(parsed, "/wt fork");
	if (hotfixGuard) { ctx.ui.notify(hotfixGuard, "error"); return; }

	const { isNew: justRegistered } = autoRegister(repoRoot);
	if (justRegistered) ctx.ui.notify(`Registered repo "${basename(repoRoot)}"`, "info");

	const config = loadConfig(repoRoot);

	let baseBranch: string;
	if (parsed.from) baseBranch = parsed.from;
	else if (parsed.hotfix || parsed.hotfeature) baseBranch = config.productionBranch;
	else baseBranch = config.baseBranch;

	let prefix: string;
	if (parsed.hotfix) prefix = "hotfix";
	else if (parsed.hotfeature) prefix = "hotfeature";
	else prefix = config.branchPrefix;

	mkdirSync(config.rootDir, { recursive: true });
	const existing = new Set(listExistingWorktrees(config.rootDir).map((w) => w.name));
	const name = parsed.name ?? pickName(config.namingScheme, existing);

	if (existing.has(name)) {
		ctx.ui.notify(`Worktree "${name}" already exists at ${config.rootDir}`, "error");
		return;
	}

	const worktreePath = join(config.rootDir, name);
	const branchName = parsed.branch
		? parsed.branch
		: parsed.ticket
			? `${prefix}/${parsed.ticket}/${name}`
			: `${prefix}/${name}`;

	const contextContent = readContextFileOption(ctx, parsed.contextFile);
	if (parsed.contextFile && contextContent === null) return;

	ctx.ui.notify(`Forking current session into "${name}" from origin/${baseBranch}…`, "info");

	const fetchR = await pi.exec("git", ["fetch", "origin", baseBranch], { cwd: repoRoot });
	if (fetchR.code !== 0) {
		ctx.ui.notify(`git fetch failed: ${fetchR.stderr?.trim().slice(0, 200) ?? "unknown error"}`, "error");
		return;
	}

	const addR = await pi.exec("git", ["worktree", "add", worktreePath, "-b", branchName, `origin/${baseBranch}`], { cwd: repoRoot });
	if (addR.code !== 0) {
		ctx.ui.notify(`git worktree add failed: ${addR.stderr?.trim().slice(0, 200)}`, "error");
		return;
	}

	writeMeta(worktreePath, {
		name,
		branch: branchName,
		baseBranch,
		createdAt: Date.now(),
		ticket: parsed.ticket,
		note: parsed.note,
	});
	const framePromotion = promotePlanningFrameToWorktree(worktreePath, readMeta(worktreePath) ?? {
		name,
		branch: branchName,
		baseBranch,
		createdAt: Date.now(),
		ticket: parsed.ticket,
		note: parsed.note,
	});
	if (framePromotion.status === "promoted") ctx.ui.notify(`✓ planning frame promoted to ${name}/.pi/frame.json`, "info");
	else if (framePromotion.status === "error") ctx.ui.notify(`Frame promotion skipped: ${framePromotion.error}`, "warning");

	ctx.ui.notify(`✓ ${name} forked (${branchName})`, "info");

	if (config.setupScript) {
		ctx.ui.notify(`Running setup: ${config.setupScript}…`, "info");
		const setupR = await pi.exec("bash", ["-lc", config.setupScript], { cwd: worktreePath });
		if (setupR.code !== 0) {
			ctx.ui.notify(`Setup script failed (code ${setupR.code}). Worktree created but setup skipped.`, "warning");
		} else {
			ctx.ui.notify(`✓ Setup complete`, "info");
		}
	}

	const session = createWorktreeSession(ctx, worktreePath, {
		carryContext: true,
		contextContent,
		sessionName: `${name} (${branchName})`,
	});
	const contextLabel = `${session.carriedContext ? " — context carried" : session.appendedContext ? " — context loaded" : ""}${framePromotionContextLabel(framePromotion)}`;

	try {
		await switchSessionToWorktree(ctx, session.sessionFile, name, worktreePath, contextLabel);
	} catch (error) {
		const reason = error instanceof Error ? ` (${error.message})` : "";
		ctx.ui.notify(`✓ Created. cwd: ${worktreePath}${reason}`, "info");
	}
}

async function handleSwitch(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const target = args.trim();

	// No argument: show dashboard overlay
	if (!target) {
		const selected = await showDashboard(pi, ctx);
		if (selected) return switchToWorktree(pi, selected.name, selected.path, ctx);
		return;
	}

	let repoRoot: string;
	let wtName: string;

	if (target.includes("/")) {
		const slashIdx = target.indexOf("/");
		const repoName = target.slice(0, slashIdx);
		wtName = target.slice(slashIdx + 1);
		const reg = loadRegistry();
		if (!reg[repoName]) {
			ctx.ui.notify(`Repo "${repoName}" not registered. Available: ${Object.keys(reg).join(", ") || "(none)"}`, "error");
			return;
		}
		repoRoot = reg[repoName];
	} else {
		const resolved = await resolveRepoRoot(pi, ctx);
		if (!resolved) return;
		repoRoot = resolved;
		wtName = target;
	}

	const config = loadConfig(repoRoot);
	const path = join(config.rootDir, wtName);
	if (!existsSync(path)) { ctx.ui.notify(`Worktree "${wtName}" not found at ${path}`, "error"); return; }

	return switchToWorktree(pi, wtName, path, ctx);
}

async function handleRepo(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const tokens = tokenize(args);
	const sub = tokens[0] ?? "list";
	const reg = loadRegistry();

	if (sub === "list" || sub === "ls") {
		const names = Object.keys(reg).sort();
		if (names.length === 0) {
			ctx.ui.notify("No repos registered.", "info");
			return;
		}
		const lines = ["Registered repos:"];
		for (const name of names) {
			const exists = existsSync(reg[name]);
			lines.push(`  ${name.padEnd(15)} ${reg[name]}${exists ? "" : " (path missing)"}`);
		}
		ctx.ui.notify(lines.join("\n"), "info");
		return;
	}

	if (sub === "add") {
		const name = tokens[1];
		const path = tokens[2];
		if (!name || !path) { ctx.ui.notify("Usage: /wt repo add <name> <path>", "error"); return; }
		const expanded = expandHome(path);
		const root = await findRepoRoot(pi, expanded);
		if (!root) { ctx.ui.notify(`${expanded} is not a git repository`, "error"); return; }
		const canonicalRoot = await canonicalRepoRoot(pi, root);
		const existingName = findRegisteredName(reg, canonicalRoot);
		if (existingName && existingName !== name) {
			ctx.ui.notify(`Repo already registered as "${existingName}" → ${reg[existingName]}. Not adding duplicate alias "${name}".`, "info");
			return;
		}
		reg[name] = canonicalRoot;
		saveRegistry(reg);
		ctx.ui.notify(`Registered "${name}" → ${canonicalRoot}`, "info");
		return;
	}

	if (sub === "rm" || sub === "remove") {
		const name = tokens[1];
		if (!name) { ctx.ui.notify("Usage: /wt repo rm <name>", "error"); return; }
		if (!reg[name]) { ctx.ui.notify(`Repo "${name}" not registered`, "error"); return; }
		delete reg[name];
		saveRegistry(reg);
		ctx.ui.notify(`Unregistered "${name}"`, "info");
		return;
	}

	if (sub === "rename") {
		const oldName = tokens[1];
		const newName = tokens[2];
		if (!oldName || !newName) { ctx.ui.notify("Usage: /wt repo rename <old> <new>", "error"); return; }
		if (!reg[oldName]) { ctx.ui.notify(`Repo "${oldName}" not registered`, "error"); return; }
		if (reg[newName]) { ctx.ui.notify(`Name "${newName}" already taken`, "error"); return; }
		reg[newName] = reg[oldName];
		delete reg[oldName];
		saveRegistry(reg);
		ctx.ui.notify(`Renamed "${oldName}" → "${newName}"`, "info");
		return;
	}

	ctx.ui.notify("Usage: /wt repo [list|add|rm|rename]", "info");
}

async function handleConfig(_pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const repoRoot = await findRepoRoot(_pi, ctx.cwd);
	if (!repoRoot) { ctx.ui.notify("Not a git repository", "error"); return; }

	const sub = args.trim();
	if (sub === "init") {
		const cfg = loadConfig(repoRoot);
		saveConfig(repoRoot, cfg);
		ctx.ui.notify(`Config written to ${configPath(repoRoot)}`, "info");
		return;
	}
	if (sub === "show" || sub === "") {
		const cfg = loadConfig(repoRoot);
		const exists = existsSync(configPath(repoRoot));
		const lines = [
			`Config (${exists ? configPath(repoRoot) : "default — not saved"}):`,
			JSON.stringify(cfg, null, 2),
		];
		ctx.ui.notify(lines.join("\n"), "info");
		return;
	}
	ctx.ui.notify("Usage: /wt config [show|init]", "info");
}

// ─── Conductor Bridge ───────────────────────────────────────────────────────

function conductorDbPath(): string {
	for (const profile of loadConductorProfiles()) {
		if (profile.dbPath) return expandProfileTemplate(profile.dbPath);
	}
	return "";
}

function conductorProjectRoots(): string[] {
	const roots = new Set<string>();
	for (const profile of loadConductorProfiles()) {
		if (profile.projectRoot) roots.add(expandProfileTemplate(profile.projectRoot));
		for (const template of profile.projectDirTemplates ?? []) roots.add(dirname(expandProfileTemplate(template, { repo: "", workspace: "" })));
	}
	return [...roots];
}

function conductorWorkspaceDirIncludes(): string[] {
	return [...new Set(loadConductorProfiles().flatMap((profile) => profile.workspaceDirIncludes ?? []))];
}

interface ConductorWorkspace {
	directoryName: string;
	branch: string;
	state: string;
	prTitle: string | null;
	repoName: string;
	activeSessionId: string | null;
	createdAt: string;
}

function sanitizeSql(s: string): string {
	return s.replace(/'/g, "''");
}

async function queryConductor(pi: ExtensionAPI, sql: string): Promise<string> {
	const dbPath = conductorDbPath();
	if (!dbPath || !existsSync(dbPath)) return "";
	const r = await pi.exec("sqlite3", ["-separator", "§", dbPath, sql]);
	return r.code === 0 ? (r.stdout?.trim() ?? "") : "";
}

async function listConductorWorkspaces(pi: ExtensionAPI, repoFilter?: string): Promise<ConductorWorkspace[]> {
	const where = repoFilter ? ` WHERE r.name='${sanitizeSql(repoFilter)}'` : "";
	const result = await queryConductor(pi,
		`SELECT w.directory_name, w.branch, w.state, COALESCE(w.pr_title,''), COALESCE(r.name,''), COALESCE(w.active_session_id,''), w.created_at FROM workspaces w LEFT JOIN repos r ON w.repository_id = r.id${where} ORDER BY w.created_at DESC`
	);
	if (!result) return [];
	return result.split("\n").map(line => {
		const p = line.split("§");
		return { directoryName: p[0], branch: p[1], state: p[2], prTitle: p[3] || null, repoName: p[4], activeSessionId: p[5] || null, createdAt: p[6] };
	});
}

async function buildResumeContext(pi: ExtensionAPI, ws: ConductorWorkspace, sessionId: string, repoPath: string): Promise<string> {
	const lines: string[] = [];
	lines.push(`# Conductor 워크스페이스: ${ws.directoryName}`, "");
	lines.push("| 항목 | 값 |", "|------|-----|");
	lines.push(`| Branch | \`${ws.branch}\` |`);
	lines.push(`| PR | ${ws.prTitle ?? "(없음)"} |`);
	lines.push(`| 상태 | ${ws.state} |`);
	lines.push(`| 생성일 | ${ws.createdAt} |`);
	lines.push(`| Session | \`${sessionId}\` |`, "");

	const rawUsers = await queryConductor(pi,
		`SELECT content FROM session_messages WHERE session_id='${sanitizeSql(sessionId)}' AND role='user' AND content IS NOT NULL ORDER BY created_at`
	);
	if (rawUsers) {
		const msgs = rawUsers.split("\n").filter(m =>
			m.length > 15 && !m.startsWith("<system") && !m.startsWith("<local-command")
			&& !m.startsWith("<command-name>") && !m.startsWith("Base directory for this skill")
			&& !m.startsWith("Continue from where") && !m.startsWith("[Request interrupted")
		);
		if (msgs.length > 0) {
			lines.push("## 이전 대화 (사용자 요청)", "");
			for (const m of msgs) lines.push(`- ${m.slice(0, 300).replace(/\n/g, " ")}`);
			lines.push("");
		}
	}

	const baseBranch = loadConfig(repoPath).baseBranch;
	const log = await pi.exec("git", ["log", "--oneline", "-15", `origin/${baseBranch}..${ws.branch}`], { cwd: repoPath });
	if (log.code === 0 && log.stdout?.trim()) {
		lines.push("## 브랜치 커밋", "", "```", log.stdout.trim(), "```", "");
	}

	const diff = await pi.exec("git", ["diff", "--name-only", `origin/${baseBranch}...${ws.branch}`], { cwd: repoPath });
	if (diff.code === 0 && diff.stdout?.trim()) {
		lines.push("## 변경된 파일", "");
		for (const f of diff.stdout.trim().split("\n")) lines.push(`- ${f}`);
		lines.push("");
	}

	lines.push("## 전체 대화 기록", "");
	lines.push(`JSONL: configured Conductor project roots에서 \`${ws.directoryName}/${sessionId}.jsonl\` 탐색`);
	return lines.join("\n");
}

function findConductorJsonl(wsName: string, sessionId: string): string | null {
	const roots = conductorProjectRoots();
	const dirIncludes = conductorWorkspaceDirIncludes();
	for (const base of roots) {
		if (!existsSync(base)) continue;
		for (const dir of readdirSync(base)) {
			const matchesKind = dirIncludes.length === 0 || dirIncludes.some((part) => dir.includes(part));
			if (matchesKind && dir.endsWith(wsName)) {
				const jsonl = join(base, dir, `${sessionId}.jsonl`);
				if (existsSync(jsonl)) return jsonl;
			}
		}
	}
	return null;
}

interface ConductorSessionSource {
	workspaceName: string;
	sessionId: string;
	jsonlPath?: string;
	title?: string;
	createdAt?: string;
	model?: string;
}

function parseOptionalDate(value?: string): Date | null {
	if (!value) return null;
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function convertConductorToPiSession(jsonlPath: string, worktreePath: string, title?: string, source?: ConductorSessionSource): string | null {
	const raw = readFileSync(jsonlPath, "utf8");
	const lines = raw.split("\n").filter(Boolean);

	const sourceCreatedAt = parseOptionalDate(source?.createdAt);
	const sessionTimestampMs = sourceCreatedAt?.getTime() ?? Date.now();
	const sessionId = `${sessionTimestampMs.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	const entries: string[] = [];
	const nowIso = new Date().toISOString();
	const sessionIso = sourceCreatedAt?.toISOString() ?? nowIso;
	const titleText = normalizeSessionText(title ?? "");
	const normalizedTitle = titleText && !["untitled", "(untitled)"].includes(titleText.toLowerCase()) ? titleText : "";

	entries.push(JSON.stringify({
		type: "session", version: 3, id: sessionId,
		timestamp: sessionIso, cwd: worktreePath,
		source: source ? {
			type: "conductor",
			workspaceName: source.workspaceName,
			sessionId: source.sessionId,
			jsonlPath: source.jsonlPath,
			title: source.title,
			createdAt: source.createdAt,
			model: source.model,
		} : undefined,
	}));
	if (normalizedTitle) {
		entries.push(JSON.stringify({
			type: "session_info", id: "00000000", parentId: null,
			timestamp: sessionIso, name: normalizedTitle,
		}));
	}

	let prevId: string | null = normalizedTitle ? "00000000" : null;
	let counter = 0;

	for (const line of lines) {
		let obj: any;
		try { obj = JSON.parse(line); } catch { continue; }

		if (obj.type === "user") {
			let text = "";
			const c = obj.message?.content;
			if (typeof c === "string") text = c;
			else if (Array.isArray(c)) text = c.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
			if (!text || text.length < 5 || text.startsWith("<system") || text.startsWith("<local-command")) continue;

			const id = (++counter).toString(16).padStart(8, "0");
			entries.push(JSON.stringify({
				type: "message", id, parentId: prevId, timestamp: obj.timestamp ?? new Date().toISOString(),
				message: { role: "user", content: [{ type: "text", text }], timestamp: Date.now() },
			}));
			prevId = id;
		} else if (obj.type === "assistant" && obj.message?.content) {
			const content = obj.message.content;
			if (!Array.isArray(content)) continue;
			const textBlocks = content.filter((b: any) => b.type === "text" && b.text).map((b: any) => ({ type: "text", text: b.text }));
			if (textBlocks.length === 0) continue;

			const id = (++counter).toString(16).padStart(8, "0");
			entries.push(JSON.stringify({
				type: "message", id, parentId: prevId, timestamp: obj.timestamp ?? new Date().toISOString(),
				message: {
					role: "assistant", content: textBlocks,
					api: "messages", provider: "anthropic",
					model: obj.message.model ?? "unknown",
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "stop", timestamp: Date.now(),
				},
			}));
			prevId = id;
		}
	}

	if (counter === 0) return null;

	const sessionDir = sessionDirForWorktree(worktreePath);
	mkdirSync(sessionDir, { recursive: true });
	const sessionFile = join(sessionDir, `${sessionTimestampMs}_${sessionId}.jsonl`);
	writeFileSync(sessionFile, entries.join("\n") + "\n");
	return sessionFile;
}

interface ConductorSession {
	id: string;
	title: string;
	createdAt: string;
	model: string;
}

async function listConductorSessions(pi: ExtensionAPI, wsName: string): Promise<ConductorSession[]> {
	const result = await queryConductor(pi,
		`SELECT s.id, COALESCE(s.title,'(untitled)'), COALESCE(s.created_at,''), COALESCE(s.model,'') FROM sessions s JOIN workspaces w ON s.workspace_id = w.id WHERE w.directory_name='${sanitizeSql(wsName)}' ORDER BY s.created_at DESC`
	);
	if (!result) return [];
	return result.split("\n").map(line => {
		const p = line.split("§");
		return { id: p[0], title: p[1], createdAt: p[2], model: p[3] };
	});
}

function sessionHasConductorSource(sessionPath: string, workspaceName: string, sessionId: string): boolean {
	try {
		const raw = readFileSync(sessionPath, "utf8");
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			let entry: any;
			try { entry = JSON.parse(line); } catch { continue; }
			const source = entry?.source;
			if (source?.type === "conductor" && source.workspaceName === workspaceName && source.sessionId === sessionId) return true;
		}
	} catch {
		// Missing/corrupt sessions are ignored by the hydrate idempotency check.
	}
	return false;
}

function sortedWorktreeSessionFiles(worktreePath: string): string[] {
	const sessionDir = sessionDirForWorktree(worktreePath);
	if (!existsSync(sessionDir)) return [];
	return readdirSync(sessionDir)
		.filter((file) => file.endsWith(".jsonl"))
		.map((file) => join(sessionDir, file))
		.sort((a, b) => {
			try { return statSync(b).mtimeMs - statSync(a).mtimeMs; } catch { return basename(b).localeCompare(basename(a)); }
		});
}

function findExistingConductorPiSession(worktreePath: string, workspaceName: string, sessionId: string, transcriptKey?: string): string | null {
	const files = sortedWorktreeSessionFiles(worktreePath);
	const sourceMatch = files.find((file) => sessionHasConductorSource(file, workspaceName, sessionId));
	if (sourceMatch) return sourceMatch;
	if (!transcriptKey) return null;
	return files.find((file) => parseSessionChoiceInfo(file).transcriptKey === transcriptKey) ?? null;
}

function conductorTranscriptKey(jsonlPath: string): string | undefined {
	const transcriptHash = createHash("sha1");
	let count = 0;
	try {
		const raw = readFileSync(jsonlPath, "utf8");
		for (const line of raw.split("\n")) {
			if (!line.trim()) continue;
			let obj: any;
			try { obj = JSON.parse(line); } catch { continue; }

			if (obj.type === "user") {
				let text = "";
				const c = obj.message?.content;
				if (typeof c === "string") text = c;
				else if (Array.isArray(c)) text = c.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
				if (!text || text.length < 5 || text.startsWith("<system") || text.startsWith("<local-command")) continue;
				const messageKey = createHash("sha1")
					.update(JSON.stringify({ role: "user", content: [{ type: "text", text }] }))
					.digest("hex");
				transcriptHash.update(messageKey).update("\n");
				count += 1;
			} else if (obj.type === "assistant" && obj.message?.content) {
				const content = obj.message.content;
				if (!Array.isArray(content)) continue;
				const textBlocks = content.filter((b: any) => b.type === "text" && b.text).map((b: any) => ({ type: "text", text: b.text }));
				if (textBlocks.length === 0) continue;
				const messageKey = createHash("sha1")
					.update(JSON.stringify({ role: "assistant", content: textBlocks }))
					.digest("hex");
				transcriptHash.update(messageKey).update("\n");
				count += 1;
			}
		}
	} catch {
		return undefined;
	}
	return count > 0 ? transcriptHash.digest("hex") : undefined;
}

interface ConductorHydrationResult {
	total: number;
	created: string[];
	existing: string[];
	missingJsonl: ConductorSession[];
	empty: ConductorSession[];
}

function conductorHydrationSummary(wsName: string, result: ConductorHydrationResult): string {
	const parts = [`전체 ${result.total}`];
	if (result.created.length > 0) parts.push(`새로 복구 ${result.created.length}`);
	if (result.existing.length > 0) parts.push(`기존 ${result.existing.length}`);
	if (result.missingJsonl.length > 0) parts.push(`JSONL 없음 ${result.missingJsonl.length}`);
	if (result.empty.length > 0) parts.push(`빈 세션 ${result.empty.length}`);
	return `Conductor 세션 동기화 — ${wsName}: ${parts.join(" · ")}`;
}

async function hydrateConductorSessionsForWorktree(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	wsName: string,
	worktreePath: string,
	options: { notifyAlways?: boolean } = {},
): Promise<ConductorHydrationResult> {
	const sessions = await listConductorSessions(pi, wsName);
	const result: ConductorHydrationResult = { total: sessions.length, created: [], existing: [], missingJsonl: [], empty: [] };
	if (sessions.length === 0) return result;

	for (const session of sessions) {
		const sourceExisting = findExistingConductorPiSession(worktreePath, wsName, session.id);
		if (sourceExisting) {
			result.existing.push(sourceExisting);
			continue;
		}

		const jsonlPath = findConductorJsonl(wsName, session.id);
		if (!jsonlPath) {
			result.missingJsonl.push(session);
			continue;
		}

		const transcriptExisting = findExistingConductorPiSession(worktreePath, wsName, session.id, conductorTranscriptKey(jsonlPath));
		if (transcriptExisting) {
			result.existing.push(transcriptExisting);
			continue;
		}

		const sessionFile = convertConductorToPiSession(jsonlPath, worktreePath, session.title, {
			workspaceName: wsName,
			sessionId: session.id,
			jsonlPath,
			title: session.title,
			createdAt: session.createdAt,
			model: session.model,
		});
		if (sessionFile) result.created.push(sessionFile);
		else result.empty.push(session);
	}

	const hasChangeOrGap = result.created.length > 0 || result.missingJsonl.length > 0 || result.empty.length > 0;
	if (options.notifyAlways || hasChangeOrGap) {
		ctx.ui.notify(
			conductorHydrationSummary(wsName, result),
			result.missingJsonl.length > 0 || result.empty.length > 0 ? "warning" : "info",
		);
	}
	return result;
}

async function handleResume(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const tokens = tokenize(args);

	if (!tokens[0] || tokens[0] === "--list" || tokens[0] === "list") {
		const repoFilter = (tokens[0] === "--list" || tokens[0] === "list") ? tokens[1] : undefined;
		const workspaces = await listConductorWorkspaces(pi, repoFilter);
		if (workspaces.length === 0) {
			ctx.ui.notify("No Conductor workspaces found. Is Conductor installed?", "info");
			return;
		}
		const lines = workspaces.slice(0, 40).map(w =>
			`  ${w.directoryName.padEnd(22)} ${(w.repoName ?? "").padEnd(10)} ${w.state.padEnd(10)} ${w.prTitle?.slice(0, 50) ?? w.branch}`
		);
		ctx.ui.notify(["Conductor workspaces:", ...lines].join("\n"), "info");
		return;
	}

	const name = tokens[0];
	let repoFlag: string | undefined;
	for (let i = 1; i < tokens.length; i++) {
		if (tokens[i] === "--repo" && i + 1 < tokens.length) repoFlag = tokens[++i];
	}

	const workspaces = await listConductorWorkspaces(pi);
	const ws = workspaces.find(w => w.directoryName === name);
	if (!ws) {
		ctx.ui.notify(`Conductor workspace "${name}" not found.`, "error");
		return;
	}

	const sessionId = ws.activeSessionId ?? undefined;

	const reg = loadRegistry();
	const repoName = repoFlag ?? ws.repoName;
	const repoPath = reg[repoName];
	if (!repoPath) {
		ctx.ui.notify(`Repo "${repoName}" not registered. Available: ${Object.keys(reg).join(", ") || "(none)"}.\nUse: /wt repo add ${repoName} <path>`, "error");
		return;
	}

	const config = loadConfig(repoPath);
	const worktreePath = join(config.rootDir, name);

	if (existsSync(worktreePath)) {
		ctx.ui.notify(`✓ "${name}" already exists (${ws.branch})`, "info");
		return switchToWorktree(pi, name, worktreePath, ctx, { notifyConductorHydration: true });
	}

	ctx.ui.notify(`Fetching branch ${ws.branch}…`, "info");
	await pi.exec("git", ["fetch", "origin", ws.branch], { cwd: repoPath });

	// Check if branch is used by another worktree (e.g. old Conductor worktree)
	const wtList = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd: repoPath });
	if (wtList.code === 0 && wtList.stdout) {
		let conflictPath: string | null = null;
		let currentWtPath = "";
		for (const line of wtList.stdout.split("\n")) {
			if (line.startsWith("worktree ")) currentWtPath = line.slice(9);
			if (line.startsWith("branch ") && line.slice(7) === `refs/heads/${ws.branch}`) {
				if (currentWtPath !== repoPath) conflictPath = currentWtPath;
			}
		}
		if (conflictPath) {
			const ok = await ctx.ui.confirm("Branch conflict",
				`"${ws.branch}" is checked out at:\n${conflictPath}\n\nRemove old worktree and continue?`);
			if (!ok) { ctx.ui.notify("Cancelled.", "info"); return; }
			await pi.exec("git", ["worktree", "remove", "--force", conflictPath], { cwd: repoPath });
			ctx.ui.notify(`Removed old worktree: ${conflictPath}`, "info");
		}
	}

	mkdirSync(config.rootDir, { recursive: true });
	const localCheck = await pi.exec("git", ["rev-parse", "--verify", ws.branch], { cwd: repoPath });
	const addArgs = localCheck.code === 0
		? ["worktree", "add", worktreePath, ws.branch]
		: ["worktree", "add", "-b", ws.branch, worktreePath, `origin/${ws.branch}`];

	const addR = await pi.exec("git", addArgs, { cwd: repoPath });
	if (addR.code !== 0) {
		ctx.ui.notify(`git worktree add failed: ${addR.stderr?.trim().slice(0, 300)}`, "error");
		return;
	}

	writeMeta(worktreePath, {
		name, branch: ws.branch, baseBranch: config.baseBranch,
		createdAt: Date.now(), note: ws.prTitle ?? "Resumed from Conductor",
	});

	if (sessionId) {
		ctx.ui.notify("Extracting session context…", "info");
		const context = await buildResumeContext(pi, ws, sessionId, repoPath);
		const contextDir = join(worktreePath, ".pi");
		mkdirSync(contextDir, { recursive: true });
		writeFileSync(join(contextDir, "conductor-context.md"), context);
	}

	ctx.ui.notify(`✓ ${name} resumed (${ws.branch})${ws.prTitle ? ` — ${ws.prTitle}` : ""}`, "info");

	if (config.setupScript) {
		ctx.ui.notify("Running setup…", "info");
		const setupR = await pi.exec("bash", ["-lc", config.setupScript], { cwd: worktreePath });
		if (setupR.code !== 0) ctx.ui.notify(`Setup failed (code ${setupR.code}).`, "warning");
	}

	return switchToWorktree(pi, name, worktreePath, ctx, { notifyConductorHydration: true });
}

async function resolveSessionsWorktree(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext, overrideCwd?: string): Promise<{ wtName: string; wtPath: string } | null> {
	const tokens = tokenize(args);
	const target = tokens[0];

	if (overrideCwd) {
		const meta = readMeta(overrideCwd);
		return { wtName: target || meta?.name || basename(overrideCwd), wtPath: overrideCwd };
	}

	if (!target) {
		const currentRoot = await findRepoRoot(pi, ctx.cwd) ?? ctx.cwd;
		const meta = readMeta(currentRoot);
		return { wtName: meta?.name ?? basename(currentRoot), wtPath: currentRoot };
	}

	let repoRoot: string;
	let wtName: string;
	if (target.includes("/")) {
		const slashIdx = target.indexOf("/");
		const repoName = target.slice(0, slashIdx);
		wtName = target.slice(slashIdx + 1);
		const reg = loadRegistry();
		if (!reg[repoName]) {
			ctx.ui.notify(`Repo "${repoName}" not registered. Available: ${Object.keys(reg).join(", ") || "(none)"}`, "error");
			return null;
		}
		repoRoot = reg[repoName];
	} else {
		const resolved = await resolveRepoRoot(pi, ctx);
		if (!resolved) return null;
		repoRoot = resolved;
		wtName = target;
	}

	const config = loadConfig(repoRoot);
	const wtPath = join(config.rootDir, wtName);
	if (!existsSync(wtPath)) {
		ctx.ui.notify(`Worktree "${wtName}" not found at ${wtPath}`, "error");
		return null;
	}
	return { wtName, wtPath };
}

async function handleSessions(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext, overrideCwd?: string) {
	const resolved = await resolveSessionsWorktree(pi, args, ctx, overrideCwd);
	if (!resolved) return;
	ctx.ui.notify("/wt sessions는 /wt switch의 세션 선택 흐름으로 통합되었습니다.", "info");
	return switchToWorktree(pi, resolved.wtName, resolved.wtPath, ctx, { notifyConductorHydration: true });
}

// ─── Subcommand dispatch ───────────────────────────────────────────────────

async function handleWt(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const trimmed = args.trim();
	if (!trimmed) {
		const t = ctx.ui.theme;
		ctx.ui.notify([
			t.fg("accent", "Usage:"),
			`  ${t.fg("warning", "/wt new")} ${t.fg("borderAccent", "[name] [--repo <name>] [--hotfix|--hotfeature|--from <branch>] [--ticket PROJ-123] [--carry-context]")}`,
			`  ${t.fg("warning", "/wt fork")} ${t.fg("borderAccent", "[name] [--context-file <path>] [--repo <name>] [--hotfix|--from <branch>]  — 현재 세션 전체를 이어받아 워크트리 생성")}`,
			`  ${t.fg("warning", "/wt switch")} ${t.fg("borderAccent", "<name> | <repo>/<name>  — 워크트리 선택 후 세션 선택")}`,
			`  ${t.fg("warning", "/wt resume")} ${t.fg("borderAccent", "<conductor-workspace>  — Conductor 워크스페이스 전체 세션 복원")}`,
			`  ${t.fg("warning", "/wt bootstrap")} ${t.fg("borderAccent", "[status|--backend|--frontend|--all|--executor]  — profile 기반 의존성 AI orchestrator/worker 준비")}`,
			`  ${t.fg("warning", "/wt list")} ${t.fg("borderAccent", "[--all]  \u2014 \uc6cc\ud06c\ud2b8\ub9ac \ubaa9\ub85d")}`,
			`  ${t.fg("warning", "/wt rm")} ${t.fg("borderAccent", "<name> [--force]  \u2014 \uc6cc\ud06c\ud2b8\ub9ac \uc0ad\uc81c")}`,
			`  ${t.fg("warning", "/wt repo")} ${t.fg("borderAccent", "[list|add|rm|rename]  \u2014 \ub808\ud3ec \ub4f1\ub85d \uad00\ub9ac")}`,
			`  ${t.fg("warning", "/wt config")} ${t.fg("borderAccent", "[show|init]  \u2014 \uc124\uc815 \ud655\uc778/\ucd08\uae30\ud654")}`,
			`  ${t.fg("border", "Ctrl+W — 워크트리 대시보드 단축키")}`,
		].join("\n"), "info");
		return;
	}

	const spaceIdx = trimmed.indexOf(" ");
	const sub = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
	const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

	switch (sub) {
		case "new": return handleNew(pi, rest, ctx);
		case "fork": return handleFork(pi, rest, ctx);
		case "list": case "ls": return handleList(pi, rest, ctx);
		case "rm": case "remove": return handleRemove(pi, rest, ctx);
		case "switch": case "sw": return handleSwitch(pi, rest, ctx);
		case "repo": return handleRepo(pi, rest, ctx);
		case "config": return handleConfig(pi, rest, ctx);
		case "resume": return handleResume(pi, rest, ctx);
		case "bootstrap": case "deps": return handleBootstrap(pi, rest, ctx);
		case "sessions": case "ss": return handleSessions(pi, rest, ctx);
		default:
			ctx.ui.notify(`Unknown subcommand: ${sub}. Try /wt for help.`, "error");
	}
}

// ─── Extension entry ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const configuredRepoLabel = profiledRepoLabel();
	pi.registerCommand("wt", {
		description: "Git worktree management — create/list/switch/remove parallel workspaces",
		handler: (args, ctx) => handleWt(pi, args, ctx),
	});

	pi.registerShortcut("ctrl+w", {
		description: "Worktree dashboard",
		handler: async (ctx) => {
			ctx.ui.setEditorText("/wt switch");
		},
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const result = await ensureDependencyBootstrapWorker(pi, ctx, event.prompt ?? "");
		if (!result.systemNote) return undefined;
		return {
			message: {
				customType: "worktree-dependency-bootstrap",
				content: result.systemNote,
				display: true,
			},
			systemPrompt: `${event.systemPrompt}\n\nWORKTREE DEPENDENCY BOOTSTRAP:\n${result.systemNote}\nDo not rerun installs manually unless the bootstrap executor/subagent failed or validation still cannot find required tools.`,
		};
	});

	pi.registerTool({
		name: "worktree_create",
		label: "Create Worktree",
		description: `Create a fresh git worktree for code changes. Use only when no investigation/planning context needs to be carried into configured protected repos (${configuredRepoLabel}).`,
		promptSnippet: `Create a fresh git worktree for code changes in configured protected repos (${configuredRepoLabel}). Required before editing files there only when context carry is not needed.`,
		promptGuidelines: [
			"Before any worktree creation, classify: investigation vs implementation, context-carry needed vs fresh, development vs production/hotfix base.",
			"Use worktree_create only for a fresh implementation session with no valuable investigation/planning context. If context exists, use worktree_fork instead.",
			`In fork/child panels (P1/P2), do not call worktree_create for configured protected repos (${configuredRepoLabel}). Hand off to the parent P0 panel and have the parent run /wt fork.`,
			"If the request mentions hotfix/production/핫픽스, pass hotfix: true. Do not create a development-based hotfix branch.",
			`Use worktree_create before editing files in configured protected repos (${configuredRepoLabel}). Do not manually run git worktree add.`,
			"Tool calls cannot execute slash-command session switches directly. After worktree_create succeeds, tell the user to submit the returned /wt switch command (prefilled in interactive UI) and wait before continuing.",
		],
		parameters: Type.Object({
			repo: Type.Optional(Type.String({ description: `Registered repo name (configured examples: ${configuredRepoLabel}). Auto-detected if omitted.` })),
			name: Type.Optional(Type.String({ description: "Worktree name. Auto-generated if omitted." })),
			ticket: Type.Optional(Type.String({ description: "Issue/ticket key (e.g. 'PROJ-123')" })),
			note: Type.Optional(Type.String({ description: "Short description of the work" })),
			hotfix: Type.Optional(Type.Boolean({ description: "Branch from production instead of development" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const repoName = params.repo;
			const reg = loadRegistry();

			let repoRoot: string | null = null;
			if (repoName) {
				repoRoot = reg[repoName] ?? null;
				if (!repoRoot) {
					throw new Error(`Repo "${repoName}" not registered. Available: ${Object.keys(reg).join(", ") || "(none)"}. Use /wt repo add ${repoName} <path> first.`);
				}
			} else {
				const names = Object.keys(reg).filter(n => existsSync(reg[n]));
				if (names.length === 0) throw new Error("No repos registered. Use /wt repo add <name> <path> first.");
				if (names.length === 1) repoRoot = reg[names[0]];
				else throw new Error(`Multiple repos registered: ${names.join(", ")}. Pass repo parameter explicitly.`);
			}

			if (!existsSync(repoRoot)) throw new Error(`Repo path missing: ${repoRoot}`);

			const panelGuard = getWorktreeCreationPanelGuardMessage(repoRoot, ctx);
			if (panelGuard) throw new Error(panelGuard);
			const hotfixGuard = getHotfixBaseGuardMessage(
				{ hotfix: Boolean(params.hotfix), hotfeature: false, from: undefined, branch: undefined, note: params.note },
				"worktree_create",
			);
			if (hotfixGuard) throw new Error(hotfixGuard);

			const { isNew: justRegistered } = autoRegister(repoRoot);
			const config = loadConfig(repoRoot);

			const baseBranch = params.hotfix ? config.productionBranch : config.baseBranch;
			const prefix = params.hotfix ? "hotfix" : config.branchPrefix;

			mkdirSync(config.rootDir, { recursive: true });
			const existing = new Set(listExistingWorktrees(config.rootDir).map(w => w.name));
			const name = params.name ?? pickName(config.namingScheme, existing);

			if (existing.has(name)) throw new Error(`Worktree "${name}" already exists at ${config.rootDir}`);

			const worktreePath = join(config.rootDir, name);
			const branchName = params.ticket ? `${prefix}/${params.ticket}/${name}` : `${prefix}/${name}`;

			onUpdate?.({
				content: [{ type: "text", text: `Fetching origin/${baseBranch}…` }],
				details: {},
			});

			const fetchR = await pi.exec("git", ["fetch", "origin", baseBranch], { cwd: repoRoot, signal });
			if (fetchR.code !== 0) throw new Error(`git fetch failed: ${fetchR.stderr?.trim().slice(0, 300) ?? "unknown"}`);

			onUpdate?.({
				content: [{ type: "text", text: `Creating worktree "${name}" (${branchName})…` }],
				details: {},
			});

			const addR = await pi.exec("git", ["worktree", "add", worktreePath, "-b", branchName, `origin/${baseBranch}`], { cwd: repoRoot, signal });
			if (addR.code !== 0) throw new Error(`git worktree add failed: ${addR.stderr?.trim().slice(0, 300)}`);

			writeMeta(worktreePath, {
				name,
				branch: branchName,
				baseBranch,
				createdAt: Date.now(),
				ticket: params.ticket,
				note: params.note,
			});
			const framePromotion = promotePlanningFrameToWorktree(worktreePath, readMeta(worktreePath) ?? {
				name,
				branch: branchName,
				baseBranch,
				createdAt: Date.now(),
				ticket: params.ticket,
				note: params.note,
			});

			if (config.setupScript) {
				onUpdate?.({
					content: [{ type: "text", text: `Running setup: ${config.setupScript}…` }],
					details: {},
				});
				await pi.exec("bash", ["-lc", config.setupScript], { cwd: worktreePath, signal });
			}

			createWorktreeSession(ctx, worktreePath, { sessionName: `${name} (${branchName})` });
			const registeredName = findRegisteredName(loadRegistry(), repoRoot) ?? basename(repoRoot);
			const switchCommand = `/wt switch ${registeredName}/${name}`;
			const prefilled = prefillSwitchCommand(ctx, switchCommand);

			const frameText = framePromotion.status === "promoted" ? ` Planning frame promoted to ${framePromotion.framePath}.` : "";
			return {
				content: [{ type: "text", text: `✓ Worktree "${name}" created (${branchName}) at ${worktreePath}.${frameText} Run ${switchCommand} to switch${prefilled ? " (prefilled in editor)" : ""}.` }],
				details: { name, branch: branchName, path: worktreePath, switchCommand, prefilled, framePromotion },
			};
		},
	});

	pi.registerTool({
		name: "worktree_switch",
		label: "Switch Worktree",
		description: "Switch to an existing git worktree. Lists available worktrees if name is omitted.",
		promptSnippet: "Switch to an existing git worktree session, or list available worktrees.",
		parameters: Type.Object({
			name: Type.Optional(Type.String({ description: "Worktree name to switch to. Omit to list available worktrees." })),
			repo: Type.Optional(Type.String({ description: `Registered repo name (configured examples: ${configuredRepoLabel}). Auto-detected if only one repo registered.` })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const reg = loadRegistry();

			let repoRoot: string | null = null;
			if (params.repo) {
				repoRoot = reg[params.repo] ?? null;
				if (!repoRoot) throw new Error(`Repo "${params.repo}" not registered. Available: ${Object.keys(reg).join(", ") || "(none)"}`);
			} else {
				const names = Object.keys(reg).filter(n => existsSync(reg[n]));
				if (names.length === 0) throw new Error("No repos registered.");
				if (names.length === 1) repoRoot = reg[names[0]];
				else throw new Error(`Multiple repos registered: ${names.join(", ")}. Pass repo parameter.`);
			}

			const config = loadConfig(repoRoot);
			const worktrees = listExistingWorktrees(config.rootDir);

			if (!params.name) {
				if (worktrees.length === 0) {
					return { content: [{ type: "text", text: "No worktrees found. Use worktree_create to make one." }], details: {} };
				}
				const lines = worktrees.map(w => {
					const status = w.meta?.status ?? "active";
					const ticket = w.meta?.ticket ? ` [${w.meta.ticket}]` : "";
					const note = w.meta?.note ? ` — ${w.meta.note.slice(0, 50)}` : "";
					return `- ${w.name} (${status}) ${w.branch}${ticket}${note}`;
				});
				return { content: [{ type: "text", text: `Available worktrees:\n${lines.join("\n")}` }], details: { worktrees: worktrees.map(w => w.name) } };
			}

			const target = worktrees.find(w => w.name === params.name);
			if (!target) throw new Error(`Worktree "${params.name}" not found. Available: ${worktrees.map(w => w.name).join(", ") || "(none)"}`);

			const registeredName = findRegisteredName(loadRegistry(), repoRoot) ?? basename(repoRoot);
			const switchCommand = `/wt switch ${registeredName}/${params.name}`;
			const prefilled = prefillSwitchCommand(ctx, switchCommand);

			return {
				content: [{ type: "text", text: `✓ Worktree "${params.name}" (${target.branch}) found. Run ${switchCommand} to switch${prefilled ? " (prefilled in editor)" : ""}.` }],
				details: { name: target.name, branch: target.branch, path: target.path, switchCommand, prefilled },
			};
		},
	});

	pi.registerTool({
		name: "worktree_fork",
		label: "Fork Worktree",
		description: "Create a new worktree with current session context carried over. Use when investigation/planning is done in the current parent session and you want to hand off to a new implementation session.",
		promptSnippet: "Fork current session into a new worktree, carrying over investigation context and conversation summary.",
		promptGuidelines: [
			"Before any worktree creation, classify: investigation vs implementation, context-carry needed vs fresh, development vs production/hotfix base.",
			"Use worktree_fork instead of worktree_create when you have valuable session context (investigation results, code analysis, plans) to carry over.",
			`In fork/child panels (P1/P2), do not call worktree_fork for configured protected repos (${configuredRepoLabel}). Hand off to the parent P0 panel and have the parent run /wt fork so the parent conversation is the source session.`,
			"If the request mentions hotfix/production/핫픽스, pass hotfix: true. Do not create a development-based hotfix branch.",
			"The context parameter should be a comprehensive markdown summary: goals, findings, target files, code snippets, and action items.",
			"Tool calls cannot execute slash-command session switches directly. After worktree_fork succeeds, tell the user to submit the returned /wt switch command (prefilled in interactive UI) and wait before continuing.",
		],
		parameters: Type.Object({
			context: Type.String({ description: "Markdown summary of current session context to carry over (goals, investigation results, target files, action items)" }),
			repo: Type.Optional(Type.String({ description: `Registered repo name (configured examples: ${configuredRepoLabel}). Auto-detected if omitted.` })),
			name: Type.Optional(Type.String({ description: "Worktree name. Auto-generated if omitted." })),
			ticket: Type.Optional(Type.String({ description: "Issue/ticket key (e.g. 'PROJ-123')" })),
			note: Type.Optional(Type.String({ description: "Short description of the work" })),
			hotfix: Type.Optional(Type.Boolean({ description: "Branch from production instead of development" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const repoName = params.repo;
			const reg = loadRegistry();

			let repoRoot: string | null = null;
			if (repoName) {
				repoRoot = reg[repoName] ?? null;
				if (!repoRoot) throw new Error(`Repo "${repoName}" not registered. Available: ${Object.keys(reg).join(", ") || "(none)"}`);
			} else {
				const names = Object.keys(reg).filter(n => existsSync(reg[n]));
				if (names.length === 0) throw new Error("No repos registered.");
				if (names.length === 1) repoRoot = reg[names[0]];
				else throw new Error(`Multiple repos registered: ${names.join(", ")}. Pass repo parameter explicitly.`);
			}

			if (!existsSync(repoRoot)) throw new Error(`Repo path missing: ${repoRoot}`);

			const panelGuard = getWorktreeCreationPanelGuardMessage(repoRoot, ctx);
			if (panelGuard) throw new Error(panelGuard);
			const hotfixGuard = getHotfixBaseGuardMessage(
				{ hotfix: Boolean(params.hotfix), hotfeature: false, from: undefined, branch: undefined, note: params.note },
				"worktree_fork",
			);
			if (hotfixGuard) throw new Error(hotfixGuard);

			autoRegister(repoRoot);
			const config = loadConfig(repoRoot);

			const baseBranch = params.hotfix ? config.productionBranch : config.baseBranch;
			const prefix = params.hotfix ? "hotfix" : config.branchPrefix;

			mkdirSync(config.rootDir, { recursive: true });
			const existing = new Set(listExistingWorktrees(config.rootDir).map(w => w.name));
			const name = params.name ?? pickName(config.namingScheme, existing);

			if (existing.has(name)) throw new Error(`Worktree "${name}" already exists at ${config.rootDir}`);

			const worktreePath = join(config.rootDir, name);
			const branchName = params.ticket ? `${prefix}/${params.ticket}/${name}` : `${prefix}/${name}`;

			onUpdate?.({
				content: [{ type: "text", text: `Fetching origin/${baseBranch}…` }],
				details: {},
			});

			const fetchR = await pi.exec("git", ["fetch", "origin", baseBranch], { cwd: repoRoot, signal });
			if (fetchR.code !== 0) throw new Error(`git fetch failed: ${fetchR.stderr?.trim().slice(0, 300) ?? "unknown"}`);

			onUpdate?.({
				content: [{ type: "text", text: `Creating worktree "${name}" (${branchName})…` }],
				details: {},
			});

			const addR = await pi.exec("git", ["worktree", "add", worktreePath, "-b", branchName, `origin/${baseBranch}`], { cwd: repoRoot, signal });
			if (addR.code !== 0) throw new Error(`git worktree add failed: ${addR.stderr?.trim().slice(0, 300)}`);

			writeMeta(worktreePath, {
				name,
				branch: branchName,
				baseBranch,
				createdAt: Date.now(),
				ticket: params.ticket,
				note: params.note,
			});
			const framePromotion = promotePlanningFrameToWorktree(worktreePath, readMeta(worktreePath) ?? {
				name,
				branch: branchName,
				baseBranch,
				createdAt: Date.now(),
				ticket: params.ticket,
				note: params.note,
			});

			createWorktreeSession(ctx, worktreePath, {
				carryContext: true,
				contextContent: params.context,
				sessionName: `${name} (${branchName})`,
			});

			if (config.setupScript) {
				onUpdate?.({
					content: [{ type: "text", text: `Running setup: ${config.setupScript}…` }],
					details: {},
				});
				await pi.exec("bash", ["-lc", config.setupScript], { cwd: worktreePath, signal });
			}

			const registeredName = findRegisteredName(loadRegistry(), repoRoot) ?? basename(repoRoot);
			const switchCommand = `/wt switch ${registeredName}/${name}`;
			const prefilled = prefillSwitchCommand(ctx, switchCommand);

			const frameText = framePromotion.status === "promoted" ? ` Planning frame promoted to ${framePromotion.framePath}.` : "";
			return {
				content: [{ type: "text", text: `✓ Worktree "${name}" forked (${branchName}) at ${worktreePath}. Context attached (${params.context.length} chars).${frameText} Run ${switchCommand} to switch${prefilled ? " (prefilled in editor)" : ""}.` }],
				details: { name, branch: branchName, path: worktreePath, contextLength: params.context.length, switchCommand, prefilled, framePromotion },
			};
		},
	});

	pi.on("before_agent_start", async (event: any) => {
		const cwd: string = event.systemPromptOptions?.cwd ?? process.cwd();
		const contextFile = join(cwd, ".pi", "conductor-context.md");
		if (!existsSync(contextFile)) return {};
		try {
			const content = readFileSync(contextFile, "utf8");
			renameSync(contextFile, contextFile.replace(".md", ".loaded.md"));
			return {
				message: { customType: "conductor-resume", content: `## 이전 Conductor 세션 컨텍스트\n\n${content}`, display: true },
			};
		} catch { return {}; }
	});
}
