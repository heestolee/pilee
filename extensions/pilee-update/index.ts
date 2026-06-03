import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export interface PileeUpdateOptions {
	noReload: boolean;
	help: boolean;
}

export interface CommandRunResult {
	code: number | null;
	stdout: string;
	stderr: string;
}

export type RunUpdate = () => Promise<CommandRunResult>;

const HELP = [
	"/pilee-update",
	"",
	"pilee package를 업데이트한 뒤 현재 Pi 세션의 extensions/skills/prompts/themes를 reload합니다.",
	"",
	"옵션:",
	"  --no-reload   pi update만 실행하고 reload는 생략",
	"  -h, --help    도움말 표시",
].join("\n");

export function parsePileeUpdateArgs(args: string): PileeUpdateOptions {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	return {
		noReload: tokens.includes("--no-reload"),
		help: tokens.includes("--help") || tokens.includes("-h") || tokens.includes("help"),
	};
}

function tail(text: string, maxChars = 2400): string {
	if (text.length <= maxChars) return text;
	return `...\n${text.slice(-maxChars)}`;
}

export function resolvePiCommand(): string {
	return process.env.PILEE_PI_BIN || process.env.PI_BIN || "pi";
}

export function runPiUpdate(command = resolvePiCommand()): Promise<CommandRunResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, ["update"], {
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
		});
		child.stderr?.on("data", (chunk) => {
			stderr += String(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

export function createPileeUpdateHandler(runUpdate: RunUpdate = () => runPiUpdate()) {
	return async (args: string, ctx: ExtensionCommandContext) => {
		const options = parsePileeUpdateArgs(args);
		if (options.help) {
			ctx.ui.notify(HELP, "info");
			return;
		}

		ctx.ui.notify("🔥 pilee 업데이트를 시작합니다. 완료되면 현재 세션을 reload합니다.", "info");
		const result = await runUpdate();
		if (result.code !== 0) {
			const output = tail([result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"));
			ctx.ui.notify(`pilee update 실패(code=${result.code ?? "unknown"})\n${output}`, "error");
			return;
		}

		const summary = tail(result.stdout.trim() || result.stderr.trim() || "Updated packages");
		if (options.noReload) {
			ctx.ui.notify(`pilee update 완료. --no-reload로 reload는 생략했습니다.\n${summary}`, "success");
			return;
		}

		ctx.ui.notify(`pilee update 완료. 현재 세션을 reload합니다.\n${summary}`, "success");
		await ctx.reload();
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("pilee-update", {
		description: "pilee package update 후 현재 세션 reload까지 한 번에 실행",
		handler: createPileeUpdateHandler(),
	});
}
