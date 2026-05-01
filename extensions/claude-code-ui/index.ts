import path from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";
import {
	defineTool,
	createReadToolDefinition,
	createBashToolDefinition,
	createEditToolDefinition,
	createWriteToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { Container, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const ANSI_RESET_BG = "\x1b[49m";

function bgRgb(text: string, r: number, g: number, b: number) {
	return `\x1b[48;2;${r};${g};${b}m${text}${ANSI_RESET_BG}`;
}

function prefix(theme: Theme, label: string) {
	return `${theme.fg("accent", "⏺")} ${theme.fg("toolTitle", theme.bold(label))}`;
}

function suffix(theme: Theme, text?: string) {
	return text ? `${theme.fg("dim", " · ")}${text}` : "";
}

function clip(text: string, max: number) {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function branchBlock(theme: Theme, text: string) {
	const [first = "", ...rest] = text.split("\n");
	return [`${theme.fg("dim", "└ ")}${first}`, ...rest.map((l) => `${theme.fg("dim", "  ")}${l}`)].join("\n");
}

function previewLines(theme: Theme, text: string, maxLines: number) {
	const lines = text.split("\n").filter((l) => l.trim()).slice(0, maxLines);
	return lines.map((l) => theme.fg("toolOutput", clip(l, 88))).join("\n");
}

function diffLine(theme: Theme, line: string) {
	if (line.startsWith("+") && !line.startsWith("+++")) return theme.fg("toolDiffAdded", line);
	if (line.startsWith("-") && !line.startsWith("---")) return theme.fg("toolDiffRemoved", line);
	return theme.fg("toolDiffContext", line);
}

type St = { summary?: string };
type Ctx = { state: St; invalidate: () => void; lastComponent?: object };

function set(ctx: Ctx, s: string) {
	if (ctx.state.summary !== s) { ctx.state.summary = s; ctx.invalidate(); }
}

function textOrNew(ctx: Ctx) {
	return ctx.lastComponent instanceof Text ? ctx.lastComponent : new Text("", 0, 0);
}

function containerOrNew(ctx: Ctx) {
	return ctx.lastComponent instanceof Container ? ctx.lastComponent : new Container();
}

function makeReadTool(cwd: string) {
	const base = createReadToolDefinition(cwd);
	return defineTool({
		...base,
		renderShell: "self",
		renderCall(args: any, theme: Theme, ctx: Ctx) {
			const t = textOrNew(ctx);
			t.setText(`${prefix(theme, "Read")} ${theme.fg("muted", args.path)}${suffix(theme, ctx.state.summary)}`);
			return t;
		},
		renderResult(result: any, opts: any, theme: Theme, ctx: Ctx) {
			const content = result.content[0];
			const s = opts.isPartial ? theme.fg("warning", "reading…") : content?.type !== "text" ? theme.fg("success", "loaded") : `${theme.fg("success", `${content.text.split("\n").length} lines`)}${result.details?.truncation?.truncated ? theme.fg("dim", " · truncated") : ""}`;
			set(ctx, s);
			if (!opts.expanded || content?.type !== "text") return containerOrNew(ctx);
			return new Text(branchBlock(theme, previewLines(theme, content.text, 14)), 0, 0);
		},
	});
}

function makeBashTool(cwd: string) {
	const base = createBashToolDefinition(cwd);
	return defineTool({
		...base,
		renderShell: "self",
		renderCall(args: any, theme: Theme, ctx: Ctx) {
			const lines = args.command.split("\n").map((l: string) => l.trim()).filter(Boolean);
			const first = clip((lines[0] ?? "").replace(/\s+/g, " "), 88);
			const meta = lines.length > 1 && !ctx.state.summary ? theme.fg("dim", ` · ${lines.length} lines`) : "";
			const t = textOrNew(ctx);
			t.setText(`${prefix(theme, "Bash")} ${theme.fg("muted", first)}${meta}${suffix(theme, ctx.state.summary)}`);
			return t;
		},
		renderResult(result: any, opts: any, theme: Theme, ctx: Ctx) {
			const output = result.content[0]?.type === "text" ? result.content[0].text : "";
			const exitCode = output.match(/exit code: (\d+)/)?.[1];
			const s = opts.isPartial ? theme.fg("warning", "running…") : exitCode && exitCode !== "0" ? theme.fg("error", `exit ${exitCode}`) : theme.fg("success", "done");
			const lineCount = output.split("\n").filter((l: string) => l.trim()).length;
			set(ctx, `${s}${theme.fg("dim", ` · ${lineCount} lines`)}${result.details?.truncation?.truncated ? theme.fg("dim", " · truncated") : ""}`);
			if (!opts.expanded || !output.trim()) return containerOrNew(ctx);
			return new Text(branchBlock(theme, previewLines(theme, output, 18)), 0, 0);
		},
	});
}

function makeEditTool(cwd: string) {
	const base = createEditToolDefinition(cwd);
	return defineTool({
		...base,
		renderShell: "self",
		renderCall(args: any, theme: Theme, ctx: Ctx) {
			const t = textOrNew(ctx);
			t.setText(`${prefix(theme, "Edit")} ${theme.fg("muted", args.path)}${suffix(theme, ctx.state.summary)}`);
			return t;
		},
		renderResult(result: any, opts: any, theme: Theme, ctx: Ctx) {
			const content = result.content[0];
			const diff = result.details?.diff?.split("\n") ?? [];
			const adds = diff.filter((l: string) => l.startsWith("+") && !l.startsWith("+++")).length;
			const dels = diff.filter((l: string) => l.startsWith("-") && !l.startsWith("---")).length;
			const s = opts.isPartial ? theme.fg("warning", "editing…") : content?.type === "text" && content.text.startsWith("Error") ? theme.fg("error", content.text.split("\n")[0]) : diff.length ? `${theme.fg("success", `+${adds}`)}${theme.fg("dim", " · ")}${theme.fg("error", `-${dels}`)}` : theme.fg("success", "applied");
			set(ctx, s);
			if (!opts.expanded || !diff.length) return containerOrNew(ctx);
			const preview = diff.slice(0, 24).map((l: string) => diffLine(theme, l));
			if (diff.length > 24) preview.push(theme.fg("dim", `… ${diff.length - 24} more`));
			return new Text(branchBlock(theme, preview.join("\n")), 0, 0);
		},
	});
}

function makeWriteTool(cwd: string) {
	const base = createWriteToolDefinition(cwd);
	return defineTool({
		...base,
		renderShell: "self",
		renderCall(args: any, theme: Theme, ctx: Ctx) {
			const lineCount = args.content.split("\n").length;
			const t = textOrNew(ctx);
			t.setText(`${prefix(theme, "Write")} ${theme.fg("muted", args.path)}${theme.fg("dim", ` · ${lineCount} lines`)}${suffix(theme, ctx.state.summary)}`);
			return t;
		},
		renderResult(result: any, opts: any, theme: Theme, ctx: Ctx) {
			const content = result.content[0];
			const s = opts.isPartial ? theme.fg("warning", "writing…") : content?.type === "text" && content.text.startsWith("Error") ? theme.fg("error", content.text.split("\n")[0]) : theme.fg("success", "written");
			set(ctx, s);
			return containerOrNew(ctx);
		},
	});
}

// Working line
function formatElapsed(ms: number) {
	const s = Math.max(0, Math.floor(ms / 1000));
	const m = Math.floor(s / 60);
	return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function toolDisplayName(name: string) {
	return ({ bash: "Running bash", read: "Reading file", write: "Writing file", edit: "Editing file" } as Record<string, string>)[name] ?? `Running ${name}`;
}

// Footer
function contextBadge(theme: Theme, percent: number | null) {
	const label = `context ${percent == null ? "--" : `${percent}%`}`;
	if (percent == null || percent <= 0) return theme.bg("selectedBg", theme.fg("muted", ` ${label} `));
	if (percent >= 100) return bgRgb(theme.fg("text", ` ${label} `), 215, 119, 87);
	const fill = Math.min(label.length - 1, Math.max(1, Math.ceil((label.length * percent) / 100)));
	return [
		theme.bg("selectedBg", theme.fg("muted", " ")),
		bgRgb(theme.fg("text", label.slice(0, fill)), 215, 119, 87),
		theme.bg("selectedBg", theme.fg("muted", label.slice(fill))),
		theme.bg("selectedBg", theme.fg("muted", " ")),
	].join("");
}

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();
	pi.registerTool(makeReadTool(cwd));
	pi.registerTool(makeBashTool(cwd));
	pi.registerTool(makeEditTool(cwd));
	pi.registerTool(makeWriteTool(cwd));

	// Working line state
	let activeTool: string | undefined;
	let startedAt = 0;
	let timer: ReturnType<typeof setInterval> | undefined;
	let hasOutput = false;
	let activeCtx: ExtensionContext | undefined;

	function render() {
		if (!activeCtx?.hasUI) return;
		if (activeTool) {
			activeCtx.ui.setWorkingMessage(`${toolDisplayName(activeTool)} · ${formatElapsed(Date.now() - startedAt)}`);
		} else if (hasOutput) {
			activeCtx.ui.setWorkingMessage("");
		} else {
			activeCtx.ui.setWorkingMessage(`Working · ${formatElapsed(Date.now() - startedAt)}`);
		}
	}

	function reset(ctx?: ExtensionContext) {
		if (timer) clearInterval(timer);
		timer = undefined;
		startedAt = 0;
		activeTool = undefined;
		hasOutput = false;
		(ctx ?? activeCtx)?.hasUI && (ctx ?? activeCtx)!.ui.setWorkingMessage("");
		activeCtx = undefined;
	}

	pi.on("agent_start", async (_e, ctx) => {
		if (!ctx.hasUI) return;
		reset();
		activeCtx = ctx;
		startedAt = Date.now();
		render();
		timer = setInterval(render, 1000);
	});

	pi.on("turn_start", async (_e, ctx) => {
		if (!ctx.hasUI) return;
		activeCtx = ctx;
		startedAt = Date.now();
		hasOutput = false;
		activeTool = undefined;
		render();
		if (!timer) timer = setInterval(render, 1000);
	});

	pi.on("tool_execution_start", async (e) => { activeTool = e.toolName; render(); });
	pi.on("tool_execution_end", async () => { activeTool = undefined; render(); });
	pi.on("message_update", async (e: any) => { if (e.assistantMessageEvent?.type?.startsWith("text_")) hasOutput = true; render(); });
	pi.on("agent_end", async (_e, ctx) => reset(ctx));
	pi.on("session_shutdown", async (_e, ctx) => reset(ctx));

	// Footer
	pi.on("session_start", async (_e, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setToolsExpanded(false);
		const projectName = path.basename(ctx.cwd) || "pi";
		ctx.ui.setFooter((tui, theme, footerData) => {
			const dispose = footerData.onBranchChange(() => tui.requestRender());
			return {
				dispose,
				invalidate() {},
				render(width: number) {
					const branch = footerData.getGitBranch();
					const left = [theme.fg("text", projectName), branch ? theme.fg("dim", branch) : ""].filter(Boolean).join(theme.fg("dim", " · "));
					const modelId = ctx.model?.id ?? "no-model";
					const effort = (() => { try { const b = ctx.sessionManager.getBranch(); for (let i = b.length - 1; i >= 0; i--) { const e = b[i]; if (e?.type === "thinking_level_change") return e.thinkingLevel; } } catch {} return null; })();
					const modelPart = [theme.fg("muted", modelId), effort ? theme.fg("dim", effort) : ""].filter(Boolean).join(theme.fg("dim", " · "));
					const percent = (() => { try { return ctx.getContextUsage()?.percent ?? null; } catch { return null; } })();
					const badge = contextBadge(theme, percent != null ? Math.round(Math.max(0, Math.min(100, percent))) : null);
					const right = `${modelPart}  ${badge}`;
					const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
					return [truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width, "")];
				},
			};
		});
	});
}
