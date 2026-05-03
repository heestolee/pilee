import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync, rmSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

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

function findRegisteredName(reg: RepoRegistry, repoPath: string): string | null {
	for (const [name, path] of Object.entries(reg)) {
		if (path === repoPath) return name;
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
	repo?: string;
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
		else if (t === "--repo" && i + 1 < tokens.length) result.repo = tokens[++i];
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
		return path;
	}
	const repoRoot = await findRepoRoot(pi, ctx.cwd);
	if (repoRoot) return repoRoot;

	const reg = loadRegistry();
	const names = Object.keys(reg).filter(n => existsSync(reg[n]));
	if (names.length === 0) {
		ctx.ui.notify("Not a git repository and no repos registered. Use /wt repo add <name> <path>", "error");
		return null;
	}
	if (names.length === 1) return reg[names[0]];
	const choice = await ctx.ui.select("어느 repo에 만들까요?", names);
	if (!choice) return null;
	return reg[choice];
}

async function handleNew(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const parsed = parseNewArgs(args);
	const repoRoot = await resolveRepoRoot(pi, ctx, parsed.repo);
	if (!repoRoot) return;

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

	// Step 5: switch to new session with worktree cwd
	const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	const pathEncoded = "--" + worktreePath.slice(1).replace(/\//g, "-") + "--";
	const sessionDir = join(homedir(), ".pi", "agent", "sessions", pathEncoded);
	mkdirSync(sessionDir, { recursive: true });
	const sessionFile = join(sessionDir, `${Date.now()}_${sessionId}.jsonl`);
	writeFileSync(sessionFile, JSON.stringify({
		type: "session", version: 3, id: sessionId,
		timestamp: new Date().toISOString(), cwd: worktreePath,
	}) + "\n");

	try {
		await ctx.switchSession(sessionFile, {
			withSession: async (newCtx: any) => {
				newCtx.ui.notify(`✓ ${name} ready (${branchName})`, "info");
			},
		});
	} catch {
		ctx.ui.notify(`✓ Created. cwd: ${worktreePath}`, "info");
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

async function handleSwitch(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const target = args.trim();
	if (!target) { ctx.ui.notify("Usage: /wt switch <name> | /wt switch <repo>/<name>", "error"); return; }

	let repoRoot: string;
	let wtName: string;

	if (target.includes("/")) {
		// Cross-repo syntax: <repo>/<name>
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
		// Current repo
		const found = await findRepoRoot(pi, ctx.cwd);
		if (!found) { ctx.ui.notify("Not a git repository (use <repo>/<name> for cross-repo)", "error"); return; }
		repoRoot = found;
		wtName = target;
	}

	const config = loadConfig(repoRoot);
	const path = join(config.rootDir, wtName);
	if (!existsSync(path)) { ctx.ui.notify(`Worktree "${wtName}" not found at ${path}`, "error"); return; }

	// Check for existing pi sessions for this worktree
	const pathEncoded = "--" + path.slice(1).replace(/\//g, "-") + "--";
	const sessionDir = join(homedir(), ".pi", "agent", "sessions", pathEncoded);
	let sessionFile: string | null = null;

	if (existsSync(sessionDir)) {
		const files = readdirSync(sessionDir).filter(f => f.endsWith(".jsonl")).sort().reverse();
		if (files.length === 1) {
			sessionFile = join(sessionDir, files[0]);
		} else if (files.length > 1) {
			const choice = await ctx.ui.select(`${wtName} 세션 선택:`, files.map(f => f.replace(/\.jsonl$/, "")));
			if (!choice) return;
			sessionFile = join(sessionDir, files[files.indexOf(choice + ".jsonl")] ?? files.find(f => f.startsWith(choice))!);
		}
	}

	if (!sessionFile) {
		const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		mkdirSync(sessionDir, { recursive: true });
		sessionFile = join(sessionDir, `${Date.now()}_${sessionId}.jsonl`);
		writeFileSync(sessionFile, JSON.stringify({
			type: "session", version: 3, id: sessionId,
			timestamp: new Date().toISOString(), cwd: path,
		}) + "\n");
	}

	try {
		await ctx.switchSession(sessionFile, {
			withSession: async (newCtx: any) => {
				newCtx.ui.notify(`✓ ${wtName} (${readMeta(path)?.branch ?? "unknown"})`, "info");
			},
		});
	} catch {
		ctx.ui.notify(`Switch to: cd ${path}`, "info");
	}
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
		reg[name] = root;
		saveRegistry(reg);
		ctx.ui.notify(`Registered "${name}" → ${root}`, "info");
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

const CONDUCTOR_DB = join(homedir(), "Library", "Application Support", "com.conductor.app", "conductor.db");

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
	if (!existsSync(CONDUCTOR_DB)) return "";
	const r = await pi.exec("sqlite3", ["-separator", "§", CONDUCTOR_DB, sql]);
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
	lines.push(`JSONL: \`~/.claude/projects/*conductor-workspaces-*${ws.directoryName}/${sessionId}.jsonl\``);
	return lines.join("\n");
}

function findConductorJsonl(wsName: string, sessionId: string): string | null {
	const base = join(homedir(), ".claude", "projects");
	if (!existsSync(base)) return null;
	for (const dir of readdirSync(base)) {
		if (dir.includes("conductor-workspaces") && dir.endsWith(wsName)) {
			const jsonl = join(base, dir, `${sessionId}.jsonl`);
			if (existsSync(jsonl)) return jsonl;
		}
	}
	return null;
}

function convertConductorToPiSession(jsonlPath: string, worktreePath: string): string | null {
	const raw = readFileSync(jsonlPath, "utf8");
	const lines = raw.split("\n").filter(Boolean);

	const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
	const entries: string[] = [];

	entries.push(JSON.stringify({
		type: "session", version: 3, id: sessionId,
		timestamp: new Date().toISOString(), cwd: worktreePath,
	}));

	let prevId: string | null = null;
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

	if (entries.length <= 1) return null;

	const pathEncoded = "--" + worktreePath.slice(1).replace(/\//g, "-") + "--";
	const sessionDir = join(homedir(), ".pi", "agent", "sessions", pathEncoded);
	mkdirSync(sessionDir, { recursive: true });
	const sessionFile = join(sessionDir, `${Date.now()}_${sessionId}.jsonl`);
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
		`SELECT s.id, COALESCE(s.title,'(untitled)'), substr(s.created_at,1,16), COALESCE(s.model,'') FROM sessions s JOIN workspaces w ON s.workspace_id = w.id WHERE w.directory_name='${sanitizeSql(wsName)}' ORDER BY s.created_at DESC`
	);
	if (!result) return [];
	return result.split("\n").map(line => {
		const p = line.split("§");
		return { id: p[0], title: p[1], createdAt: p[2], model: p[3] };
	});
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
		return handleSessions(pi, name, ctx, worktreePath);
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

	return handleSessions(pi, name, ctx, worktreePath);
}

async function handleSessions(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext, overrideCwd?: string) {
	const tokens = tokenize(args);

	// Determine workspace name: from arg, or from current worktree meta
	let wsName = tokens[0];
	if (!wsName) {
		const meta = readMeta(ctx.cwd);
		wsName = meta?.name ?? basename(ctx.cwd);
	}

	const sessions = await listConductorSessions(pi, wsName);
	if (sessions.length === 0) {
		ctx.ui.notify(`No Conductor sessions found for "${wsName}".`, "info");
		return;
	}

	const options = sessions.map(s => `${s.title}  (${s.createdAt}, ${s.model})`);
	const choice = await ctx.ui.select(`Conductor sessions — ${wsName}:`, options);
	if (!choice) return;

	const idx = options.indexOf(choice);
	const selected = sessions[idx];

	const jsonlPath = findConductorJsonl(wsName, selected.id);
	if (!jsonlPath) {
		ctx.ui.notify(`JSONL not found for session "${selected.title}" (${selected.id}).`, "error");
		return;
	}

	ctx.ui.notify(`Converting "${selected.title}"…`, "info");
	const resolvedCwd = overrideCwd ?? ctx.cwd;
	const sessionFile = convertConductorToPiSession(jsonlPath, resolvedCwd);
	if (!sessionFile) {
		ctx.ui.notify("Conversion failed (no messages found).", "error");
		return;
	}

	try {
		await (ctx as any).switchSession(sessionFile, {
			withSession: async (newCtx: any) => {
				newCtx.ui.notify(`✓ Loaded: ${selected.title}`, "info");
			},
		});
	} catch {
		ctx.ui.notify(`✓ Session saved. Use /resume to load it.`, "info");
	}
}

// ─── Subcommand dispatch ───────────────────────────────────────────────────

async function handleWt(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
	const trimmed = args.trim();
	if (!trimmed) {
		ctx.ui.notify([
			"Usage:",
			"  /wt new [name] [--repo <name>] [--hotfix|--hotfeature|--from <branch>] [--ticket COM-XXXX] [--note \"...\"]",
			"  /wt resume <conductor-workspace> [--repo <name>]",
			"  /wt resume --list [repo]",
			"  /wt sessions [workspace]  — Conductor 대화 세션 선택 모달",
			"  /wt list [--all]",
			"  /wt switch <name> | <repo>/<name>",
			"  /wt rm <name> [--force]",
			"  /wt repo [list|add|rm|rename]",
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
		case "repo": return handleRepo(pi, rest, ctx);
		case "config": return handleConfig(pi, rest, ctx);
		case "resume": return handleResume(pi, rest, ctx);
		case "sessions": case "ss": return handleSessions(pi, rest, ctx);
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
