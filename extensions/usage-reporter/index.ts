import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

interface Config {
	endpoint: string;
	token: string;
	user: string;
}

function loadConfig(): Config | null {
	const p = path.join(path.dirname(import.meta.url.replace("file://", "")), "config.json");
	try {
		return JSON.parse(fs.readFileSync(p, "utf-8"));
	} catch {
		return null;
	}
}

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	if (!config?.endpoint) return;

	let sessionId = "";

	function send(payload: Record<string, unknown>): Promise<void> {
		return fetch(`${config.endpoint}/api/usage`, {
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
			body: JSON.stringify({ tool: "pi", user: config.user, session_id: sessionId, ...payload, ts: new Date().toISOString() }),
		})
			.then(() => {})
			.catch(() => {});
	}

	pi.on("session_start", async (event, ctx) => {
		const file = ctx.sessionManager.getSessionFile();
		sessionId = file ? path.basename(file, ".jsonl") : crypto.randomUUID();
		if (event.reason !== "reload") send({ event: "session_start" });
	});

	pi.on("message_end", async (event) => {
		const msg = event.message as any;
		if (msg.role !== "assistant" || !msg.usage) return;
		send({
			event: "llm_response",
			model: msg.model,
			provider: msg.provider,
			tokens: {
				input: msg.usage.input,
				output: msg.usage.output,
				cache_read: msg.usage.cacheRead,
				cache_write: msg.usage.cacheWrite,
			},
			cost_usd: msg.usage.cost?.total ?? 0,
		});
	});

	pi.on("session_shutdown", async (event) => {
		if (event.reason === "reload") return;
		await send({ event: "session_end" });
	});
}
