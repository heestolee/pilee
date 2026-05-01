import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

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
	rootDir: join(homedir(), "pilee-workspaces"),
	baseBranch: "development",
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

function getRepoName(repoRoot: string): string {
	return basename(repoRoot);
}

function configPath(repoRoot: string): string {
	return join(repoRoot, ".pi", "worktree.json");
}

function loadConfig(repoRoot: string): WorktreeConfig {
	const p = configPath(repoRoot);
	if (!existsSync(p)) return { ...DEFAULT_CONFIG, rootDir: join(DEFAULT_CONFIG.rootDir, getRepoName(repoRoot)) };
	try {
		const data = JSON.parse(readFileSync(p, "utf8"));
		return { ...DEFAULT_CONFIG, ...data, rootDir: expandHome(data.rootDir ?? join(DEFAULT_CONFIG.rootDir, getRepoName(repoRoot))) };
	} catch {
		return { ...DEFAULT_CONFIG, rootDir: join(DEFAULT_CONFIG.rootDir, getRepoName(repoRoot)) };
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

interface WorktreeMeta {
	name: string;
	branch: string;
	baseBranch: string;
	createdAt: number;
	ticket?: string;
	note?: string;
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
	from?: string;
	ticket?: string;
	note?: string;
	branch?: string;
}

function parseNewArgs(args: string): NewArgs {
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

	const result: NewArgs = { hotfix: false, hotfeature: false };
	const positional: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === "--hotfix") result.hotfix = true;
		else if (t === "--hotfeature") result.hotfeature = true;
		else if (t === "--from" && i + 1 < tokens.length) result.from = tokens[++i];
		else if (t === "--ticket" && i + 1 < tokens.length) result.ticket = tokens[++i];
		else if (t === "--note" && i + 1 < tokens.length) result.note = tokens[++i];
		else if (t === "--branch" && i + 1 < tokens.length) result.branch = tokens[++i];
		else positional.push(t);
	}
	if (positional.length > 0) result.name = positional[0];
	return result;
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

async function handleNew(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const repoRoot = await findRepoRoot(pi, ctx.cwd);
	if (!repoRoot) { ctx.ui.notify("Not a git repository", "error"); return; }

	const config = loadConfig(repoRoot);
	const parsed = parseNewArgs(args);

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

	// Step 5: open in Ghostty
	if (config.autoOpenInGhostty) {
		const opened = await openInGhostty(pi, worktreePath, config.ghosttyDirection);
		if (opened) ctx.ui.notify(`→ opened in Ghostty`, "info");
	}
}

async function handleList(pi: ExtensionAPI, _args: string, ctx: ExtensionCommandContext) {
	const repoRoot = await findRepoRoot(pi, ctx.cwd);
	if (!repoRoot) { ctx.ui.notify("Not a git repository", "error"); return; }

	const config = loadConfig(repoRoot);
	const worktrees = listExistingWorktrees(config.rootDir);

	if (worktrees.length === 0) {
		ctx.ui.notify(`No worktrees in ${config.rootDir}. Use /wt new to create one.`, "info");
		return;
	}

	const lines: string[] = [`Worktrees (${worktrees.length}):`];
	for (const w of worktrees) {
		const status = await getWorktreeStatus(pi, w.path);
		const statusStr = status === null ? "?" : status.changes > 0 ? `${status.changes} changes` : status.ahead > 0 ? `${status.ahead} ahead` : status.behind > 0 ? `${status.behind} behind` : "clean";
		const ticket = w.meta?.ticket ? ` [${w.meta.ticket}]` : "";
		const note = w.meta?.note ? ` — ${w.meta.note.slice(0, 40)}` : "";
		lines.push(`  ${w.name.padEnd(15)} ${w.branch.padEnd(35)} ${statusStr}${ticket}${note}`);
	}
	ctx.ui.notify(lines.join("\n"), "info");
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

async function handleSwitch(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const repoRoot = await findRepoRoot(pi, ctx.cwd);
	if (!repoRoot) { ctx.ui.notify("Not a git repository", "error"); return; }

	const config = loadConfig(repoRoot);
	const name = args.trim();
	if (!name) { ctx.ui.notify("Usage: /wt switch <name>", "error"); return; }

	const path = join(config.rootDir, name);
	if (!existsSync(path)) { ctx.ui.notify(`Worktree "${name}" not found`, "error"); return; }

	if (config.autoOpenInGhostty) {
		const opened = await openInGhostty(pi, path, config.ghosttyDirection);
		if (opened) {
			ctx.ui.notify(`→ ${name} opened in Ghostty`, "info");
			return;
		}
	}
	ctx.ui.notify(`Switch to: cd ${path}`, "info");
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

// ─── Subcommand dispatch ───────────────────────────────────────────────────

async function handleWt(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const trimmed = args.trim();
	if (!trimmed) {
		ctx.ui.notify([
			"Usage:",
			"  /wt new [name] [--hotfix|--hotfeature|--from <branch>] [--ticket COM-XXXX] [--note \"...\"]",
			"  /wt list",
			"  /wt switch <name>",
			"  /wt rm <name> [--force]",
			"  /wt config [show|init]",
		].join("\n"), "info");
		return;
	}

	const spaceIdx = trimmed.indexOf(" ");
	const sub = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
	const rest = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

	switch (sub) {
		case "new": return handleNew(pi, rest, ctx);
		case "list": case "ls": return handleList(pi, rest, ctx);
		case "rm": case "remove": return handleRemove(pi, rest, ctx);
		case "switch": case "sw": return handleSwitch(pi, rest, ctx);
		case "config": return handleConfig(pi, rest, ctx);
		default:
			ctx.ui.notify(`Unknown subcommand: ${sub}. Try /wt for help.`, "error");
	}
}

// ─── Extension entry ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerCommand("wt", {
		description: "Git worktree management — create/list/switch/remove parallel workspaces",
		handler: (args, ctx) => handleWt(pi, args, ctx),
	});
}
