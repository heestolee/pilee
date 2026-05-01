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

function expandEnv(env: Record<string, string> | undefined): Record<string, string> {
	if (!env) return { ...process.env } as Record<string, string>;
	const result = { ...process.env } as Record<string, string>;
	for (const [k, v] of Object.entries(env)) {
		result[k] = v.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? "");
	}
	return result;
}

async function connectServer(name: string, config: ServerConfig): Promise<Connection> {
	const existing = connections.get(name);
	if (existing?.status === "connected") return existing;

	const effectiveConfig = applyNpxCache(config);

	const transport = new StdioClientTransport({
		command: effectiveConfig.command,
		args: effectiveConfig.args ?? [],
		env: expandEnv(effectiveConfig.env),
	});

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

function text(msg: string) {
	return { content: [{ type: "text" as const, text: msg }], details: {} };
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

function findToolServer(toolName: string): { server: string; conn: Connection } | null {
	for (const [server, conn] of connections) {
		if (conn.tools.some((t) => t.name === toolName)) return { server, conn };
	}
	return null;
}

async function callTool(toolName: string, args?: Record<string, unknown>): Promise<string> {
	const found = findToolServer(toolName);
	if (!found) return `Tool "${toolName}" not found. Use action:"status" or action:"list" to see available tools.`;

	if (found.conn.status === "disconnected") {
		const config = serverConfigs[found.server];
		if (!config) return `Server "${found.server}" config not found, cannot auto-reconnect.`;
		try {
			const reconnected = await connectServer(found.server, config);
			found.conn = reconnected;
		} catch (e) {
			return `Auto-reconnect to "${found.server}" failed: ${e instanceof Error ? e.message : e}`;
		}
	}

	found.conn.lastUsedAt = Date.now();

	try {
		const result = await found.conn.client.callTool({ name: toolName, arguments: args ?? {} });
		const parts = (result.content as Array<{ type: string; text?: string }>)
			.filter((c) => c.type === "text" && c.text)
			.map((c) => c.text!);
		const output = parts.join("\n");
		if (output.length > 30000) {
			return `${output.slice(0, 30000)}\n\n… (truncated, total ${output.length} chars)`;
		}
		return output || "(empty response)";
	} catch (e) {
		const errorMsg = e instanceof Error ? e.message : String(e);
		recordFailure(found.server, errorMsg);
		return `Error calling ${toolName}: ${errorMsg}`;
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
				case "list":
					return text(listTools(params.server));
				case "describe":
					return text(describeTool(params.tool));
				case "search":
					return text(searchTools(params.query));
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
					const result = await callTool(params.tool, args);
					return text(result);
				}
			}
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
		await disconnectAll();
	});
}
