import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { writeAtomicJson } from "./files.ts";

export type TerminalBinding = { windowId: string; terminalId: string };
export type SessionRegistration = {
	version: 1;
	pid: number;
	processStartedAt: string;
	processToken: string;
	generation: string;
	updatedAt: number;
	sessionFile: string;
	cwd: string;
	title: string;
	panelLabel: string;
	forkId?: string;
	parentSessionFile?: string;
	binding?: TerminalBinding;
	error?: string;
};

export function pidIsAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

/** A PID may belong to a different process after a crash. Compare OS birth times, not record ages. */
export function readProcessStarts(pids: number[]): Map<number, string> {
	const ids = [...new Set(pids.filter((pid) => Number.isInteger(pid) && pid > 0))];
	const starts = new Map<number, string>();
	if (!ids.length) return starts;
	const result = spawnSync("/bin/ps", ["-p", ids.join(","), "-o", "pid=", "-o", "lstart="], {
		encoding: "utf8", timeout: 1000, env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
	});
	if (result.error || (result.status !== 0 && result.status !== 1)) return starts;
	for (const line of (result.stdout || "").split(/\r?\n/u)) {
		const match = line.trim().match(/^(\d+)\s+(.+)$/u);
		if (match && ids.includes(Number(match[1]))) starts.set(Number(match[1]), match[2].trim());
	}
	return starts;
}

function registrationPath(workspaceDir: string, record: Pick<SessionRegistration, "pid" | "processToken">): string {
	if (!Number.isInteger(record.pid) || record.pid <= 0 || !/^[a-f0-9-]+$/u.test(record.processToken)) throw new Error("잘못된 process identity");
	return join(workspaceDir, "registrations", `${record.pid}-${record.processToken}.json`);
}

export function writeRegistration(workspaceDir: string, record: SessionRegistration): void {
	writeAtomicJson(registrationPath(workspaceDir, record), record);
}

export function removeRegistration(workspaceDir: string, record: Pick<SessionRegistration, "pid" | "processToken" | "generation">): void {
	const path = registrationPath(workspaceDir, record);
	try {
		const current = JSON.parse(readFileSync(path, "utf8"));
		if (current.generation === record.generation) unlinkSync(path);
	} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

/** No TTL, title/cwd scoring, session-file deduplication, or promotion from the legacy registry. */
export function readRegistrations(workspaceDir: string): SessionRegistration[] {
	const directory = join(workspaceDir, "registrations");
	let files: string[];
	try { files = readdirSync(directory); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	const records = files.filter((name) => name.endsWith(".json")).flatMap((name) => {
		try {
			const record: SessionRegistration = JSON.parse(readFileSync(join(directory, name), "utf8"));
			if (record.version !== 1 || typeof record.processStartedAt !== "string" || !record.processStartedAt ||
				typeof record.generation !== "string" || typeof record.sessionFile !== "string" ||
				typeof record.cwd !== "string" || typeof record.title !== "string" || typeof record.panelLabel !== "string" ||
				registrationPath(workspaceDir, record) !== join(directory, name) || !pidIsAlive(record.pid)) return [];
			if (record.binding && (typeof record.binding.terminalId !== "string" || !record.binding.terminalId ||
				typeof record.binding.windowId !== "string" || !record.binding.windowId)) return [];
			return [record];
		} catch { return []; }
	});
	const starts = readProcessStarts(records.map((record) => record.pid));
	return records.filter((record) => starts.get(record.pid) === record.processStartedAt);
}
