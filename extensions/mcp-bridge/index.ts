import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

interface ServerConfig {
	type?: string;
	command: string;
	args?: string[];
	env?: Record<string, string>;
}

interface McpTool {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
}

interface Connection {
	client: Client;
	transport: StdioClientTransport;
	tools: McpTool[];
	status: "connected" | "disconnected" | "error";
	error?: string;
	lastUsedAt: number;
}

interface StoredMcpResult {
	id: string;
	server: string;
	tool: string;
	action: string;
	args?: Record<string, unknown>;
	timestamp: number;
	output: string;
	rawData: unknown;
}

interface McpFormattedResult {
	text: string;
	details?: Record<string, unknown>;
}

// --- Failure Tracker (in-memory, resets on session start) ---

interface FailureRecord {
	count: number;
	consecutive: number;
	lastError: string;
	lastFailureAt: number;
}

const failures = new Map<string, FailureRecord>();

function recordFailure(name: string, error: string) {
	const existing = failures.get(name);
	if (existing) {
		existing.count++;
		existing.consecutive++;
		existing.lastError = error;
		existing.lastFailureAt = Date.now();
	} else {
		failures.set(name, { count: 1, consecutive: 1, lastError: error, lastFailureAt: Date.now() });
	}
}

function recordIdleDisconnect(name: string) {
	const existing = failures.get(name);
	if (existing) {
		existing.count++;
		existing.lastError = "idle-timeout";
		existing.lastFailureAt = Date.now();
	} else {
		failures.set(name, { count: 1, consecutive: 0, lastError: "idle-timeout", lastFailureAt: Date.now() });
	}
}

function recordSuccess(name: string) {
	const existing = failures.get(name);
	if (existing) existing.consecutive = 0;
}

function isUnhealthy(name: string): boolean {
	const record = failures.get(name);
	return !!record && record.consecutive >= 3;
}

function failureStatusText(name: string): string {
	const record = failures.get(name);
	if (!record || record.count === 0) return "failures: 0";
	const ago = formatTimeAgo(record.lastFailureAt);
	return `${record.count} failures, last: ${record.lastError} ${ago}`;
}

function formatTimeAgo(timestamp: number): string {
	const diff = Math.floor((Date.now() - timestamp) / 1000);
	if (diff < 60) return `${diff}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}min ago`;
	return `${Math.floor(diff / 3600)}h ago`;
}

// --- NPX Cache ---

const NPX_CACHE_PATH = join(homedir(), ".pi", "agent", "state", "mcp-npx-cache.json");
const NPX_CACHE_TTL = 24 * 60 * 60 * 1000;
const MCP_DIGEST_THRESHOLD_CHARS = 12_000;
const MCP_DIGEST_THRESHOLD_LINES = 240;
const MCP_DIGEST_PREVIEW_CHARS = 700;
const MCP_DIGEST_MAX_REFERENCES = 24;

interface NpxCacheData {
	[key: string]: { resolvedAt: number };
}

function loadNpxCache(): NpxCacheData {
	try {
		if (existsSync(NPX_CACHE_PATH)) {
			return JSON.parse(readFileSync(NPX_CACHE_PATH, "utf8"));
		}
	} catch {}
	return {};
}

function saveNpxCache(cache: NpxCacheData) {
	try {
		mkdirSync(dirname(NPX_CACHE_PATH), { recursive: true });
		writeFileSync(NPX_CACHE_PATH, JSON.stringify(cache, null, 2));
	} catch {}
}

function npxCacheKey(args: string[]): string {
	return args.filter((a) => a !== "--prefer-offline").join("|");
}

function applyNpxCache(config: ServerConfig): ServerConfig {
	if (config.command !== "npx") return config;
	const args = config.args ?? [];
	if (!args.includes("-y")) return config;

	const key = npxCacheKey(args);
	const cache = loadNpxCache();
	const entry = cache[key];

	if (entry && Date.now() - entry.resolvedAt < NPX_CACHE_TTL && !args.includes("--prefer-offline")) {
		return { ...config, args: ["--prefer-offline", ...args] };
	}
	return config;
}

function updateNpxCache(config: ServerConfig) {
	if (config.command !== "npx") return;
	const args = config.args ?? [];
	if (!args.includes("-y")) return;

	const key = npxCacheKey(args);
	const cache = loadNpxCache();
	cache[key] = { resolvedAt: Date.now() };
	saveNpxCache(cache);
}

// --- Core ---

const connections = new Map<string, Connection>();
const storedMcpResults = new Map<string, StoredMcpResult>();
let serverConfigs: Record<string, ServerConfig> = {};
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;

const IDLE_TIMEOUT = 10 * 60 * 1000;
const IDLE_CHECK_INTERVAL = 60 * 1000;

function loadConfig(): Record<string, ServerConfig> {
	const paths = [
		join(homedir(), ".claude.json"),
		join(process.cwd(), ".mcp.json"),
		join(homedir(), ".mcp.json"),
	];

	for (const p of paths) {
		if (!existsSync(p)) continue;
		try {
			const data = JSON.parse(readFileSync(p, "utf8"));
			const servers = data.mcpServers ?? data["mcp-servers"] ?? data.mcpservers;
			if (servers && typeof servers === "object") return servers;
		} catch {}
	}
	return {};
}

function baseMcpEnv(): Record<string, string> {
	return {
		...process.env,
		FRAMELINK_TELEMETRY: process.env.FRAMELINK_TELEMETRY ?? "off",
		DO_NOT_TRACK: process.env.DO_NOT_TRACK ?? "1",
	} as Record<string, string>;
}

function expandEnv(env: Record<string, string> | undefined): Record<string, string> {
	const result = baseMcpEnv();
	for (const [k, v] of Object.entries(env ?? {})) {
		result[k] = v.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
	}
	return result;
}

function drainServerStderr(transport: StdioClientTransport) {
	const stderr = transport.stderr;
	if (!stderr) return;
	stderr.on("data", () => {});
	stderr.on("error", () => {});
}

async function connectServer(name: string, config: ServerConfig): Promise<Connection> {
	const existing = connections.get(name);
	if (existing?.status === "connected") return existing;

	const effectiveConfig = applyNpxCache(config);

	const transport = new StdioClientTransport({
		command: effectiveConfig.command,
		args: effectiveConfig.args ?? [],
		env: expandEnv(effectiveConfig.env),
		stderr: "pipe",
	});
	drainServerStderr(transport);

	const client = new Client({ name: `pilee-${name}`, version: "0.1.0" }, { capabilities: {} });

	try {
		await client.connect(transport);
		const { tools } = await client.listTools();
		const conn: Connection = {
			client,
			transport,
			tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as Record<string, unknown> })),
			status: "connected",
			lastUsedAt: Date.now(),
		};
		connections.set(name, conn);
		recordSuccess(name);
		updateNpxCache(config);
		return conn;
	} catch (e) {
		const errorMsg = e instanceof Error ? e.message : String(e);
		const conn: Connection = {
			client,
			transport,
			tools: [],
			status: "error",
			error: errorMsg,
			lastUsedAt: Date.now(),
		};
		connections.set(name, conn);
		recordFailure(name, errorMsg);
		throw e;
	}
}

async function disconnectServer(name: string): Promise<void> {
	const conn = connections.get(name);
	if (!conn) return;
	try {
		await conn.transport.close();
	} catch {}
	conn.status = "disconnected";
	connections.delete(name);
}

async function idleDisconnectServer(name: string): Promise<void> {
	const conn = connections.get(name);
	if (!conn || conn.status !== "connected") return;
	try {
		await conn.transport.close();
	} catch {}
	conn.status = "disconnected";
	recordIdleDisconnect(name);
}

async function disconnectAll(): Promise<void> {
	for (const name of [...connections.keys()]) await disconnectServer(name);
}

function startIdleChecker() {
	if (idleCheckInterval) return;
	idleCheckInterval = setInterval(() => {
		const now = Date.now();
		for (const [name, conn] of connections) {
			if (conn.status === "connected" && now - conn.lastUsedAt > IDLE_TIMEOUT) {
				idleDisconnectServer(name);
			}
		}
	}, IDLE_CHECK_INTERVAL);
}

function stopIdleChecker() {
	if (idleCheckInterval) {
		clearInterval(idleCheckInterval);
		idleCheckInterval = null;
	}
}

function text(msg: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text: msg }], details };
}

function truncateCompact(value: string, maxChars = MCP_DIGEST_PREVIEW_CHARS): string {
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1).trim()}…`;
}

function redactSensitiveForDigest(value: string): string {
	return value
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
		.replace(/("?(?:password|passwd|token|secret|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token)"?\s*[:=]\s*")([^"\n]{4,})(")/gi, "$1[redacted]$3")
		.replace(/((?:password|passwd|token|secret|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)([^\s,}\]]{4,})/gi, "$1[redacted]");
}

function tryParseJson(value: string): unknown | undefined {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	const starts = trimmed.startsWith("{") || trimmed.startsWith("[")
		? [0]
		: [...trimmed.matchAll(/[\[{]/g)].map((match) => match.index ?? -1).filter((index) => index >= 0);
	for (const start of starts) {
		try {
			return JSON.parse(trimmed.slice(start));
		} catch {}
	}
	return undefined;
}

function previewJsonValue(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(truncateCompact(value, 120));
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (Array.isArray(value)) return `[${value.length} items]`;
	if (typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).slice(0, 6).join(", ")}${Object.keys(value as Record<string, unknown>).length > 6 ? ", …" : ""}}`;
	return String(value);
}

const IMPORTANT_JSON_KEYS = new Set([
	"id",
	"key",
	"node_id",
	"issueKey",
	"issue_key",
	"number",
	"title",
	"name",
	"summary",
	"status",
	"state",
	"url",
	"html_url",
	"web_url",
	"created_at",
	"updated_at",
	"author",
	"user",
	"login",
	"email",
]);

function summarizeJsonObject(value: Record<string, unknown>): string {
	const entries = Object.entries(value);
	const important = entries.filter(([key]) => IMPORTANT_JSON_KEYS.has(key)).slice(0, 8);
	const selected = important.length > 0 ? important : entries.slice(0, 6);
	return selected.map(([key, val]) => `${key}=${previewJsonValue(val)}`).join(", ") || "(empty object)";
}

function summarizeJson(value: unknown): string[] {
	if (Array.isArray(value)) {
		const lines = [`JSON array · ${value.length} items`];
		value.slice(0, 10).forEach((item, index) => {
			if (item && typeof item === "object" && !Array.isArray(item)) lines.push(`- [${index}] ${summarizeJsonObject(item as Record<string, unknown>)}`);
			else lines.push(`- [${index}] ${previewJsonValue(item)}`);
		});
		if (value.length > 10) lines.push(`- … 외 ${value.length - 10}개`);
		return lines;
	}
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj);
		const lines = [`JSON object · ${keys.length} keys: ${keys.slice(0, 18).join(", ")}${keys.length > 18 ? ", …" : ""}`];
		const important = Object.entries(obj).filter(([key]) => IMPORTANT_JSON_KEYS.has(key));
		if (important.length > 0) lines.push(`중요 필드: ${important.slice(0, 10).map(([key, val]) => `${key}=${previewJsonValue(val)}`).join(", ")}`);
		for (const [key, val] of Object.entries(obj).slice(0, 8)) {
			if (Array.isArray(val)) lines.push(`- ${key}: array(${val.length})`);
			else if (val && typeof val === "object") lines.push(`- ${key}: object(${Object.keys(val as Record<string, unknown>).length} keys)`);
		}
		return lines;
	}
	return [`JSON scalar: ${previewJsonValue(value)}`];
}


function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
	if (typeof value === "string") return value.trim() || undefined;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return undefined;
}

function readString(record: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
	if (!record) return undefined;
	for (const key of keys) {
		const value = stringValue(record[key]);
		if (value) return value;
	}
	return undefined;
}

function compactLine(value: string, maxChars = 240): string {
	return truncateCompact(redactSensitiveForDigest(value), maxChars);
}

function richTextToPlain(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		return value.map((item) => {
			if (typeof item === "string") return item;
			if (!isRecord(item)) return "";
			return readString(item, "plain_text", "content", "text", "name")
				?? (isRecord(item.text) ? readString(item.text, "content", "plain_text") : undefined)
				?? "";
		}).filter(Boolean).join("");
	}
	if (isRecord(value)) {
		return readString(value, "plain_text", "content", "text", "name")
			?? (isRecord(value.text) ? readString(value.text, "content", "plain_text") : undefined)
			?? "";
	}
	return "";
}

function adfToPlain(value: unknown): string {
	const parts: string[] = [];
	const visit = (node: unknown) => {
		if (typeof node === "string") return;
		if (Array.isArray(node)) {
			for (const item of node) visit(item);
			return;
		}
		if (!isRecord(node)) return;
		const text = readString(node, "text");
		if (text) parts.push(text);
		if (Array.isArray(node.content)) visit(node.content);
	};
	visit(value);
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

function genericValueToText(value: unknown): string {
	const direct = stringValue(value);
	if (direct) return direct;
	const rich = richTextToPlain(value);
	if (rich) return rich;
	const adf = adfToPlain(value);
	if (adf) return adf;
	if (Array.isArray(value)) return value.map(genericValueToText).filter(Boolean).join(", ");
	if (isRecord(value)) {
		return readString(value, "displayName", "display_name", "real_name", "username", "name", "key", "id") ?? "";
	}
	return "";
}

function collectRecords(value: unknown, predicate: (record: Record<string, unknown>) => boolean, depth = 0, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
	if (out.length >= 500 || depth > 5) return out;
	if (Array.isArray(value)) {
		for (const item of value) collectRecords(item, predicate, depth + 1, out);
		return out;
	}
	if (!isRecord(value)) return out;
	if (predicate(value)) out.push(value);
	for (const child of Object.values(value)) collectRecords(child, predicate, depth + 1, out);
	return out;
}

function sourceHint(args: { server: string; tool: string }): string {
	return `${args.server} ${args.tool}`.toLowerCase();
}

function formatMaybeTime(value: unknown): string | undefined {
	const raw = stringValue(value);
	if (!raw) return undefined;
	if (/^\d{10}(?:\.\d+)?$/.test(raw)) {
		const date = new Date(Number.parseFloat(raw) * 1000);
		if (Number.isFinite(date.getTime())) return `${date.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")} (${raw})`;
	}
	const parsed = Date.parse(raw);
	if (Number.isFinite(parsed)) return new Date(parsed).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
	return raw;
}

function looksLikeSlackMessage(record: Record<string, unknown>): boolean {
	return typeof record.text === "string"
		&& !!(record.ts || record.thread_ts || record.user || record.username || record.user_name || record.bot_id || record.channel);
}

function slackActor(message: Record<string, unknown>): string {
	return readString(message, "user_name", "username", "real_name", "name", "user", "bot_id")
		?? (isRecord(message.user_profile) ? readString(message.user_profile, "real_name", "display_name", "name") : undefined)
		?? (isRecord(message.bot_profile) ? readString(message.bot_profile, "name") : undefined)
		?? "unknown";
}

function slackAttachmentLines(message: Record<string, unknown>): string[] {
	const lines: string[] = [];
	const files = Array.isArray(message.files) ? message.files : [];
	for (const file of files.slice(0, 5)) {
		if (!isRecord(file)) continue;
		const title = readString(file, "title", "name", "filename", "id") ?? "file";
		const url = readString(file, "url_private", "permalink", "url");
		lines.push(`  - 파일: ${title}${url ? ` · ${url}` : ""}`);
	}
	const attachments = Array.isArray(message.attachments) ? message.attachments : [];
	for (const attachment of attachments.slice(0, 5)) {
		if (!isRecord(attachment)) continue;
		const title = readString(attachment, "title", "fallback", "text");
		if (title) lines.push(`  - 첨부: ${compactLine(title, 180)}`);
	}
	return lines;
}

function renderSlackSummary(parsed: unknown, args: { server: string; tool: string }): string[] | undefined {
	const hint = sourceHint(args);
	const messages = collectRecords(parsed, looksLikeSlackMessage);
	if (!hint.includes("slack") && messages.length === 0) return undefined;
	const root = isRecord(parsed) ? parsed : undefined;
	const channel = readString(root, "channel_name", "channel", "channel_id") ?? readString(messages[0], "channel_name", "channel", "channel_id");
	const threadTs = readString(root, "thread_ts", "ts") ?? readString(messages[0], "thread_ts");
	const participants = [...new Set(messages.map(slackActor).filter(Boolean))];
	const times = messages.map((msg) => formatMaybeTime(msg.ts)).filter((time): time is string => !!time);
	const lines = ["💬 Slack 결과 확인", ""];
	lines.push(`메시지: ${messages.length.toLocaleString()}개`);
	if (channel) lines.push(`채널: ${channel}`);
	if (threadTs) lines.push(`thread_ts: ${threadTs}`);
	if (participants.length > 0) lines.push(`참여자: ${participants.slice(0, 20).join(", ")}${participants.length > 20 ? ` 외 ${participants.length - 20}명` : ""}`);
	if (times.length > 0) lines.push(`시간 범위: ${times[0]}${times.length > 1 ? ` → ${times[times.length - 1]}` : ""}`);
	if (messages.length === 0) return lines;
	lines.push("", "## 대화 스레드");
	messages.forEach((message, index) => {
		const time = formatMaybeTime(message.ts) ?? `#${index + 1}`;
		const text = compactLine(String(message.text ?? ""), 1200);
		lines.push(`[${time}] ${slackActor(message)}`);
		lines.push(text || "(본문 없음)");
		lines.push(...slackAttachmentLines(message));
		lines.push("");
	});
	return lines.filter((line, index, arr) => !(line === "" && arr[index - 1] === ""));
}

function looksLikeNotionPage(record: Record<string, unknown>): boolean {
	return record.object === "page" || (!!record.properties && (!!record.last_edited_time || !!record.created_time || typeof record.url === "string"));
}

function looksLikeNotionBlock(record: Record<string, unknown>): boolean {
	if (record.object === "block") return true;
	return ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "callout", "child_page"].some((key) => isRecord(record[key]));
}

function notionPropertyToText(property: unknown): string {
	if (!isRecord(property)) return genericValueToText(property);
	const type = stringValue(property.type);
	if (type && property[type] !== undefined) {
		const typed = property[type];
		if (type === "title" || type === "rich_text") return richTextToPlain(typed);
		if (type === "select" || type === "status") return isRecord(typed) ? readString(typed, "name") ?? "" : genericValueToText(typed);
		if (type === "multi_select" && Array.isArray(typed)) return typed.map((item) => isRecord(item) ? readString(item, "name") : undefined).filter(Boolean).join(", ");
		if (type === "date" && isRecord(typed)) return [readString(typed, "start"), readString(typed, "end")].filter(Boolean).join(" → ");
		if (type === "people" && Array.isArray(typed)) return typed.map((item) => isRecord(item) ? readString(item, "name", "id") : undefined).filter(Boolean).join(", ");
		if (type === "relation" && Array.isArray(typed)) return `${typed.length} relations`;
		if (type === "formula" && isRecord(typed)) return genericValueToText(typed[readString(typed, "type") ?? ""] ?? typed);
		return genericValueToText(typed);
	}
	return genericValueToText(property);
}

function notionPageTitle(page: Record<string, unknown>): string {
	const properties = isRecord(page.properties) ? page.properties : undefined;
	if (properties) {
		for (const [key, property] of Object.entries(properties)) {
			if (isRecord(property) && property.type === "title") return notionPropertyToText(property) || key;
		}
		const name = properties.Name ?? properties.name ?? properties.Title ?? properties.title;
		const text = notionPropertyToText(name);
		if (text) return text;
	}
	return readString(page, "title", "name", "id") ?? "Untitled";
}

function notionBlockText(block: Record<string, unknown>): string {
	const type = readString(block, "type") ?? ["paragraph", "heading_1", "heading_2", "heading_3", "bulleted_list_item", "numbered_list_item", "to_do", "quote", "callout", "child_page"].find((key) => isRecord(block[key]));
	if (!type) return "";
	const body = isRecord(block[type]) ? block[type] as Record<string, unknown> : undefined;
	if (!body) return "";
	if (type === "child_page") return readString(body, "title") ?? "";
	return richTextToPlain(body.rich_text) || readString(body, "text", "caption") || "";
}

function renderNotionSummary(parsed: unknown, args: { server: string; tool: string }): string[] | undefined {
	const hint = sourceHint(args);
	const pages = collectRecords(parsed, looksLikeNotionPage);
	const blocks = collectRecords(parsed, looksLikeNotionBlock);
	if (!hint.includes("notion") && pages.length === 0 && blocks.length === 0) return undefined;
	const lines = ["📝 Notion 결과 확인", ""];
	lines.push(`페이지: ${pages.length.toLocaleString()}개 / 블록: ${blocks.length.toLocaleString()}개`);
	if (pages.length === 1) {
		const page = pages[0];
		lines.push(`제목: ${notionPageTitle(page)}`);
		const url = readString(page, "url", "public_url");
		if (url) lines.push(`URL: ${url}`);
		const edited = formatMaybeTime(page.last_edited_time);
		if (edited) lines.push(`최종 수정: ${edited}`);
		const properties = isRecord(page.properties) ? page.properties : undefined;
		if (properties) {
			lines.push("", "## 주요 속성");
			for (const [key, property] of Object.entries(properties).slice(0, 18)) {
				const value = notionPropertyToText(property);
				if (value) lines.push(`- ${key}: ${compactLine(value, 220)}`);
			}
		}
	} else if (pages.length > 1) {
		lines.push("", "## 페이지 목록");
		for (const page of pages.slice(0, 40)) {
			const edited = formatMaybeTime(page.last_edited_time);
			const url = readString(page, "url", "public_url");
			lines.push(`- ${notionPageTitle(page)}${edited ? ` · ${edited}` : ""}${url ? ` · ${url}` : ""}`);
		}
		if (pages.length > 40) lines.push(`- … 외 ${pages.length - 40}개`);
	}
	if (blocks.length > 0) {
		lines.push("", "## 본문/블록 preview");
		for (const block of blocks.slice(0, 40)) {
			const text = notionBlockText(block);
			if (text) lines.push(`- ${compactLine(text, 320)}`);
		}
		if (blocks.length > 40) lines.push(`- … 외 ${blocks.length - 40}개 블록`);
	}
	return lines;
}

function looksLikeJiraIssue(record: Record<string, unknown>): boolean {
	return !!(record.key || record.issueKey || record.issue_key) && (isRecord(record.fields) || !!record.summary || !!record.status);
}

function collectJiraIssues(parsed: unknown): Record<string, unknown>[] {
	const issues = collectRecords(parsed, looksLikeJiraIssue);
	const seen = new Set<string>();
	return issues.filter((issue) => {
		const key = readString(issue, "key", "issueKey", "issue_key") ?? JSON.stringify(issue).slice(0, 80);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function jiraPerson(value: unknown): string {
	return isRecord(value) ? readString(value, "displayName", "name", "emailAddress", "accountId") ?? "" : genericValueToText(value);
}

function jiraStatus(value: unknown): string {
	return isRecord(value) ? readString(value, "name", "statusCategory") ?? genericValueToText(value) : genericValueToText(value);
}

function jiraDescription(value: unknown): string {
	if (typeof value === "string") return value;
	return adfToPlain(value) || genericValueToText(value);
}

function renderJiraSummary(parsed: unknown, args: { server: string; tool: string }): string[] | undefined {
	const hint = sourceHint(args);
	const issues = collectJiraIssues(parsed);
	if (!/jira|atlassian/.test(hint) && issues.length === 0) return undefined;
	const lines = ["🎫 Jira 결과 확인", ""];
	lines.push(`이슈: ${issues.length.toLocaleString()}개`);
	if (issues.length === 0) return lines;
	lines.push("", "## 이슈 목록");
	for (const issue of issues.slice(0, 40)) {
		const fields = isRecord(issue.fields) ? issue.fields : issue;
		const key = readString(issue, "key", "issueKey", "issue_key") ?? readString(fields, "key") ?? "UNKNOWN";
		const summary = readString(fields, "summary", "title", "name") ?? readString(issue, "summary", "title", "name") ?? "(summary 없음)";
		const status = jiraStatus(fields.status ?? issue.status);
		const assignee = jiraPerson(fields.assignee ?? issue.assignee);
		const reporter = jiraPerson(fields.reporter ?? issue.reporter ?? fields.creator);
		const url = readString(issue, "url", "self", "web_url", "html_url") ?? readString(fields, "url", "self");
		lines.push(`- ${key}: ${summary}${status ? ` · ${status}` : ""}${assignee ? ` · 담당 ${assignee}` : ""}${reporter ? ` · 보고 ${reporter}` : ""}${url ? ` · ${url}` : ""}`);
		const description = jiraDescription(fields.description ?? issue.description);
		if (description && issues.length <= 5) lines.push(`  - 설명: ${compactLine(description, 420)}`);
	}
	if (issues.length > 40) lines.push(`- … 외 ${issues.length - 40}개`);
	return lines;
}

function buildHumanMcpSummary(args: { server: string; tool: string; action: string; output: string; parsed: unknown | undefined }): string[] | undefined {
	if (args.parsed === undefined) return undefined;
	return renderSlackSummary(args.parsed, args)
		?? renderNotionSummary(args.parsed, args)
		?? renderJiraSummary(args.parsed, args);
}

function shouldReturnDigest(args: { action: string; output: string }): boolean {
	if (tryParseJson(args.output) !== undefined) return true;
	return shouldDigestMcpOutput(args.output);
}

function extractImportantReferences(output: string): string[] {
	const refs = new Set<string>();
	const redacted = redactSensitiveForDigest(output);
	const urlMatches = redacted.match(/https?:\/\/[^\s)"'<>]+/g) ?? [];
	for (const url of urlMatches.slice(0, MCP_DIGEST_MAX_REFERENCES)) refs.add(`URL: ${truncateCompact(url, 180)}`);
	const ticketMatches = redacted.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [];
	for (const key of ticketMatches.slice(0, MCP_DIGEST_MAX_REFERENCES)) refs.add(`key: ${key}`);
	for (const line of redacted.split(/\r?\n/)) {
		if (refs.size >= MCP_DIGEST_MAX_REFERENCES) break;
		const trimmed = line.trim();
		if (trimmed.startsWith("{") || trimmed.startsWith("[")) continue;
		if (/\b(id|key|number|title|name|status|state|url|html_url|web_url)\b/i.test(trimmed)) refs.add(truncateCompact(trimmed, 220));
	}
	return [...refs].slice(0, MCP_DIGEST_MAX_REFERENCES);
}

function firstLastLinePreview(output: string): string[] {
	const lines = redactSensitiveForDigest(output).split(/\r?\n/).filter((line) => line.trim().length > 0);
	if (lines.length <= 12) return lines.map((line) => truncateCompact(line, 220));
	return [
		...lines.slice(0, 6).map((line) => truncateCompact(line, 220)),
		`… 중간 ${Math.max(0, lines.length - 12)}줄 생략 …`,
		...lines.slice(-6).map((line) => truncateCompact(line, 220)),
	];
}

function shouldDigestMcpOutput(output: string): boolean {
	if (output.length > MCP_DIGEST_THRESHOLD_CHARS) return true;
	return output.split(/\r?\n/).length > MCP_DIGEST_THRESHOLD_LINES;
}

function buildMcpDigest(args: { responseId: string; server: string; tool: string; action: string; output: string }): string {
	const parsed = tryParseJson(args.output);
	const lines: string[] = [
		"🔌 MCP 결과 — digest-first",
		`server: ${args.server}`,
		`tool: ${args.tool}`,
		`action: ${args.action}`,
		`responseId: ${args.responseId}`,
		`원문 크기: ${args.output.length.toLocaleString()} chars / ${args.output.split(/\r?\n/).length.toLocaleString()} lines`,
		"",
		"## 요약",
	];
	const humanSummary = buildHumanMcpSummary({ ...args, parsed });
	if (humanSummary) lines.push(...humanSummary);
	else if (parsed !== undefined) lines.push(...summarizeJson(parsed));
	else lines.push(...firstLastLinePreview(args.output).map((line) => `- ${line}`));
	const refs = extractImportantReferences(args.output);
	if (refs.length > 0) {
		lines.push("", "## 보존한 식별자/URL preview");
		for (const ref of refs) lines.push(`- ${ref}`);
	}
	lines.push("", "원문은 대화 context에 넣지 않고 내부에 보존했습니다.");
	lines.push(`필요 시: get_mcp_content(responseId="${args.responseId}")`);
	return lines.join("\n").trim();
}

function formatMcpOutput(args: {
	server: string;
	tool: string;
	action: string;
	output: string;
	rawData: unknown;
	args?: Record<string, unknown>;
}): McpFormattedResult {
	if (!shouldReturnDigest({ action: args.action, output: args.output })) {
		return { text: args.output || "(empty response)", details: { mcpDigest: false, server: args.server, tool: args.tool, action: args.action } };
	}
	const responseId = `mcp_${randomUUID().slice(0, 8)}`;
	const digest = buildMcpDigest({ responseId, server: args.server, tool: args.tool, action: args.action, output: args.output });
	storedMcpResults.set(responseId, {
		id: responseId,
		server: args.server,
		tool: args.tool,
		action: args.action,
		args: args.args,
		timestamp: Date.now(),
		output: args.output,
		rawData: args.rawData,
	});
	return {
		text: digest,
		details: {
			mcpDigest: true,
			responseId,
			server: args.server,
			tool: args.tool,
			action: args.action,
			originalChars: args.output.length,
		},
	};
}

export function __buildMcpDigestForTesting(args: { server: string; tool: string; action?: string; output: string }): string {
	return buildMcpDigest({ responseId: "mcp_test", server: args.server, tool: args.tool, action: args.action ?? "call", output: args.output });
}

export function __formatMcpOutputForTesting(args: { server: string; tool: string; action?: string; output: string; rawData?: unknown }): McpFormattedResult {
	return formatMcpOutput({ server: args.server, tool: args.tool, action: args.action ?? "call", output: args.output, rawData: args.rawData ?? args.output });
}

export function __shouldReturnDigestForTesting(args: { action?: string; output: string }): boolean {
	return shouldReturnDigest({ action: args.action ?? "call", output: args.output });
}

function statusText(): string {
	const configured = Object.keys(serverConfigs);
	if (configured.length === 0) return "No MCP servers configured.";

	const lines: string[] = ["MCP Servers:"];
	for (const name of configured) {
		const conn = connections.get(name);
		const failInfo = failureStatusText(name);
		const unhealthy = isUnhealthy(name) ? " [unhealthy]" : "";
		if (!conn) {
			lines.push(`  ${name}: not connected${unhealthy} | ${failInfo}`);
		} else if (conn.status === "error") {
			lines.push(`  ${name}: error — ${conn.error}${unhealthy} | ${failInfo}`);
		} else if (conn.status === "disconnected") {
			lines.push(`  ${name}: disconnected (idle)${unhealthy} | ${failInfo}`);
		} else {
			lines.push(`  ${name}: connected (${conn.tools.length} tools) | ${failInfo}`);
		}
	}
	return lines.join("\n");
}

function listTools(server?: string): string {
	if (server) {
		const conn = connections.get(server);
		if (!conn) return `Server "${server}" not connected. Use action:"connect" first.`;
		return conn.tools.map((t) => `  ${t.name} — ${t.description ?? "(no description)"}`).join("\n") || "No tools.";
	}
	const lines: string[] = [];
	for (const [name, conn] of connections) {
		if (conn.status !== "connected" && conn.status !== "disconnected") continue;
		if (conn.tools.length === 0) continue;
		lines.push(`[${name}]${conn.status === "disconnected" ? " (idle — will reconnect on use)" : ""}`);
		for (const t of conn.tools) lines.push(`  ${t.name} — ${t.description ?? ""}`);
	}
	return lines.join("\n") || "No connected servers.";
}

function describeTool(toolName?: string): string {
	if (!toolName) return "Tool name is required.";
	for (const [server, conn] of connections) {
		const tool = conn.tools.find((t) => t.name === toolName);
		if (tool) {
			return [
				`Tool: ${tool.name}`,
				`Server: ${server}`,
				`Description: ${tool.description ?? "(none)"}`,
				`Input schema:`,
				JSON.stringify(tool.inputSchema ?? {}, null, 2),
			].join("\n");
		}
	}
	return `Tool "${toolName}" not found in any connected server.`;
}

function searchTools(query?: string): string {
	if (!query) return "Query is required.";
	const q = query.toLowerCase();
	const results: string[] = [];
	for (const [server, conn] of connections) {
		for (const t of conn.tools) {
			if (t.name.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)) {
				results.push(`  [${server}] ${t.name} — ${t.description ?? ""}`);
			}
		}
	}
	return results.length > 0 ? results.join("\n") : `No tools matching "${query}".`;
}

function findToolServer(toolName: string, preferredServer?: string): { server: string; conn: Connection } | null {
	if (preferredServer) {
		const conn = connections.get(preferredServer);
		if (conn?.tools.some((t) => t.name === toolName)) return { server: preferredServer, conn };
	}
	for (const [server, conn] of connections) {
		if (conn.tools.some((t) => t.name === toolName)) return { server, conn };
	}
	return null;
}

async function callTool(toolName: string, args?: Record<string, unknown>, preferredServer?: string): Promise<McpFormattedResult> {
	const found = findToolServer(toolName, preferredServer);
	if (!found) return { text: `Tool "${toolName}" not found. Use action:"status" or action:"list" to see available tools.` };

	if (found.conn.status === "disconnected") {
		const config = serverConfigs[found.server];
		if (!config) return { text: `Server "${found.server}" config not found, cannot auto-reconnect.` };
		try {
			const reconnected = await connectServer(found.server, config);
			found.conn = reconnected;
		} catch (e) {
			return { text: `Auto-reconnect to "${found.server}" failed: ${e instanceof Error ? e.message : e}` };
		}
	}

	found.conn.lastUsedAt = Date.now();

	try {
		const result = await found.conn.client.callTool({ name: toolName, arguments: args ?? {} });
		const content = Array.isArray((result as any).content) ? (result as any).content as Array<{ type: string; text?: string }> : [];
		const parts = content
			.filter((c) => c.type === "text" && c.text)
			.map((c) => c.text!);
		const nonText = content
			.filter((c) => c.type !== "text")
			.map((c) => `[${c.type} content stored in raw json]`);
		const output = [...parts, ...nonText].join("\n") || "(empty response)";
		recordSuccess(found.server);
		return formatMcpOutput({
			server: found.server,
			tool: toolName,
			action: "call",
			output,
			rawData: { result, arguments: args ?? {} },
			args,
		});
	} catch (e) {
		const errorMsg = e instanceof Error ? e.message : String(e);
		recordFailure(found.server, errorMsg);
		return formatMcpOutput({
			server: found.server,
			tool: toolName,
			action: "call-error",
			output: `Error calling ${toolName}: ${errorMsg}`,
			rawData: { error: errorMsg, arguments: args ?? {} },
			args,
		});
	}
}

export default function (pi: ExtensionAPI) {
	serverConfigs = loadConfig();

	const DESCRIPTION = [
		"MCP proxy: call external tools on MCP servers.",
		"Examples:",
		'  status: {action:"status"}',
		'  list tools: {action:"list", server:"myserver"}',
		'  call tool: {action:"call", tool:"jira_search", args:\'{"jql":"project=X"}\'}',
		'  search: {action:"search", query:"jira"}',
		'  describe: {action:"describe", tool:"jira_search"}',
		'  connect: {action:"connect", server:"myserver"}',
	].join("\n");

	pi.registerTool({
		name: "mcp",
		label: "MCP",
		description: DESCRIPTION,
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("call"),
				Type.Literal("list"),
				Type.Literal("describe"),
				Type.Literal("search"),
				Type.Literal("status"),
				Type.Literal("connect"),
			]),
			tool: Type.Optional(Type.String({ description: "Tool name (for call/describe)" })),
			args: Type.Optional(Type.String({ description: 'Tool arguments as JSON string, e.g. {"jql":"project=X"}' })),
			server: Type.Optional(Type.String({ description: "Target server (for list/connect/call)" })),
			query: Type.Optional(Type.String({ description: "Search query (for search)" })),
		}),
		async execute(_id, params) {
			switch (params.action) {
				case "status":
					return text(statusText());
				case "list": {
					const result = formatMcpOutput({ server: params.server ?? "all", tool: "list", action: "list", output: listTools(params.server), rawData: { server: params.server } });
					return text(result.text, result.details);
				}
				case "describe": {
					const result = formatMcpOutput({ server: "all", tool: params.tool ?? "describe", action: "describe", output: describeTool(params.tool), rawData: { tool: params.tool } });
					return text(result.text, result.details);
				}
				case "search": {
					const result = formatMcpOutput({ server: "all", tool: "search", action: "search", output: searchTools(params.query), rawData: { query: params.query } });
					return text(result.text, result.details);
				}
				case "connect": {
					const name = params.server;
					if (!name) return text('Server name is required. Use action:"status" to see available servers.');
					const config = serverConfigs[name];
					if (!config) return text(`Server "${name}" not found in config. Available: ${Object.keys(serverConfigs).join(", ")}`);
					try {
						const conn = await connectServer(name, config);
						return text(`Connected to "${name}" — ${conn.tools.length} tools available.`);
					} catch (e) {
						return text(`Failed to connect to "${name}": ${e instanceof Error ? e.message : e}`);
					}
				}
				case "call": {
					if (!params.tool) return text("Tool name is required for call action.");
					let args: Record<string, unknown> | undefined;
					if (params.args) {
						try {
							args = typeof params.args === "object" ? (params.args as any) : JSON.parse(params.args);
						} catch {
							return text(`Invalid JSON in args: ${params.args}`);
						}
					}
					const result = await callTool(params.tool, args, params.server);
					return text(result.text, result.details);
				}
			}
		},
	});

	pi.registerTool({
		name: "get_mcp_content",
		label: "Get MCP Content",
		description: "Retrieve full content from a digest-first MCP result in the current session.",
		parameters: Type.Object({
			responseId: Type.String({ description: "The responseId returned by a digest-first MCP result, e.g. mcp_ab12cd34" }),
		}),
		async execute(_id, params) {
			const stored = storedMcpResults.get(params.responseId);
			if (!stored) return text(`No stored MCP result for responseId "${params.responseId}". MCP 원문은 현재 세션 메모리에만 보존됩니다.`);
			const lines = [
				`MCP full content`,
				`responseId: ${stored.id}`,
				`server: ${stored.server}`,
				`tool: ${stored.tool}`,
				`action: ${stored.action}`,
				"",
				stored.output,
			].filter(Boolean);
			return text(lines.join("\n"), {
				responseId: stored.id,
				server: stored.server,
				tool: stored.tool,
				action: stored.action,
			});
		},
	});

	// Auto-connect on session start (skip unhealthy servers)
	pi.on("session_start", async (_event, ctx) => {
		serverConfigs = loadConfig();
		failures.clear();
		const names = Object.keys(serverConfigs);
		if (names.length === 0) return;

		let connected = 0;
		let failed = 0;
		let skipped = 0;
		for (const name of names) {
			if (isUnhealthy(name)) {
				skipped++;
				continue;
			}
			try {
				await connectServer(name, serverConfigs[name]);
				connected++;
			} catch {
				failed++;
			}
		}

		startIdleChecker();

		if (ctx.hasUI) {
			const toolCount = [...connections.values()].reduce((sum, c) => sum + c.tools.length, 0);
			if (failed > 0 || skipped > 0) {
				const parts = [`${connected}/${names.length} servers connected`, `${toolCount} tools`];
				if (failed > 0) parts.push(`${failed} failed`);
				if (skipped > 0) parts.push(`${skipped} unhealthy skipped`);
				ctx.ui.notify(`MCP: ${parts.join(", ")}`, "warning");
			} else if (connected > 0) {
				ctx.ui.setStatus("mcp", `MCP ${connected}/${names.length} · ${toolCount} tools`);
			}
		}
	});

	// /mcp command
	pi.registerCommand("mcp", {
		description: "MCP server status and management",
		handler: async (args, ctx) => {
			const sub = args.trim().split(" ")[0] ?? "";
			if (sub === "reconnect") {
				const name = args.trim().split(" ")[1];
				if (name) {
					await disconnectServer(name);
					const config = serverConfigs[name];
					if (config) {
						try {
							await connectServer(name, config);
							ctx.ui.notify(`Reconnected to "${name}"`, "info");
						} catch (e) {
							ctx.ui.notify(`Failed to reconnect "${name}": ${e instanceof Error ? e.message : e}`, "error");
						}
					}
				} else {
					await disconnectAll();
					for (const [n, c] of Object.entries(serverConfigs)) {
						try {
							await connectServer(n, c);
						} catch {}
					}
					ctx.ui.notify("Reconnected all servers", "info");
				}
			} else if (sub === "disconnect") {
				const name = args.trim().split(" ")[1];
				if (name) {
					await disconnectServer(name);
					ctx.ui.notify(`Disconnected "${name}"`, "info");
				}
			} else {
				ctx.ui.notify(statusText(), "info");
			}
		},
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async () => {
		stopIdleChecker();
		storedMcpResults.clear();
		await disconnectAll();
	});
}
