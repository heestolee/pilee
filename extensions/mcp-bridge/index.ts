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
	artifactPath?: string;
	rawJsonPath?: string;
	fullTextPath?: string;
}

interface McpArtifactRef {
	path: string;
	rawJsonPath: string;
	fullTextPath: string;
	openCommand: string;
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
const MCP_ARTIFACT_DIR = join(homedir(), "Documents", "agent-history", "mcp");
const MCP_RESULT_SIGNATURE = "MCP Result";
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

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/https?:\/\//g, "")
		.replace(/[^a-z0-9가-힣_-]+/gi, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 72) || "mcp";
}

function pathSegment(value: string): string {
	return slugify(value).replace(/\.+/g, "-") || "mcp";
}

function quoteArchivePath(filePath: string): string {
	return `/archive "${filePath.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function truncateCompact(value: string, maxChars = MCP_DIGEST_PREVIEW_CHARS): string {
	const text = value.replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1).trim()}…`;
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function redactSensitiveForDigest(value: string): string {
	return value
		.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [redacted]")
		.replace(/("?(?:password|passwd|token|secret|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token)"?\s*[:=]\s*")([^"\n]{4,})(")/gi, "$1[redacted]$3")
		.replace(/((?:password|passwd|token|secret|authorization|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)([^\s,}\]]{4,})/gi, "$1[redacted]");
}

function tryParseJson(value: string): unknown | undefined {
	const trimmed = value.trim();
	if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) return undefined;
	try {
		return JSON.parse(trimmed);
	} catch {
		return undefined;
	}
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

function extractImportantReferences(output: string): string[] {
	const refs = new Set<string>();
	const redacted = redactSensitiveForDigest(output);
	const urlMatches = redacted.match(/https?:\/\/[^\s)"'<>]+/g) ?? [];
	for (const url of urlMatches.slice(0, MCP_DIGEST_MAX_REFERENCES)) refs.add(`URL: ${truncateCompact(url, 180)}`);
	const ticketMatches = redacted.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? [];
	for (const key of ticketMatches.slice(0, MCP_DIGEST_MAX_REFERENCES)) refs.add(`key: ${key}`);
	for (const line of redacted.split(/\r?\n/)) {
		if (refs.size >= MCP_DIGEST_MAX_REFERENCES) break;
		if (/\b(id|key|number|title|name|status|state|url|html_url|web_url)\b/i.test(line)) refs.add(truncateCompact(line, 220));
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

function buildMcpArtifactHtml(args: {
	responseId: string;
	server: string;
	tool: string;
	action: string;
	output: string;
	digest: string;
	createdAt: Date;
}): string {
	return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${MCP_RESULT_SIGNATURE} — ${escapeHtml(args.server)} / ${escapeHtml(args.tool)}</title>
<style>
	:root { color-scheme: light dark; --bg:#111827; --panel:#1f2937; --panel2:#0f172a; --text:#f9fafb; --muted:#9ca3af; --line:#374151; --accent:#a78bfa; }
	body { margin:0; padding:28px; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
	main { max-width:1080px; margin:0 auto; }
	header { border-bottom:1px solid var(--line); margin-bottom:24px; padding-bottom:18px; }
	h1 { margin:0 0 8px; font-size:28px; }
	.meta { display:flex; flex-wrap:wrap; gap:8px; color:var(--muted); font-size:13px; }
	.badge { border:1px solid var(--line); border-radius:999px; padding:4px 9px; background:rgba(255,255,255,.04); }
	section { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:20px; margin-bottom:18px; }
	pre { white-space:pre-wrap; overflow:auto; background:var(--panel2); border:1px solid var(--line); border-radius:12px; padding:16px; line-height:1.55; }
	details summary { cursor:pointer; color:var(--accent); font-weight:700; }
</style>
</head>
<body>
<main>
<header>
	<h1>${MCP_RESULT_SIGNATURE}</h1>
	<div class="meta">
		<span class="badge">${escapeHtml(args.createdAt.toLocaleString())}</span>
		<span class="badge">server=${escapeHtml(args.server)}</span>
		<span class="badge">tool=${escapeHtml(args.tool)}</span>
		<span class="badge">action=${escapeHtml(args.action)}</span>
		<span class="badge">responseId=${escapeHtml(args.responseId)}</span>
	</div>
</header>
<section>
	<h2>Digest returned to Pi</h2>
	<pre>${escapeHtml(args.digest)}</pre>
</section>
<section>
	<details open>
		<summary>Full MCP text output</summary>
		<pre>${escapeHtml(args.output)}</pre>
	</details>
</section>
</main>
</body>
</html>`;
}

function writeMcpArtifact(args: {
	responseId: string;
	server: string;
	tool: string;
	action: string;
	output: string;
	digest: string;
	rawData: unknown;
}): McpArtifactRef | undefined {
	try {
		const createdAt = new Date();
		const timestamp = createdAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const dir = join(MCP_ARTIFACT_DIR, pathSegment(args.server), pathSegment(args.tool));
		const baseName = `${timestamp}_${args.responseId}_${slugify(`${args.server}-${args.tool}`)}`;
		const rawDir = join(dir, `${baseName}.raw`);
		mkdirSync(rawDir, { recursive: true });
		const rawJsonPath = join(rawDir, "raw.json");
		const fullTextPath = join(rawDir, "full.txt");
		const htmlPath = join(dir, `${baseName}.html`);
		writeFileSync(rawJsonPath, `${safeStringify(args.rawData)}\n`, "utf8");
		writeFileSync(fullTextPath, args.output.endsWith("\n") ? args.output : `${args.output}\n`, "utf8");
		writeFileSync(htmlPath, buildMcpArtifactHtml({ ...args, createdAt }), "utf8");
		return { path: htmlPath, rawJsonPath, fullTextPath, openCommand: quoteArchivePath(htmlPath) };
	} catch {
		return undefined;
	}
}

function artifactLines(artifact: McpArtifactRef | undefined): string[] {
	if (!artifact) return ["원문 artifact 저장 실패: 이번 세션의 get_mcp_content로만 원문을 재조회할 수 있습니다."];
	return [
		`원문 artifact: ${artifact.openCommand}`,
		`raw json: ${artifact.rawJsonPath}`,
		`full text: ${artifact.fullTextPath}`,
	];
}

function rewriteMcpArtifactDigest(args: {
	artifact: McpArtifactRef | undefined;
	responseId: string;
	server: string;
	tool: string;
	action: string;
	output: string;
	digest: string;
}) {
	if (!args.artifact) return;
	try {
		writeFileSync(args.artifact.path, buildMcpArtifactHtml({ ...args, createdAt: new Date() }), "utf8");
	} catch {}
}

function buildMcpDigest(args: { responseId: string; server: string; tool: string; action: string; output: string; artifact?: McpArtifactRef }): string {
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
	if (parsed !== undefined) lines.push(...summarizeJson(parsed));
	else lines.push(...firstLastLinePreview(args.output).map((line) => `- ${line}`));
	const refs = extractImportantReferences(args.output);
	if (refs.length > 0) {
		lines.push("", "## 보존한 식별자/URL preview");
		for (const ref of refs) lines.push(`- ${ref}`);
	}
	lines.push("", "원문은 대화 context에 넣지 않고 artifact로 저장했습니다.");
	lines.push(...artifactLines(args.artifact));
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
	if (!shouldDigestMcpOutput(args.output)) {
		return { text: args.output || "(empty response)", details: { mcpDigest: false, server: args.server, tool: args.tool, action: args.action } };
	}
	const responseId = `mcp_${randomUUID().slice(0, 8)}`;
	const placeholderDigest = buildMcpDigest({ responseId, server: args.server, tool: args.tool, action: args.action, output: args.output });
	const artifact = writeMcpArtifact({ ...args, responseId, digest: placeholderDigest });
	const digest = buildMcpDigest({ responseId, server: args.server, tool: args.tool, action: args.action, output: args.output, artifact });
	rewriteMcpArtifactDigest({ artifact, responseId, server: args.server, tool: args.tool, action: args.action, output: args.output, digest });
	storedMcpResults.set(responseId, {
		id: responseId,
		server: args.server,
		tool: args.tool,
		action: args.action,
		args: args.args,
		timestamp: Date.now(),
		output: args.output,
		rawData: args.rawData,
		artifactPath: artifact?.path,
		rawJsonPath: artifact?.rawJsonPath,
		fullTextPath: artifact?.fullTextPath,
	});
	return {
		text: digest,
		details: {
			mcpDigest: true,
			responseId,
			server: args.server,
			tool: args.tool,
			action: args.action,
			artifactPath: artifact?.path,
			rawJsonPath: artifact?.rawJsonPath,
			fullTextPath: artifact?.fullTextPath,
			originalChars: args.output.length,
		},
	};
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
			if (!stored) return text(`No stored MCP result for responseId "${params.responseId}". Open the artifact path from the digest if this is an older session.`);
			const lines = [
				`MCP full content`,
				`responseId: ${stored.id}`,
				`server: ${stored.server}`,
				`tool: ${stored.tool}`,
				`action: ${stored.action}`,
				stored.artifactPath ? `artifact: ${stored.artifactPath}` : "",
				"",
				stored.output,
			].filter(Boolean);
			return text(lines.join("\n"), {
				responseId: stored.id,
				server: stored.server,
				tool: stored.tool,
				action: stored.action,
				artifactPath: stored.artifactPath,
				rawJsonPath: stored.rawJsonPath,
				fullTextPath: stored.fullTextPath,
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
