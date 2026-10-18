import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPreviewBridge } from "./bridge.ts";
import { dispatchPreviewUrl, parsePreviewUrl, readSessionRegistry } from "./dispatcher.mjs";

function post(port: number, token: string, capability: string, headers: Record<string, string> = {}, method = "POST"): Promise<number> {
	return new Promise((resolve, reject) => {
		const req = request({ hostname: "127.0.0.1", port, path: `/open/${capability}`, method, headers: { authorization: `Bearer ${token}`, "content-length": "0", ...headers } }, (res) => { res.resume(); resolve(res.statusCode!); });
		req.on("error", reject); req.end();
	});
}

test("dispatcher는 등록된 원래 세션으로만 파일 capability를 전달한다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-bridge-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const opened: string[] = [];
	const bridge = await startPreviewBridge((path) => { opened.push(path); return true; }, dir);
	t.after(() => bridge.close());
	const url = bridge.register("/workspace/report.sql")!;
	// when
	await dispatchPreviewUrl(url, dir);
	// then
	assert.deepEqual(opened, ["/workspace/report.sql"]);
	assert.equal(bridge.register("/workspace/report.sql"), url);
	assert.equal((await stat(bridge.registryPath)).mode & 0o777, 0o600);
});

test("외부 Origin·인증 누락·미등록 capability·잘못된 Host는 거부한다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-bridge-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	let opened = 0;
	const bridge = await startPreviewBridge(() => { opened++; return true; }, dir);
	t.after(() => bridge.close());
	const { capability } = parsePreviewUrl(bridge.register("/workspace/report.md")!);
	const { port, token } = JSON.parse(await readFile(bridge.registryPath, "utf8"));
	// when
	const statuses = await Promise.all([
		post(port, token, capability, { origin: "https://example.org" }),
		post(port, "", capability),
		post(port, token, "0".repeat(32)),
		post(port, token, capability, { host: "example.org" }),
		post(port, token, capability, { "sec-fetch-site": "same-origin" }),
		post(port, token, capability, {}, "GET"),
	]);
	// then
	assert.deepEqual(statuses, [403, 403, 404, 403, 403, 405]);
	assert.equal(opened, 0);
});

test("종료한 세션 링크는 새 세션에서 재사용할 수 없다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-bridge-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const first = await startPreviewBridge(() => true, dir);
	const old = first.register("/workspace/report.md")!;
	// when
	await first.close();
	const next = await startPreviewBridge(() => false, dir);
	t.after(() => next.close());
	// then
	await assert.rejects(dispatchPreviewUrl(old, dir));
	await assert.rejects(dispatchPreviewUrl(next.register("/workspace/report.md")!, dir), /사용 중/u);
	assert.equal(first.register("/workspace/report.md"), undefined);
});

test("강제 종료된 프로세스의 잔여 registry는 연결 전에 거부한다", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "preview-dead-session-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	let opened = false;
	const bridge = await startPreviewBridge(() => { opened = true; return true; }, dir);
	t.after(() => bridge.close());
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
	await once(child, "spawn");
	t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
	const registration = JSON.parse(await readFile(bridge.registryPath, "utf8"));
	await writeFile(bridge.registryPath, JSON.stringify({ ...registration, pid: child.pid }));
	const exited = once(child, "exit");
	child.kill("SIGKILL");
	await exited;
	await assert.rejects(dispatchPreviewUrl(bridge.register("/workspace/report.md")!, dir), { code: "ESRCH" });
	assert.equal(opened, false);
});

test("URL과 registry로 임의 포트·명령·파일 경로를 주입할 수 없다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-registry-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const session = "a".repeat(32);
	const path = join(dir, `${session}.json`);
	const record = { version: 1, session, port: 12345, token: "b".repeat(64), pid: process.pid, createdAt: 1 };
	await writeFile(path, JSON.stringify({ ...record, host: "example.org" }), { mode: 0o600 });
	// when / then
	for (const url of ["https://example.org", `pilee-preview://${session}:80/${"b".repeat(32)}`, `pilee-preview://${session}/../../etc/passwd`, `pilee-preview://${session}/${"b".repeat(32)}?port=1234`, `pilee-preview://${session}/${"b".repeat(32)};echo evil`]) assert.throws(() => parsePreviewUrl(url));
	await assert.rejects(readSessionRegistry(session, dir));
	await writeFile(path, JSON.stringify(record));
	await chmod(path, 0o644);
	await assert.rejects(readSessionRegistry(session, dir), /安全|안전/u);
	await rm(path);
	await writeFile(join(dir, "other.json"), JSON.stringify(record), { mode: 0o600 });
	await symlink(join(dir, "other.json"), path);
	await assert.rejects(readSessionRegistry(session, dir));
});
