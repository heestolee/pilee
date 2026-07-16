import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type StudyLearningAgentRole = "tutor" | "editor" | "coach";

export interface StudyLearningAgentRequest {
	role: StudyLearningAgentRole;
	prompt: string;
	cwd: string;
	model?: string;
	thinking?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	killGraceMs?: number;
}

export type StudyLearningAgentRunner = (request: StudyLearningAgentRequest) => Promise<string>;

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_STDERR_LENGTH = 8_000;

export function buildStudyLearningAgentArgs(request: StudyLearningAgentRequest, promptPath: string): string[] {
	const args = ["--mode", "json", "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files"];
	if (request.model) args.push("--model", request.model);
	if (request.thinking) args.push("--thinking", request.thinking);
	args.push("--append-system-prompt", promptPath, `Run the Study Hard ${request.role} task from the system prompt.`);
	return args;
}

export function sanitizedStudyLearningAgentEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env = { ...source };
	for (const key of Object.keys(env)) {
		if (/^NOTION_/i.test(key) || /^SLACK_/i.test(key) || /^STUDY_HARD_.*(?:TOKEN|SECRET|KEY)$/i.test(key) || key === "THIRD_PARTY_PROXY_URL") {
			delete env[key];
		}
	}
	return env;
}

export function parseStudyLearningAgentJson<T extends Record<string, unknown>>(output: string): T {
	const trimmed = output.trim();
	const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1]?.trim();
	const candidates = [trimmed, fenced].filter((candidate): candidate is string => !!candidate);
	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as T;
		} catch {}
	}
	throw new Error("학습 agent가 유효한 JSON 객체를 반환하지 않았습니다.");
}

function getFinalAssistantText(event: unknown): string | undefined {
	if (!event || typeof event !== "object") return undefined;
	const item = event as Record<string, unknown>;
	if (item.type !== "message_end" || !item.message || typeof item.message !== "object") return undefined;
	const message = item.message as Record<string, unknown>;
	if (message.role !== "assistant" || !Array.isArray(message.content)) return undefined;
	const text = message.content
		.filter((part): part is Record<string, unknown> => !!part && typeof part === "object" && (part as Record<string, unknown>).type === "text")
		.map((part) => String(part.text || ""))
		.join("\n")
		.trim();
	return text || undefined;
}

function piInvocation(args: string[]): { command: string; args: string[] } {
	const override = process.env.STUDY_HARD_PI_EXECUTABLE;
	if (override) return { command: override, args };
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && existsSync(currentScript) && !/\.test\.[cm]?[jt]s$/.test(basename(currentScript))) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	return { command: "pi", args };
}

export const runIsolatedStudyLearningAgent: StudyLearningAgentRunner = async (request) => {
	if (request.signal?.aborted) throw new Error("학습 agent 실행이 취소되었습니다.");
	const tempDir = mkdtempSync(join(tmpdir(), "study-hard-agent-"));
	const promptPath = join(tempDir, `${request.role}-prompt.md`);
	writeFileSync(
		promptPath,
		`You are the isolated Study Hard ${request.role} agent. You have no tools and must never claim to mutate external state.\n\n${request.prompt}`,
		{ encoding: "utf-8", mode: 0o600 },
	);
	const invocation = piInvocation(buildStudyLearningAgentArgs(request, promptPath));
	try {
		return await new Promise<string>((resolve, reject) => {
			const child = spawn(invocation.command, invocation.args, {
				cwd: request.cwd,
				env: sanitizedStudyLearningAgentEnv(),
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let stdoutBuffer = "";
			let stderr = "";
			let finalText = "";
			let settled = false;
			const finish = (error?: Error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				request.signal?.removeEventListener("abort", abort);
				if (error) reject(error);
				else resolve(finalText);
			};
			const terminate = () => {
				if (child.exitCode !== null) return;
				child.kill("SIGTERM");
				setTimeout(() => {
					if (child.exitCode === null) child.kill("SIGKILL");
				}, request.killGraceMs ?? 5_000).unref?.();
			};
			const abort = () => {
				terminate();
				finish(new Error("학습 agent 실행이 취소되었습니다."));
			};
			const timeout = setTimeout(() => {
				terminate();
				finish(new Error(`학습 agent 실행이 ${request.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms를 초과했습니다.`));
			}, request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
			request.signal?.addEventListener("abort", abort, { once: true });
			const processLine = (line: string) => {
				if (!line.trim()) return;
				try {
					const text = getFinalAssistantText(JSON.parse(line));
					if (text) finalText = text;
				} catch {}
			};
			child.stdout.on("data", (chunk) => {
				stdoutBuffer += String(chunk);
				const lines = stdoutBuffer.split("\n");
				stdoutBuffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});
			child.stderr.on("data", (chunk) => {
				stderr = `${stderr}${String(chunk)}`.slice(-MAX_STDERR_LENGTH);
			});
			child.once("error", (error) => finish(new Error(`학습 agent를 시작하지 못했습니다: ${error.message}`)));
			child.once("close", (code) => {
				if (stdoutBuffer.trim()) processLine(stdoutBuffer);
				if (settled) return;
				if (code !== 0) {
					finish(new Error(`학습 agent가 종료 코드 ${code}로 실패했습니다.${stderr.trim() ? ` ${stderr.trim()}` : ""}`));
					return;
				}
				if (!finalText) {
					finish(new Error(`학습 agent가 답변을 반환하지 않았습니다.${stderr.trim() ? ` ${stderr.trim()}` : ""}`));
					return;
				}
				finish();
			});
		});
	} finally {
		rmSync(tempDir, { recursive: true, force: true });
	}
};
