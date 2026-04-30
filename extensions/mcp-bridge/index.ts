import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
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
}

const connections = new Map<string, Connection>();
let serverConfigs: Record<string, ServerConfig> = {};

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

	const transport = new StdioClientTransport({
		command: config.command,
		args: config.args ?? [],
		env: expandEnv(config.env),
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
		};
		connections.set(name, conn);
		return conn;
	} catch (e) {
		const conn: Connection = {
			client,
			transport,
			tools: [],
			status: "error",
			error: e instanceof Error ? e.message : String(e),
		};
		connections.set(name, conn);
		throw e;
	}
}

async function disconnectServer(name: string): Promise<void> {
	const conn = connections.get(name);
	if (!conn) return;
	try { await conn.transport.close(); } catch {}
	conn.status = "disconnected";
	connections.delete(name);
}

async function disconnectAll(): Promise<void> {
	for (const name of [...connections.keys()]) await disconnectServer(name);
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
		if (!conn) {
			lines.push(`  ${name}: not connected`);
		} else if (conn.status === "error") {
			lines.push(`  ${name}: error — ${conn.error}`);
		} else {
			lines.push(`  ${name}: connected (${conn.tools.length} tools)`);
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
		if (conn.status !== "connected") continue;
		lines.push(`[${name}]`);
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
		return `Error calling ${toolName}: ${e instanceof Error ? e.message : e}`;
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
					if (!name) return text("Server name is required. Use action:\"status\" to see available servers.");
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
							args = typeof params.args === "object" ? params.args as any : JSON.parse(params.args);
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

	// Auto-connect on session start
	pi.on("session_start", async (_event, ctx) => {
		serverConfigs = loadConfig();
		const names = Object.keys(serverConfigs);
		if (names.length === 0) return;

		let connected = 0;
		let failed = 0;
		for (const name of names) {
			try {
				await connectServer(name, serverConfigs[name]);
				connected++;
			} catch {
				failed++;
			}
		}

		if (ctx.hasUI) {
			const total = connections.size;
			const toolCount = [...connections.values()].reduce((sum, c) => sum + c.tools.length, 0);
			if (failed > 0) {
				ctx.ui.notify(`MCP: ${connected}/${names.length} servers connected (${toolCount} tools, ${failed} failed)`, "warning");
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
						try { await connectServer(n, c); } catch {}
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
		await disconnectAll();
	});
}
