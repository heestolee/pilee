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

const QUESTION_CARD_LABELS = ["질문 제목", "현재 이해", "막힌 결정", "왜 중요한가", "추천", "추천 답안", "선택 후 달라지는 것", "질문"];

function countQuestionCardLabels(value: string): number {
	return QUESTION_CARD_LABELS.filter((label) => new RegExp(`(?:^|\\n)\\s*${label}\\s*[:：]`).test(value)).length;
}

export type QuestionDisplayParts = {
	title: string;
	body: string;
	wasSplit: boolean;
};

export function splitQuestionDisplayParts(rawQuestion: string): QuestionDisplayParts {
	const raw = rawQuestion.trim() || "선택해주세요.";
	const lines = raw.split(/\r?\n/);
	let title = "";
	let titleLineIndex = -1;

	for (let index = 0; index < lines.length; index++) {
		const line = lines[index].trim();
		if (!line) continue;
		const titleMatch = line.match(/^질문 제목\s*[:：]\s*(.+)$/);
		if (titleMatch?.[1]) {
			title = titleMatch[1].trim();
			titleLineIndex = index;
			break;
		}
	}

	if (!title) {
		for (let index = lines.length - 1; index >= 0; index--) {
			const line = lines[index].trim();
			if (!line) continue;
			const questionMatch = line.match(/^질문\s*[:：]\s*(.*)$/);
			if (!questionMatch) continue;
			const inlineTitle = questionMatch[1]?.trim();
			const nextTitle = lines.slice(index + 1).find((candidate) => candidate.trim())?.trim();
			title = inlineTitle || nextTitle || "질문";
			titleLineIndex = index;
			break;
		}
	}

	const cardLabelCount = countQuestionCardLabels(raw);
	const shouldSplit = raw.length > 180 || cardLabelCount >= 2 || /\r?\n\s*\r?\n/.test(raw);
	if (!shouldSplit) return { title: raw, body: "", wasSplit: false };

	if (!title) {
		const firstContentLine = lines.find((line) => line.trim())?.trim() ?? "선택해주세요.";
		title = firstContentLine.length > 90 ? `${firstContentLine.slice(0, 87).trimEnd()}…` : firstContentLine;
	}
	if (title.length > 120) title = `${title.slice(0, 117).trimEnd()}…`;

	const body = lines.filter((_, index) => index !== titleLineIndex).join("\n").trim();
	return { title, body, wasSplit: true };
}

function normalizeStudioQuestionInput(question: StudioQuestion): StudioQuestion {
	const parts = splitQuestionDisplayParts(question.question);
	if (!parts.wasSplit) return { ...question, question: parts.title };

	const existingMarkdown = question.markdown?.trim() ?? "";
	const shouldAppendBody = Boolean(parts.body) && !existingMarkdown.includes(parts.body.slice(0, 120));
	const markdown = [existingMarkdown, shouldAppendBody ? parts.body : ""].filter(Boolean).join("\n\n---\n\n");
	return { ...question, question: parts.title, markdown };
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

export function buildPageHtml(): string {
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
.layer-visual { border:1px solid #dbeafe; background:linear-gradient(180deg,#f8fbff 0%,#ffffff 100%); border-radius:20px; padding:16px; margin:16px 0; overflow:hidden; min-width:0; max-width:100%; }
.layer-visual-head { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; margin-bottom:12px; }
.layer-visual-title { font-size:18px; font-weight:950; color:#1e3a8a; overflow-wrap:anywhere; }
.layer-visual-subtitle { margin-top:3px; color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
.layer-flow-strip { display:flex; flex-wrap:wrap; gap:8px; margin:10px 0 14px; }
.layer-flow-chip { border:1px solid #bfdbfe; background:#eff6ff; color:#1d4ed8; border-radius:999px; padding:5px 9px; font-size:11px; font-weight:850; }
.layer-visual-diagram { overflow:auto; border:1px solid #dbeafe; border-radius:18px; background:#fff; padding:12px; }
.layer-visual-canvas { position:relative; min-width:760px; }
.layer-rail { position:absolute; left:0; top:0; z-index:1; overflow:visible; }
.layer-card { position:absolute; left:92px; right:18px; z-index:2; border:1px solid #cbd5e1; border-left:7px solid #7c3aed; border-radius:18px; background:#ffffff; box-shadow:0 12px 26px rgba(15,23,42,.07); padding:13px 15px; min-height:168px; overflow:visible; }
.layer-card.entry, .layer-card.resolver, .layer-card.controller { border-left-color:#2563eb; background:#f8fbff; }
.layer-card.application, .layer-card.usecase, .layer-card.service { border-left-color:#7c3aed; background:#fbf8ff; }
.layer-card.domain, .layer-card.entity, .layer-card.vo { border-left-color:#059669; background:#f7fefb; }
.layer-card.repository, .layer-card.data, .layer-card.persistence, .layer-card.db { border-left-color:#d97706; background:#fffaf3; }
.layer-card.consumer, .layer-card.ui { border-left-color:#0891b2; background:#f5fdff; }
.layer-card.ops { border-left-color:#dc2626; background:#fff7f7; }
.layer-card-top { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; }
.layer-card-title { font-size:15px; font-weight:950; color:#111827; overflow-wrap:anywhere; }
.layer-card-role { margin-top:3px; display:inline-block; background:#eef2ff; color:#3730a3; border:1px solid #c7d2fe; border-radius:999px; padding:3px 8px; font-size:11px; font-weight:900; }
.layer-card-beginner { margin-top:9px; padding:9px 10px; border:1px solid rgba(37,99,235,.16); background:rgba(239,246,255,.72); border-radius:12px; color:#334155; font-size:12px; line-height:1.45; }
.layer-card-section { margin-top:9px; }
.layer-card-section b { display:block; color:#475569; font-size:11px; text-transform:uppercase; letter-spacing:.04em; margin-bottom:3px; }
.layer-card-section ul { margin:0; padding-left:18px; }
.layer-card-section li { margin:2px 0; font-size:12px; line-height:1.38; overflow-wrap:anywhere; }
.layer-reqs { display:flex; flex-wrap:wrap; gap:4px; justify-content:flex-end; min-width:80px; }
.layer-req { background:#111827; color:white; border-radius:999px; padding:3px 7px; font-size:10px; font-weight:950; }
.layer-glossary { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:8px; margin-top:12px; }
.layer-glossary-card { border:1px solid #e2e8f0; border-radius:14px; background:#fff; padding:9px 10px; }
.layer-glossary-card strong { display:block; font-size:12px; color:#1e3a8a; }
.layer-glossary-card span { display:block; margin-top:3px; color:var(--muted); font-size:11px; line-height:1.4; }
.arch-visual { border:1px solid #e9d5ff; background:linear-gradient(180deg,#fdfbff 0%,#ffffff 100%); border-radius:20px; padding:16px; margin:16px 0; overflow:hidden; min-width:0; max-width:100%; }
.arch-visual-head { display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start; margin-bottom:12px; }
.arch-visual-title { font-size:18px; font-weight:950; color:#581c87; overflow-wrap:anywhere; }
.arch-visual-subtitle { margin-top:3px; color:var(--muted); font-size:12px; overflow-wrap:anywhere; }
.arch-visual-diagram { overflow:auto; border:1px solid #e9d5ff; border-radius:18px; background:#fff; padding:22px; overscroll-behavior:contain; }
.arch-canvas { position:relative; min-width:980px; margin:0 auto; }
.arch-lane { position:absolute; border:1px dashed #e2e8f0; border-radius:18px; background:rgba(248,250,252,.62); box-sizing:border-box; }
.arch-lane-title { position:absolute; left:12px; top:11px; right:12px; text-align:center; font-size:11px; font-weight:950; color:#64748b; text-transform:uppercase; letter-spacing:.04em; overflow-wrap:anywhere; }
.arch-lane.down .arch-lane-title { text-align:left; right:auto; max-width:210px; }
.arch-edge-svg { position:absolute; inset:0; z-index:1; overflow:visible; pointer-events:none; }
.arch-node { position:absolute; z-index:2; border:1px solid #cbd5e1; border-top:6px solid #7c3aed; border-radius:17px; background:#ffffff; box-shadow:0 12px 26px rgba(15,23,42,.07); padding:12px 13px; overflow:visible; box-sizing:border-box; }
.arch-node.screen, .arch-node.ui { border-top-color:#2563eb; background:#f8fbff; }
.arch-node.resolver, .arch-node.api { border-top-color:#4f46e5; background:#f8f7ff; }
.arch-node.usecase, .arch-node.service { border-top-color:#7c3aed; background:#fbf8ff; }
.arch-node.domain, .arch-node.vo, .arch-node.entity { border-top-color:#059669; background:#f7fefb; }
.arch-node.repository, .arch-node.repo { border-top-color:#d97706; background:#fffaf3; }
.arch-node.table, .arch-node.db { border-top-color:#b45309; background:#fff7ed; }
.arch-node.ops, .arch-node.review { border-top-color:#dc2626; background:#fff7f7; }
.arch-node.legacy { opacity:.94; border-style:dashed; }
.arch-node-title { font-size:13px; font-weight:950; line-height:1.25; overflow-wrap:anywhere; }
.arch-node-kind { display:inline-flex; margin-top:5px; border:1px solid #ddd6fe; background:#f5f3ff; color:#6d28d9; border-radius:999px; padding:2px 7px; font-size:10px; font-weight:900; }
.arch-node-desc { margin-top:7px; font-size:11px; color:#475569; line-height:1.35; overflow-wrap:anywhere; }
.arch-node-badges { display:flex; flex-wrap:wrap; gap:4px; margin-top:8px; }
.arch-badge { display:inline-flex; border:1px solid #e2e8f0; background:#f8fafc; color:#475569; border-radius:999px; padding:2px 6px; font-size:9px; font-weight:950; white-space:nowrap; }
.arch-badge.pk { border-color:#bfdbfe; background:#eff6ff; color:#1d4ed8; }
.arch-badge.fk { border-color:#bbf7d0; background:#f0fdf4; color:#166534; }
.arch-badge.unique { border-color:#ddd6fe; background:#f5f3ff; color:#6d28d9; }
.arch-badge.json { border-color:#fed7aa; background:#fff7ed; color:#c2410c; }
.arch-badge.legacy, .arch-badge.risk { border-color:#fecaca; background:#fef2f2; color:#991b1b; }
.arch-badge.source-of-truth { border-color:#bae6fd; background:#ecfeff; color:#0e7490; }
.arch-columns { margin-top:8px; display:grid; gap:4px; }
.arch-column { display:flex; justify-content:space-between; gap:7px; align-items:flex-start; border-top:1px solid rgba(148,163,184,.28); padding-top:4px; font-size:10px; }
.arch-column-name { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
.arch-column-badges { display:flex; flex-wrap:wrap; gap:3px; justify-content:flex-end; }
.arch-edge-label-bg { fill:rgba(255,255,255,.96); stroke:#ddd6fe; stroke-width:1.2px; filter:drop-shadow(0 3px 8px rgba(88,28,135,.12)); }
.arch-edge-label { font-size:10.5px; font-weight:950; fill:#334155; dominant-baseline:middle; }
.arch-legend { display:grid; grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:8px; margin-top:12px; }
.arch-legend-card { border:1px solid #e2e8f0; border-radius:14px; background:#fff; padding:9px 10px; }
.arch-legend-card strong { display:block; color:#581c87; font-size:12px; }
.arch-legend-card span { display:block; margin-top:3px; color:var(--muted); font-size:11px; line-height:1.4; }
.question { border-color:#ddd6fe; background:#faf9ff; }
.question-title { font-size:18px; font-weight:800; margin:0 0 12px; line-height:1.35; overflow-wrap:anywhere; }
.question-context { margin:0 0 14px; padding:12px 14px; border:1px solid #ede9fe; border-radius:12px; background:#faf9ff; font-size:14px; line-height:1.55; }
.question-context h1, .question-context h2 { font-size:16px; margin:10px 0 6px; border:0; padding:0; }
.question-context h3, .question-context h4, .question-context h5, .question-context h6 { font-size:14px; margin:9px 0 5px; }
.question-context p { margin:6px 0; }
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
function asTextArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(function(item) { return String(item || '').trim(); }).filter(Boolean);
  return String(value).split(/\n|;/).map(function(item) { return item.trim(); }).filter(Boolean);
}
function layerKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'layer';
}
function defaultLayerInfo(layer) {
  var raw = layerKey(layer.layer || layer.kind || layer.type || layer.id || layer.title || layer.label);
  if (/resolver|controller|route|entry|api/.test(raw)) return { key:'entry', role:'요청 접수창', beginner:'사용자나 화면에서 들어온 요청을 가장 먼저 받는 입구입니다. 여기서는 요청 모양을 읽고, 실제 업무 판단은 usecase 쪽으로 넘깁니다.' };
  if (/usecase|application|flow|orchestr/.test(raw)) return { key:'usecase', role:'업무 총괄자', beginner:'이번 기능을 어떤 순서로 처리할지 조립하는 곳입니다. 권한, 트랜잭션, 여러 서비스 호출 순서를 한 업무 흐름으로 묶습니다.' };
  if (/service|worker|manager/.test(raw)) return { key:'service', role:'전문 작업자', beginner:'특정 일을 실제로 수행하는 작업자입니다. 이미지 draft 생성, pending 요청 반려처럼 재사용되는 세부 작업을 맡습니다.' };
  if (/domain|rule|policy/.test(raw)) return { key:'domain', role:'업무 규칙판', beginner:'하면 안 되는 것과 반드시 지켜야 하는 규칙을 모아둔 곳입니다. 승인 전 즉시 반영 금지, 자동승인 금지 같은 약속을 지킵니다.' };
  if (/entity|model|vo|value/.test(raw)) return { key:'entity', role:'데이터 모양과 불변식', beginner:'DB row나 값 객체가 어떤 의미인지 표현합니다. 단순 저장값이 아니라, 이 값이 어떤 상태와 규칙을 가져야 하는지 드러냅니다.' };
  if (/repo|data|dao|gateway|loader/.test(raw)) return { key:'repository', role:'DB·외부 저장소 창구', beginner:'데이터를 어디서 읽고 어디에 저장할지 담당하는 창구입니다. 업무 판단을 하지 않고 조회 조건과 저장 경계를 명확히 합니다.' };
  if (/persist|db|migration|table/.test(raw)) return { key:'persistence', role:'실제 저장소', beginner:'데이터가 실제로 남는 테이블/컬럼입니다. 여기의 구조가 바뀌면 migration, rollback, 운영 데이터 영향까지 함께 봐야 합니다.' };
  if (/consumer|admin|partner|ui|screen|client/.test(raw)) return { key:'consumer', role:'사용자가 보는 화면', beginner:'최종 사용자가 행동하는 화면입니다. backend가 제공한 결과가 실제 UX와 검증 캡처로 이어지는 곳입니다.' };
  if (/ops|slack|alert|review|approve/.test(raw)) return { key:'ops', role:'운영 전환 지점', beginner:'운영팀 검수, 승인, 알림처럼 코드 결과가 실제 업무로 넘어가는 지점입니다. 실수하면 사람의 업무 흐름이 깨질 수 있습니다.' };
  return { key:raw, role:'구조 구성요소', beginner:'이 카드가 맡는 책임을 한 문장으로 설명해야 합니다. 모호하면 구현 전에 어느 레이어 책임인지 다시 나눠야 합니다.' };
}
function normalizeLayer(layer, index) {
  layer = layer || {};
  var info = defaultLayerInfo(layer);
  var title = layer.title || layer.label || layer.name || layer.layer || layer.id || ('Layer ' + (index + 1));
  return {
    id: layer.id || info.key + '-' + (index + 1),
    key: layerKey(layer.key || layer.layer || layer.kind || layer.type || info.key),
    title: String(title),
    role: String(layer.beginnerLabel || layer.role || info.role),
    beginner: String(layer.beginnerDescription || layer.beginner || layer.explainLikeBootcamp || info.beginner),
    requirements: asTextArray(layer.requirements || layer.requirementIds || layer.refs || layer.ids),
    responsibilities: asTextArray(layer.responsibilities || layer.owns || layer.tasks || layer.contract),
    files: asTextArray(layer.files || layer.paths || layer.candidates),
    evidence: asTextArray(layer.evidence || layer.verify || layer.verification),
    risk: asTextArray(layer.risks || layer.risk),
    status: layer.status || layer.state || 'planned'
  };
}
function layerCardHeight(layer) {
  var itemCount = layer.responsibilities.length + layer.files.length + layer.evidence.length + layer.risk.length;
  var beginnerExtra = Math.ceil(Math.max(0, layer.beginner.length - 90) / 80) * 18;
  return Math.max(210, 168 + beginnerExtra + itemCount * 22);
}
function renderLayerList(label, items) {
  if (!items || !items.length) return '';
  return '<div class="layer-card-section"><b>' + esc(label) + '</b><ul>' + items.slice(0, 5).map(function(item) { return '<li>' + inline(item) + '</li>'; }).join('') + '</ul></div>';
}
function renderReqs(reqs) {
  if (!reqs || !reqs.length) return '<span class="layer-req">REQ?</span>';
  return reqs.map(function(req) { return '<span class="layer-req">' + esc(req) + '</span>'; }).join('');
}
function renderLayerCard(layer, index, top, height) {
  var cls = layerKey(layer.key) + ' ' + layerKey(layer.status);
  return '<article class="layer-card ' + esc(cls) + '" style="top:' + top + 'px;height:' + height + 'px">'
    + '<div class="layer-card-top"><div><div class="layer-card-title">' + esc(index + 1) + '. ' + inline(layer.title) + '</div><span class="layer-card-role">' + esc(layer.role) + '</span></div><div class="layer-reqs">' + renderReqs(layer.requirements) + '</div></div>'
    + '<div class="layer-card-beginner">' + inline(layer.beginner) + '</div>'
    + renderLayerList('이 레이어가 맡는 일', layer.responsibilities)
    + renderLayerList('구현 후보 파일', layer.files)
    + renderLayerList('검증 포인트', layer.evidence)
    + renderLayerList('주의할 실수', layer.risk)
    + '</article>';
}
function renderLayerRail(layers, tops, heights, canvasHeight) {
  var circles = [];
  var arrows = [];
  for (var i = 0; i < layers.length; i++) {
    var y = tops[i] + 44;
    circles.push('<circle cx="40" cy="' + y + '" r="18" fill="#ffffff" stroke="#2563eb" stroke-width="3"/><text x="40" y="' + (y + 5) + '" text-anchor="middle" font-size="13" font-weight="900" fill="#1d4ed8">' + (i + 1) + '</text>');
    if (i < layers.length - 1) {
      var nextY = tops[i + 1] + 26;
      arrows.push('<path d="M40 ' + (y + 22) + ' L40 ' + nextY + '" stroke="#93c5fd" stroke-width="4" stroke-linecap="round" marker-end="url(#layerArrow)"/>');
    }
  }
  return '<svg class="layer-rail" width="80" height="' + canvasHeight + '" viewBox="0 0 80 ' + canvasHeight + '"><defs><marker id="layerArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#93c5fd"/></marker></defs>' + arrows.join('') + circles.join('') + '</svg>';
}
function renderFlowStrip(flow) {
  var items = asTextArray(flow);
  if (!items.length) return '';
  return '<div class="layer-flow-strip">' + items.map(function(item, index) { return '<span class="layer-flow-chip">' + (index + 1) + '. ' + inline(item) + '</span>'; }).join('') + '</div>';
}
function renderLayerGlossary(spec, layers) {
  var glossary = Array.isArray(spec.glossary) ? spec.glossary : [];
  if (!glossary.length) {
    var seen = new Set();
    glossary = layers.map(function(layer) { return { term: layer.title, description: layer.role + ' — ' + layer.beginner }; }).filter(function(item) {
      var key = layerKey(item.term); if (seen.has(key)) return false; seen.add(key); return true;
    }).slice(0, 8);
  }
  if (!glossary.length) return '';
  return '<div class="layer-glossary">' + glossary.map(function(item) {
    return '<div class="layer-glossary-card"><strong>' + esc(item.term || item.title || '레이어') + '</strong><span>' + inline(item.description || item.body || '') + '</span></div>';
  }).join('') + '</div>';
}
function renderBackendLayerVisualElement(el, spec) {
  var layers = (Array.isArray(spec.layers) ? spec.layers : []).map(normalizeLayer);
  if (!layers.length) { el.innerHTML = '<div class="tft-visual-error">backend-layer-map visual에는 layers 배열이 필요합니다.</div>'; return; }
  var gap = 18;
  var tops = [];
  var heights = [];
  var cursor = 18;
  layers.forEach(function(layer) { var h = layerCardHeight(layer); tops.push(cursor); heights.push(h); cursor += h + gap; });
  var canvasHeight = Math.max(260, cursor + 12);
  var cards = layers.map(function(layer, index) { return renderLayerCard(layer, index, tops[index], heights[index]); }).join('');
  el.className = 'layer-visual';
  el.innerHTML = '<div class="layer-visual-head"><div><div class="layer-visual-title">' + esc(spec.title || 'Backend Layer Visual Map') + '</div>' + (spec.subtitle ? '<div class="layer-visual-subtitle">' + esc(spec.subtitle) + '</div>' : '<div class="layer-visual-subtitle">usecase/entity/service/repository가 어디서 어떤 책임을 갖는지 한눈에 보는 그림입니다.</div>') + '</div><span class="badge">SVG layer map</span></div>'
    + renderFlowStrip(spec.flow || spec.story || spec.userFlow)
    + '<div class="layer-visual-diagram"><div class="layer-visual-canvas" style="height:' + canvasHeight + 'px">' + renderLayerRail(layers, tops, heights, canvasHeight) + cards + '</div></div>'
    + renderLayerGlossary(spec, layers)
    + renderLearningNotes(spec.notes || spec.explanations);
}
function isBackendLayerVisualSpec(spec) {
  var kind = String(spec.kind || spec.type || '').toLowerCase();
  return kind === 'backend-layer-map' || kind === 'layer-map' || kind === 'backend-layer-visual';
}
function isArchitectureFlowSpec(spec) {
  var kind = String(spec.kind || spec.type || '').toLowerCase();
  return kind === 'architecture-flow' || kind === 'data-flow-map' || kind === 'data-flow' || kind === 'architecture-data-flow';
}
function normalizeArchLane(value, index) {
  if (typeof value === 'string') return { id: layerKey(value), title: value, index:index };
  value = value || {};
  return { id: layerKey(value.id || value.key || value.title || value.label || ('lane-' + index)), title: String(value.title || value.label || value.id || ('Lane ' + (index + 1))), index:index };
}
function archNodeKind(node) { return layerKey(node.type || node.kind || node.layer || 'node'); }
function archTextLines(value, charsPerLine, maxLines) {
  var text = String(value || '').trim();
  if (!text) return 0;
  var lines = Math.ceil(text.length / Math.max(12, charsPerLine || 28));
  return Math.max(1, Math.min(maxLines || 5, lines));
}
function archNodeHeight(node) {
  var cols = Array.isArray(node.columns) ? node.columns.length : 0;
  var badgeCount = asTextArray(node.badges || node.flags).length;
  var titleExtra = Math.max(0, archTextLines(node.title || node.name || node.id, 24, 3) - 1) * 18;
  var descExtra = Math.max(0, archTextLines(node.description || node.beginnerDescription || node.role, 48, 5) - 2) * 15;
  var base = node.type === 'table' || node.kind === 'table' ? 184 : 148;
  return Math.max(base, 118 + titleExtra + descExtra + cols * 24 + Math.ceil(badgeCount / 3) * 16);
}
function collectArchLanes(spec) {
  var explicit = Array.isArray(spec.lanes) ? spec.lanes.map(normalizeArchLane) : [];
  var lanes = explicit.slice();
  var seen = new Set(lanes.map(function(lane) { return lane.id; }));
  (Array.isArray(spec.nodes) ? spec.nodes : []).forEach(function(node) {
    var raw = node.lane || node.group || node.layer || 'Flow';
    var id = layerKey(raw);
    if (!seen.has(id)) { seen.add(id); lanes.push({ id:id, title:String(raw), index:lanes.length }); }
  });
  return lanes.length ? lanes : [{ id:'flow', title:'Flow', index:0 }];
}
function normalizeArchNode(node, index, lanes) {
  node = node || {};
  var laneId = layerKey(node.lane || node.group || node.layer || lanes[0].id);
  if (!lanes.some(function(lane) { return lane.id === laneId; })) laneId = lanes[0].id;
  return {
    id: String(node.id || ('node-' + (index + 1))),
    lane: laneId,
    row: Number.isFinite(Number(node.row)) ? Number(node.row) : undefined,
    type: archNodeKind(node),
    title: String(node.title || node.name || node.id || ('Node ' + (index + 1))),
    description: String(node.description || node.beginnerDescription || node.role || ''),
    badges: asTextArray(node.badges || node.flags || node.requirements),
    columns: Array.isArray(node.columns) ? node.columns : [],
    status: node.status || node.state || '',
    source: node.source || node.sourceOfTruth,
    order: index,
  };
}
function columnBadges(column) {
  var badges = asTextArray(column.badges || column.constraints || column.flags || column.badge);
  if (column.pk || column.primaryKey) badges.push('PK');
  if (column.fk || column.foreignKey || column.references) badges.push('FK');
  if (column.unique) badges.push('UNIQUE');
  if (column.nullable === false || column.required) badges.push('NOT NULL');
  if (column.json || column.type === 'json' || column.type === 'jsonb') badges.push('JSON');
  if (column.legacy) badges.push('LEGACY');
  return Array.from(new Set(badges.filter(Boolean)));
}
function archBadgeClass(value) {
  var key = layerKey(value);
  if (key === 'pk' || key === 'primary-key') return 'pk';
  if (key === 'fk' || key === 'foreign-key') return 'fk';
  if (key === 'unique') return 'unique';
  if (key === 'json' || key === 'jsonb') return 'json';
  if (key === 'legacy' || key === 'deprecated') return 'legacy';
  if (key === 'source-of-truth' || key === 'canonical') return 'source-of-truth';
  if (key === 'risk' || key === 'danger') return 'risk';
  return key;
}
function renderArchBadge(value) { return '<span class="arch-badge ' + archBadgeClass(value) + '">' + esc(value) + '</span>'; }
function renderArchColumns(columns) {
  if (!columns || !columns.length) return '';
  return '<div class="arch-columns">' + columns.slice(0, 8).map(function(column) {
    var name = column.name || column.id || column.column || '';
    var badges = columnBadges(column).map(renderArchBadge).join('');
    var refs = column.references || column.ref || column.to;
    var label = refs ? name + ' → ' + refs : name;
    return '<div class="arch-column"><span class="arch-column-name">' + esc(label) + '</span><span class="arch-column-badges">' + badges + '</span></div>';
  }).join('') + '</div>';
}
function renderArchNode(node, layout) {
  var badges = node.badges.slice();
  if (node.source === true) badges.push('source-of-truth');
  else if (typeof node.source === 'string') badges.push(node.source);
  if (node.status) badges.push(node.status);
  var classes = ['arch-node', node.type].concat(badges.map(archBadgeClass)).join(' ');
  return '<article class="' + esc(classes) + '" style="left:' + layout.x + 'px;top:' + layout.y + 'px;width:' + layout.w + 'px;min-height:' + layout.h + 'px">'
    + '<div class="arch-node-title">' + inline(node.title) + '</div>'
    + '<span class="arch-node-kind">' + esc(node.type) + '</span>'
    + (node.description ? '<div class="arch-node-desc">' + inline(node.description) + '</div>' : '')
    + (badges.length ? '<div class="arch-node-badges">' + badges.map(renderArchBadge).join('') + '</div>' : '')
    + renderArchColumns(node.columns)
    + '</article>';
}
function archEdgeColor(edge) {
  return edge.color || (edge.kind === 'write' ? '#dc2626' : edge.kind === 'read' ? '#2563eb' : '#7c3aed');
}
function archLabelPill(label, x, y, anchor) {
  label = String(label || '');
  var width = Math.min(220, Math.max(46, label.length * 6.5 + 20));
  var height = 22;
  var left = anchor === 'end' ? x - width : anchor === 'start' ? x : x - width / 2;
  var textX = anchor === 'end' ? x - 10 : anchor === 'start' ? x + 10 : x;
  var textAnchor = anchor === 'end' ? 'end' : anchor === 'start' ? 'start' : 'middle';
  return '<rect class="arch-edge-label-bg" x="' + left + '" y="' + (y - height / 2) + '" width="' + width + '" height="' + height + '" rx="11"/><text x="' + textX + '" y="' + y + '" text-anchor="' + textAnchor + '" class="arch-edge-label">' + esc(label) + '</text>';
}
function renderArchEdge(edge, layouts, index, markerId, orientation, metrics) {
  var from = layouts[edge.from];
  var to = layouts[edge.to];
  if (!from || !to) return '';
  var color = archEdgeColor(edge);
  var label = edge.label || edge.title || edge.kind || ('F' + (index + 1));
  var busOffset = (index % 5) * 28;
  var path;
  var lx;
  var ly;
  var anchor = 'middle';
  if (orientation === 'DOWN') {
    var sxDown = from.x + from.w;
    var syDown = from.y + Math.min(from.h / 2, 88);
    var txDown = to.x + to.w;
    var tyDown = to.y + Math.min(to.h / 2, 88);
    var busX = metrics.canvasWidth - metrics.rightGutter + 24 + busOffset;
    path = 'M' + sxDown + ' ' + syDown + ' L' + busX + ' ' + syDown + ' L' + busX + ' ' + tyDown + ' L' + txDown + ' ' + tyDown;
    lx = Math.min(metrics.canvasWidth - 20, busX + 8);
    ly = (syDown + tyDown) / 2;
    anchor = 'end';
  } else {
    var sx = from.x + from.w;
    var sy = from.y + Math.min(from.h / 2, 88);
    var tx = to.x;
    var ty = to.y + Math.min(to.h / 2, 88);
    var busY = metrics.edgeBusTop + busOffset;
    var exitX = sx + Math.max(18, metrics.laneGap / 2);
    var entryX = tx - Math.max(18, metrics.laneGap / 2);
    if (tx >= sx) {
      path = 'M' + sx + ' ' + sy + ' L' + exitX + ' ' + sy + ' L' + exitX + ' ' + busY + ' L' + entryX + ' ' + busY + ' L' + entryX + ' ' + ty + ' L' + tx + ' ' + ty;
      lx = (exitX + entryX) / 2;
      ly = busY - 13;
    } else {
      var wrapX = Math.max(20, Math.min(sx + 40 + busOffset, metrics.canvasWidth - 28));
      path = 'M' + sx + ' ' + sy + ' L' + wrapX + ' ' + sy + ' L' + wrapX + ' ' + busY + ' L' + entryX + ' ' + busY + ' L' + entryX + ' ' + ty + ' L' + tx + ' ' + ty;
      lx = (wrapX + entryX) / 2;
      ly = busY - 13;
    }
  }
  return '<g class="arch-edge"><path d="' + path + '" fill="none" stroke="' + esc(color) + '" stroke-width="2.8" stroke-linejoin="round" stroke-linecap="round" marker-end="url(#' + markerId + ')"/>' + archLabelPill(label, lx, ly, anchor) + '</g>';
}
function renderArchLegend(spec) {
  var legend = Array.isArray(spec.legend) ? spec.legend : [];
  if (!legend.length) {
    legend = [
      { title:'PK / FK', description:'PK는 row의 고유 식별자, FK는 다른 table row를 가리키는 연결선입니다.' },
      { title:'source-of-truth', description:'실제로 최종 데이터가 맞다고 믿는 저장소입니다. 예를 들어 승인 후 반영되는 canonical table이 이 역할입니다.' },
      { title:'legacy', description:'남아 있지만 이번 흐름에서는 줄이거나 끊어야 하는 오래된 source입니다.' },
    ];
  }
  return '<div class="arch-legend">' + legend.map(function(item) { return '<div class="arch-legend-card"><strong>' + esc(item.title || item.term || '설명') + '</strong><span>' + inline(item.description || item.body || '') + '</span></div>'; }).join('') + '</div>';
}
function archOrientation(spec, lanes, nodes) {
  var raw = String(spec.direction || spec.layout || spec.orientation || 'auto').toUpperCase();
  if (raw === 'DOWN' || raw === 'VERTICAL' || raw === 'TOP-DOWN') return 'DOWN';
  if (raw === 'RIGHT' || raw === 'HORIZONTAL' || raw === 'LR' || raw === 'LEFT-RIGHT') return 'RIGHT';
  var horizontalWidth = lanes.length * 292 + Math.max(0, lanes.length - 1) * 56;
  var hasOneNodePerLane = nodes.length <= lanes.length + 2;
  if (lanes.length >= 6 && hasOneNodePerLane) return 'DOWN';
  if (horizontalWidth > 1500 && nodes.length <= lanes.length * 2) return 'DOWN';
  return 'RIGHT';
}
function sortedLaneItems(items) {
  return items.sort(function(a, b) {
    var aRow = Number.isFinite(a.node.row) ? a.node.row : a.node.order;
    var bRow = Number.isFinite(b.node.row) ? b.node.row : b.node.order;
    return aRow === bRow ? a.node.order - b.node.order : aRow - bRow;
  });
}
function buildArchLaneBuckets(nodes, lanes) {
  var laneBuckets = {};
  nodes.forEach(function(node) {
    var lane = lanes.find(function(item) { return item.id === node.lane; }) || lanes[0];
    if (!laneBuckets[lane.id]) laneBuckets[lane.id] = [];
    laneBuckets[lane.id].push({ node:node, lane:lane });
  });
  Object.keys(laneBuckets).forEach(function(laneId) { laneBuckets[laneId] = sortedLaneItems(laneBuckets[laneId]); });
  return laneBuckets;
}
function renderArchitectureFlowElement(el, spec) {
  var lanes = collectArchLanes(spec);
  var nodes = (Array.isArray(spec.nodes) ? spec.nodes : []).map(function(node, index) { return normalizeArchNode(node, index, lanes); });
  if (!nodes.length) { el.innerHTML = '<div class="tft-visual-error">architecture-flow visual에는 nodes 배열이 필요합니다.</div>'; return; }
  var orientation = archOrientation(spec, lanes, nodes);
  var laneGap = Number(spec.laneGap) || (orientation === 'DOWN' ? 34 : 56);
  var nodeWidth = Number(spec.nodeWidth) || (orientation === 'DOWN' ? 270 : 246);
  var rowGap = Number(spec.rowGap) || 34;
  var sidePad = 46;
  var topPad = 58;
  var bottomPad = 46;
  var rightGutter = 150;
  var laneBuckets = buildArchLaneBuckets(nodes, lanes);
  var layouts = {};
  var laneBoxes = {};
  var canvasWidth;
  var canvasHeight;
  var edgeBusTop = 0;
  if (orientation === 'DOWN') {
    var maxLaneItems = Math.max.apply(null, lanes.map(function(lane) { return (laneBuckets[lane.id] || []).length || 1; }));
    var nodeGap = Number(spec.nodeGap) || 28;
    var contentWidth = Math.max(760, sidePad * 2 + maxLaneItems * nodeWidth + Math.max(0, maxLaneItems - 1) * nodeGap + rightGutter);
    canvasWidth = Number(spec.canvasWidth) || contentWidth;
    var yCursor = sidePad;
    lanes.forEach(function(lane) {
      var items = laneBuckets[lane.id] || [];
      var laneNodeHeights = items.map(function(item) { return archNodeHeight(item.node); });
      var laneHeight = Math.max(210, topPad + (laneNodeHeights.length ? Math.max.apply(null, laneNodeHeights) : 120) + bottomPad);
      laneBoxes[lane.id] = { x:sidePad, y:yCursor, w:canvasWidth - sidePad * 2, h:laneHeight };
      items.forEach(function(item, index) {
        var h = archNodeHeight(item.node);
        layouts[item.node.id] = { x:sidePad + 24 + index * (nodeWidth + nodeGap), y:yCursor + topPad, w:nodeWidth, h:h };
      });
      yCursor += laneHeight + laneGap;
    });
    canvasHeight = yCursor + bottomPad;
  } else {
    var laneWidth = Number(spec.laneWidth) || Math.max(292, nodeWidth + 60);
    canvasWidth = sidePad * 2 + lanes.length * laneWidth + Math.max(0, lanes.length - 1) * laneGap;
    lanes.forEach(function(lane) {
      var x = sidePad + lane.index * (laneWidth + laneGap);
      laneBoxes[lane.id] = { x:x, y:sidePad, w:laneWidth, h:0 };
      var cursor = topPad + sidePad;
      (laneBuckets[lane.id] || []).forEach(function(item, index) {
        if (index > 0) cursor += rowGap;
        var h = archNodeHeight(item.node);
        layouts[item.node.id] = { x:x + Math.max(18, (laneWidth - nodeWidth) / 2), y:cursor, w:nodeWidth, h:h };
        cursor += h;
      });
    });
    var nodeBottom = Object.values(layouts).reduce(function(max, box) { return Math.max(max, box.y + box.h); }, topPad + sidePad);
    edgeBusTop = nodeBottom + 72;
    canvasHeight = Math.max(420, edgeBusTop + 28 * Math.min(5, Math.max(1, (Array.isArray(spec.edges) ? spec.edges.length : 0))) + bottomPad);
    Object.keys(laneBoxes).forEach(function(laneId) { laneBoxes[laneId].h = canvasHeight - sidePad * 2; });
  }
  var laneHtml = lanes.map(function(lane) {
    var box = laneBoxes[lane.id];
    var klass = orientation === 'DOWN' ? 'arch-lane down' : 'arch-lane';
    return '<div class="' + klass + '" style="left:' + box.x + 'px;top:' + box.y + 'px;width:' + box.w + 'px;height:' + box.h + 'px"><div class="arch-lane-title">' + esc(lane.title) + '</div></div>';
  }).join('');
  var markerId = el.id + '-arch-arrow';
  var edges = Array.isArray(spec.edges) ? spec.edges : [];
  var metrics = { orientation:orientation, canvasWidth:canvasWidth, canvasHeight:canvasHeight, laneGap:laneGap, edgeBusTop:edgeBusTop, rightGutter:rightGutter };
  var edgeSvg = '<svg class="arch-edge-svg" width="' + canvasWidth + '" height="' + canvasHeight + '" viewBox="0 0 ' + canvasWidth + ' ' + canvasHeight + '"><defs><marker id="' + markerId + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#7c3aed"/></marker></defs>' + edges.map(function(edge, index) { return renderArchEdge(edge, layouts, index, markerId, orientation, metrics); }).join('') + '</svg>';
  var nodeHtml = nodes.map(function(node) { return renderArchNode(node, layouts[node.id]); }).join('');
  var orientationLabel = orientation === 'DOWN' ? 'Architecture flow · 세로 자동 배치' : 'Architecture flow · 가로 배치';
  el.className = 'arch-visual';
  el.innerHTML = '<div class="arch-visual-head"><div><div class="arch-visual-title">' + esc(spec.title || 'Architecture / Data Flow Map') + '</div>' + (spec.subtitle ? '<div class="arch-visual-subtitle">' + esc(spec.subtitle) + '</div>' : '<div class="arch-visual-subtitle">데이터와 로직이 UI/API/usecase/domain/repository/DB를 어떻게 지나가는지 보는 전체 지도입니다.</div>') + '</div><span class="badge">' + esc(orientationLabel) + '</span></div>'
    + '<div class="arch-visual-diagram"><div class="arch-canvas" style="width:' + canvasWidth + 'px;height:' + canvasHeight + 'px">' + laneHtml + edgeSvg + nodeHtml + '</div></div>'
    + renderArchLegend(spec)
    + renderLearningNotes(spec.notes || spec.explanations);
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
  if (isBackendLayerVisualSpec(spec)) { renderBackendLayerVisualElement(el, spec); return; }
  if (isArchitectureFlowSpec(spec)) { renderArchitectureFlowElement(el, spec); return; }
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
function renderPendingTftVisuals() {
  return Promise.all(Array.prototype.slice.call(document.querySelectorAll('.tft-visual[data-source]')).map(function(el) { return renderTftVisualElement(el); }));
}
function pageScrollTop() {
  var doc = document.documentElement || {};
  var body = document.body || {};
  if (typeof window.pageYOffset === 'number') return window.pageYOffset;
  if (typeof doc.scrollTop === 'number') return doc.scrollTop;
  if (typeof body.scrollTop === 'number') return body.scrollTop;
  return 0;
}
function pageViewportHeight() {
  var doc = document.documentElement || {};
  return Number(window.innerHeight || doc.clientHeight || 0) || 0;
}
function pageScrollHeight() {
  var doc = document.documentElement || {};
  var body = document.body || {};
  return Math.max(
    Number(body.scrollHeight || 0),
    Number(doc.scrollHeight || 0),
    Number(body.offsetHeight || 0),
    Number(doc.offsetHeight || 0),
    Number(doc.clientHeight || 0)
  );
}
function captureScrollState() {
  var top = pageScrollTop();
  var viewport = pageViewportHeight();
  var height = pageScrollHeight();
  var bottomGap = Math.max(0, height - top - viewport);
  return { top: top, viewport: viewport, height: height, bottomGap: bottomGap, nearBottom: bottomGap <= 96 };
}
function restoreScrollState(snapshot) {
  if (!snapshot) return;
  var viewport = pageViewportHeight() || snapshot.viewport || 0;
  var maxTop = Math.max(0, pageScrollHeight() - viewport);
  var target = snapshot.nearBottom ? maxTop : Math.min(snapshot.top, maxTop);
  if (Math.abs(pageScrollTop() - target) < 2) return;
  window.scrollTo(0, target);
}
function restoreScrollAfterRender(snapshot) {
  if (!snapshot) return;
  var restore = function() { restoreScrollState(snapshot); };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(restore);
  else setTimeout(restore, 0);
  setTimeout(restore, 40);
  setTimeout(restore, 160);
}
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
function countQuestionCardLabelsInBrowser(value) {
  var labels = ['질문 제목', '현재 이해', '막힌 결정', '왜 중요한가', '추천', '추천 답안', '선택 후 달라지는 것', '질문'];
  return labels.filter(function(label) { return new RegExp('(?:^|\\n)\\s*' + label + '\\s*[:：]').test(value); }).length;
}
function splitQuestionDisplay(rawQuestion) {
  var raw = String(rawQuestion || '').trim() || '선택해주세요.';
  var lines = raw.split(/\r?\n/);
  var title = '';
  var titleLineIndex = -1;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    var titleMatch = line.match(/^질문 제목\s*[:：]\s*(.+)$/);
    if (titleMatch && titleMatch[1]) { title = titleMatch[1].trim(); titleLineIndex = i; break; }
  }
  if (!title) {
    for (var j = lines.length - 1; j >= 0; j--) {
      var qLine = lines[j].trim();
      if (!qLine) continue;
      var questionMatch = qLine.match(/^질문\s*[:：]\s*(.*)$/);
      if (!questionMatch) continue;
      var inlineTitle = questionMatch[1] ? questionMatch[1].trim() : '';
      var nextLine = lines.slice(j + 1).find(function(item) { return item.trim(); });
      title = inlineTitle || (nextLine ? nextLine.trim() : '질문');
      titleLineIndex = j;
      break;
    }
  }
  var shouldSplit = raw.length > 180 || countQuestionCardLabelsInBrowser(raw) >= 2 || /\r?\n\s*\r?\n/.test(raw);
  if (!shouldSplit) return { title: raw, body: '', wasSplit: false };
  if (!title) {
    var first = lines.find(function(item) { return item.trim(); });
    title = first ? first.trim() : '선택해주세요.';
    if (title.length > 90) title = title.slice(0, 87).trimEnd() + '…';
  }
  if (title.length > 120) title = title.slice(0, 117).trimEnd() + '…';
  var body = lines.filter(function(_, index) { return index !== titleLineIndex; }).join('\n').trim();
  return { title: title, body: body, wasSplit: true };
}
function renderQuestionValue(rawQuestion) {
  var parts = splitQuestionDisplay(rawQuestion);
  return '<div class="answer-value">' + inline(parts.title) + '</div>' + (parts.body ? '<div class="question-context markdown">' + renderMarkdown(parts.body) + '</div>' : '');
}
function renderAnswerCard(answer) {
  var optionHtml = (answer.selectedOptions || []).length
    ? '<ol>' + answer.selectedOptions.map(function(opt) { return '<li>' + inline(opt) + '</li>'; }).join('') + '</ol>'
    : '<div class="status">선택한 옵션 없음</div>';
  var textHtml = answer.text ? '<div class="answer-row"><div class="answer-label">직접 입력</div><div class="answer-value">' + inline(answer.text) + '</div></div>' : '';
  return '<div class="answer-title">✅ ' + answerStatusLabel(answer.status) + '</div>'
    + (answer.question ? '<div class="answer-row"><div class="answer-label">질문</div>' + renderQuestionValue(answer.question) + '</div>' : '')
    + '<div class="answer-row"><div class="answer-label">선택값</div><div class="answer-value">' + optionHtml + '</div></div>'
    + textHtml
    + '<div class="status">Pi가 다음 단계를 준비 중입니다. 다음 markdown update가 오면 이 카드가 교체됩니다.</div>';
}
function renderQuestionForm(q) {
  var type = q.multiSelect ? 'checkbox' : 'radio';
  var parts = splitQuestionDisplay(q.question);
  return '<div class="inline-question">'
    + '<div class="question-title">' + esc(parts.title) + '</div>'
    + (parts.body ? '<div class="question-context markdown">' + renderMarkdown(parts.body) + '</div>' : '')
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
      body += '<div class="answer-row"><div class="answer-label">질문</div>' + renderQuestionValue(entry.question.question) + '</div>';
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
function selectTab(key) { selectedTab = key; if (state) render(state, { preserveScroll:false }); }
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
function render(s, options) {
  var scrollSnapshot = state && (!options || options.preserveScroll !== false) ? captureScrollState() : null;
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
  setTimeout(function() {
    var visualRender = renderPendingTftVisuals();
    restoreScrollAfterRender(scrollSnapshot);
    if (visualRender && typeof visualRender.then === 'function') visualRender.then(function() { restoreScrollAfterRender(scrollSnapshot); }).catch(function() { restoreScrollAfterRender(scrollSnapshot); });
  }, 0);
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
				const question = normalizeStudioQuestionInput({
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
				});
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
