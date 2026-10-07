import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { readProcessStarts, readRegistrations, removeRegistration, writeRegistration, type SessionRegistration } from "./registry.ts";

const processStartedAt = readProcessStarts([process.pid]).get(process.pid)!;

const record = (token: string): SessionRegistration => ({
	version: 1, pid: process.pid, processStartedAt, processToken: token, generation: "first", updatedAt: 1,
	sessionFile: "/fixture.jsonl", cwd: "/fixture", title: "same title", panelLabel: "P0",
	binding: { windowId: "window", terminalId: token },
});

test("idle registrations outlive 24 hours, dead PIDs are excluded, and stale cleanup preserves a new generation", () => {
	const root = mkdtempSync(join(tmpdir(), "workspace-registry-"));
	try {
		writeRegistration(root, record("aaa"));
		writeRegistration(root, { ...record("bbb"), pid: 99999999 });
		writeFileSync(join(root, "active-sessions.json"), JSON.stringify({ records: [{ ...record("ccc"), updatedAt: Date.now() }] }));
		assert.deepEqual(readRegistrations(root).map((item) => item.processToken), ["aaa"]);
		writeRegistration(root, { ...record("aaa"), generation: "new" });
		removeRegistration(root, record("aaa"));
		assert.equal(readRegistrations(root)[0].generation, "new");
		removeRegistration(root, { ...record("aaa"), generation: "new" });
		assert.deepEqual(readRegistrations(root), []);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("a reused live PID cannot promote the previous process's binding", () => {
	const root = mkdtempSync(join(tmpdir(), "workspace-registry-reused-pid-"));
	try {
		assert.ok(processStartedAt);
		writeRegistration(root, { ...record("aaa"), processStartedAt: "Wed Jan  1 00:00:00 2000" });
		assert.deepEqual(readRegistrations(root), []);
		writeRegistration(root, record("bbb"));
		assert.deepEqual(readRegistrations(root).map((item) => item.processToken), ["bbb"]);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("separate writer processes publish atomic files without losing another registration", async () => {
	const root = mkdtempSync(join(tmpdir(), "workspace-registry-writers-"));
	try {
		const run = (token: string) => promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", `
			import { writeRegistration } from ${JSON.stringify(new URL("./registry.ts", import.meta.url).href)};
			for (let n = 0; n < 25; n++) writeRegistration(${JSON.stringify(root)}, { ...${JSON.stringify(record(token))}, title: String(n) });
		`], { env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: root } });
		await Promise.all([run("aaa"), run("bbb")]);
		assert.equal(readRegistrations(root).length, 2);
		const files = readdirSync(join(root, "registrations"));
		assert.equal(files.length, 2);
		for (const file of files) assert.equal(JSON.parse(readFileSync(join(root, "registrations", file), "utf8")).title, "24");
	} finally { rmSync(root, { recursive: true, force: true }); }
});
