import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { registryDirectory } from "./dispatcher.mjs";

export interface PreviewBridge {
	register(path: string): string | undefined;
	close(): Promise<void>;
	registryPath: string;
}

export async function startPreviewBridge(onOpen: (path: string) => boolean, directory = registryDirectory()): Promise<PreviewBridge> {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const dir = await lstat(directory);
	if (!dir.isDirectory() || dir.isSymbolicLink() || (dir.mode & 0o077) || (process.getuid && dir.uid !== process.getuid())) {
		throw new Error("안전하지 않은 미리보기 세션 디렉터리입니다.");
	}
	const session = randomBytes(16).toString("hex");
	const token = randomBytes(32).toString("hex");
	const paths = new Map<string, string>();
	const capabilities = new Map<string, string>();
	let closed = false;
	let port = 0;
	const server = createServer((req, res) => {
		res.setHeader("Cache-Control", "no-store");
		const reject = (status: number) => { req.resume(); res.writeHead(status).end(); };
		if (closed) return reject(410);
		if (req.socket.remoteAddress !== "127.0.0.1" || req.headers.host !== `127.0.0.1:${port}` ||
			req.headers.origin !== undefined || req.headers["sec-fetch-site"] !== undefined || req.headers["transfer-encoding"] !== undefined ||
			(req.headers["content-length"] !== undefined && req.headers["content-length"] !== "0")) return reject(403);
		const supplied = Buffer.from(req.headers.authorization ?? "");
		const expected = Buffer.from(`Bearer ${token}`);
		if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reject(403);
		if (req.method !== "POST") return reject(405);
		const match = /^\/open\/([a-f0-9]{32})$/u.exec(req.url ?? "");
		const path = match && capabilities.get(match[1]);
		if (!path) return reject(404);
		try { reject(onOpen(path) ? 202 : 409); } catch { reject(503); }
	});
	server.requestTimeout = 5000;
	server.headersTimeout = 5000;
	server.keepAliveTimeout = 500;
	server.maxConnections = 20;
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
	});
	const address = server.address();
	if (!address || typeof address === "string") { server.close(); throw new Error("미리보기 연결 준비 실패"); }
	port = address.port;
	const registryPath = join(directory, `${session}.json`);
	try {
		await writeFile(registryPath, JSON.stringify({ version: 1, session, port, token, pid: process.pid, createdAt: Date.now() }), { mode: 0o600, flag: "wx" });
	} catch (error) { server.close(); throw error; }
	server.unref();
	return {
		registryPath,
		register(path) {
			if (closed) return;
			const existing = paths.get(path);
			if (existing) return `pilee-preview://${session}/${existing}`;
			if (paths.size >= 2000) return;
			const capability = randomBytes(16).toString("hex");
			paths.set(path, capability);
			capabilities.set(capability, path);
			return `pilee-preview://${session}/${capability}`;
		},
		async close() {
			if (closed) return;
			closed = true;
			paths.clear(); capabilities.clear();
			try {
				await unlink(registryPath).catch((error: NodeJS.ErrnoException) => {
					if (error.code !== "ENOENT") throw error;
				});
			} finally {
				server.closeAllConnections();
				await new Promise<void>((resolve) => server.close(() => resolve()));
			}
		},
	};
}
