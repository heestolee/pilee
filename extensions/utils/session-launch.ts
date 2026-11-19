import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Pi 세션을 새 Ghostty 화면에서 실행하는 명령. fork-panel·workspace 복원·/show-report가 모두 이 모듈만 쓴다.
export const SESSION_LAUNCH_ROOT = "/tmp/pilee-panel-launch";
const SESSION_LAUNCH_TTL_MS = 24 * 60 * 60 * 1000;

export function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function appleScriptString(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function buildEnvPrefix(env: Record<string, string | undefined>): string {
	const entries = Object.entries(env).filter(([, value]) => Boolean(value));
	return entries.length > 0 ? `${entries.map(([key, value]) => `${key}=${shellQuote(value!)}`).join(" ")} ` : "";
}

// Ghostty가 띄운 화면은 PATH가 최소라, PATH를 보정하는 사용자 래퍼를 현재 node 경로보다 먼저 쓴다.
export function currentPiCommand(): string {
	const envPi = process.env.PILEE_PI_BIN || process.env.PI_BIN;
	if (envPi && existsSync(envPi)) return shellQuote(envPi);
	const userWrapper = join(homedir(), ".local", "bin", "pi");
	if (existsSync(userWrapper)) return shellQuote(userWrapper);
	const cliPath = process.argv[1] && existsSync(process.argv[1]) ? process.argv[1] : "";
	if (cliPath) return `${shellQuote(process.execPath)} ${shellQuote(cliPath)}`;
	return "pi";
}

export function buildPiSessionCommand(cwd: string, sessionFile: string, env: Record<string, string | undefined> = {}): string {
	return `cd ${shellQuote(cwd)} && ${buildEnvPrefix(env)}${currentPiCommand()} --session ${shellQuote(sessionFile)}`;
}

function pruneSessionLaunchScripts(root: string): void {
	try {
		const cutoff = Date.now() - SESSION_LAUNCH_TTL_MS;
		for (const name of readdirSync(root)) {
			if (!name.startsWith("launch-") || !name.endsWith(".sh")) continue;
			const path = join(root, name);
			try { if (statSync(path).mtimeMs < cutoff) unlinkSync(path); } catch {}
		}
	} catch {}
}

// 한글 경로·긴 env가 AppleScript 문자열에서 깨지지 않도록, Ghostty에는 짧은 ASCII 스크립트 경로만 넘긴다.
export function prepareSessionLaunchScript(
	cwd: string,
	sessionFile: string,
	env: Record<string, string | undefined> = {},
	root = SESSION_LAUNCH_ROOT,
): { command: string; scriptPath: string } {
	mkdirSync(root, { recursive: true, mode: 0o700 });
	pruneSessionLaunchScripts(root);
	const scriptPath = join(root, `launch-${Date.now()}-${randomUUID().slice(0, 8)}.sh`);
	const command = buildPiSessionCommand(cwd, sessionFile, env);
	writeFileSync(scriptPath, `#!/bin/bash\nrm -f -- ${shellQuote(scriptPath)}\nexec /bin/bash -lc ${shellQuote(command)}\n`, { encoding: "utf8", mode: 0o700 });
	chmodSync(scriptPath, 0o700);
	return { command: appleScriptString(scriptPath), scriptPath };
}
