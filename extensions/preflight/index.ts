import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

// ─── Types ─────────────────────────────────────────────────────────────────

interface PreflightRule {
	match: string;             // glob pattern
	command: string;           // shell command (or program path)
	input?: "stdin" | "args";  // how to pass file path; default: "args"
}

interface PreflightConfig {
	enabled: boolean;
	rules: PreflightRule[];
	timeout: number;
	skipPatterns: string[];
}

const DEFAULT_CONFIG: PreflightConfig = {
	enabled: true,
	rules: [],
	timeout: 30000,
	skipPatterns: ["node_modules", "dist", ".git", ".next", "build", ".cache"],
};

// ─── Glob matcher (simple, no deps) ────────────────────────────────────────

function globToRegex(pattern: string): RegExp {
	let r = "";
	let i = 0;
	while (i < pattern.length) {
		const c = pattern[i];
		if (c === "*") {
			if (pattern[i + 1] === "*") {
				r += ".*";
				i += 2;
				if (pattern[i] === "/") i++;
			} else {
				r += "[^/]*";
				i++;
			}
		} else if (c === "?") { r += "[^/]"; i++; }
		else if (c === ".") { r += "\\."; i++; }
		else if (c === "{") {
			const end = pattern.indexOf("}", i);
			if (end === -1) { r += "\\{"; i++; continue; }
			const opts = pattern.slice(i + 1, end).split(",");
			r += `(${opts.map((o) => o.replace(/\./g, "\\.")).join("|")})`;
			i = end + 1;
		}
		else if (/[\\^$+()|[\]]/.test(c)) { r += `\\${c}`; i++; }
		else { r += c; i++; }
	}
	return new RegExp(`^${r}$`);
}

function matchGlob(pattern: string, path: string): boolean {
	try { return globToRegex(pattern).test(path); } catch { return false; }
}

// ─── Config loading ────────────────────────────────────────────────────────

async function findRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	return r.code === 0 ? (r.stdout ?? "").trim() || null : null;
}

function loadConfig(repoRoot: string): PreflightConfig {
	const configPath = join(repoRoot, ".pi", "preflight.json");
	if (!existsSync(configPath)) return { ...DEFAULT_CONFIG };
	try {
		const data = JSON.parse(readFileSync(configPath, "utf8"));
		return { ...DEFAULT_CONFIG, ...data };
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

// ─── Lint runner ───────────────────────────────────────────────────────────

interface LintResult {
	clean: boolean;
	output: string;
	timedOut: boolean;
}

function runLint(rule: PreflightRule, repoRoot: string, relPath: string, timeout: number): Promise<LintResult> {
	return new Promise((resolveResult) => {
		const useStdin = rule.input === "stdin";

		// Parse command into program + args
		const parts = rule.command.split(/\s+/);
		const program = parts[0];
		const baseArgs = parts.slice(1);
		const finalArgs = useStdin ? baseArgs : [...baseArgs, relPath];

		const child = spawn(program, finalArgs, {
			cwd: repoRoot,
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "", stderr = "", done = false, timedOut = false;
		const finish = (code: number) => {
			if (done) return;
			done = true;
			const output = (stdout + (stderr ? `\n${stderr}` : "")).trim();
			resolveResult({ clean: code === 0, output, timedOut });
		};

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => child.kill("SIGKILL"), 1000);
		}, timeout);

		child.stdout.on("data", (c) => { stdout += c; });
		child.stderr.on("data", (c) => { stderr += c; });
		child.on("error", (e) => { clearTimeout(timer); stderr += `\n${e.message}`; finish(1); });
		child.on("close", (code) => { clearTimeout(timer); finish(code ?? 1); });

		if (useStdin) {
			try { child.stdin.write(`${relPath}\n`); child.stdin.end(); } catch { finish(1); }
		}
	});
}

// ─── Tool input parsing ────────────────────────────────────────────────────

function extractFilePath(toolName: string, input: unknown): string | null {
	if (!input || typeof input !== "object") return null;
	const i = input as Record<string, unknown>;
	if (toolName === "edit" || toolName === "write") {
		return typeof i.path === "string" ? i.path : null;
	}
	return null;
}

// ─── State (per-session) ───────────────────────────────────────────────────

interface SessionState {
	disabled: boolean;
}

// ─── Main extension ────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const state: SessionState = { disabled: false };

	pi.on("tool_result", async (event, ctx) => {
		if (state.disabled) return;
		if (event.isError) return; // don't add to errors
		const filePath = extractFilePath(event.toolName, event.input);
		if (!filePath) return;

		const absPath = isAbsolute(filePath) ? filePath : resolve(ctx.cwd, filePath);
		const repoRoot = await findRepoRoot(pi, ctx.cwd);
		if (!repoRoot) return;

		const config = loadConfig(repoRoot);
		if (!config.enabled) return;

		const relPath = relative(repoRoot, absPath);

		// Skip patterns
		if (config.skipPatterns.some((p) => relPath.includes(p))) return;

		// Find matching rule
		const rule = config.rules.find((r) => matchGlob(r.match, relPath));
		if (!rule) return;

		const result = await runLint(rule, repoRoot, relPath, config.timeout);
		if (result.clean) return;
		if (result.timedOut) return; // silently skip timeouts

		// Append to tool result
		const feedback = [
			"",
			"─── PREFLIGHT lint feedback ───",
			`File: ${relPath}`,
			result.output.slice(0, 3000),
			result.output.length > 3000 ? "(truncated)" : "",
			"Please fix these violations.",
		].filter(Boolean).join("\n");

		const existing = event.content as Array<{ type: string; text?: string }>;
		const newContent = [...existing];
		const lastText = newContent.findIndex((c) => c.type === "text");
		if (lastText >= 0) {
			newContent[lastText] = {
				...newContent[lastText],
				text: `${newContent[lastText].text ?? ""}\n${feedback}`,
			};
		} else {
			newContent.push({ type: "text", text: feedback });
		}

		return { content: newContent };
	});

	// /preflight command
	pi.registerCommand("preflight", {
		description: "Manual preflight lint check + on/off control",
		async handler(args: string, ctx: ExtensionCommandContext) {
			const sub = args.trim().split(/\s+/)[0];
			const repoRoot = await findRepoRoot(pi, ctx.cwd);
			if (!repoRoot) { ctx.ui.notify("Not a git repository", "error"); return; }
			const config = loadConfig(repoRoot);
			const configPath = join(repoRoot, ".pi", "preflight.json");

			if (sub === "off" || sub === "disable") {
				state.disabled = true;
				ctx.ui.notify("Preflight disabled for this session", "info");
				return;
			}
			if (sub === "on" || sub === "enable") {
				state.disabled = false;
				ctx.ui.notify("Preflight enabled for this session", "info");
				return;
			}
			if (sub === "config" || sub === "show") {
				const exists = existsSync(configPath);
				ctx.ui.notify(`${exists ? configPath : "default (no config file)"}\n${JSON.stringify(config, null, 2)}`, "info");
				return;
			}
			if (sub === "init") {
				const fs = await import("node:fs/promises");
				await fs.mkdir(dirname(configPath), { recursive: true });
				const example: PreflightConfig = {
					enabled: true,
					rules: [
						{ match: "frontend/**/*.{ts,tsx,js,jsx}", command: "frontend/scripts/lint-files.sh", input: "stdin" },
						{ match: "backend/**/*.ts", command: "backend/scripts/lint-files.sh", input: "stdin" },
					],
					timeout: 30000,
					skipPatterns: ["node_modules", "dist", ".git", ".next", "build"],
				};
				await fs.writeFile(configPath, JSON.stringify(example, null, 2));
				ctx.ui.notify(`✓ Created ${configPath}`, "info");
				return;
			}
			if (sub === "run") {
				// Manual run on staged + unstaged files
				const r = await pi.exec("git", ["diff", "--name-only", "HEAD"], { cwd: repoRoot });
				if (r.code !== 0) { ctx.ui.notify("git diff failed", "error"); return; }
				const files = (r.stdout ?? "").trim().split("\n").filter(Boolean);
				if (files.length === 0) { ctx.ui.notify("No changed files", "info"); return; }

				const lines: string[] = [`Preflight checking ${files.length} files…`];
				let issueCount = 0;
				for (const f of files) {
					if (config.skipPatterns.some((p) => f.includes(p))) continue;
					const rule = config.rules.find((r) => matchGlob(r.match, f));
					if (!rule) continue;
					const result = await runLint(rule, repoRoot, f, config.timeout);
					if (!result.clean) {
						issueCount++;
						lines.push(`\n❌ ${f}\n${result.output.slice(0, 1000)}`);
					}
				}
				lines.push(`\n${issueCount === 0 ? "✓ All clean" : `${issueCount} files with issues`}`);
				ctx.ui.notify(lines.join("\n"), issueCount === 0 ? "info" : "warning");
				return;
			}

			ctx.ui.notify([
				"Usage:",
				"  /preflight on|off — enable/disable for session",
				"  /preflight show    — view config",
				"  /preflight init    — create example config in .pi/preflight.json",
				"  /preflight run     — manually check changed files",
				`Status: ${state.disabled ? "disabled" : "enabled"}`,
			].join("\n"), "info");
		},
	});
}
