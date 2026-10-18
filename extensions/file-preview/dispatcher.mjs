import { constants, realpathSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { request } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEME = "pilee-preview";
export const BUNDLE_ID = "dev.pilee.file-preview";
export const APP_NAME = "Pilee File Preview.app";
export const MARKER = "pilee-file-preview-handler-v1";
export function registryDirectory() { return join(homedir(), ".pi", "agent", "file-preview", "sessions"); }

export function parsePreviewUrl(value) {
	const match = /^pilee-preview:\/\/([a-f0-9]{32})\/([a-f0-9]{32})$/u.exec(value);
	if (!match) throw new Error("올바르지 않은 미리보기 링크입니다.");
	return { session: match[1], capability: match[2] };
}

export async function readSessionRegistry(session, directory = registryDirectory()) {
	if (!/^[a-f0-9]{32}$/u.test(session)) throw new Error("올바르지 않은 세션입니다.");
	const dir = await lstat(directory);
	if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) || (process.getuid && dir.uid !== process.getuid())) {
		throw new Error("안전하지 않은 미리보기 세션 디렉터리입니다.");
	}
	const handle = await open(join(directory, `${session}.json`), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const info = await handle.stat();
		if (!info.isFile() || info.size > 4096 || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) {
			throw new Error("안전하지 않은 미리보기 세션 등록입니다.");
		}
		const buffer = Buffer.alloc(4097);
		const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
		if (bytesRead > 4096) throw new Error("미리보기 세션 등록이 너무 큽니다.");
		const value = JSON.parse(buffer.subarray(0, bytesRead).toString("utf8"));
		if (value.version !== 1 || value.session !== session || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 ||
			!Number.isInteger(value.pid) || value.pid < 1 || !/^[a-f0-9]{64}$/u.test(value.token) ||
			!Number.isFinite(value.createdAt) || typeof value.host !== "undefined") {
			throw new Error("올바르지 않은 미리보기 세션 등록입니다.");
		}
		process.kill(value.pid, 0); // Fail closed for a dead session; never launch a process.
		return value;
	} finally { await handle.close(); }
}

/** The URL supplies no host, port, file path, or command. Only a local capability is sent. */
export async function dispatchPreviewUrl(url, directory = registryDirectory()) {
	const { session, capability } = parsePreviewUrl(url);
	const registration = await readSessionRegistry(session, directory);
	await new Promise((resolveRequest, reject) => {
		const req = request({
			hostname: "127.0.0.1", port: registration.port, method: "POST", path: `/open/${capability}`,
			headers: { authorization: `Bearer ${registration.token}`, "content-length": "0" },
			agent: false, timeout: 2000,
		}, (res) => {
			res.resume();
			if (res.statusCode === 202) resolveRequest(undefined);
			else reject(new Error(res.statusCode === 409 ? "세션이 사용 중입니다. 잠시 후 다시 열어 주세요." : "미리보기 요청이 거부되었습니다."));
		});
		req.on("timeout", () => req.destroy(new Error("미리보기 세션에 연결할 수 없습니다.")));
		req.on("error", reject);
		req.end();
	});
}

function isCliEntry() {
	try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
	catch { return false; }
}

if (isCliEntry()) {
	dispatchPreviewUrl(process.argv[2] ?? "").catch(() => {
		console.error("파일 미리보기를 열지 못했습니다. 원래 Pi 세션에서 /preview를 사용하세요.");
		process.exitCode = 1;
	});
}
