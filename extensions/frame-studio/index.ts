import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir, platform } from "node:os";
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { buildFrameIdentity, type FrameIdentity } from "../tft-commands/frame-identity.ts";
import { getGlimpseOpen, type GlimpseWindow } from "../utils/glimpse.ts";
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

type StudioToolContextDetails = {
	transcriptRef: StudioTranscriptRef;
	tabSnapshot: StudioTabSnapshot;
	snapshot?: StudioContextSnapshot;
	contextDigest?: string;
	stageOutputContract?: string;
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

const STUDIO_TABS: Array<{ key: StudioTabKey; label: string; subtitle: string }> = [
	{ key: "frame", label: "Frame", subtitle: "목표·범위·성공 기준" },
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
	if (tab === "frame") return "If /frame was performed, persist the agreed goal/scope/success criteria to frame.json first; frame.md and transcript are mirror/provenance.";
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
	};
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
.app { max-width: 980px; margin:0 auto; padding:24px; }
.hero { padding:22px 24px; border:1px solid var(--line); border-radius:18px; background:var(--panel); }
.kicker { display:flex; gap:8px; align-items:center; color:var(--accent); font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
h1 { margin:8px 0 6px; font-size:28px; line-height:1.18; }
.meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; color:var(--muted); }
.badge { border:1px solid var(--line); background:rgba(255,255,255,.75); border-radius:999px; padding:4px 10px; font-size:12px; }
.tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:16px; }
.tab { text-align:left; border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:12px 14px; color:var(--text); cursor:pointer; }
.tab:hover { border-color:#c4b5fd; background:#faf9ff; }
.tab.active { border-color:var(--accent); background:var(--accent-soft); box-shadow:0 0 0 1px rgba(124,58,237,.15) inset; }
.tab-label { display:block; font-size:14px; font-weight:900; }
.tab-subtitle { display:block; margin-top:2px; color:var(--muted); font-size:11px; font-weight:650; }
.tab-status { display:inline-block; margin-top:7px; border:1px solid rgba(120,113,108,.25); border-radius:999px; padding:1px 7px; color:var(--muted); font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
.layout { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; margin-top:18px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:18px 20px; }
.stage-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
.stage-title { margin:0; font-size:18px; font-weight:900; }
.stage-subtitle { color:var(--muted); font-size:12px; margin-top:2px; }
.card h2 { margin:0 0 10px; font-size:17px; }
.markdown h1 { font-size:23px; border-bottom:1px solid var(--line); padding-bottom:8px; }
.markdown h2 { font-size:19px; margin-top:22px; }
.markdown h3 { font-size:16px; margin-top:18px; }
.markdown h4 { font-size:14px; margin:16px 0 6px; font-weight:900; }
.markdown h5, .markdown h6 { font-size:13px; margin:14px 0 5px; font-weight:850; color:var(--muted); }
.markdown p { margin:8px 0; }
.markdown ul, .markdown ol { padding-left:24px; }
.markdown table { width:100%; border-collapse:collapse; margin:14px 0; display:block; overflow-x:auto; white-space:normal; }
.markdown th, .markdown td { border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
.markdown th { background:var(--panel2); font-weight:800; }
.markdown tr:nth-child(even) td { background:#fafaf9; }
.markdown code { background:rgba(120,113,108,.13); border-radius:6px; padding:1px 5px; }
.markdown pre { background:#292524; color:#fafaf9; border-radius:12px; padding:14px; overflow:auto; }
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
.stage-runs { display:grid; gap:16px; }
.stage-run { border:1px solid var(--line); border-radius:16px; background:#fafaf9; padding:12px; }
.stage-run.running, .stage-run.awaiting { border-color:#c4b5fd; background:#faf9ff; }
.stage-run.done { border-color:#bbf7d0; background:#f0fdf4; }
.stage-run.aborted { border-color:#fecaca; background:#fef2f2; }
.stage-run-head { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; margin-bottom:10px; }
.stage-run-title { font-weight:900; font-size:15px; }
.stage-run-meta { display:flex; flex-wrap:wrap; gap:6px; color:var(--muted); font-size:12px; }
.stage-run-body { display:grid; gap:12px; }
.timeline { display:grid; gap:12px; }
.timeline-item { border:1px solid var(--line); border-radius:14px; padding:14px 16px; background:#fff; }
.timeline-item.pending { border-color:#ddd6fe; background:#faf9ff; box-shadow:0 0 0 1px rgba(124,58,237,.10) inset; }
.timeline-item.answer-entry { border-color:#bbf7d0; background:#f0fdf4; }
.timeline-head { display:flex; gap:8px; flex-wrap:wrap; align-items:center; color:var(--muted); font-size:12px; font-weight:800; margin-bottom:8px; }
.timeline-kind { color:var(--accent); text-transform:uppercase; letter-spacing:.04em; }
.timeline-body { display:grid; gap:10px; }
.timeline-markdown { margin-top:4px; }
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
<script>
${webviewCopyScript()}
var state = null;
var selectedTab = null;
var STUDIO_TABS = [
  { key:'frame', label:'Frame', subtitle:'목표·범위·성공 기준', empty:'아직 Frame 기록이 없습니다. /frame으로 정렬을 시작하거나, 명확한 작업이면 다른 탭부터 바로 기록할 수 있습니다.' },
  { key:'decide', label:'Decide', subtitle:'대안·challenge·mitigation', empty:'아직 Decide 기록이 없습니다. 순서 강제가 아니므로 명확한 작업은 이 탭을 비워둔 채 Verify/Verify Report를 사용할 수 있습니다. /decide가 같은 identity에 decision table과 challenge를 기록하면 여기에 표시됩니다.' },
  { key:'verify', label:'Verify', subtitle:'판정·healing 기록', empty:'아직 Verify 기록이 없습니다. Decide가 없어도 user request, frame success criteria, diff, evidence 기준으로 바로 검증을 기록할 수 있습니다. Self-healing은 별도 탭이 아니라 실패/gap 이후 이 탭에 run/re-verify 기록으로 append합니다.' },
  { key:'verify-report', label:'Verify Report', subtitle:'증거 리포트·artifact', empty:'아직 Verify Report 기록이 없습니다. Verify 탭 기록이 없어도 evidence report artifact를 바로 연결할 수 있습니다. 단, 검증 축이나 coverage gap은 report에 명시해야 합니다.' }
];
function esc(s) { return String(s || '').replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
function inline(s) { var tick = String.fromCharCode(96); return esc(s).replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
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
    if (/^\s*/.test(line) && line.trim().indexOf(String.fromCharCode(96).repeat(3)) === 0) { closeList(); if (inCode) html.push('</code></pre>'); else html.push('<pre><code>'); inCode = !inCode; continue; }
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
    + '<div class="actions"><button class="primary" onclick="submitAnswer()">' + esc(q.submitLabel || '선택 완료') + '</button><button class="secondary" onclick="cancelAnswer()">취소</button><span class="status" id="submitStatus"></span></div>'
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
function render(s) {
  state = s;
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
  var active = activeTabKey(s);
  var activeMeta = STUDIO_TABS.find(function(tab) { return tab.key === active; }) || STUDIO_TABS[0];
  document.getElementById('flowTitle').textContent = activeMeta.label + ' 진행';
  document.getElementById('flowSubtitle').textContent = '업데이트·질문·답변을 시간순으로 표시합니다. 현재 선택도 해당 step 안에 표시됩니다.';
  document.getElementById('flowStatus').textContent = tabStatus(s, active);
  document.getElementById('timeline').innerHTML = renderStageRuns(visibleTimelineEntries(s), s, active);
  document.getElementById('logs').innerHTML = (s.logs || []).slice().reverse().map(function(log) {
    return '<div>' + new Date(log.time).toLocaleTimeString() + ' · ' + esc(log.message) + '</div>';
  }).join('') || '<span class="status">로그 없음</span>';
}
async function submitAnswer(cancelled) {
  if (!state || !state.question) return;
  var checked = Array.prototype.slice.call(document.querySelectorAll('input[name="frameOption"]:checked')).map(function(el) { return Number(el.value); });
  var textEl = document.getElementById('answerText');
  setStatus('전송 중...');
  try {
    var res = await fetch('/submit', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ questionId: state.question.id, cancelled: !!cancelled, selectedIndices: checked, text: textEl ? textEl.value : '' }) });
    if (!res.ok) throw new Error(await res.text());
    setStatus('Pi로 전송됨');
  } catch (e) { setStatus('전송 실패: ' + e.message); }
}
function cancelAnswer() { submitAnswer(true); }
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

function openGlimpseUrl(open: (html: string, opts: Record<string, unknown>) => GlimpseWindow, url: string, title: string): GlimpseWindow {
	const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#fafaf9"><script>window.location.replace(${JSON.stringify(url)});</script></body></html>`;
	const win = open(html, { width: 980, height: 900, title, openLinks: true });
	win.on("message", (data: unknown) => {
		if (!data || typeof data !== "object") return;
		const msg = data as Record<string, unknown>;
		if (msg.type !== "resize" || typeof msg.height !== "number") return;
		win._write?.({ type: "resize", width: 980, height: Math.max(560, Math.min(Math.round(msg.height), 1200)) });
	});
	return win;
}

async function openStudio(pi: ExtensionAPI, ctx: ExtensionContext, handle: FrameStudioHandle): Promise<"glimpse" | "browser" | "none"> {
	if (!ctx.hasUI) return "none";
	if (platform() === "darwin") {
		const open = await getGlimpseOpen();
		if (open) {
			try {
				handle.window = openGlimpseUrl(open, handle.state.url, handle.state.title);
				handle.window.on("closed", () => { handle.window = undefined; });
				return "glimpse";
			} catch {}
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

function registerTftStudioCommand(pi: ExtensionAPI): void {
	pi.registerCommand("tft", {
		description: "TFT Studio 열기/재진입. Usage: /tft [open|resume] [transcriptPath|identityKey]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
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
				pushState(handle);
				const context = toolContextDetails(handle.state, tab, `${tabLabel(tab)} tab updated${params.step ? `: ${params.step}` : ""}.`);
				return resultText(`TFT Studio updated (${handle.state.runId}). Transcript ref: ${context.transcriptRef.openCommand}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, ...context });
			}

			if (action === "ask") {
				if (!ctx.hasUI) {
					const tab = normalizeTab(params.tab) ?? handle.state.activeTab ?? "frame";
					const context = toolContextDetails(handle.state, tab, "TFT Studio UI unavailable; use numbered text-mode fallback and persist any stage output manually.");
					return resultText("TFT Studio UI is unavailable in this context. Use numbered text-mode AskUserQuestion fallback.", { status: "unavailable", transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, ...context });
				}
				const tab = normalizeTab(params.tab) ?? handle.state.activeTab ?? "frame";
				if (params.title) handle.state.title = params.title;
				if (params.step) handle.state.step = params.step;
				updateTab(handle.state, tab, { markdown: params.markdown, step: params.step });
				if (!handle.window) await openStudio(pi, ctx, handle);
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
				pushState(handle);
				const context = toolContextDetails(handle.state, tab, `${tabLabel(tab)} stage finished. Review the stage output contract before continuing.`);
				return resultText(`TFT Studio finished (${handle.state.runId}). Transcript ref: ${context.transcriptRef.openCommand}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, ...context, snapshot: studioSnapshot(handle.state, tab) });
			}

			if (action === "abort") {
				handle.state.status = "aborted";
				appendTimeline(handle.state, { kind: "abort", tab: handle.state.activeTab, step: handle.state.step, message: "TFT Studio aborted." });
				addLog(handle, "TFT Studio aborted.");
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
