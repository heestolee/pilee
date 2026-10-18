import { constants } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 1024 * 1024;
const PATH_CONTROLS = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u;

export interface PreviewFile {
	path: string;
	original: string;
	display: string;
	markdown: boolean;
}

/** Only local paths; never fetch a URL, expand a command, or execute a file. */
export function localPath(input: string, cwd: string): string | undefined {
	let value = input.trim();
	if (PATH_CONTROLS.test(value) || !value || value.startsWith("#") || value.startsWith("//")) return;
	try {
		if (/^file:/iu.test(value)) {
			const url = new URL(value);
			if (url.hostname && url.hostname !== "localhost") return;
			if (url.search || url.username || url.password) return;
			url.hash = "";
			value = fileURLToPath(url);
		} else {
			if (/^[a-z][a-z\d+.-]*:/iu.test(value)) return;
			// Markdown destinations may escape punctuation or percent-encode spaces.
			value = value.replace(/\\([\\()\[\] ])/gu, "$1");
			value = value.replace(/#(?:L\d+(?:-L?\d+)?|[^/]*)$/u, "");
			try { value = decodeURIComponent(value); } catch { /* A literal percent is valid in a local filename. */ }
		}
		if (PATH_CONTROLS.test(value) || !value) return;
		if (value === "~" || value.startsWith("~/")) value = homedir() + value.slice(1);
		return resolve(cwd, value);
	} catch {
		return;
	}
}

/** File bytes remain intact for copying; terminal controls never reach the renderer. */
export function safeDisplay(text: string): string {
	return stripVTControlCharacters(text)
		.replace(/\r\n?/gu, "\n")
		.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/gu, "�");
}

export async function readPreview(input: string, cwd: string): Promise<PreviewFile> {
	const requested = localPath(input, cwd);
	if (!requested) throw new Error("로컬 파일 경로만 미리 볼 수 있습니다.");
	const path = await realpath(requested);
	const before = await stat(path);
	if (!before.isFile()) throw new Error("디렉터리·장치가 아닌 일반 파일을 선택하세요.");
	if (before.size > MAX_BYTES) throw new Error("1 MiB를 넘는 파일은 미리 볼 수 없습니다.");
	// NONBLOCK avoids hanging if a regular file is replaced by a pipe before open.
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const opened = await handle.stat();
		if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev) {
			throw new Error("파일이 바뀌었습니다. 다시 열어 주세요.");
		}
		const buffer = Buffer.alloc(MAX_BYTES + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length > MAX_BYTES) throw new Error("1 MiB를 넘는 파일은 미리 볼 수 없습니다.");
		const after = await handle.stat();
		const current = await stat(path);
		if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || current.ino !== opened.ino || current.dev !== opened.dev || await realpath(requested) !== path) {
			throw new Error("읽는 동안 파일이 바뀌었습니다. 다시 열어 주세요.");
		}
		let original: string;
		try { original = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, length)); }
		catch { throw new Error("UTF-8 텍스트 파일만 미리 볼 수 있습니다."); }
		if (original.includes("\0")) throw new Error("바이너리 파일은 미리 볼 수 없습니다.");
		if (original.split("\n").length > 20_000) throw new Error("20,000줄을 넘는 파일은 미리 볼 수 없습니다.");
		return { path, original, display: safeDisplay(original), markdown: /\.(md|markdown|mdown)$/iu.test(extname(path)) };
	} finally {
		await handle.close();
	}
}
