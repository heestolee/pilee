import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { buildFrameIdentity, type FrameIdentity } from "../tft-commands/frame-identity.ts";
import { openCompanionUrl, toggleCompanionWindow } from "../utils/companion-window.ts";
import type { GlimpseWindow } from "../utils/glimpse.ts";
import { registerCompanionToggleShortcut } from "./companion-shortcut.ts";
import { loadOrDeriveWorkContext } from "../utils/work-context.ts";
import { webviewCopyCss, webviewCopyScript } from "../utils/webview-copy.ts";

type StudioStatus = "running" | "awaiting" | "done" | "aborted";
type AskStatus = "answered" | "cancelled" | "timeout" | "unavailable";
type StudioTabKey = "frame" | "decide" | "verify" | "verify-report";

type StudioTabState = {
	markdown: string;
	step?: string;
	updatedAt?: number;
};

type StudioQuestion = {
	id: string;
	tab: StudioTabKey;
	question: string;
	markdown?: string;
	options: string[];
	multiSelect: boolean;
	allowText: boolean;
	placeholder?: string;
	submitLabel?: string;
	createdAt: number;
};

type StudioAnswer = {
	status: AskStatus;
	questionId?: string;
	question?: string;
	selectedIndices: number[];
	selectedOptions: string[];
	text?: string;
	submittedAt: number;
};

type StudioTranscriptRef = {
	path: string;
	openCommand: string;
	tab: StudioTabKey;
	step?: string;
	note: string;
};

type StudioTabSnapshot = {
	tab: StudioTabKey;
	label: string;
	step?: string;
	updatedAt?: number;
	hasMarkdown: boolean;
	digest: string;
	timelineEntries: number;
};

type StudioContextSnapshot = {
	activeTab: StudioTabKey;
	transcriptRef: StudioTranscriptRef;
	tabs: StudioTabSnapshot[];
};

type StudioWorkContextSnapshot = {
	path: string;
	tasksPath: string;
	displayName: string;
	mode: string;
	goal?: string;
	currentSlice?: { id: string; title: string; scope: string[] };
	openQuestions: Array<{ id: string; text: string; owner: string }>;
	verifyFocus: string[];
};

type StudioToolContextDetails = {
	transcriptRef: StudioTranscriptRef;
	tabSnapshot: StudioTabSnapshot;
	snapshot?: StudioContextSnapshot;
	contextDigest?: string;
	stageOutputContract?: string;
	workContext?: StudioWorkContextSnapshot;
};

type StudioTimelineEntry = {
	id: string;
	time: number;
	kind: "start" | "update" | "question" | "answer" | "finish" | "abort" | "restore";
	tab?: StudioTabKey;
	step?: string;
	title?: string;
	markdown?: string;
	question?: StudioQuestion;
	answer?: StudioAnswer;
	message?: string;
};

type FrameStudioState = {
	runId: string;
	identity: FrameIdentity;
	title: string;
	markdown: string;
	step?: string;
	activeTab: StudioTabKey;
	tabs: Record<StudioTabKey, StudioTabState>;
	status: StudioStatus;
	url: string;
	transcriptPath: string;
	createdAt: number;
	updatedAt: number;
	question?: StudioQuestion;
	lastAnswer?: StudioAnswer;
	workContext?: StudioWorkContextSnapshot;
	timeline: StudioTimelineEntry[];
	logs: Array<{ time: number; message: string }>;
};

type PendingAsk = {
	questionId: string;
	resolve: (answer: StudioAnswer) => void;
	timer: ReturnType<typeof setTimeout>;
};

type FrameStudioHandle = {
	state: FrameStudioState;
	server: Server;
	clients: Set<ServerResponse>;
	pending?: PendingAsk;
	window?: GlimpseWindow;
	pingInterval: ReturnType<typeof setInterval>;
	closed: boolean;
};

const STATE_DIR = join(homedir(), ".pi", "agent", "frame-studio");
const TRANSCRIPTS_DIR = join(STATE_DIR, "transcripts");
const ASK_TIMEOUT_MS = 8 * 60 * 60 * 1000;
const TFT_RESUME_CUSTOM_TYPE = "pilee-tft-studio-resume";
const nodeRequire = createRequire(import.meta.url);
let elkBundlePath: string | undefined;

function resolveElkBundlePath(): string | undefined {
	if (elkBundlePath !== undefined) return elkBundlePath || undefined;
	try {
		elkBundlePath = nodeRequire.resolve("elkjs/lib/elk.bundled.js");
	} catch {
		elkBundlePath = "";
	}
	return elkBundlePath || undefined;
}

const STUDIO_TABS: Array<{ key: StudioTabKey; label: string; subtitle: string }> = [
	{ key: "frame", label: "Frame", subtitle: "계약·계획 합성" },
	{ key: "decide", label: "Decide", subtitle: "대안·challenge·mitigation" },
	{ key: "verify", label: "Verify", subtitle: "판정·healing 기록" },
	{ key: "verify-report", label: "Verify Report", subtitle: "증거 리포트·artifact" },
];

const runsById = new Map<string, FrameStudioHandle>();
const runsByIdentity = new Map<string, FrameStudioHandle>();
let latestRunId: string | undefined;

function resultText(text: string, details?: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function sendJson(res: ServerResponse, value: unknown, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(value));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => { body += chunk; });
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function safeIdentityFileName(key: string): string {
	return key
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120) || "untitled";
}

function transcriptPathForIdentity(key: string): string {
	return join(TRANSCRIPTS_DIR, `${safeIdentityFileName(key)}.json`);
}

function stripOuterQuotes(value: string): string {
	return value.trim().replace(/^['"]|['"]$/g, "");
}

function parseTftOpenTarget(args: string): string {
	const trimmed = args.trim();
	if (!trimmed || /^(?:open|resume|reopen)$/i.test(trimmed)) return "";
	const match = trimmed.match(/^(?:open|resume|reopen)\s+(.+)$/i);
	return stripOuterQuotes(match ? match[1] : trimmed);
}

function transcriptIdentityFromPath(rawTarget: string, cwd: string): { identityKey: string; displayTitle?: string; title?: string } | null {
	if (!rawTarget) return null;
	const candidate = isAbsolute(rawTarget) ? rawTarget : resolvePath(cwd, rawTarget);
	if (!existsSync(candidate)) return null;
	const base = realpathSync(TRANSCRIPTS_DIR);
	const resolved = realpathSync(candidate);
	if (resolved !== base && !resolved.startsWith(`${base}${sep}`)) {
		throw new Error("TFT Studio transcript path must be under ~/.pi/agent/frame-studio/transcripts.");
	}
	const parsed = JSON.parse(readFileSync(resolved, "utf-8")) as Partial<FrameStudioState>;
	const identity = parsed.identity;
	if (!identity?.key) throw new Error("Transcript does not include a TFT Studio identity key.");
	return { identityKey: identity.key, displayTitle: identity.displayTitle, title: parsed.title };
}

function normalizeTab(value: unknown): StudioTabKey | undefined {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!raw) return undefined;
	if (raw === "frame") return "frame";
	if (raw === "decide" || raw === "decision" || raw === "decisions") return "decide";
	if (raw === "verify" || raw === "verification") return "verify";
	if (raw === "verify-report" || raw === "report" || raw === "verify_report") return "verify-report";
	return undefined;
}

function makeDefaultTabs(markdown = "", step?: string): Record<StudioTabKey, StudioTabState> {
	return {
		frame: { markdown, step, updatedAt: Date.now() },
		decide: { markdown: "" },
		verify: { markdown: "" },
		"verify-report": { markdown: "" },
	};
}

function normalizeTabs(value: unknown, markdown = "", step?: string): Record<StudioTabKey, StudioTabState> {
	const defaults = makeDefaultTabs(markdown, step);
	if (!value || typeof value !== "object") return defaults;
	const parsed = value as Partial<Record<StudioTabKey, Partial<StudioTabState>>>;
	for (const tab of STUDIO_TABS) {
		const source = parsed[tab.key];
		if (!source || typeof source !== "object") continue;
		defaults[tab.key] = {
			markdown: typeof source.markdown === "string" ? source.markdown : defaults[tab.key].markdown,
			step: typeof source.step === "string" ? source.step : defaults[tab.key].step,
			updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : defaults[tab.key].updatedAt,
		};
	}
	return defaults;
}

function updateTab(state: FrameStudioState, tab: StudioTabKey, params: { markdown?: string; step?: string }) {
	state.activeTab = tab;
	state.tabs = normalizeTabs(state.tabs, state.markdown, state.step);
	const current = state.tabs[tab] ?? { markdown: "" };
	state.tabs[tab] = {
		...current,
		markdown: params.markdown !== undefined ? params.markdown : current.markdown,
		step: params.step ?? current.step,
		updatedAt: Date.now(),
	};
	if (tab === "frame") {
		if (params.markdown !== undefined) state.markdown = params.markdown;
		if (params.step) state.step = params.step;
	}
}

function stripMarkdownForDigest(markdown: string, max = 700): string {
	const text = markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/!\[[^\]]*\]\([^\)]*\)/g, " ")
		.replace(/\[([^\]]+)\]\([^\)]*\)/g, "$1")
		.replace(/^\s{0,3}#{1,6}\s*/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "- ")
		.replace(/\|\s*-{3,}\s*/g, " ")
		.replace(/[ \t]+/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function transcriptRef(state: FrameStudioState, tab = state.activeTab): StudioTranscriptRef {
	const tabState = state.tabs?.[tab];
	return {
		path: state.transcriptPath,
		openCommand: `/archive ${state.transcriptPath}`,
		tab,
		step: tabState?.step ?? state.step,
		note: "Transcript is provenance. Persist stage outputs to canonical structured data before treating the work as complete.",
	};
}

function stageOutputContract(tab: StudioTabKey): string {
	if (tab === "frame") return "If /frame was performed, persist the agreed goal/scope/success criteria to frame.json first, then synthesize implementation_plan when decisions are closed; frame.md and transcript are mirror/provenance.";
	if (tab === "decide") return "If /decide was performed, persist the selected option, tradeoffs, challenge, and mitigations to frame.json.decisions[] (or an explicit planning canonical record).";
	if (tab === "verify") return "If /verify was performed, persist PASS/FAIL/GAP evidence, side effects, self-healing runs, and re-verify result to frame.json.verifications[] (or an explicit verification record).";
	return "If /verify-report was performed, persist report/evidence artifact refs with the verification item they prove; report HTML is evidence/provenance, not the only canonical result.";
}

function tabLabel(tab: StudioTabKey): string {
	return STUDIO_TABS.find((item) => item.key === tab)?.label ?? tab;
}

function tabSnapshot(state: FrameStudioState, tab: StudioTabKey): StudioTabSnapshot {
	const tabs = normalizeTabs(state.tabs, state.markdown, state.step);
	const tabState = tabs[tab] ?? { markdown: "" };
	const digest = stripMarkdownForDigest(tabState.markdown || "");
	return {
		tab,
		label: tabLabel(tab),
		step: tabState.step,
		updatedAt: tabState.updatedAt,
		hasMarkdown: Boolean((tabState.markdown || "").trim()),
		digest: digest || "No tab markdown recorded yet.",
		timelineEntries: state.timeline.filter((entry) => entry.tab === tab).length,
	};
}

function studioSnapshot(state: FrameStudioState, tab = state.activeTab): StudioContextSnapshot {
	return {
		activeTab: state.activeTab,
		transcriptRef: transcriptRef(state, tab),
		tabs: STUDIO_TABS.map((item) => tabSnapshot(state, item.key)),
	};
}

function answerDigest(question: StudioQuestion, answer: StudioAnswer, tabState: StudioTabSnapshot): string {
	if (answer.status !== "answered") return `${tabLabel(question.tab)} ask ended with status=${answer.status}. See ${tabState.digest ? "tab snapshot" : "transcript"} for context.`;
	const selected = answer.selectedOptions.length ? answer.selectedOptions.join(", ") : "no option selected";
	const text = answer.text?.trim() ? ` Direct input: ${answer.text.trim()}` : "";
	return `${tabLabel(question.tab)} answer for "${question.question}": ${selected}.${text} Current tab context: ${tabState.digest}`;
}

function toolContextDetails(state: FrameStudioState, tab = state.activeTab, contextDigest?: string): StudioToolContextDetails {
	return {
		transcriptRef: transcriptRef(state, tab),
		tabSnapshot: tabSnapshot(state, tab),
		contextDigest,
		stageOutputContract: stageOutputContract(tab),
		workContext: state.workContext,
	};
}

function refreshStudioWorkContext(state: FrameStudioState, ctx: ExtensionContext): StudioWorkContextSnapshot | undefined {
	const card = loadOrDeriveWorkContext(ctx.cwd, ctx.sessionManager?.getSessionFile?.());
	state.workContext = card ? {
		path: card.identity.contextPath,
		tasksPath: card.identity.tasksPath,
		displayName: card.identity.displayName,
		mode: card.mode,
		goal: card.goal,
		currentSlice: card.currentSlice ? { id: card.currentSlice.id, title: card.currentSlice.title, scope: card.currentSlice.scope } : undefined,
		openQuestions: card.openQuestions.slice(0, 4).map((question) => ({ id: question.id, text: question.text, owner: question.owner })),
		verifyFocus: card.verifyFocus.slice(0, 5),
	} : undefined;
	return state.workContext;
}

function persistState(state: FrameStudioState): void {
	try {
		mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
		writeFileSync(state.transcriptPath, JSON.stringify({ ...state, url: "" }, null, 2));
	} catch {}
}

function timelineContentSignature(entry: Partial<StudioTimelineEntry>): string {
	return JSON.stringify({
		kind: entry.kind,
		tab: entry.tab,
		title: entry.title,
		step: entry.step,
		markdown: entry.markdown,
		message: entry.message,
		question: entry.question,
		answer: entry.answer,
	});
}

function normalizeTimelineEntries(entries: unknown[]): StudioTimelineEntry[] {
	const normalized: StudioTimelineEntry[] = [];
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const current = entry as StudioTimelineEntry;
		const previous = normalized[normalized.length - 1];
		if (previous && current.kind === "update" && previous.kind === "update" && timelineContentSignature(previous) === timelineContentSignature(current)) continue;
		normalized.push(current);
	}
	return normalized;
}

function loadPersistedState(identity: FrameIdentity): FrameStudioState | null {
	const transcriptPath = transcriptPathForIdentity(identity.key);
	try {
		if (!existsSync(transcriptPath)) return null;
		const parsed = JSON.parse(readFileSync(transcriptPath, "utf8")) as Partial<FrameStudioState>;
		const markdown = parsed.markdown || "";
		const step = parsed.step;
		return {
			runId: randomUUID().slice(0, 8),
			identity: parsed.identity ?? identity,
			title: parsed.title || identity.displayTitle || "TFT Studio",
			markdown,
			step,
			activeTab: normalizeTab(parsed.activeTab) ?? "frame",
			tabs: normalizeTabs(parsed.tabs, markdown, step),
			status: parsed.status === "done" || parsed.status === "aborted" ? parsed.status : "running",
			url: "",
			transcriptPath,
			createdAt: parsed.createdAt || Date.now(),
			updatedAt: Date.now(),
			question: undefined,
			lastAnswer: parsed.lastAnswer,
			workContext: parsed.workContext as StudioWorkContextSnapshot | undefined,
			timeline: Array.isArray(parsed.timeline) ? normalizeTimelineEntries(parsed.timeline) : [],
			logs: Array.isArray(parsed.logs) ? parsed.logs : [],
		};
	} catch {
		return null;
	}
}

function appendTimeline(state: FrameStudioState, entry: Omit<StudioTimelineEntry, "id" | "time">): void {
	const previous = state.timeline[state.timeline.length - 1];
	if (entry.kind === "update" && previous?.kind === "update" && timelineContentSignature(previous) === timelineContentSignature(entry)) return;
	state.timeline.push({ id: randomUUID().slice(0, 8), time: Date.now(), ...entry });
	state.updatedAt = Date.now();
	persistState(state);
}


function serializeState(state: FrameStudioState) {
	return {
		runId: state.runId,
		identity: state.identity,
		title: state.title,
		markdown: state.markdown,
		step: state.step,
		activeTab: state.activeTab,
		tabs: normalizeTabs(state.tabs, state.markdown, state.step),
		status: state.status,
		url: state.url,
		transcriptPath: state.transcriptPath,
		createdAt: state.createdAt,
		updatedAt: state.updatedAt,
		question: state.question,
		lastAnswer: state.lastAnswer,
		workContext: state.workContext,
		timeline: state.timeline,
		logs: state.logs.slice(-30),
	};
}

function pushState(handle: FrameStudioHandle) {
	const payload = `data: ${JSON.stringify(serializeState(handle.state))}\n\n`;
	for (const client of [...handle.clients]) {
		try { client.write(payload); } catch { handle.clients.delete(client); }
	}
}

function addLog(handle: FrameStudioHandle, message: string) {
	handle.state.logs.push({ time: Date.now(), message });
	handle.state.updatedAt = Date.now();
	persistState(handle.state);
}

function listenOnLoopback(server: Server): Promise<string> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") return reject(new Error("Failed to bind TFT Studio server."));
			resolve(`http://127.0.0.1:${address.port}/`);
		});
	});
}

function buildPageHtml(): string {
	return String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>TFT Studio</title>
<style>
:root {
  color-scheme: light;
  --bg:#fafaf9; --panel:#ffffff; --panel2:#f5f5f4; --line:#e7e5e4;
  --text:#292524; --muted:#78716c; --accent:#7c3aed; --accent-soft:#ede9fe;
  --green:#166534; --red:#991b1b; --amber:#92400e;
}
* { box-sizing: border-box; }
${webviewCopyCss()}
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.app { max-width: min(1280px, calc(100vw - 24px)); margin:0 auto; padding:24px; }
.hero { padding:22px 24px; border:1px solid var(--line); border-radius:18px; background:var(--panel); }
.kicker { display:flex; gap:8px; align-items:center; color:var(--accent); font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
h1 { margin:8px 0 6px; font-size:28px; line-height:1.18; }
.meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; color:var(--muted); }
.badge { border:1px solid var(--line); background:rgba(255,255,255,.75); border-radius:999px; padding:4px 10px; font-size:12px; }
.work-context { display:none; margin-top:16px; border:1px solid #ddd6fe; background:#faf9ff; border-radius:16px; padding:14px 16px; }
.work-context.visible { display:block; }
.work-context-title { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; font-weight:950; color:var(--accent); }
.work-context-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; margin-top:10px; }
.work-context-cell { border:1px solid rgba(124,58,237,.14); background:#fff; border-radius:12px; padding:9px 10px; min-width:0; }
.work-context-label { color:var(--muted); font-size:11px; font-weight:850; text-transform:uppercase; letter-spacing:.04em; }
.work-context-value { margin-top:3px; font-size:12px; overflow-wrap:anywhere; }
.tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:16px; }
.tab { text-align:left; border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:12px 14px; color:var(--text); cursor:pointer; }
.tab:hover { border-color:#c4b5fd; background:#faf9ff; }
.tab.active { border-color:var(--accent); background:var(--accent-soft); box-shadow:0 0 0 1px rgba(124,58,237,.15) inset; }
.tab-label { display:block; font-size:14px; font-weight:900; }
.tab-subtitle { display:block; margin-top:2px; color:var(--muted); font-size:11px; font-weight:650; }
.tab-status { display:inline-block; margin-top:7px; border:1px solid rgba(120,113,108,.25); border-radius:999px; padding:1px 7px; color:var(--muted); font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
.layout { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; margin-top:18px; min-width:0; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:18px 20px; min-width:0; max-width:100%; }
.stage-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
.stage-title { margin:0; font-size:18px; font-weight:900; }
.stage-subtitle { color:var(--muted); font-size:12px; margin-top:2px; }
.card h2 { margin:0 0 10px; font-size:17px; }
.markdown { min-width:0; max-width:100%; overflow-wrap:anywhere; }
.markdown h1 { font-size:23px; border-bottom:1px solid var(--line); padding-bottom:8px; }
.markdown h2 { font-size:19px; margin-top:22px; }
.markdown h3 { font-size:16px; margin-top:18px; }
.markdown h4 { font-size:14px; margin:16px 0 6px; font-weight:900; }
.markdown h5, .markdown h6 { font-size:13px; margin:14px 0 5px; font-weight:850; color:var(--muted); }
.markdown p { margin:8px 0; }
.markdown ul, .markdown ol { padding-left:24px; }
.markdown table { width:100%; max-width:100%; border-collapse:collapse; margin:14px 0; display:block; overflow-x:auto; white-space:normal; }
.markdown th, .markdown td { border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
.markdown th { background:var(--panel2); font-weight:800; }
.markdown tr:nth-child(even) td { background:#fafaf9; }
.markdown code { background:rgba(120,113,108,.13); border-radius:6px; padding:1px 5px; }
.markdown pre { background:#292524; color:#fafaf9; border-radius:12px; padding:14px; overflow:auto; }
.tft-visual { border:1px solid var(--line); border-radius:18px; background:#fbfdff; margin:16px 0; padding:14px; overflow:hidden; min-width:0; max-width:100%; }
.tft-visual-head { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; margin-bottom:12px; min-width:0; }
.tft-visual-title { font-weight:950; font-size:16px; overflow-wrap:anywhere; }
.tft-visual-subtitle { color:var(--muted); font-size:12px; margin-top:2px; overflow-wrap:anywhere; }
.tft-visual-diagram { display:flex; justify-content:flex-start; overflow:auto; border:1px dashed #cbd5e1; border-radius:16px; background:#fff; padding:12px; min-width:0; max-width:100%; }
.tft-elk-canvas { position:relative; flex:0 0 auto; }
.tft-elk-canvas svg { position:absolute; inset:0; z-index:1; }
.tft-elk-table { position:absolute; z-index:2; background:#fff; border:1px solid #cbd5e1; border-radius:14px; overflow:hidden; box-shadow:0 10px 24px rgba(15,23,42,.07); }
.tft-elk-table.new { border-color:#86efac; }
.tft-elk-table.changed { border-color:#fcd34d; }
.tft-elk-table.removed, .tft-elk-table.deleted { border-color:#fca5a5; }
.tft-elk-head { min-height:42px; background:#f8fafc; border-bottom:1px solid var(--line); display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:9px 10px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:13px; overflow-wrap:anywhere; }
.tft-elk-table.new .tft-elk-head { background:#f0fdf4; }
.tft-elk-table.changed .tft-elk-head { background:#fffbeb; }
.tft-elk-table.removed .tft-elk-head, .tft-elk-table.deleted .tft-elk-head { background:#fef2f2; }
.tft-elk-row { min-height:56px; display:flex; align-items:flex-start; justify-content:space-between; gap:8px; padding:9px 10px; border-top:1px solid #f1f5f9; overflow-wrap:anywhere; }
.tft-elk-row:first-of-type { border-top:0; }
.tft-elk-row b { display:block; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12px; overflow-wrap:anywhere; }
.tft-elk-row small { display:block; color:var(--muted); font-size:10px; margin-top:1px; }
.tft-pill { display:inline-flex; border:1px solid var(--line); border-radius:999px; padding:3px 7px; font-size:10px; font-weight:900; white-space:nowrap; }
.tft-pill.new, .tft-pill.rate { background:#f0fdf4; border-color:#bbf7d0; color:#166534; }
.tft-pill.changed, .tft-pill.semantic, .tft-pill.unique-part { background:#fffbeb; border-color:#fde68a; color:#92400e; }
.tft-pill.removed, .tft-pill.deleted, .tft-pill.risk { background:#fef2f2; border-color:#fecaca; color:#991b1b; }
.tft-pill.fk, .tft-pill.relation { background:#eff6ff; border-color:#bfdbfe; color:#1d4ed8; }
.tft-pill.unique { background:#f5f3ff; border-color:#ddd6fe; color:#6d28d9; }
.tft-pill.same, .tft-pill.default { background:#f8fafc; color:#64748b; }
.tft-edge-label { font-size:12px; font-weight:900; fill:#334155; paint-order:stroke; stroke:#fff; stroke-width:5px; }
.tft-visual-legend { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:8px; margin-top:12px; min-width:0; }
.tft-relation-card, .tft-note-card { border:1px solid var(--line); border-radius:13px; background:#fff; padding:10px 11px; }
.tft-relation-card strong, .tft-note-card strong { display:block; margin-bottom:4px; overflow-wrap:anywhere; }
.tft-relation-card p, .tft-note-card p { margin:4px 0; color:var(--muted); font-size:12px; line-height:1.45; overflow-wrap:anywhere; }
.tft-visual-error { border:1px solid #fecaca; background:#fef2f2; color:#991b1b; border-radius:14px; padding:12px; white-space:pre-wrap; }
.question { border-color:#ddd6fe; background:#faf9ff; }
.question-title { font-size:18px; font-weight:800; margin:0 0 12px; }
.options { display:grid; gap:10px; margin:14px 0; }
.option { display:flex; gap:10px; align-items:flex-start; padding:12px; border:1px solid var(--line); border-radius:14px; background:#fff; cursor:pointer; }
.option:hover { border-color:#c4b5fd; background:#faf9ff; }
.option input { margin-top:3px; }
.option-number { min-width:24px; height:24px; border-radius:8px; display:inline-grid; place-items:center; background:var(--accent-soft); color:var(--accent); font-weight:800; }
textarea { width:100%; min-height:92px; resize:vertical; border:1px solid var(--line); border-radius:14px; padding:12px; font:inherit; }
.actions { display:flex; gap:10px; align-items:center; margin-top:14px; }
button { border:0; border-radius:12px; padding:10px 15px; font-weight:800; cursor:pointer; }
.primary { background:var(--accent); color:white; }
.secondary { background:var(--panel2); color:var(--text); }
.status { color:var(--muted); font-size:13px; }
.answer { border-color:#bbf7d0; background:#f0fdf4; }
.answer-title { display:flex; gap:8px; align-items:center; font-size:18px; font-weight:850; margin:0 0 12px; color:var(--green); }
.answer-row { margin:8px 0; }
.answer-label { color:var(--muted); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
.answer-value { margin-top:3px; }
.stage-runs { display:grid; gap:16px; min-width:0; max-width:100%; }
.stage-run { border:1px solid var(--line); border-radius:16px; background:#fafaf9; padding:12px; min-width:0; max-width:100%; }
.stage-run.running, .stage-run.awaiting { border-color:#c4b5fd; background:#faf9ff; }
.stage-run.done { border-color:#bbf7d0; background:#f0fdf4; }
.stage-run.aborted { border-color:#fecaca; background:#fef2f2; }
.stage-run-head { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; margin-bottom:10px; }
.stage-run-title { font-weight:900; font-size:15px; }
.stage-run-meta { display:flex; flex-wrap:wrap; gap:6px; color:var(--muted); font-size:12px; }
.stage-run-body { display:grid; gap:12px; min-width:0; max-width:100%; }
.timeline { display:grid; gap:12px; min-width:0; max-width:100%; }
.timeline-item { border:1px solid var(--line); border-radius:14px; padding:14px 16px; background:#fff; min-width:0; max-width:100%; }
.timeline-item.pending { border-color:#ddd6fe; background:#faf9ff; box-shadow:0 0 0 1px rgba(124,58,237,.10) inset; }
.timeline-item.answer-entry { border-color:#bbf7d0; background:#f0fdf4; }
.timeline-head { display:flex; gap:8px; flex-wrap:wrap; align-items:center; color:var(--muted); font-size:12px; font-weight:800; margin-bottom:8px; }
.timeline-kind { color:var(--accent); text-transform:uppercase; letter-spacing:.04em; }
.timeline-body { display:grid; gap:10px; min-width:0; max-width:100%; }
.timeline-markdown { margin-top:4px; min-width:0; max-width:100%; }
.inline-question { border:1px solid #ddd6fe; border-radius:14px; background:#fff; padding:14px; }
.timeline details { margin-top:8px; }
.timeline summary { cursor:pointer; font-weight:800; color:var(--text); }
.logs { color:var(--muted); font-size:12px; max-height:160px; overflow:auto; }
.empty { color:var(--muted); padding:24px; text-align:center; }
</style>
</head>
<body>
<div class="app">
  <section class="hero">
    <div class="kicker">TFT Studio</div>
    <h1 id="title">TFT Studio</h1>
    <div class="meta" id="meta"></div>
    <nav class="tabs" id="tabs"></nav>
    <div class="work-context" id="workContext"></div>
  </section>
  <main class="layout">
    <section class="card">
      <div class="stage-head">
        <div>
          <h2 class="stage-title" id="flowTitle">TFT 진행</h2>
          <div class="stage-subtitle" id="flowSubtitle">업데이트·질문·답변을 시간순으로 표시합니다.</div>
        </div>
        <span class="badge" id="flowStatus">running</span>
      </div>
      <div class="timeline" id="timeline"></div>
    </section>
    <section class="card"><h2>로그</h2><div class="logs" id="logs"></div></section>
  </main>
</div>
<script src="/elk.bundled.js"></script>
<script>
${webviewCopyScript()}
var state = null;
var selectedTab = null;
var STUDIO_TABS = [
  { key:'frame', label:'Frame', subtitle:'계약·계획 합성', empty:'아직 Frame 기록이 없습니다. /frame으로 목표·범위·성공 기준을 정렬하고, 결정이 닫히면 같은 Frame 안에서 구현 계획을 합성합니다.' },
  { key:'decide', label:'Decide', subtitle:'대안·challenge·mitigation', empty:'아직 Decide 기록이 없습니다. 순서 강제가 아니므로 명확한 작업은 이 탭을 비워둔 채 Verify/Verify Report를 사용할 수 있습니다. /decide가 같은 identity에 decision table과 challenge를 기록하면 여기에 표시됩니다.' },
  { key:'verify', label:'Verify', subtitle:'판정·healing 기록', empty:'아직 Verify 기록이 없습니다. Decide가 없어도 user request, frame success criteria, diff, evidence 기준으로 바로 검증을 기록할 수 있습니다. Self-healing은 별도 탭이 아니라 실패/gap 이후 이 탭에 run/re-verify 기록으로 append합니다.' },
  { key:'verify-report', label:'Verify Report', subtitle:'증거 리포트·artifact', empty:'아직 Verify Report 기록이 없습니다. Verify 탭 기록이 없어도 evidence report artifact를 바로 연결할 수 있습니다. 단, 검증 축이나 coverage gap은 report에 명시해야 합니다.' }
];
function esc(s) { return String(s || '').replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
function inline(s) { var tick = String.fromCharCode(96); return esc(s).replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
function simpleHash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i); return (h >>> 0).toString(36); }
function visualPlaceholder(source) {
  var id = 'tftv-' + simpleHash(source) + '-' + Math.random().toString(36).slice(2, 7);
  return '<div id="' + id + '" class="tft-visual" data-source="' + encodeURIComponent(source) + '"><div class="status">TFT visual 렌더링 중...</div></div>';
}
function normalizeVisualStatus(value, fallback) { return String(value || fallback || 'same').trim().toLowerCase().replace(/_/g, '-'); }
function pillClass(value) {
  var v = normalizeVisualStatus(value, 'default');
  if (v.indexOf('new') >= 0) return 'new';
  if (v.indexOf('delete') >= 0 || v.indexOf('remove') >= 0) return 'removed';
  if (v.indexOf('change') >= 0 || v.indexOf('semantic') >= 0) return 'changed';
  if (v.indexOf('unique-part') >= 0) return 'unique-part';
  if (v.indexOf('unique') >= 0) return 'unique';
  if (v.indexOf('fk') >= 0 || v.indexOf('relation') >= 0) return 'fk';
  if (v.indexOf('rate') >= 0) return 'rate';
  if (v.indexOf('risk') >= 0) return 'risk';
  if (v.indexOf('same') >= 0) return 'same';
  return 'default';
}
function renderPill(value) { return '<span class="tft-pill ' + pillClass(value) + '">' + esc(value || 'same') + '</span>'; }
function estimateVisualTextWidth(value) {
  var text = String(value || '');
  var ascii = text.replace(/[^\x00-\x7F]/g, '');
  var wide = text.length - ascii.length;
  return Math.ceil(ascii.length * 8 + wide * 13);
}
function tableWidth(table) {
  var requested = Number(table.width);
  if (Number.isFinite(requested) && requested > 0) return Math.max(240, Math.min(requested, 560));
  var labels = [table.name || table.id || ''];
  (table.columns || []).forEach(function(col) {
    labels.push(col.name || col.id || '');
    (col.badges || []).forEach(function(badge) { labels.push(badge); });
  });
  var widest = labels.reduce(function(max, label) { return Math.max(max, estimateVisualTextWidth(label)); }, 0);
  return Math.max(260, Math.min(560, widest + 96));
}
function estimatedRowHeight(col) {
  var labelWidth = estimateVisualTextWidth(col.name || col.id || '');
  var badgeCount = (col.badges || []).length || 1;
  var hasDescription = Boolean(col.description);
  return Math.max(56, 44 + Math.ceil(labelWidth / 260) * 12 + (badgeCount > 2 ? 12 : 0) + (hasDescription ? 14 : 0));
}
function tableHeight(table) { return 48 + Math.max(1, (table.columns || []).reduce(function(sum, col) { return sum + estimatedRowHeight(col); }, 0)); }
function relationNodeId(ref) { return String(ref || '').split('.')[0]; }
function renderRelationCards(relations) {
  if (!relations || !relations.length) return '';
  return '<div class="tft-visual-legend">' + relations.map(function(r, i) {
    var id = r.id || ('R' + (i + 1));
    var title = (r.from || '?') + ' → ' + (r.to || '?');
    return '<div class="tft-relation-card"><strong>' + esc(id) + ' · ' + inline(title) + '</strong>' + (r.description ? '<p>' + inline(r.description) + '</p>' : '') + (r.why ? '<p><b>왜:</b> ' + inline(r.why) + '</p>' : '') + '</div>';
  }).join('') + '</div>';
}
function renderLearningNotes(notes) {
  if (!notes || !notes.length) return '';
  return '<div class="tft-visual-legend">' + notes.map(function(n) {
    var body = Array.isArray(n.body) ? '<ul>' + n.body.map(function(item) { return '<li>' + inline(item) + '</li>'; }).join('') + '</ul>' : '<p>' + inline(n.body || n.text || '') + '</p>';
    return '<div class="tft-note-card"><strong>' + esc(n.title || '설명') + '</strong>' + body + '</div>';
  }).join('') + '</div>';
}
function renderElkTable(table, node, scale, pad) {
  var status = table.status || 'same';
  var rows = (table.columns || []).map(function(col) {
    var badges = (col.badges && col.badges.length ? col.badges : [col.status || 'same']).map(renderPill).join('');
    return '<div class="tft-elk-row"><div><b>' + esc(col.name || col.id || '') + '</b>' + (col.description ? '<small>' + esc(col.description) + '</small>' : '') + '</div><div>' + badges + '</div></div>';
  }).join('');
  return '<div class="tft-elk-table ' + pillClass(status) + '" style="left:' + ((pad + node.x) * scale) + 'px;top:' + ((pad + node.y) * scale) + 'px;width:' + (node.width * scale) + 'px;height:' + (node.height * scale) + 'px"><div class="tft-elk-head"><b>' + esc(table.name || table.id) + '</b>' + renderPill(status) + '</div>' + rows + '</div>';
}
function edgePath(section, scale, pad) {
  var pts = [section.startPoint].concat(section.bendPoints || [], [section.endPoint]);
  return pts.map(function(p, i) { return (i ? 'L' : 'M') + ((pad + p.x) * scale) + ' ' + ((pad + p.y) * scale); }).join(' ');
}
async function renderTftVisualElement(el) {
  if (el.getAttribute('data-rendered') === '1') return;
  el.setAttribute('data-rendered', '1');
  var source = decodeURIComponent(el.getAttribute('data-source') || '');
  var spec;
  try { spec = JSON.parse(source); } catch (e) { el.innerHTML = '<div class="tft-visual-error">tft-visual JSON parse failed:\\n' + esc(e.message || e) + '</div>'; return; }
  if (!window.ELK) { el.innerHTML = '<div class="tft-visual-error">ELK renderer를 불러오지 못했습니다.</div>'; return; }
  var tables = Array.isArray(spec.tables) ? spec.tables : [];
  if (!tables.length) { el.innerHTML = '<div class="tft-visual-error">tft-visual에는 tables 배열이 필요합니다.</div>'; return; }
  var relations = Array.isArray(spec.relations) ? spec.relations : [];
  var direction = String(spec.direction || spec.layout || 'DOWN').toUpperCase();
  if (direction !== 'RIGHT') direction = 'DOWN';
  var children = tables.map(function(t) { return { id:String(t.id || t.name), width:tableWidth(t), height:tableHeight(t) }; });
  var edges = relations.map(function(r, i) { return { id:String(r.id || ('R' + (i + 1))), sources:[relationNodeId(r.from)], targets:[relationNodeId(r.to)] }; }).filter(function(e) { return e.sources[0] && e.targets[0]; });
  try {
    var elk = new window.ELK();
    var laid = await elk.layout({ id:'root', layoutOptions:{
      'elk.algorithm':'layered',
      'elk.direction':direction,
      'elk.spacing.nodeNode':String(spec.nodeSpacing || 32),
      'elk.layered.spacing.nodeNodeBetweenLayers':String(spec.layerSpacing || 70),
      'elk.edgeRouting':'ORTHOGONAL',
      'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX',
      'elk.layered.crossingMinimization.strategy':'LAYER_SWEEP'
    }, children:children, edges:edges });
    var pad = 24;
    var rawWidth = (laid.width || 900) + pad * 2;
    var requestedScale = Number(spec.scale);
    var scale = Number.isFinite(requestedScale) && requestedScale > 0 ? requestedScale : 1;
    var width = Math.ceil(rawWidth * scale);
    var height = Math.ceil(((laid.height || 420) + pad * 2) * scale);
    var nodeById = {}; (laid.children || []).forEach(function(n) { nodeById[n.id] = n; });
    var markerId = el.id + '-arrow';
    var edgeSvg = (laid.edges || []).map(function(e) {
      var section = e.sections && e.sections[0]; if (!section) return '';
      var rel = relations.find(function(r, i) { return String(r.id || ('R' + (i + 1))) === e.id; }) || {};
      var color = rel.color || (e.id === 'R1' ? '#2563eb' : '#7c3aed');
      var label = rel.shortLabel || e.id;
      var midX = (pad + (section.startPoint.x + section.endPoint.x) / 2) * scale;
      var midY = (pad + (section.startPoint.y + section.endPoint.y) / 2) * scale - 8;
      return '<path d="' + edgePath(section, scale, pad) + '" fill="none" stroke="' + esc(color) + '" stroke-width="2.5" marker-end="url(#' + markerId + ')"/><text x="' + midX + '" y="' + midY + '" class="tft-edge-label">' + esc(label) + '</text>';
    }).join('');
    var tableHtml = tables.map(function(t) { return renderElkTable(t, nodeById[String(t.id || t.name)], scale, pad); }).join('');
    var svg = '<svg width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '"><defs><marker id="' + markerId + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7c3aed"/></marker></defs>' + edgeSvg + '</svg>';
    el.innerHTML = '<div class="tft-visual-head"><div><div class="tft-visual-title">' + esc(spec.title || 'TFT visual') + '</div>' + (spec.subtitle ? '<div class="tft-visual-subtitle">' + esc(spec.subtitle) + '</div>' : '') + '</div>' + renderPill(direction === 'DOWN' ? 'top-down' : 'left-right') + '</div><div class="tft-visual-diagram"><div class="tft-elk-canvas" style="width:' + width + 'px;height:' + height + 'px">' + svg + tableHtml + '</div></div>' + renderRelationCards(relations) + renderLearningNotes(spec.notes || spec.explanations);
  } catch (e) {
    el.innerHTML = '<div class="tft-visual-error">ELK layout failed:\\n' + esc(e && e.message ? e.message : e) + '</div>';
  }
}
function renderPendingTftVisuals() { Array.prototype.slice.call(document.querySelectorAll('.tft-visual[data-source]')).forEach(function(el) { renderTftVisualElement(el); }); }
function renderMarkdown(md) {
  var lines = String(md || '').split(/\r?\n/);
  var html = []; var inCode = false; var list = null;
  function closeList() { if (list) { html.push('</' + list + '>'); list = null; } }
  function splitTableRow(line) {
    var trimmed = String(line || '').trim();
    if (trimmed.indexOf('|') < 0) return null;
    if (trimmed.charAt(0) === '|') trimmed = trimmed.slice(1);
    if (trimmed.charAt(trimmed.length - 1) === '|') trimmed = trimmed.slice(0, -1);
    var cells = []; var current = ''; var inInlineCode = false;
    for (var i = 0; i < trimmed.length; i++) {
      var ch = trimmed.charAt(i);
      if (ch === '\\' && trimmed.charAt(i + 1) === '|') { current += '|'; i++; continue; }
      if (ch === String.fromCharCode(96)) inInlineCode = !inInlineCode;
      if (ch === '|' && !inInlineCode) { cells.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells.length > 1 ? cells : null;
  }
  function isTableDivider(line) {
    var cells = splitTableRow(line);
    return !!cells && cells.every(function(cell) { return /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')); });
  }
  function renderTable(start) {
    var header = splitTableRow(lines[start]);
    if (!header || !isTableDivider(lines[start + 1] || '')) return null;
    var rows = []; var i = start + 2;
    while (i < lines.length) {
      if (!lines[i].trim()) break;
      var cells = splitTableRow(lines[i]);
      if (!cells || isTableDivider(lines[i])) break;
      rows.push(cells); i++;
    }
    var colCount = header.length;
    var out = '<table><thead><tr>' + header.map(function(cell) { return '<th>' + inline(cell) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function(row) {
      out += '<tr>';
      for (var c = 0; c < colCount; c++) out += '<td>' + inline(row[c] || '') + '</td>';
      out += '</tr>';
    });
    out += '</tbody></table>';
    return { html: out, next: i };
  }
  for (var idx = 0; idx < lines.length; idx++) {
    var line = lines[idx];
    var fence = line.trim();
    if (!inCode && fence.indexOf(String.fromCharCode(96).repeat(3) + 'tft-visual') === 0) {
      closeList();
      var visualLines = [];
      idx++;
      while (idx < lines.length && lines[idx].trim().indexOf(String.fromCharCode(96).repeat(3)) !== 0) { visualLines.push(lines[idx]); idx++; }
      html.push(visualPlaceholder(visualLines.join('\n')));
      continue;
    }
    if (/^\s*/.test(line) && fence.indexOf(String.fromCharCode(96).repeat(3)) === 0) { closeList(); if (inCode) html.push('</code></pre>'); else html.push('<pre><code>'); inCode = !inCode; continue; }
    if (inCode) { html.push(esc(line) + '\n'); continue; }
    var table = renderTable(idx); if (table) { closeList(); html.push(table.html); idx = table.next - 1; continue; }
    var heading = line.match(/^(#{1,6})\s+(.+)$/); if (heading) { closeList(); var level = heading[1].length; html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>'); continue; }
    var ol = line.match(/^\s*(\d+)\.\s+(.*)$/); if (ol) { if (list !== 'ol') { closeList(); list = 'ol'; html.push('<ol>'); } html.push('<li>' + inline(ol[2]) + '</li>'); continue; }
    var ul = line.match(/^\s*[-*]\s+(.*)$/); if (ul) { if (list !== 'ul') { closeList(); list = 'ul'; html.push('<ul>'); } html.push('<li>' + inline(ul[1]) + '</li>'); continue; }
    closeList();
    if (!line.trim()) html.push('<br/>'); else html.push('<p>' + inline(line) + '</p>');
  }
  closeList(); if (inCode) html.push('</code></pre>');
  return html.join('');
}
function setStatus(text) { var el = document.getElementById('submitStatus'); if (el) el.textContent = text; }
function submitShortcutLabel(label) {
  var base = String(label || '선택 완료').trim() || '선택 완료';
  base = base.replace(/\s*\((?:⌥↵|Option\s*\+\s*Enter|Alt\s*\+\s*Enter)\)\s*$/i, '');
  base = base.replace(/⌥↵|Option\s*\+\s*Enter|Alt\s*\+\s*Enter/ig, '⌘↵');
  if (/⌘|Command\s*\+\s*Enter|Cmd\s*\+\s*Enter|Meta\s*\+\s*Enter/i.test(base)) return base;
  return base + ' (⌘↵)';
}
function answerStatusLabel(status) {
  if (status === 'answered') return '선택 완료됨';
  if (status === 'cancelled') return '선택 취소됨';
  if (status === 'timeout') return '응답 시간 초과';
  return '응답 상태: ' + esc(status || 'unknown');
}
function renderAnswerCard(answer) {
  var optionHtml = (answer.selectedOptions || []).length
    ? '<ol>' + answer.selectedOptions.map(function(opt) { return '<li>' + inline(opt) + '</li>'; }).join('') + '</ol>'
    : '<div class="status">선택한 옵션 없음</div>';
  var textHtml = answer.text ? '<div class="answer-row"><div class="answer-label">직접 입력</div><div class="answer-value">' + inline(answer.text) + '</div></div>' : '';
  return '<div class="answer-title">✅ ' + answerStatusLabel(answer.status) + '</div>'
    + (answer.question ? '<div class="answer-row"><div class="answer-label">질문</div><div class="answer-value">' + inline(answer.question) + '</div></div>' : '')
    + '<div class="answer-row"><div class="answer-label">선택값</div><div class="answer-value">' + optionHtml + '</div></div>'
    + textHtml
    + '<div class="status">Pi가 다음 단계를 준비 중입니다. 다음 markdown update가 오면 이 카드가 교체됩니다.</div>';
}
function renderQuestionForm(q) {
  var type = q.multiSelect ? 'checkbox' : 'radio';
  return '<div class="inline-question">'
    + '<div class="question-title">' + esc(q.question) + '</div>'
    + '<div class="options">' + q.options.map(function(opt, i) {
      return '<label class="option"><input name="frameOption" type="' + type + '" value="' + i + '"><span class="option-number">' + (i + 1) + '</span><span>' + inline(opt) + '</span></label>';
    }).join('') + '</div>'
    + (q.allowText ? '<textarea id="answerText" placeholder="' + esc(q.placeholder || '직접 입력') + '"></textarea>' : '')
    + '<div class="actions"><button class="primary" onclick="submitAnswer()">' + esc(submitShortcutLabel(q.submitLabel)) + '</button><button class="secondary" onclick="cancelAnswer()">취소</button><span class="status" id="submitStatus"></span></div>'
    + '</div>';
}
function renderTimelineEntry(entry, s) {
  var isPending = !!(s && s.status === 'awaiting' && s.question && entry.question && entry.question.id === s.question.id);
  var classes = ['timeline-item'];
  if (isPending) classes.push('pending');
  if (entry.answer) classes.push('answer-entry');
  var head = '<div class="timeline-head"><span>' + new Date(entry.time).toLocaleTimeString() + '</span><span class="timeline-kind">' + esc(entry.kind || '') + '</span>' + (entry.tab ? '<span>' + esc(entry.tab) + '</span>' : '') + (entry.step ? '<span>' + esc(entry.step) + '</span>' : '') + (isPending ? '<span class="badge">선택 대기</span>' : '') + '</div>';
  var body = '';
  if (entry.message) body += '<p>' + inline(entry.message) + '</p>';
  if (entry.markdown) body += '<div class="markdown timeline-markdown">' + renderMarkdown(entry.markdown) + '</div>';
  if (entry.question) {
    if (isPending) {
      body += renderQuestionForm(s.question);
    } else {
      body += '<div class="answer-row"><div class="answer-label">질문</div><div class="answer-value">' + inline(entry.question.question) + '</div></div>';
      if ((entry.question.options || []).length) {
        body += '<div class="answer-row"><div class="answer-label">옵션</div><ol>' + entry.question.options.map(function(opt) { return '<li>' + inline(opt) + '</li>'; }).join('') + '</ol></div>';
      }
    }
  }
  if (entry.answer) body += renderAnswerCard(entry.answer);
  return '<div class="' + classes.join(' ') + '">' + head + '<div class="timeline-body">' + (body || '<span class="status">내용 없음</span>') + '</div></div>';
}
function timelineEntriesForTab(s, key) {
  return (s.timeline || []).filter(function(entry) { return (!entry.tab && key === 'frame') || entry.tab === key; });
}
function visibleTimelineEntries(s) {
  return timelineEntriesForTab(s, activeTabKey(s));
}
function renderTimeline(entries, s) {
  if (!entries || !entries.length) return '<span class="status">아직 기록된 TFT 전문이 없습니다.</span>';
  return entries.map(function(entry) { return renderTimelineEntry(entry, s); }).join('');
}
function stageLabel(key) {
  var tab = STUDIO_TABS.find(function(item) { return item.key === key; });
  return tab ? tab.label : key;
}
function groupStageRuns(entries, active) {
  var runs = []; var current = null; var index = 0;
  function startRun(entry) {
    index += 1;
    current = { index:index, tab:active, entries:[], status:'running', startedAt:entry && entry.time, endedAt:null };
    runs.push(current);
  }
  (entries || []).forEach(function(entry) {
    var kind = entry.kind || 'entry';
    if (!current || (current.entries.length && (kind === 'start' || current.status !== 'running'))) startRun(entry);
    current.entries.push(entry);
    if (!current.startedAt || (entry.time && entry.time < current.startedAt)) current.startedAt = entry.time;
    if (kind === 'finish') { current.status = 'done'; current.endedAt = entry.time; }
    else if (kind === 'abort') { current.status = 'aborted'; current.endedAt = entry.time; }
  });
  return runs;
}
function stageRunStatus(run, s) {
  var pending = !!(s && s.status === 'awaiting' && s.question && run.entries.some(function(entry) { return entry.question && entry.question.id === s.question.id; }));
  return pending ? 'awaiting' : run.status;
}
function renderStageRun(run, s, active) {
  var status = stageRunStatus(run, s);
  var start = run.startedAt ? new Date(run.startedAt).toLocaleTimeString() : '';
  var end = run.endedAt ? new Date(run.endedAt).toLocaleTimeString() : '';
  var title = stageLabel(active) + ' Run #' + run.index;
  var range = start && end ? start + ' → ' + end : (start || '시간 미상');
  return '<article class="stage-run ' + esc(status) + '">'
    + '<div class="stage-run-head"><div><div class="stage-run-title">' + esc(title) + '</div><div class="stage-run-meta"><span>' + esc(range) + '</span><span>' + run.entries.length + ' entries</span></div></div><span class="badge">' + esc(status) + '</span></div>'
    + '<div class="stage-run-body timeline">' + renderTimeline(run.entries, s) + '</div>'
    + '</article>';
}
function renderStageRuns(entries, s, active) {
  if (!entries || !entries.length) return '<span class="status">아직 기록된 TFT 전문이 없습니다.</span>';
  var runs = groupStageRuns(entries, active);
  return '<div class="stage-runs">' + runs.map(function(run) { return renderStageRun(run, s, active); }).join('') + '</div>';
}
function tabData(s, key) {
  var tabs = s.tabs || {};
  var data = tabs[key] || {};
  if (key === 'frame' && !data.markdown && s.markdown) data = { markdown:s.markdown, step:s.step, updatedAt:s.updatedAt };
  return data;
}
function activeTabKey(s) {
  var key = selectedTab || s.activeTab || 'frame';
  return STUDIO_TABS.some(function(tab) { return tab.key === key; }) ? key : 'frame';
}
function tabStatus(s, key) {
  var data = tabData(s, key);
  if (s.status === 'awaiting' && s.question && s.question.tab === key) return 'awaiting';
  var runs = groupStageRuns(timelineEntriesForTab(s, key), key);
  if (runs.length) return stageRunStatus(runs[runs.length - 1], s);
  if (data.markdown) return 'active';
  return 'idle';
}
function renderTabs(s) {
  var active = activeTabKey(s);
  return STUDIO_TABS.map(function(tab) {
    var status = tabStatus(s, tab.key);
    return '<button class="tab ' + (tab.key === active ? 'active' : '') + '" onclick="selectTab(\'' + tab.key + '\')">'
      + '<span class="tab-label">' + esc(tab.label) + '</span>'
      + '<span class="tab-subtitle">' + esc(tab.subtitle) + '</span>'
      + '<span class="tab-status">' + esc(status) + '</span>'
      + '</button>';
  }).join('');
}
function selectTab(key) { selectedTab = key; if (state) render(state); }
function renderWorkContext(ctx) {
  if (!ctx) return '';
  var slice = ctx.currentSlice;
  var cells = [
    ['Goal', ctx.goal || '(목표 미기록)'],
    ['Current slice', slice ? (slice.id + ' · ' + slice.title + (slice.scope && slice.scope.length ? ' · ' + slice.scope.join(', ') : '')) : '(slice 미선택)'],
    ['Needs user', ctx.openQuestions && ctx.openQuestions.length ? ctx.openQuestions.map(function(q) { return q.id + ': ' + q.text; }).join(' / ') : '없음'],
    ['Verify focus', ctx.verifyFocus && ctx.verifyFocus.length ? ctx.verifyFocus.join(' / ') : '미기록']
  ];
  return '<div class="work-context-title"><span>Working Context Card</span><span class="badge">' + esc(ctx.mode || 'unknown') + '</span></div>'
    + '<div class="work-context-grid">' + cells.map(function(pair) {
      return '<div class="work-context-cell"><div class="work-context-label">' + esc(pair[0]) + '</div><div class="work-context-value">' + esc(pair[1]) + '</div></div>';
    }).join('') + '</div>';
}
function render(s) {
  state = s;
  if (!s.status || s.status !== 'awaiting' || !s.question) { submitInFlight = false; submittedQuestionId = ''; }
  else if (submittedQuestionId && s.question.id !== submittedQuestionId) { submitInFlight = false; submittedQuestionId = ''; }
  if (s.status === 'awaiting' && s.question && !selectedTab) selectedTab = s.question.tab || s.activeTab || 'frame';
  document.title = s.title || 'TFT Studio';
  document.getElementById('title').textContent = s.title || 'TFT Studio';
  var ident = s.identity || {};
  document.getElementById('meta').innerHTML = [
    '<span class="badge">TFT Studio</span>',
    '<span class="badge">' + esc(ident.mode || 'unknown') + '</span>',
    '<span class="badge">' + esc(ident.displayTitle || '') + '</span>',
    s.step ? '<span class="badge">' + esc(s.step) + '</span>' : '',
    '<span class="badge">' + esc(s.status || '') + '</span>'
  ].filter(Boolean).join('');
  document.getElementById('tabs').innerHTML = renderTabs(s);
  var wc = document.getElementById('workContext');
  wc.innerHTML = renderWorkContext(s.workContext);
  wc.className = 'work-context' + (s.workContext ? ' visible' : '');
  var active = activeTabKey(s);
  var activeMeta = STUDIO_TABS.find(function(tab) { return tab.key === active; }) || STUDIO_TABS[0];
  document.getElementById('flowTitle').textContent = activeMeta.label + ' 진행';
  document.getElementById('flowSubtitle').textContent = '업데이트·질문·답변을 시간순으로 표시합니다. 현재 선택도 해당 step 안에 표시됩니다.';
  document.getElementById('flowStatus').textContent = tabStatus(s, active);
  document.getElementById('timeline').innerHTML = renderStageRuns(visibleTimelineEntries(s), s, active);
  setTimeout(renderPendingTftVisuals, 0);
  document.getElementById('logs').innerHTML = (s.logs || []).slice().reverse().map(function(log) {
    return '<div>' + new Date(log.time).toLocaleTimeString() + ' · ' + esc(log.message) + '</div>';
  }).join('') || '<span class="status">로그 없음</span>';
}
var submitInFlight = false;
var submittedQuestionId = '';
async function submitAnswer(cancelled) {
  if (submitInFlight || !state || !state.question) return;
  submitInFlight = true;
  submittedQuestionId = state.question.id;
  var checked = Array.prototype.slice.call(document.querySelectorAll('input[name="frameOption"]:checked')).map(function(el) { return Number(el.value); });
  var textEl = document.getElementById('answerText');
  setStatus('전송 중...');
  try {
    var res = await fetch('/submit', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ questionId: state.question.id, cancelled: !!cancelled, selectedIndices: checked, text: textEl ? textEl.value : '' }) });
    if (!res.ok) throw new Error(await res.text());
    setStatus('Pi로 전송됨');
  } catch (e) { setStatus('전송 실패: ' + e.message); submitInFlight = false; }
}
function cancelAnswer() { submitAnswer(true); }
function isEnterKey(event) {
  if (!event) return false;
  var key = event.key || '';
  var code = event.code || '';
  return key === 'Enter' || key === 'NumpadEnter' || code === 'Enter' || code === 'NumpadEnter';
}
function isSubmitShortcut(event) {
  if (!event || event.isComposing || !isEnterKey(event)) return false;
  return event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
}
function isLegacyAltSubmitShortcut(event) {
  if (!event || event.isComposing || !isEnterKey(event)) return false;
  return event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey;
}
function suppressShortcutEvent(event) {
  event.preventDefault();
  event.stopPropagation();
  if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
}
function hasPendingQuestion() {
  return !!(state && state.status === 'awaiting' && state.question);
}
document.addEventListener('keydown', function(event) {
  if (!hasPendingQuestion()) return;
  if (isSubmitShortcut(event)) {
    suppressShortcutEvent(event);
    submitAnswer(false);
    return;
  }
  if (isLegacyAltSubmitShortcut(event)) {
    suppressShortcutEvent(event);
    var active = document.activeElement;
    if (active && typeof active.blur === 'function') active.blur();
    setTimeout(function() { submitAnswer(false); }, 0);
  }
}, true);
document.addEventListener('keyup', function(event) {
  if (hasPendingQuestion() && isLegacyAltSubmitShortcut(event)) suppressShortcutEvent(event);
}, true);
var es = new EventSource('/events');
es.onmessage = function(ev) { render(JSON.parse(ev.data)); };
es.onerror = function() { setTimeout(function(){ location.reload(); }, 2000); };
fetch('/state').then(function(r){ return r.json(); }).then(render).catch(function(){});
</script>
</body>
</html>`;
}

function createServerFor(state: FrameStudioState): FrameStudioHandle {
	const handle: FrameStudioHandle = {
		state,
		server: createServer(),
		clients: new Set(),
		pingInterval: setInterval(() => {
			for (const client of [...handle.clients]) {
				try { client.write(`: ping ${Date.now()}\n\n`); } catch { handle.clients.delete(client); }
			}
		}, 15000),
		closed: false,
	};

	handle.server.on("request", async (req, res) => {
		try {
			const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
			if (req.method === "GET" && url.pathname === "/") {
				res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
				res.end(buildPageHtml());
				return;
			}
			if (req.method === "GET" && url.pathname === "/state") {
				sendJson(res, serializeState(handle.state));
				return;
			}
			if (req.method === "GET" && url.pathname === "/elk.bundled.js") {
				const bundle = resolveElkBundlePath();
				if (!bundle) {
					res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
					res.end("elkjs bundle not found");
					return;
				}
				res.writeHead(200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=3600" });
				res.end(readFileSync(bundle, "utf-8"));
				return;
			}
			if (req.method === "GET" && url.pathname === "/events") {
				res.writeHead(200, {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache, no-transform",
					connection: "keep-alive",
				});
				handle.clients.add(res);
				res.write(`data: ${JSON.stringify(serializeState(handle.state))}\n\n`);
				req.on("close", () => handle.clients.delete(res));
				return;
			}
			if (req.method === "POST" && url.pathname === "/submit") {
				const body = JSON.parse(await readBody(req) || "{}");
				const pending = handle.pending;
				if (!pending || body.questionId !== pending.questionId) {
					sendJson(res, { ok: false, error: "No matching pending question." }, 409);
					return;
				}
				const selectedIndices = Array.isArray(body.selectedIndices)
					? body.selectedIndices.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < (handle.state.question?.options.length ?? 0))
					: [];
				const questionTab = handle.state.question?.tab ?? handle.state.activeTab;
				const options = handle.state.question?.options ?? [];
				const answer: StudioAnswer = {
					status: body.cancelled ? "cancelled" : "answered",
					questionId: pending.questionId,
					question: handle.state.question?.question,
					selectedIndices,
					selectedOptions: selectedIndices.map((i) => options[i]).filter(Boolean),
					text: typeof body.text === "string" && body.text.trim() ? body.text.trim() : undefined,
					submittedAt: Date.now(),
				};
				clearTimeout(pending.timer);
				handle.pending = undefined;
				handle.state.lastAnswer = answer;
				handle.state.question = undefined;
				handle.state.status = "running";
				appendTimeline(handle.state, { kind: "answer", tab: questionTab, step: handle.state.step, answer });
				addLog(handle, answer.status === "cancelled" ? "Question cancelled by user." : "Question answered in TFT Studio.");
				pushState(handle);
				pending.resolve(answer);
				sendJson(res, { ok: true });
				return;
			}
			sendJson(res, { error: "Not found" }, 404);
		} catch (error) {
			sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
		}
	});

	return handle;
}

async function openInBrowser(pi: ExtensionAPI, url: string): Promise<void> {
	const plat = platform();
	const result = plat === "darwin"
		? await pi.exec("open", [url])
		: plat === "win32"
			? await pi.exec("cmd", ["/c", "start", "", url])
			: await pi.exec("xdg-open", [url]);
	if (result.code !== 0) throw new Error(result.stderr || `Failed to open browser (${result.code})`);
}

async function openStudio(pi: ExtensionAPI, ctx: ExtensionContext, handle: FrameStudioHandle): Promise<"glimpse" | "browser" | "none"> {
	if (!ctx.hasUI) return "none";
	if (platform() === "darwin") {
		const result = await openCompanionUrl(pi, ctx, handle.state.url, handle.state.title, { width: 980, height: 900 });
		if (result.window) {
			handle.window = result.window;
			handle.window.on("closed", () => { handle.window = undefined; });
			return "glimpse";
		}
	}
	await openInBrowser(pi, handle.state.url);
	return "browser";
}

async function ensureRun(pi: ExtensionAPI, ctx: ExtensionContext, params: { title?: string; markdown?: string; step?: string; tab?: string; identityKey?: string; displayTitle?: string; args?: string }, options: { recordReuseUpdate?: boolean; reactivate?: boolean; startStage?: boolean } = {}): Promise<{ handle: FrameStudioHandle; opened: "glimpse" | "browser" | "none" | "reused" }> {
	mkdirSync(STATE_DIR, { recursive: true });
	const inferred = buildFrameIdentity(ctx as any, params.args ?? "");
	const identity = params.identityKey || params.displayTitle
		? { ...inferred, key: params.identityKey || inferred.key, displayTitle: params.displayTitle || inferred.displayTitle }
		: inferred;
	const tab = normalizeTab(params.tab) ?? "frame";
	let handle = runsByIdentity.get(identity.key);
	if (handle && !handle.closed) {
		const wasTerminal = handle.state.status === "done" || handle.state.status === "aborted";
		if (options.reactivate && wasTerminal) handle.state.status = "running";
		if (params.title) handle.state.title = params.title;
		updateTab(handle.state, tab, { markdown: params.markdown, step: params.step });
		if (params.markdown !== undefined || params.step) handle.state.lastAnswer = undefined;
		if (options.recordReuseUpdate !== false && (params.markdown !== undefined || params.step || params.title || params.tab)) {
			appendTimeline(handle.state, {
				kind: options.startStage && wasTerminal ? "start" : "update",
				tab,
				title: params.title,
				step: params.step,
				markdown: params.markdown,
				message: options.startStage && wasTerminal ? `${tabLabel(tab)} stage restarted in the same work-unit transcript.` : undefined,
			});
		}
		refreshStudioWorkContext(handle.state, ctx);
		handle.state.updatedAt = Date.now();
		pushState(handle);
		latestRunId = handle.state.runId;
		return { handle, opened: "reused" };
	}

	const restored = loadPersistedState(identity);
	const runId = restored?.runId ?? randomUUID().slice(0, 8);
	const state: FrameStudioState = restored ?? {
		runId,
		identity,
		title: params.title || identity.displayTitle || "TFT Studio",
		markdown: params.markdown || "",
		step: params.step,
		activeTab: tab,
		tabs: makeDefaultTabs(params.markdown || "", params.step),
		status: "running",
		url: "",
		transcriptPath: transcriptPathForIdentity(identity.key),
		createdAt: Date.now(),
		updatedAt: Date.now(),
		timeline: [],
		logs: [],
	};
	const restoredWasTerminal = restored?.status === "done" || restored?.status === "aborted";
	if (restoredWasTerminal && options.reactivate) state.status = "running";
	if (params.title) state.title = params.title;
	updateTab(state, tab, { markdown: params.markdown, step: params.step });
	handle = createServerFor(state);
	state.url = await listenOnLoopback(handle.server);
	refreshStudioWorkContext(state, ctx);
	if (restored) {
		appendTimeline(state, { kind: "restore", tab, step: params.step, markdown: params.markdown, message: "Saved TFT Studio transcript restored." });
		if (restoredWasTerminal && options.startStage) {
			appendTimeline(state, { kind: "start", tab, title: state.title, step: params.step, markdown: params.markdown, message: `${tabLabel(tab)} stage restarted in the same work-unit transcript.` });
		}
	} else appendTimeline(state, { kind: "start", tab, title: state.title, step: state.step, markdown: state.markdown, message: "TFT Studio started." });
	addLog(handle, restored ? "Saved TFT Studio transcript restored." : "TFT Studio started.");
	runsById.set(runId, handle);
	runsByIdentity.set(identity.key, handle);
	latestRunId = runId;
	const opened = await openStudio(pi, ctx, handle);
	return { handle, opened };
}

function latestHandle(): FrameStudioHandle | undefined {
	return latestRunId ? runsById.get(latestRunId) : undefined;
}

function closeHandle(handle: FrameStudioHandle) {
	if (handle.closed) return;
	handle.closed = true;
	try { handle.server.close(); } catch {}
	try { clearInterval(handle.pingInterval); } catch {}
	try { handle.window?.close(); } catch {}
	if (handle.pending) {
		clearTimeout(handle.pending.timer);
		const questionTab = handle.state.question?.tab ?? handle.state.activeTab;
		const answer: StudioAnswer = { status: "cancelled", questionId: handle.pending.questionId, question: handle.state.question?.question, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() };
		handle.state.lastAnswer = answer;
		handle.state.question = undefined;
		handle.state.status = "running";
		appendTimeline(handle.state, { kind: "answer", tab: questionTab, step: handle.state.step, answer });
		handle.pending.resolve(answer);
		handle.pending = undefined;
	}
	runsById.delete(handle.state.runId);
	runsByIdentity.delete(handle.state.identity.key);
}

function ask(handle: FrameStudioHandle, question: StudioQuestion, signal?: AbortSignal): Promise<StudioAnswer> {
	if (handle.pending) {
		clearTimeout(handle.pending.timer);
		handle.pending.resolve({ status: "cancelled", questionId: handle.pending.questionId, question: handle.state.question?.question, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() });
	}
	handle.state.lastAnswer = undefined;
	handle.state.question = question;
	handle.state.status = "awaiting";
	updateTab(handle.state, question.tab, { markdown: question.markdown, step: handle.state.step });
	appendTimeline(handle.state, { kind: "question", tab: question.tab, step: handle.state.step, markdown: question.markdown, question });
	addLog(handle, `Awaiting answer: ${question.question}`);
	pushState(handle);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			if (handle.pending?.questionId !== question.id) return;
			handle.pending = undefined;
			const answer: StudioAnswer = { status: "timeout", questionId: question.id, question: question.question, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() };
			handle.state.lastAnswer = answer;
			handle.state.question = undefined;
			handle.state.status = "running";
			appendTimeline(handle.state, { kind: "answer", tab: question.tab, step: handle.state.step, answer });
			addLog(handle, "Question timed out.");
			pushState(handle);
			resolve(answer);
		}, ASK_TIMEOUT_MS);
		handle.pending = { questionId: question.id, resolve, timer };
		if (signal) {
			signal.addEventListener("abort", () => {
				if (handle.pending?.questionId !== question.id) return;
				clearTimeout(timer);
				handle.pending = undefined;
				const answer: StudioAnswer = { status: "cancelled", questionId: question.id, question: question.question, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() };
				handle.state.lastAnswer = answer;
				handle.state.question = undefined;
				handle.state.status = "running";
				appendTimeline(handle.state, { kind: "answer", tab: question.tab, step: handle.state.step, answer });
				addLog(handle, "Question cancelled by abort signal.");
				pushState(handle);
				resolve(answer);
			}, { once: true });
		}
	});
}

function latestRecoverableQuestion(state: FrameStudioState): StudioQuestion | undefined {
	let latestQuestionIndex = -1;
	let latestQuestion: StudioQuestion | undefined;
	for (let i = state.timeline.length - 1; i >= 0; i--) {
		const entry = state.timeline[i];
		if (entry.kind === "question" && entry.question) {
			latestQuestionIndex = i;
			latestQuestion = entry.question;
			break;
		}
	}
	if (!latestQuestion || latestQuestionIndex < 0) return undefined;
	const answer = state.timeline
		.slice(latestQuestionIndex + 1)
		.find((entry) => entry.kind === "answer" && entry.answer?.questionId === latestQuestion?.id)
		?.answer;
	return !answer || answer.status !== "answered" ? latestQuestion : undefined;
}

function buildResumeAnswerPrompt(state: FrameStudioState, question: StudioQuestion, answer: StudioAnswer): string {
	const selected = answer.selectedOptions.length ? answer.selectedOptions.map((option) => `- ${option}`).join("\n") : "- (no option selected)";
	const text = answer.text?.trim() ? `\n\nDirect input:\n${answer.text.trim()}` : "";
	return [
		"# TFT Studio resume answer",
		"",
		"A previously unanswered TFT Studio question was reactivated and the user answered it.",
		"Continue the same TFT workflow from this answer. Do not restart the frame or create a new Studio transcript.",
		"Use the transcript as provenance, and persist any canonical stage output as required by the relevant TFT skill.",
		"",
		`Transcript: ${state.transcriptPath}`,
		`Identity: ${state.identity.key}`,
		`Title: ${state.title}`,
		`Tab: ${question.tab}`,
		`Step: ${state.step ?? ""}`,
		"",
		`Question: ${question.question}`,
		"",
		"Selected:",
		selected,
		text,
	].join("\n");
}

function reactivateLatestQuestionForResume(pi: ExtensionAPI, handle: FrameStudioHandle): boolean {
	if (handle.pending || handle.state.question) return false;
	const sourceQuestion = latestRecoverableQuestion(handle.state);
	if (!sourceQuestion) return false;
	const question: StudioQuestion = { ...sourceQuestion, id: randomUUID().slice(0, 8), createdAt: Date.now() };
	void ask(handle, question).then((answer) => {
		if (answer.status !== "answered") return;
		pi.sendMessage(
			{
				customType: TFT_RESUME_CUSTOM_TYPE,
				content: buildResumeAnswerPrompt(handle.state, question, answer),
				display: false,
				details: {
					transcriptPath: handle.state.transcriptPath,
					identity: handle.state.identity,
					question,
					answer,
				},
			},
			{ deliverAs: "followUp", triggerTurn: true },
		);
	});
	addLog(handle, `Reactivated unanswered question: ${question.question}`);
	pushState(handle);
	return true;
}

export async function resumeTftStudioFromTranscript(pi: ExtensionAPI, ctx: ExtensionCommandContext | ExtensionContext, transcriptPath: string): Promise<{ runId: string; title: string; opened: "glimpse" | "browser" | "none" | "reused"; reactivated: boolean; transcriptPath: string }> {
	const fromPath = transcriptIdentityFromPath(transcriptPath, ctx.cwd ?? process.cwd());
	if (!fromPath) throw new Error("TFT Studio transcript를 찾을 수 없습니다.");
	const ensured = await ensureRun(pi, ctx as ExtensionContext, {
		tab: "frame",
		identityKey: fromPath.identityKey,
		displayTitle: fromPath.displayTitle,
		title: fromPath.title || fromPath.displayTitle,
	});
	const handle = ensured.handle;
	if (handle.state.status === "done" || handle.state.status === "aborted") {
		handle.state.status = "running";
		appendTimeline(handle.state, { kind: "restore", tab: handle.state.activeTab, step: handle.state.step, message: "TFT Studio re-entered for continued work." });
		addLog(handle, "TFT Studio re-entered.");
		pushState(handle);
	}
	const reactivated = reactivateLatestQuestionForResume(pi, handle);
	const opened = ensured.opened === "reused" ? await openStudio(pi, ctx as ExtensionContext, handle) : ensured.opened;
	return { runId: handle.state.runId, title: handle.state.title, opened, reactivated, transcriptPath: handle.state.transcriptPath };
}

async function toggleCurrentCompanion(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	const toggled = await toggleCompanionWindow(pi, ctx, { width: 980, height: 900 });
	if (toggled.mode === "hidden") {
		ctx.ui.notify(`짝 WebView 숨김: ${toggled.title ?? "companion"}`, "info");
		return;
	}
	if (toggled.mode === "shown") {
		ctx.ui.notify(`짝 WebView 표시: ${toggled.title ?? "companion"}`, "info");
		return;
	}
	const latest = latestHandle();
	if (latest) {
		const opened = await openStudio(pi, ctx, latest);
		ctx.ui.notify(`TFT Studio companion 열기: ${latest.state.title} (${opened})`, opened === "none" ? "warning" : "info");
		return;
	}
	ctx.ui.notify("현재 세션에 연결된 WebView가 없습니다. 먼저 /tft 또는 /show-report를 여세요.", "warning");
}

function registerCompanionCommand(pi: ExtensionAPI): void {
	pi.registerCommand("companion", {
		description: "현재 Pi 패널에 연결된 단일 WebView companion을 토글합니다. 기본 단축키: Ctrl+Shift+G",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await toggleCurrentCompanion(pi, ctx);
		},
	});
	registerCompanionToggleShortcut(pi, async (ctx) => {
		await toggleCurrentCompanion(pi, ctx);
	});
}

function registerTftStudioCommand(pi: ExtensionAPI): void {
	pi.registerCommand("tft", {
		description: "TFT Studio 열기/재진입. Usage: /tft [open|resume|toggle] [transcriptPath|identityKey]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				if (/^\s*(?:toggle|hide|show)\s*$/i.test(args ?? "")) {
					await toggleCurrentCompanion(pi, ctx);
					return;
				}
				const target = parseTftOpenTarget(args);
				if (target && existsSync(isAbsolute(target) ? target : resolvePath(ctx.cwd, target))) {
					const resumed = await resumeTftStudioFromTranscript(pi, ctx, target);
					ctx.ui.notify(`TFT Studio 재진입: ${resumed.title} (${resumed.opened})${resumed.reactivated ? " · 미응답 질문 활성화" : ""}`, "info");
					return;
				}
				const params: { tab: string; args?: string; identityKey?: string } = {
					tab: "frame",
					args,
				};
				if (target && target.includes(":")) params.identityKey = target;
				const ensured = await ensureRun(pi, ctx, params);
				const handle = ensured.handle;
				const reactivated = reactivateLatestQuestionForResume(pi, handle);
				const opened = ensured.opened === "reused" ? await openStudio(pi, ctx, handle) : ensured.opened;
				ctx.ui.notify(`TFT Studio 재진입: ${handle.state.title} (${opened})${reactivated ? " · 미응답 질문 활성화" : ""}`, "info");
			} catch (error) {
				ctx.ui.notify(`TFT Studio 재진입 실패: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}

export default function (pi: ExtensionAPI) {
	registerCompanionCommand(pi);
	registerTftStudioCommand(pi);

	pi.registerTool({
		name: "frame_studio",
		label: "TFT Studio",
		description: "Open/update a Glimpse TFT Studio shell for Frame/Decide/Verify/Verify Report work-unit flow. The tool name remains frame_studio for compatibility.",
		parameters: Type.Object({
			action: Type.String({ description: "start|update|ask|open|finish|abort" }),
			runId: Type.Optional(Type.String({ description: "Existing TFT Studio run id. Omit to use identity/latest run." })),
			identityKey: Type.Optional(Type.String({ description: "Override identity key. Usually use Frame identity hint key. Also reopens the saved transcript for that identity." })),
			displayTitle: Type.Optional(Type.String({ description: "Override display title." })),
			args: Type.Optional(Type.String({ description: "Original /frame args used for identity inference." })),
			title: Type.Optional(Type.String({ description: "Window/report title." })),
			tab: Type.Optional(Type.String({ description: "TFT Studio tab: frame|decide|verify|verify-report. Defaults to frame." })),
			step: Type.Optional(Type.String({ description: "Current stage step label." })),
			markdown: Type.Optional(Type.String({ description: "Markdown to render in the selected TFT Studio tab." })),
			question: Type.Optional(Type.String({ description: "Question to ask for action=ask." })),
			options: Type.Optional(Type.Array(Type.String(), { description: "Options for action=ask." })),
			multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple option selection." })),
			allowText: Type.Optional(Type.Boolean({ description: "Allow direct text input." })),
			placeholder: Type.Optional(Type.String({ description: "Text input placeholder." })),
			submitLabel: Type.Optional(Type.String({ description: "Submit button label." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
			const action = String(params.action || "").trim().toLowerCase();
			if (!action) throw new Error("frame_studio action is required.");

			if (action === "start") {
				const { handle, opened } = await ensureRun(pi, ctx, params, { reactivate: true, startStage: true });
				refreshStudioWorkContext(handle.state, ctx);
				const tab = handle.state.activeTab;
				const context = toolContextDetails(handle.state, tab, `TFT Studio started on ${tabLabel(tab)}.`);
				return resultText(`TFT Studio started (${handle.state.runId}). ${handle.state.url}. Transcript ref: ${context.transcriptRef.openCommand}. Opened: ${opened}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, identity: handle.state.identity, activeTab: handle.state.activeTab, opened, ...context, snapshot: studioSnapshot(handle.state, tab) });
			}

			let handle = params.runId ? runsById.get(params.runId) : undefined;
			if (!handle && (params.identityKey || params.displayTitle || params.args)) {
				const ensured = await ensureRun(pi, ctx, params, { recordReuseUpdate: action === "start", reactivate: action !== "open", startStage: action === "start" });
				handle = ensured.handle;
			} else if (!handle) {
				handle = latestHandle();
			}

			if (!handle && ["update", "ask", "open"].includes(action)) {
				const ensured = await ensureRun(pi, ctx, params, { reactivate: action !== "open" });
				handle = ensured.handle;
			}
			if (!handle) throw new Error("No active TFT Studio run. Call action=start first.");

			if (action === "open") {
				refreshStudioWorkContext(handle.state, ctx);
				const opened = await openStudio(pi, ctx, handle);
				const tab = handle.state.activeTab;
				const context = toolContextDetails(handle.state, tab, `TFT Studio reopened. Active tab: ${tabLabel(tab)}.`);
				return resultText(`TFT Studio opened (${handle.state.runId}). ${handle.state.url}. Transcript ref: ${context.transcriptRef.openCommand}. Opened: ${opened}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, opened, ...context, snapshot: studioSnapshot(handle.state, tab) });
			}

			if (action === "update") {
				const tab = normalizeTab(params.tab) ?? handle.state.activeTab ?? "frame";
				if (params.title) handle.state.title = params.title;
				updateTab(handle.state, tab, { markdown: params.markdown, step: params.step });
				if (params.markdown !== undefined || params.step) handle.state.lastAnswer = undefined;
				appendTimeline(handle.state, { kind: "update", tab, title: params.title, step: params.step, markdown: params.markdown });
				addLog(handle, `Updated ${tab}${params.step ? `: ${params.step}` : ""}.`);
				refreshStudioWorkContext(handle.state, ctx);
				pushState(handle);
				const context = toolContextDetails(handle.state, tab, `${tabLabel(tab)} tab updated${params.step ? `: ${params.step}` : ""}.`);
				return resultText(`TFT Studio updated (${handle.state.runId}). Transcript ref: ${context.transcriptRef.openCommand}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, ...context });
			}

			if (action === "ask") {
				refreshStudioWorkContext(handle.state, ctx);
				if (!ctx.hasUI) {
					const tab = normalizeTab(params.tab) ?? handle.state.activeTab ?? "frame";
					const context = toolContextDetails(handle.state, tab, "TFT Studio UI unavailable; use numbered text-mode fallback and persist any stage output manually.");
					return resultText("TFT Studio UI is unavailable in this context. Use numbered text-mode AskUserQuestion fallback.", { status: "unavailable", transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, ...context });
				}
				const tab = normalizeTab(params.tab) ?? handle.state.activeTab ?? "frame";
				if (params.title) handle.state.title = params.title;
				if (params.step) handle.state.step = params.step;
				updateTab(handle.state, tab, { markdown: params.markdown, step: params.step });
				await openStudio(pi, ctx, handle);
				const question: StudioQuestion = {
					id: randomUUID().slice(0, 8),
					tab,
					question: params.question || "선택해주세요.",
					markdown: params.markdown,
					options: Array.isArray(params.options) ? params.options : [],
					multiSelect: Boolean(params.multiSelect),
					allowText: Boolean(params.allowText),
					placeholder: params.placeholder,
					submitLabel: params.submitLabel,
					createdAt: Date.now(),
				};
				const answer = await ask(handle, question, signal);
				refreshStudioWorkContext(handle.state, ctx);
				const currentTabSnapshot = tabSnapshot(handle.state, tab);
				const contextDigest = answerDigest(question, answer, currentTabSnapshot);
				const context = toolContextDetails(handle.state, tab, contextDigest);
				return resultText(
					answer.status === "answered"
						? `TFT Studio answer (${tabLabel(tab)}): ${answer.selectedOptions.join(", ") || "(no option)"}${answer.text ? `; text: ${answer.text}` : ""}. Transcript ref: ${context.transcriptRef.openCommand}.`
						: `TFT Studio ask ended: ${answer.status}. Transcript ref: ${context.transcriptRef.openCommand}.`,
					{ runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, answer, ...context },
				);
			}

			if (action === "finish") {
				const tab = normalizeTab(params.tab) ?? handle.state.activeTab ?? "frame";
				updateTab(handle.state, tab, { markdown: params.markdown, step: params.step });
				handle.state.status = "done";
				appendTimeline(handle.state, { kind: "finish", tab, step: params.step ?? handle.state.step, markdown: params.markdown, message: "TFT Studio finished." });
				addLog(handle, "TFT Studio finished.");
				refreshStudioWorkContext(handle.state, ctx);
				pushState(handle);
				const context = toolContextDetails(handle.state, tab, `${tabLabel(tab)} stage finished. Review the stage output contract before continuing.`);
				return resultText(`TFT Studio finished (${handle.state.runId}). Transcript ref: ${context.transcriptRef.openCommand}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, ...context, snapshot: studioSnapshot(handle.state, tab) });
			}

			if (action === "abort") {
				handle.state.status = "aborted";
				appendTimeline(handle.state, { kind: "abort", tab: handle.state.activeTab, step: handle.state.step, message: "TFT Studio aborted." });
				addLog(handle, "TFT Studio aborted.");
				refreshStudioWorkContext(handle.state, ctx);
				pushState(handle);
				const context = toolContextDetails(handle.state, handle.state.activeTab, "TFT Studio aborted; transcript remains available as provenance only.");
				return resultText(`TFT Studio aborted (${handle.state.runId}). Transcript ref: ${context.transcriptRef.openCommand}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, ...context });
			}

			throw new Error(`Unknown frame_studio action: ${params.action}`);
		},
	});

	pi.on("session_shutdown", () => {
		for (const handle of [...runsById.values()]) closeHandle(handle);
	});
}
