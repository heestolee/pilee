import { existsSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Spacer, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { truncatePlainToWidth } from "../utils/format-utils.ts";

const PATCH_STATE_KEY = Symbol.for("pilee.tool-group-renderer.patch-state");
const PATCH_VERSION = "2026-06-03-mcp-content-collapse-r2";
const GROUP_STATE = Symbol("pilee.tool-group-renderer.state");
function piPackageRootFromDistEntrypoint(filePath: string | undefined): string | null {
	if (!filePath) return null;
	const resolved = resolve(filePath);
	const marker = `${sep}dist${sep}`;
	const index = resolved.lastIndexOf(marker);
	return index >= 0 ? resolved.slice(0, index) : null;
}

function piInteractiveBaseCandidates(): string[] {
	const candidates: string[] = [];
	if (process.env.PI_INTERACTIVE_BASE) candidates.push(process.env.PI_INTERACTIVE_BASE);
	if (process.env.PI_CODING_AGENT_ROOT) candidates.push(join(process.env.PI_CODING_AGENT_ROOT, "dist", "modes", "interactive"));
	const entrypointRoots = [
		piPackageRootFromDistEntrypoint(process.argv[1]),
		piPackageRootFromDistEntrypoint(fileURLToPath(import.meta.url)),
	].filter((value): value is string => Boolean(value));
	for (const root of entrypointRoots) candidates.push(join(root, "dist", "modes", "interactive"));
	candidates.push(join(dirname(process.execPath), "..", "lib", "node_modules", "@mariozechner", "pi-coding-agent", "dist", "modes", "interactive"));
	candidates.push("/usr/local/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive");
	candidates.push("/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/dist/modes/interactive");
	return [...new Set(candidates.map((candidate) => resolve(candidate)))];
}

const PI_INTERACTIVE_BASE = (() => {
	const candidates = piInteractiveBaseCandidates();
	return candidates.find((candidate) => existsSync(join(candidate, "interactive-mode.js"))) ?? candidates[0];
})();

function interactiveModuleUrl(file: string): string {
	return pathToFileURL(join(PI_INTERACTIVE_BASE, file)).href;
}
const BASH_PREVIEW_LIMIT = 56;
const MIN_BASH_LINE_WIDTH_WITH_COMMAND = 36;
const MIN_BASH_COMMAND_PREVIEW_WIDTH = 12;
const IMAGE_READ_EXTENSIONS = [".gif", ".jpeg", ".jpg", ".png", ".webp"] as const;

type GroupableToolName = "bash" | "read" | "edit" | "write";
type ThemeColor = "accent" | "dim" | "error" | "muted" | "success" | "text" | "toolTitle" | "warning";
type ThemeBg = "toolErrorBg" | "toolPendingBg" | "toolSuccessBg";

type RuntimeTheme = {
	fg: (color: ThemeColor, text: string) => string;
	bg: (color: ThemeBg, text: string) => string;
	bold: (text: string) => string;
};

type ToolResultLike = {
	content?: Array<{ type: string; text?: string }>;
	details?: unknown;
	isError?: boolean;
};

type GroupItem = {
	toolCallId: string;
	toolName: GroupableToolName;
	args: unknown;
	executionStarted: boolean;
	argsComplete: boolean;
	isPartial: boolean;
	isError: boolean;
	startedAt?: number;
	finishedAt?: number;
	result?: ToolResultLike;
};

type ToolHandle = {
	updateArgs: (args: unknown) => void;
	markExecutionStarted: () => void;
	setArgsComplete: () => void;
	updateResult: (result: ToolResultLike, isPartial?: boolean) => void;
};

type ToolComponentHandle = ToolHandle & { setExpanded?: (expanded: boolean) => void };

type TailCandidate = {
	toolName: GroupableToolName;
	toolCallId: string;
	item: GroupItem;
	component: ToolComponentHandle;
};

type GroupRuntimeState = {
	tailGroup: GroupedBuiltinToolComponent | null;
	tailCandidate: TailCandidate | null;
};

type InteractiveModeLike = {
	isInitialized?: boolean;
	init: () => Promise<void>;
	footer: { invalidate: () => void };
	ui: { requestRender: () => void };
	chatContainer: {
		children: unknown[];
		addChild: (child: unknown) => void;
		removeChild: (child: unknown) => void;
		clear: () => void;
	};
	pendingTools: Map<string, ToolHandle>;
	settingsManager: { getShowImages: () => boolean; getImageWidthCells: () => number };
	toolOutputExpanded: boolean;
	streamingComponent?: { updateContent: (message: unknown) => void };
	streamingMessage?: AssistantMessageLike;
	getRegisteredToolDefinition: (name: string) => unknown;
	sessionManager: { getCwd: () => string };
	session: { retryAttempt: number };
	addMessageToChat: (message: SessionMessageLike, options?: RenderSessionOptionsLike) => void;
	isFirstUserMessage: boolean;
	editor: { addToHistory?: (text: string) => void };
	getUserMessageText: (message: SessionMessageLike) => string | undefined;
	getMarkdownThemeWithSettings: () => unknown;
};

type RenderSessionOptionsLike = {
	updateFooter?: boolean;
	populateHistory?: boolean;
};

type AssistantMessageLike = {
	role: "assistant";
	content: AssistantContentLike[];
	stopReason?: string;
	errorMessage?: string;
};

type AssistantContentLike =
	| {
			type: "toolCall";
			id: string;
			name: string;
			arguments: unknown;
	  }
	| {
			type: string;
	  };

type SessionMessageLike =
	| AssistantMessageLike
	| {
			role: "toolResult";
			toolCallId: string;
			content?: Array<{ type: string; text?: string }>;
			details?: unknown;
			isError?: boolean;
	  }
	| {
			role: string;
			[key: string]: unknown;
	  };

type SessionContextLike = {
	messages: SessionMessageLike[];
};

type PrototypeMethods = {
	handleEvent: (event: {
		type: string;
		message?: SessionMessageLike;
		toolCallId?: string;
		toolName?: string;
		args?: unknown;
	}) => Promise<void>;
	renderSessionContext: (sessionContext: SessionContextLike, options?: RenderSessionOptionsLike) => void;
	addMessageToChat: (message: SessionMessageLike, options?: RenderSessionOptionsLike) => void;
};

type PatchState = {
	version?: string;
	originals?: PrototypeMethods;
	toolExecutionComponent?: new (
		toolName: string,
		toolCallId: string,
		args: unknown,
		options: { showImages: boolean; imageWidthCells: number },
		toolDefinition: unknown,
		ui: unknown,
		cwd: string,
	) => ToolHandle & { setExpanded?: (expanded: boolean) => void };
};

let runtimeTheme: RuntimeTheme | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isAssistantToolCallContent(
	content: AssistantContentLike,
): content is Extract<AssistantContentLike, { type: "toolCall" }> {
	return content.type === "toolCall";
}

function isAssistantMessage(message: SessionMessageLike | undefined): message is AssistantMessageLike {
	return !!message && message.role === "assistant";
}

function isToolResultMessage(
	message: SessionMessageLike,
): message is Extract<SessionMessageLike, { role: "toolResult" }> {
	return message.role === "toolResult";
}

function getTheme(): RuntimeTheme {
	return (
		runtimeTheme ?? {
			fg: (_color: ThemeColor, text: string) => text,
			bg: (_color: ThemeBg, text: string) => text,
			bold: (text: string) => text,
		}
	);
}

function isGroupableTool(toolName: string): toolName is GroupableToolName {
	return toolName === "bash" || toolName === "read" || toolName === "edit" || toolName === "write";
}

function hasImageReadExtension(path: string): boolean {
	const lowerPath = path.trim().toLowerCase();
	return IMAGE_READ_EXTENSIONS.some((extension) => lowerPath.endsWith(extension));
}

function isImageReadToolCall(toolName: string, args: unknown): boolean {
	if (toolName !== "read") return false;
	const params = isRecord(args) ? args : {};
	return typeof params.path === "string" && hasImageReadExtension(params.path);
}

function isGroupableToolCall(toolName: string, args: unknown): toolName is GroupableToolName {
	return isGroupableTool(toolName) && !isImageReadToolCall(toolName, args);
}

function isGroupableItem(item: Pick<GroupItem, "toolName" | "args">): boolean {
	return isGroupableToolCall(item.toolName, item.args);
}

function ensureGroupState(mode: InteractiveModeLike): GroupRuntimeState {
	const target = mode as InteractiveModeLike & { [GROUP_STATE]?: GroupRuntimeState };
	if (!target[GROUP_STATE]) {
		target[GROUP_STATE] = { tailGroup: null, tailCandidate: null };
	}
	return target[GROUP_STATE];
}

function hasVisibleAssistantContent(message: AssistantMessageLike): boolean {
	return message.content.some((content) => {
		if (!isRecord(content)) return false;
		const record = content as Record<string, unknown>;
		if (record.type !== "text") return false;
		return typeof record.text === "string" && record.text.trim().length > 0;
	});
}

function hasToolCallContent(message: AssistantMessageLike): boolean {
	return message.content.some((content) => isAssistantToolCallContent(content));
}

function shouldBreakGroupForMessage(message: SessionMessageLike): boolean {
	if (isAssistantMessage(message)) {
		const hasToolCalls = hasToolCallContent(message);
		if (hasVisibleAssistantContent(message)) return true;
		return !hasToolCalls && (message.stopReason === "aborted" || message.stopReason === "error");
	}
	return message.role !== "toolResult";
}

function shouldBreakGroupForMessageUpdate(message: AssistantMessageLike): boolean {
	return hasVisibleAssistantContent(message) && !hasToolCallContent(message);
}

function replaceChildInContainer(
	container: InteractiveModeLike["chatContainer"],
	previousChild: unknown,
	nextChild: unknown,
): void {
	const index = container.children.indexOf(previousChild);
	if (index === -1) {
		container.addChild(nextChild);
		return;
	}
	container.children.splice(index, 1, nextChild);
}

function isComponentLike(value: unknown): value is { render: (width: number) => string[] } {
	return isRecord(value) && typeof value.render === "function";
}

function isVisuallyEmptyChild(child: unknown): boolean {
	if (!isComponentLike(child)) return false;
	try {
		const lines = child.render(120);
		return lines.length === 0 || lines.every((line) => line.length === 0);
	} catch {
		return false;
	}
}

function findAppendableGroup(mode: InteractiveModeLike): GroupedBuiltinToolComponent | null {
	for (let index = mode.chatContainer.children.length - 1; index >= 0; index--) {
		const child = mode.chatContainer.children[index];
		if (child instanceof GroupedBuiltinToolComponent) {
			return child;
		}
		if (isVisuallyEmptyChild(child)) continue;
		return null;
	}
	return null;
}

function isAppendableTailCandidate(mode: InteractiveModeLike, candidate: TailCandidate): boolean {
	for (let index = mode.chatContainer.children.length - 1; index >= 0; index--) {
		const child = mode.chatContainer.children[index];
		if (child === candidate.component) return true;
		if (isVisuallyEmptyChild(child)) continue;
		return false;
	}
	return false;
}

function truncatePreview(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function normalizeInlinePreview(value: string): string {
	return value.replace(/\r\n|\r|\n/g, " ");
}

function formatBashCommandPreview(command: string, maxWidth = BASH_PREVIEW_LIMIT): string {
	return truncatePlainToWidth(normalizeInlinePreview(`$ ${command}`), maxWidth);
}

function deriveBashTitle(command: string): string {
	const trimmed = command.trim();
	if (!trimmed) return "명령어 실행";

	const withoutEnv = trimmed.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, "");
	const withoutSudo = withoutEnv.replace(/^sudo\s+/, "");
	const withoutBang = withoutSudo.replace(/^(?:!!\s*)?/, "");
	const match = withoutBang.match(/^\S+/);
	return match?.[0] ?? "명령어 실행";
}

function extractRawTextContent(result?: ToolResultLike): string | undefined {
	return result?.content?.find(
		(entry): entry is { type: string; text: string } => entry.type === "text" && typeof entry.text === "string",
	)?.text;
}

function extractTextContent(result?: ToolResultLike): string | undefined {
	return extractRawTextContent(result)?.trim();
}

function countRenderedTextLines(text: string): number {
	const lines = text.split("\n");
	while (lines.length > 1 && lines.at(-1) === "") {
		lines.pop();
	}
	return lines.length;
}

function summarizeEditDiff(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (line.startsWith("+++") || line.startsWith("---")) continue;
		if (line.startsWith("+")) added++;
		if (line.startsWith("-")) removed++;
	}
	return { added, removed };
}

function formatElapsedSeconds(ms: number): number {
	return Math.max(1, Math.ceil(ms / 1000));
}

function formatBashDuration(item: GroupItem): string {
	const theme = getTheme();
	if (!item.startedAt) return "";
	const endTime = item.finishedAt ?? Date.now();
	const seconds = formatElapsedSeconds(Math.max(0, endTime - item.startedAt));
	if (item.finishedAt) {
		return ` ${theme.fg("muted", `[${seconds}s]`)}`;
	}
	return ` ${theme.fg("warning", `[~${seconds}s]`)}`;
}

function formatBashLine(args: unknown, item: GroupItem, maxWidth?: number): string {
	const theme = getTheme();
	const params = isRecord(args) ? args : {};
	const title = typeof params.title === "string" && params.title.length > 0 ? params.title : undefined;
	const command = typeof params.command === "string" ? params.command : "";
	const label = title ?? deriveBashTitle(command);
	const prefix = theme.fg("muted", "ㄴ ");
	const prefixWidth = visibleWidth("ㄴ ");
	const contentWidth = maxWidth === undefined ? undefined : Math.max(1, maxWidth - prefixWidth);
	const duration = formatBashDuration(item);
	let commandPreview = "";
	let durationPreview = duration;

	if (command && (contentWidth === undefined || contentWidth >= MIN_BASH_LINE_WIDTH_WITH_COMMAND)) {
		const fixedWidth = visibleWidth(label) + visibleWidth(duration) + visibleWidth(" ()");
		const commandWidth = contentWidth === undefined ? BASH_PREVIEW_LIMIT : contentWidth - fixedWidth;
		if (commandWidth >= MIN_BASH_COMMAND_PREVIEW_WIDTH) {
			commandPreview = ` (${formatBashCommandPreview(command, Math.min(BASH_PREVIEW_LIMIT, commandWidth))})`;
		} else if (contentWidth !== undefined) {
			durationPreview = "";
		}
	} else if (contentWidth !== undefined) {
		durationPreview = "";
	}

	const content = `${label}${commandPreview}${durationPreview}`;
	const color: ThemeColor = item.isError
		? "error"
		: item.isPartial || (!item.result && item.executionStarted)
			? "warning"
			: "text";
	const line =
		color === "text"
			? `${prefix}${theme.fg("accent", label)}${theme.fg("dim", commandPreview)}${durationPreview}`
			: `${prefix}${theme.fg(color, content)}`;

	return maxWidth === undefined
		? line
		: truncateToWidth(line, maxWidth, theme.fg(color === "text" ? "dim" : color, "..."));
}

function formatPlainPathLine(path: string, item: GroupItem): string {
	const theme = getTheme();
	if (item.isError) return `${theme.fg("muted", "ㄴ ")}${theme.fg("error", path)}`;
	if (item.isPartial || (!item.result && item.executionStarted)) {
		return `${theme.fg("muted", "ㄴ ")}${theme.fg("warning", path)}`;
	}
	return `${theme.fg("muted", "ㄴ ")}${theme.fg("accent", path)}`;
}

function formatReadLine(args: unknown, item: GroupItem): string {
	const theme = getTheme();
	const params = isRecord(args) ? args : {};
	const path = typeof params.path === "string" && params.path.length > 0 ? params.path : "(unknown path)";
	const rawText = extractRawTextContent(item.result);
	if (!rawText) return formatPlainPathLine(path, item);

	const start = typeof params.offset === "number" && Number.isFinite(params.offset) ? params.offset : 1;
	const lineCount = countRenderedTextLines(rawText);
	const end = start + Math.max(lineCount - 1, 0);
	const suffix = theme.fg("dim", `:${start}-${end}`);
	const base = formatPlainPathLine(path, item);
	return `${base}${suffix}`;
}

function formatEditLine(args: unknown, item: GroupItem): string {
	const theme = getTheme();
	const params = isRecord(args) ? args : {};
	const path = typeof params.path === "string" && params.path.length > 0 ? params.path : "(unknown path)";
	const base = formatPlainPathLine(path, item);
	const details = isRecord(item.result?.details) ? item.result?.details : undefined;
	const diff = typeof details?.diff === "string" ? details.diff : undefined;
	if (!diff) return base;
	const { added, removed } = summarizeEditDiff(diff);
	return `${base} ${theme.fg("success", `+${added}`)} ${theme.fg("dim", "/")} ${theme.fg("error", `-${removed}`)}`;
}

function formatWriteLine(args: unknown, item: GroupItem): string {
	const params = isRecord(args) ? args : {};
	const path = typeof params.path === "string" && params.path.length > 0 ? params.path : "(unknown path)";
	return formatPlainPathLine(path, item);
}

function formatExpandedTextDetail(item: GroupItem): string[] {
	const theme = getTheme();
	const text = extractTextContent(item.result);
	if (!text) return [];

	const firstLine = text.split("\n").find((line) => line.trim().length > 0);
	if (!firstLine) return [];

	const summary = truncatePreview(firstLine.trim(), 96);
	const color: ThemeColor = item.isError ? "error" : item.isPartial ? "warning" : "dim";
	return [`  ${theme.fg(color, summary)}`];
}

function formatExpandedEditDetail(item: GroupItem): string[] {
	const theme = getTheme();
	const details = isRecord(item.result?.details) ? item.result?.details : undefined;
	const diff = typeof details?.diff === "string" ? details.diff : undefined;
	if (!diff) return formatExpandedTextDetail(item);

	const changedLines = diff
		.split("\n")
		.filter(
			(line) => (line.startsWith("+") || line.startsWith("-")) && !line.startsWith("+++") && !line.startsWith("---"),
		);
	if (changedLines.length === 0) return formatExpandedTextDetail(item);

	const previewLimit = 6;
	const preview = changedLines.slice(0, previewLimit).map((line) => {
		const color: ThemeColor = line.startsWith("+") ? "success" : "error";
		return `  ${theme.fg(color, truncatePreview(line, 96))}`;
	});
	const hidden = changedLines.length - preview.length;
	if (hidden > 0) {
		preview.push(`  ${theme.fg("dim", `… ${hidden} more changed lines`)}`);
	}
	return preview;
}

function formatExpandedDetail(item: GroupItem): string[] {
	if (item.toolName === "edit" && !item.isError) return formatExpandedEditDetail(item);
	return formatExpandedTextDetail(item);
}

function toolResultDetails(result?: ToolResultLike): Record<string, unknown> | undefined {
	return isRecord(result?.details) ? result.details : undefined;
}

function detailString(details: Record<string, unknown> | undefined, key: string): string | undefined {
	const value = details?.[key];
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function extractLineValue(text: string, label: string): string | undefined {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = text.match(new RegExp(`^${escaped}:\\s*(.+)$`, "m"));
	return match?.[1]?.trim();
}

function cleanMarkdownTitle(line: string): string {
	return line.replace(/^#+\s*/, "").replace(/^[-*]\s*/, "").trim();
}

function firstContentLine(text: string): string | undefined {
	for (const line of text.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (/^(?:🔌 MCP 결과|server:|tool:|action:|responseId:|원문 크기:|## 요약|원문은 |필요 시:)/.test(trimmed)) continue;
		return cleanMarkdownTitle(trimmed);
	}
	return undefined;
}

function countCommaSeparated(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const count = value.split(",").map((part) => part.trim()).filter(Boolean).length;
	return count > 0 ? count : undefined;
}

function countMatches(text: string, pattern: RegExp): number {
	return [...text.matchAll(pattern)].length;
}

function conciseTimeRange(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const times = [...value.matchAll(/(\d{2}:\d{2})(?::\d{2})?/g)].map((match) => match[1]);
	if (times.length >= 2) return `${times[0]}–${times.at(-1)}`;
	return times[0];
}

function mcpRenderableText(result?: ToolResultLike): string {
	const details = toolResultDetails(result);
	const fullContent = details?.mcpFullContent === true && typeof details.fullContent === "string" ? details.fullContent.trim() : undefined;
	const fullDigest = typeof details?.fullDigest === "string" ? details.fullDigest.trim() : undefined;
	return fullContent || fullDigest || extractRawTextContent(result)?.trim() || "";
}

function isMcpFullContentResult(result?: ToolResultLike): boolean {
	const details = toolResultDetails(result);
	return details?.mcpFullContent === true || /^MCP full content\b/.test(extractRawTextContent(result)?.trim() ?? "");
}

function formatMcpFullContentCollapsedLine(result: ToolResultLike | undefined, args: unknown, expanded: boolean): string {
	const details = toolResultDetails(result);
	const text = typeof details?.fullContent === "string" ? details.fullContent.trim() : extractRawTextContent(result)?.trim() || "";
	const server = detailString(details, "server") ?? extractLineValue(text, "server") ?? (isRecord(args) ? detailString(args, "server") : undefined) ?? "mcp";
	const tool = detailString(details, "tool") ?? extractLineValue(text, "tool") ?? (isRecord(args) ? detailString(args, "tool") : undefined) ?? "tool";
	const responseId = detailString(details, "responseId") ?? extractLineValue(text, "responseId");
	const messageCount = extractLineValue(text, "messageCount")?.replace(/[^0-9,]/g, "") || text.match(/Retrieved\s+(\d+)\s+message\(s\)/)?.[1];
	const hint = expanded ? "Ctrl+O 접기" : "Ctrl+O 펼쳐보기";
	return ["📦 MCP 원문", `${server}/${tool}`, messageCount ? `${messageCount}개 메시지` : undefined, responseId, hint].filter(Boolean).join(" · ");
}

function formatMcpCollapsedLine(result?: ToolResultLike, args?: unknown, expanded = false): string {
	if (isMcpFullContentResult(result)) return formatMcpFullContentCollapsedLine(result, args, expanded);

	const text = mcpRenderableText(result);
	const details = toolResultDetails(result);
	const server = detailString(details, "server") ?? (isRecord(args) ? detailString(args, "server") : undefined) ?? "mcp";
	const tool = detailString(details, "tool") ?? (isRecord(args) ? detailString(args, "tool") : undefined) ?? "tool";
	const hint = expanded ? "Ctrl+O 접기" : "Ctrl+O 펼쳐보기";
	const suffix = ` · ${hint}`;

	if (!result) return `🔌 MCP 실행 중 · ${server}/${tool}`;
	if (result.isError) return `🔌 MCP 실패 · ${server}/${tool}${suffix}`;

	if (text.includes("💬 Slack 결과 확인")) {
		const messageCount = extractLineValue(text, "메시지");
		const participants = countCommaSeparated(extractLineValue(text, "참여자"));
		const time = conciseTimeRange(extractLineValue(text, "시간 범위"));
		return ["💬 Slack thread", messageCount ? `${messageCount} 메시지` : undefined, participants ? `참여자 ${participants}명` : undefined, time, hint].filter(Boolean).join(" · ");
	}

	if (text.includes("📝 Notion 결과 확인") || `${server} ${tool}`.toLowerCase().includes("notion")) {
		const title = extractLineValue(text, "제목") ?? firstContentLine(text) ?? "Notion 결과";
		const imageCount = countMatches(text, /^- 이미지:/gm);
		return [`📝 Notion page`, truncatePlainToWidth(title, 72), imageCount > 0 ? `이미지 ${imageCount}개` : undefined, hint].filter(Boolean).join(" · ");
	}

	if (text.includes("🎫 Jira 결과 확인")) {
		const issueCount = extractLineValue(text, "이슈");
		const title = firstContentLine(text) ?? `${server}/${tool}`;
		return [`🎫 Jira`, issueCount ? `${issueCount} 이슈` : truncatePlainToWidth(title, 72), hint].filter(Boolean).join(" · ");
	}

	const chars = typeof details?.originalChars === "number" ? `${details.originalChars.toLocaleString()} chars` : undefined;
	return [`🔌 MCP`, `${server}/${tool}`, chars, hint].filter(Boolean).join(" · ");
}

function formatMcpExpandedText(result?: ToolResultLike): string {
	const text = mcpRenderableText(result);
	return text && text.length > 0 ? text : "(아직 결과 없음)";
}

class McpToolResultComponent extends Container implements ToolComponentHandle {
	private readonly content: Text;
	private args: unknown;
	private result?: ToolResultLike;
	private isPartial = false;
	private expanded = false;

	constructor(args: unknown) {
		super();
		this.args = args;
		this.addChild(new Spacer(1));
		this.content = new Text("", 1, 1);
		this.addChild(this.content);
		this.refreshDisplay();
	}

	updateArgs(args: unknown): void {
		this.args = args;
		this.refreshDisplay();
	}

	markExecutionStarted(): void {
		this.refreshDisplay();
	}

	setArgsComplete(): void {
		this.refreshDisplay();
	}

	updateResult(result: ToolResultLike, isPartial = false): void {
		this.result = result;
		this.isPartial = isPartial;
		this.refreshDisplay();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.refreshDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.refreshDisplay();
	}

	private refreshDisplay(): void {
		const theme = getTheme();
		const bg: ThemeBg = this.result?.isError ? "toolErrorBg" : this.isPartial || !this.result ? "toolPendingBg" : "toolSuccessBg";
		this.content.setCustomBgFn((text) => theme.bg(bg, text));
		const header = formatMcpCollapsedLine(this.result, this.args, this.expanded);
		if (!this.expanded) {
			this.content.setText(theme.fg(this.result?.isError ? "error" : "accent", header));
			return;
		}
		this.content.setText(`${theme.fg("toolTitle", theme.bold(header))}\n${formatMcpExpandedText(this.result)}`);
	}
}

function createGroupItem(toolName: GroupableToolName, toolCallId: string, args: unknown): GroupItem {
	return {
		toolCallId,
		toolName,
		args,
		executionStarted: false,
		argsComplete: false,
		isPartial: false,
		isError: false,
	};
}

function updateGroupItemResult(item: GroupItem, result: ToolResultLike, isPartial = false): void {
	item.result = result;
	item.isPartial = isPartial;
	item.isError = !!result?.isError;
	if (isPartial) {
		item.startedAt ??= Date.now();
		item.finishedAt = undefined;
	} else {
		item.startedAt ??= Date.now();
		item.finishedAt = Date.now();
	}
}

class GroupedBuiltinToolComponent extends Container {
	private readonly content: Text;
	private items: GroupItem[] = [];
	private expanded = false;
	private renderContentWidth: number | undefined;

	constructor() {
		super();
		this.addChild(new Spacer(1));
		this.content = new Text("", 1, 1);
		this.addChild(this.content);
		this.refreshDisplay();
	}

	appendItem(toolName: GroupableToolName, toolCallId: string, args: unknown): ToolHandle {
		return this.appendExistingItem(createGroupItem(toolName, toolCallId, args));
	}

	appendExistingItem(item: GroupItem): ToolHandle {
		this.items.push(item);
		this.refreshDisplay();
		return {
			updateArgs: (nextArgs: unknown) => {
				item.args = nextArgs;
				this.refreshDisplay();
			},
			markExecutionStarted: () => {
				item.executionStarted = true;
				item.startedAt ??= Date.now();
				this.refreshDisplay();
			},
			setArgsComplete: () => {
				item.argsComplete = true;
				this.refreshDisplay();
			},
			updateResult: (result: ToolResultLike, isPartial = false) => {
				updateGroupItemResult(item, result, isPartial);
				this.refreshDisplay();
			},
		};
	}

	getItemCount(): number {
		return this.items.length;
	}

	getSingletonItem(): GroupItem | undefined {
		return this.items.length === 1 ? this.items[0] : undefined;
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		this.refreshDisplay();
	}

	override invalidate(): void {
		super.invalidate();
		this.refreshDisplay();
	}

	private getBackgroundToken(): ThemeBg {
		if (this.items.length > 0 && this.items.every((item) => item.isError)) return "toolErrorBg";
		if (this.items.some((item) => item.isPartial || (item.executionStarted && !item.result))) return "toolPendingBg";
		return "toolSuccessBg";
	}

	private formatItemLine(item: GroupItem): string[] {
		const line =
			item.toolName === "bash"
				? formatBashLine(item.args, item, this.renderContentWidth)
				: item.toolName === "read"
					? formatReadLine(item.args, item)
					: item.toolName === "edit"
						? formatEditLine(item.args, item)
						: formatWriteLine(item.args, item);
		if (!this.expanded) return [line];
		return [line, ...formatExpandedDetail(item)];
	}

	private formatGroupedLines(): string[] {
		const theme = getTheme();
		const lines: string[] = [];
		let previousToolName: GroupableToolName | undefined;

		for (const item of this.items) {
			if (item.toolName !== previousToolName) {
				if (previousToolName !== undefined) {
					lines.push("");
				}
				lines.push(theme.fg("toolTitle", theme.bold(item.toolName)));
				previousToolName = item.toolName;
			}
			lines.push(...this.formatItemLine(item));
		}

		return lines;
	}

	override render(width: number): string[] {
		const nextContentWidth = Math.max(1, width - 2);
		if (this.renderContentWidth !== nextContentWidth) {
			this.renderContentWidth = nextContentWidth;
			this.refreshDisplay();
		}
		return super.render(width);
	}

	private refreshDisplay(): void {
		const theme = getTheme();
		this.content.setCustomBgFn((text) => theme.bg(this.getBackgroundToken(), text));
		this.content.setText(this.formatGroupedLines().join("\n"));
	}
}

function createNormalToolInstance(
	mode: InteractiveModeLike,
	toolName: string,
	toolCallId: string,
	args: unknown,
): ToolComponentHandle {
	const ToolExecutionComponentCtor = (
		globalThis as typeof globalThis & {
			[PATCH_STATE_KEY]?: PatchState;
		}
	)[PATCH_STATE_KEY]?.toolExecutionComponent;
	if (!ToolExecutionComponentCtor) {
		throw new Error("ToolExecutionComponent constructor is not initialized");
	}

	const component = new ToolExecutionComponentCtor(
		toolName,
		toolCallId,
		args,
		{
			showImages: mode.settingsManager.getShowImages(),
			imageWidthCells: mode.settingsManager.getImageWidthCells(),
		},
		mode.getRegisteredToolDefinition(toolName),
		mode.ui,
		mode.sessionManager.getCwd(),
	);
	component.setExpanded?.(mode.toolOutputExpanded);
	return component;
}

function createNormalToolComponent(
	mode: InteractiveModeLike,
	toolName: string,
	toolCallId: string,
	args: unknown,
): ToolHandle {
	const component = createNormalToolInstance(mode, toolName, toolCallId, args);
	mode.chatContainer.addChild(component);
	return component;
}

function createMcpToolComponent(mode: InteractiveModeLike, toolCallId: string, args: unknown): ToolHandle {
	const component = new McpToolResultComponent(args);
	component.setExpanded(mode.toolOutputExpanded);
	mode.chatContainer.addChild(component);
	mode.pendingTools.set(toolCallId, component);
	return component;
}

function createRecordingToolHandle(delegate: ToolComponentHandle, item: GroupItem): ToolComponentHandle {
	return {
		updateArgs: (args: unknown) => {
			item.args = args;
			delegate.updateArgs(args);
		},
		markExecutionStarted: () => {
			item.executionStarted = true;
			item.startedAt ??= Date.now();
			delegate.markExecutionStarted();
		},
		setArgsComplete: () => {
			item.argsComplete = true;
			delegate.setArgsComplete();
		},
		updateResult: (result: ToolResultLike, isPartial = false) => {
			updateGroupItemResult(item, result, isPartial);
			delegate.updateResult(result, isPartial);
		},
		setExpanded: (expanded: boolean) => delegate.setExpanded?.(expanded),
	};
}

function createTailCandidate(
	mode: InteractiveModeLike,
	toolName: GroupableToolName,
	toolCallId: string,
	args: unknown,
): { candidate: TailCandidate; handle: ToolComponentHandle } {
	const component = createNormalToolInstance(mode, toolName, toolCallId, args);
	const item = createGroupItem(toolName, toolCallId, args);
	const handle = createRecordingToolHandle(component, item);
	mode.chatContainer.addChild(component);
	return {
		candidate: { toolName, toolCallId, item, component },
		handle,
	};
}

function promoteTailCandidateToGroup(mode: InteractiveModeLike, candidate: TailCandidate): GroupedBuiltinToolComponent {
	const group = new GroupedBuiltinToolComponent();
	group.setExpanded(mode.toolOutputExpanded);
	const firstHandle = group.appendExistingItem(candidate.item);
	replaceChildInContainer(mode.chatContainer, candidate.component, group);
	if (mode.pendingTools.has(candidate.toolCallId)) {
		mode.pendingTools.set(candidate.toolCallId, firstHandle);
	}
	return group;
}

function materializeSingletonGroup(mode: InteractiveModeLike, group: GroupedBuiltinToolComponent): void {
	const item = group.getSingletonItem();
	if (!item) return;
	const component = createNormalToolInstance(mode, item.toolName, item.toolCallId, item.args);
	if (item.executionStarted) {
		component.markExecutionStarted();
	}
	if (item.argsComplete) {
		component.setArgsComplete();
	}
	if (item.result) {
		component.updateResult(item.result, item.isPartial);
	}
	const pendingHandle = mode.pendingTools.get(item.toolCallId);
	if (pendingHandle) {
		mode.pendingTools.set(item.toolCallId, component);
	}
	replaceChildInContainer(mode.chatContainer, group, component);
}

function finalizeTailGroup(mode: InteractiveModeLike): void {
	const state = ensureGroupState(mode);
	const group = state.tailGroup;
	if (!group) return;
	if (group.getItemCount() === 1) {
		materializeSingletonGroup(mode, group);
	}
	state.tailGroup = null;
}

function breakGroup(mode: InteractiveModeLike): void {
	const state = ensureGroupState(mode);
	finalizeTailGroup(mode);
	state.tailCandidate = null;
}

function ensureToolHandle(mode: InteractiveModeLike, toolName: string, toolCallId: string, args: unknown): ToolHandle {
	if (toolName === "mcp" || toolName === "get_mcp_content") {
		breakGroup(mode);
		return createMcpToolComponent(mode, toolCallId, args);
	}
	if (!isGroupableToolCall(toolName, args)) {
		breakGroup(mode);
		const component = createNormalToolComponent(mode, toolName, toolCallId, args);
		mode.pendingTools.set(toolCallId, component);
		return component;
	}

	const state = ensureGroupState(mode);
	let group = findAppendableGroup(mode);
	if (group) {
		state.tailGroup = group;
		state.tailCandidate = null;
		const handle = group.appendItem(toolName, toolCallId, args);
		mode.pendingTools.set(toolCallId, handle);
		return handle;
	}

	if (
		state.tailCandidate &&
		isGroupableItem(state.tailCandidate.item) &&
		isAppendableTailCandidate(mode, state.tailCandidate)
	) {
		group = promoteTailCandidateToGroup(mode, state.tailCandidate);
		state.tailGroup = group;
		state.tailCandidate = null;
		const handle = group.appendItem(toolName, toolCallId, args);
		mode.pendingTools.set(toolCallId, handle);
		return handle;
	}

	finalizeTailGroup(mode);
	state.tailCandidate = null;
	const { candidate, handle } = createTailCandidate(mode, toolName, toolCallId, args);
	state.tailCandidate = candidate;
	mode.pendingTools.set(toolCallId, handle);
	return handle;
}

function updateStreamingAssistantToolCalls(mode: InteractiveModeLike, message: AssistantMessageLike): void {
	mode.streamingMessage = message;
	mode.streamingComponent?.updateContent(message);
	for (const content of message.content) {
		if (!isAssistantToolCallContent(content)) continue;
		if (!mode.pendingTools.has(content.id)) {
			ensureToolHandle(mode, content.name, content.id, content.arguments);
		} else {
			mode.pendingTools.get(content.id)?.updateArgs(content.arguments);
		}
	}
	mode.ui.requestRender();
}

function getAssistantAbortMessage(mode: InteractiveModeLike, message: AssistantMessageLike): string {
	if (message.stopReason === "aborted") {
		const retryAttempt = mode.session.retryAttempt;
		return retryAttempt > 0
			? `Aborted after ${retryAttempt} retry attempt${retryAttempt > 1 ? "s" : ""}`
			: "Operation aborted";
	}
	return message.errorMessage || "Error";
}

function renderAssistantMessageWithGroups(mode: InteractiveModeLike, message: AssistantMessageLike): void {
	mode.addMessageToChat(message);
	for (const content of message.content) {
		if (!isAssistantToolCallContent(content)) continue;
		const handle = ensureToolHandle(mode, content.name, content.id, content.arguments);
		if (message.stopReason !== "aborted" && message.stopReason !== "error") continue;
		handle.updateResult({ content: [{ type: "text", text: getAssistantAbortMessage(mode, message) }], isError: true });
		mode.pendingTools.delete(content.id);
	}
}

function applyToolResultToPendingHandle(
	mode: InteractiveModeLike,
	message: Extract<SessionMessageLike, { role: "toolResult" }>,
): void {
	const handle = mode.pendingTools.get(message.toolCallId);
	if (!handle) return;
	handle.updateResult(message);
	mode.pendingTools.delete(message.toolCallId);
}

function renderSessionContextPatched(
	mode: InteractiveModeLike,
	sessionContext: SessionContextLike,
	options: RenderSessionOptionsLike = {},
): void {
	mode.pendingTools.clear();
	mode.isFirstUserMessage = true;
	breakGroup(mode);

	if (options.updateFooter) {
		mode.footer.invalidate();
		(mode as InteractiveModeLike & { updateEditorBorderColor?: () => void }).updateEditorBorderColor?.();
	}

	for (const message of sessionContext.messages) {
		if (isAssistantMessage(message)) {
			renderAssistantMessageWithGroups(mode, message);
			continue;
		}
		if (isToolResultMessage(message)) {
			applyToolResultToPendingHandle(mode, message);
			continue;
		}
		mode.addMessageToChat(message, options);
	}

	mode.pendingTools.clear();
	breakGroup(mode);
	mode.ui.requestRender();
}

export const __test__ = {
	formatBashCommandPreview,
	formatBashLine,
	formatMcpCollapsedLine,
	ensureToolHandle,
	setRuntimeThemeForTest: (theme?: RuntimeTheme) => {
		runtimeTheme = theme;
	},
	shouldBreakGroupForMessageUpdate,
	updateStreamingAssistantToolCalls,
};

export default async function toolGroupRenderer(_pi: ExtensionAPI): Promise<void> {
	const globalState = globalThis as typeof globalThis & {
		[PATCH_STATE_KEY]?: PatchState;
	};
	const patchState = globalState[PATCH_STATE_KEY] ?? {};
	globalState[PATCH_STATE_KEY] = patchState;

	const [{ InteractiveMode }, { ToolExecutionComponent }, themeModule] = await Promise.all([
		import(interactiveModuleUrl("interactive-mode.js")),
		import(interactiveModuleUrl("components/tool-execution.js")),
		import(interactiveModuleUrl("theme/theme.js")),
	]);

	patchState.toolExecutionComponent = ToolExecutionComponent;
	runtimeTheme = themeModule.theme as RuntimeTheme;

	const proto = InteractiveMode.prototype as InteractiveModeLike & PrototypeMethods;
	if (!patchState.originals) {
		patchState.originals = {
			handleEvent: proto.handleEvent,
			renderSessionContext: proto.renderSessionContext,
			addMessageToChat: proto.addMessageToChat,
		};
	} else {
		proto.handleEvent = patchState.originals.handleEvent;
		proto.renderSessionContext = patchState.originals.renderSessionContext;
		proto.addMessageToChat = patchState.originals.addMessageToChat;
	}

	const originalHandleEvent = patchState.originals.handleEvent;
	const originalRenderSessionContext = patchState.originals.renderSessionContext;
	const originalAddMessageToChat = patchState.originals.addMessageToChat;

	proto.addMessageToChat = function addMessageToChatPatched(this: InteractiveModeLike, message, options) {
		if (shouldBreakGroupForMessage(message)) {
			breakGroup(this);
		}
		return originalAddMessageToChat.call(this, message, options);
	};

	proto.handleEvent = async function handleEventPatched(this: InteractiveModeLike, event) {
		if (event.type === "agent_start" || event.type === "agent_end") {
			breakGroup(this);
		}

		if (event.type === "message_update" && isAssistantMessage(event.message)) {
			if (shouldBreakGroupForMessageUpdate(event.message)) {
				breakGroup(this);
			}
			if (!this.isInitialized) {
				await this.init();
			}
			this.footer.invalidate();
			if (this.streamingComponent) {
				updateStreamingAssistantToolCalls(this, event.message);
			}
			return;
		}

		if (
			event.type === "tool_execution_start" &&
			typeof event.toolCallId === "string" &&
			typeof event.toolName === "string"
		) {
			if (!this.isInitialized) {
				await this.init();
			}
			this.footer.invalidate();
			let handle = this.pendingTools.get(event.toolCallId);
			if (!handle) {
				handle = ensureToolHandle(this, event.toolName, event.toolCallId, event.args);
			}
			handle.markExecutionStarted();
			this.ui.requestRender();
			return;
		}

		return originalHandleEvent.call(this, event);
	};

	proto.renderSessionContext = function renderSessionContextPatchedWrapper(
		this: InteractiveModeLike,
		sessionContext,
		options,
	) {
		return renderSessionContextPatched(this, sessionContext, options);
	};

	patchState.version = PATCH_VERSION;

	void originalRenderSessionContext;
}
