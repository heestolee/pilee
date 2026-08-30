import { createHash } from "node:crypto";

export const PR_REVIEW_SOURCE_SCHEMA_VERSION = 1;
export const DEFAULT_CHUNK_BYTES = 48 * 1024;
export const MAX_DIFF_BYTES = 8 * 1024 * 1024;
export const MAX_CHUNKS = 128;

export type DiffLineKind =
	| "file-header"
	| "metadata"
	| "old-file"
	| "new-file"
	| "hunk-header"
	| "addition"
	| "deletion"
	| "context"
	| "no-newline";

export interface ReviewDiffLine {
	id: string;
	index: number;
	text: string;
	kind: DiffLineKind;
	fileId?: string;
	hunkId?: string;
	oldLine?: number;
	newLine?: number;
}

export interface ReviewDiffFile {
	id: string;
	path: string;
	oldPath?: string;
	status: "added" | "deleted" | "modified" | "renamed" | "binary";
	additions: number;
	deletions: number;
	lineIds: string[];
	hunkIds: string[];
	binary: boolean;
}

export type ReviewDeclarationKind =
	| "file"
	| "import"
	| "variable"
	| "function"
	| "component"
	| "hook"
	| "method"
	| "constructor"
	| "class"
	| "interface"
	| "type"
	| "enum"
	| "namespace"
	| "property"
	| "accessor"
	| "test-suite"
	| "test";

export interface ReviewDeclarationRange {
	startLine: number;
	endLine: number;
}

export interface ReviewDeclarationSource {
	path: string;
	text: string;
	sha256: string;
	lineCount: number;
}

export interface ReviewDeclarationUnit {
	id: string;
	fileId: string;
	kind: ReviewDeclarationKind;
	name: string;
	symbolPath: string[];
	parentId?: string;
	childIds: string[];
	depth: number;
	before?: ReviewDeclarationRange;
	after?: ReviewDeclarationRange;
	evidenceIds: string[];
}

export interface ReviewFileSourceSnapshot {
	fileId: string;
	path: string;
	language: "typescript" | "tsx" | "javascript" | "jsx";
	before?: ReviewDeclarationSource;
	after?: ReviewDeclarationSource;
	declarations: ReviewDeclarationUnit[];
}

export interface ReviewDiffChunk {
	id: string;
	startIndex: number;
	endIndex: number;
	start: string;
	end: string;
	bytes: number;
	changedRows: number;
	fileIds: string[];
	prefixLineIds: string[];
}

export interface ReviewSourceBundle {
	schemaVersion: typeof PR_REVIEW_SOURCE_SCHEMA_VERSION;
	sourceSha256: string;
	capture: Record<string, unknown>;
	stats: {
		files: number;
		hunks: number;
		additions: number;
		deletions: number;
		changedRows: number;
		physicalLines: number;
		bytes: number;
		chunks: number;
	};
	lines: ReviewDiffLine[];
	files: ReviewDiffFile[];
	chunks: ReviewDiffChunk[];
	fileSources?: ReviewFileSourceSnapshot[];
}

function evidenceId(index: number): string {
	return `D${String(index + 1).padStart(6, "0")}`;
}

function decodeGitPath(value: string): string {
	const trimmed = value.trim().replace(/\t.*$/, "");
	if (trimmed === "/dev/null") return trimmed;
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try { return JSON.parse(trimmed); } catch {}
	}
	return trimmed;
}

function stripGitPrefix(value: string): string {
	const decoded = decodeGitPath(value);
	return decoded.startsWith("a/") || decoded.startsWith("b/") ? decoded.slice(2) : decoded;
}

function pathsFromDiffHeader(value: string): { oldPath?: string; path: string } {
	const payload = value.slice("diff --git ".length);
	const boundary = payload.lastIndexOf(" b/");
	if (boundary >= 0) {
		return {
			oldPath: stripGitPrefix(payload.slice(0, boundary)),
			path: stripGitPrefix(payload.slice(boundary + 1)),
		};
	}
	const quoted = payload.match(/^("(?:[^"\\]|\\.)*")\s+("(?:[^"\\]|\\.)*")$/);
	if (quoted) return { oldPath: stripGitPrefix(quoted[1]!), path: stripGitPrefix(quoted[2]!) };
	return { path: payload };
}

function parseHunk(value: string): { oldLine: number; newLine: number } | undefined {
	const match = value.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
	if (!match) return undefined;
	return { oldLine: Number(match[1]), newLine: Number(match[2]) };
}

function lineBytes(line: ReviewDiffLine): number {
	return Buffer.byteLength(line.text, "utf8") + 32;
}

function chunkPrefixes(lines: ReviewDiffLine[], startIndex: number): string[] {
	if (startIndex === 0) return [];
	let fileHeader: string | undefined;
	let hunkHeader: string | undefined;
	for (let index = startIndex - 1; index >= 0; index -= 1) {
		const line = lines[index]!;
		if (!hunkHeader && line.kind === "hunk-header") hunkHeader = line.id;
		if (line.kind === "file-header") {
			fileHeader = line.id;
			break;
		}
	}
	return [fileHeader, hunkHeader].filter((id): id is string => Boolean(id));
}

function buildChunks(lines: ReviewDiffLine[], targetBytes: number): ReviewDiffChunk[] {
	const chunks: ReviewDiffChunk[] = [];
	let startIndex = 0;
	let bytes = 0;
	const push = (endIndex: number) => {
		if (endIndex < startIndex) return;
		const selected = lines.slice(startIndex, endIndex + 1);
		const fileIds = [...new Set(selected.map((line) => line.fileId).filter((id): id is string => Boolean(id)))];
		chunks.push({
			id: `C${String(chunks.length + 1).padStart(3, "0")}`,
			startIndex,
			endIndex,
			start: selected[0]!.id,
			end: selected.at(-1)!.id,
			bytes,
			changedRows: selected.filter((line) => line.kind === "addition" || line.kind === "deletion").length,
			fileIds,
			prefixLineIds: chunkPrefixes(lines, startIndex),
		});
		startIndex = endIndex + 1;
		bytes = 0;
	};

	for (let index = 0; index < lines.length; index += 1) {
		const nextBytes = lineBytes(lines[index]!);
		if (index > startIndex && bytes + nextBytes > targetBytes) push(index - 1);
		bytes += nextBytes;
	}
	push(lines.length - 1);
	if (chunks.length > MAX_CHUNKS) throw new Error(`PR diff chunk count ${chunks.length} exceeds ${MAX_CHUNKS}`);
	return chunks;
}

export function rechunkReviewSourceByFile(bundle: ReviewSourceBundle, targetBytes = DEFAULT_CHUNK_BYTES): ReviewSourceBundle {
	const chunks: ReviewDiffChunk[] = [];
	for (const file of bundle.files) {
		const fileLineIds = new Set(file.lineIds);
		const fileLines = bundle.lines.filter((line) => fileLineIds.has(line.id));
		let selected: ReviewDiffLine[] = [];
		let bytes = 0;
		const push = () => {
			if (!selected.length) return;
			const startIndex = selected[0]!.index;
			const endIndex = selected.at(-1)!.index;
			chunks.push({
				id: `C${String(chunks.length + 1).padStart(3, "0")}`,
				startIndex,
				endIndex,
				start: selected[0]!.id,
				end: selected.at(-1)!.id,
				bytes,
				changedRows: selected.filter((line) => line.kind === "addition" || line.kind === "deletion").length,
				fileIds: [file.id],
				prefixLineIds: chunkPrefixes(bundle.lines, startIndex),
			});
			selected = [];
			bytes = 0;
		};
		for (const line of fileLines) {
			const nextBytes = lineBytes(line);
			if (selected.length && bytes + nextBytes > targetBytes) push();
			selected.push(line);
			bytes += nextBytes;
		}
		push();
	}
	if (chunks.length > MAX_CHUNKS) throw new Error(`PR diff chunk count ${chunks.length} exceeds ${MAX_CHUNKS}`);
	return { ...bundle, chunks, stats: { ...bundle.stats, chunks: chunks.length } };
}

export function captureUnifiedDiff(
	diff: string,
	capture: Record<string, unknown> = {},
	options: { chunkBytes?: number } = {},
): ReviewSourceBundle {
	if (!diff.trim()) throw new Error("captured diff is empty");
	const normalized = diff.replace(/\r\n/g, "\n");
	const byteLength = Buffer.byteLength(normalized, "utf8");
	if (byteLength > MAX_DIFF_BYTES) throw new Error(`diff is larger than ${MAX_DIFF_BYTES} bytes`);
	if (/^diff --(?:cc|combined) /m.test(normalized)) throw new Error("combined diffs are not supported");

	const physicalLines = normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
	const lines: ReviewDiffLine[] = [];
	const files: ReviewDiffFile[] = [];
	let currentFile: ReviewDiffFile | undefined;
	let currentHunkId: string | undefined;
	let oldLine: number | undefined;
	let newLine: number | undefined;

	for (const text of physicalLines) {
		const id = evidenceId(lines.length);
		let kind: DiffLineKind = "metadata";
		if (text.startsWith("diff --git ")) {
			const paths = pathsFromDiffHeader(text);
			currentFile = {
				id: `F${String(files.length + 1).padStart(3, "0")}`,
				path: paths.path,
				oldPath: paths.oldPath,
				status: paths.oldPath && paths.oldPath !== paths.path ? "renamed" : "modified",
				additions: 0,
				deletions: 0,
				lineIds: [],
				hunkIds: [],
				binary: false,
			};
			files.push(currentFile);
			currentHunkId = undefined;
			oldLine = undefined;
			newLine = undefined;
			kind = "file-header";
		} else if (text.startsWith("new file mode ")) {
			if (currentFile) currentFile.status = "added";
		} else if (text.startsWith("deleted file mode ")) {
			if (currentFile) currentFile.status = "deleted";
		} else if (text.startsWith("rename from ")) {
			if (currentFile) {
				currentFile.oldPath = decodeGitPath(text.slice("rename from ".length));
				currentFile.status = "renamed";
			}
		} else if (text.startsWith("rename to ")) {
			if (currentFile) {
				currentFile.path = decodeGitPath(text.slice("rename to ".length));
				currentFile.status = "renamed";
			}
		} else if (text.startsWith("Binary files ") || text.startsWith("GIT binary patch")) {
			if (currentFile) {
				currentFile.binary = true;
				currentFile.status = "binary";
			}
		} else if (text.startsWith("--- ")) {
			kind = "old-file";
			const path = stripGitPrefix(text.slice(4));
			if (currentFile && path !== "/dev/null") currentFile.oldPath = path;
		} else if (text.startsWith("+++ ")) {
			kind = "new-file";
			const path = stripGitPrefix(text.slice(4));
			if (currentFile && path !== "/dev/null") currentFile.path = path;
		} else if (text.startsWith("@@")) {
			const parsed = parseHunk(text);
			if (!parsed) throw new Error(`invalid hunk header: ${text}`);
			oldLine = parsed.oldLine;
			newLine = parsed.newLine;
			currentHunkId = `H${String(files.reduce((count, file) => count + file.hunkIds.length, 0) + 1).padStart(4, "0")}`;
			currentFile?.hunkIds.push(currentHunkId);
			kind = "hunk-header";
		} else if (text.startsWith("+") && !text.startsWith("+++")) {
			kind = "addition";
			currentFile && (currentFile.additions += 1);
		} else if (text.startsWith("-") && !text.startsWith("---")) {
			kind = "deletion";
			currentFile && (currentFile.deletions += 1);
		} else if (text.startsWith(" ")) {
			kind = "context";
		} else if (text.startsWith("\\ No newline")) {
			kind = "no-newline";
		}

		const line: ReviewDiffLine = {
			id,
			index: lines.length,
			text,
			kind,
			fileId: currentFile?.id,
			hunkId: currentHunkId,
		};
		if (kind === "addition") {
			line.newLine = newLine;
			if (newLine !== undefined) newLine += 1;
		} else if (kind === "deletion") {
			line.oldLine = oldLine;
			if (oldLine !== undefined) oldLine += 1;
		} else if (kind === "context") {
			line.oldLine = oldLine;
			line.newLine = newLine;
			if (oldLine !== undefined) oldLine += 1;
			if (newLine !== undefined) newLine += 1;
		}
		lines.push(line);
		currentFile?.lineIds.push(id);
	}

	if (!files.length) throw new Error("diff has no file headers");
	const chunks = buildChunks(lines, Math.max(4_096, options.chunkBytes ?? DEFAULT_CHUNK_BYTES));
	return {
		schemaVersion: PR_REVIEW_SOURCE_SCHEMA_VERSION,
		sourceSha256: createHash("sha256").update(normalized).digest("hex"),
		capture,
		stats: {
			files: files.length,
			hunks: files.reduce((count, file) => count + file.hunkIds.length, 0),
			additions: files.reduce((count, file) => count + file.additions, 0),
			deletions: files.reduce((count, file) => count + file.deletions, 0),
			changedRows: files.reduce((count, file) => count + file.additions + file.deletions, 0),
			physicalLines: lines.length,
			bytes: byteLength,
			chunks: chunks.length,
		},
		lines,
		files,
		chunks,
	};
}

export function renderInspectionChunk(bundle: ReviewSourceBundle, chunkId: string): string {
	const chunk = bundle.chunks.find((candidate) => candidate.id === chunkId);
	if (!chunk) throw new Error(`unknown chunk: ${chunkId}`);
	const prefixes = chunk.prefixLineIds
		.map((id) => bundle.lines.find((line) => line.id === id))
		.filter((line): line is ReviewDiffLine => Boolean(line));
	const selected = bundle.lines.slice(chunk.startIndex, chunk.endIndex + 1);
	const render = (line: ReviewDiffLine, prefix = false) => {
		const oldValue = line.oldLine === undefined ? "" : String(line.oldLine);
		const newValue = line.newLine === undefined ? "" : String(line.newLine);
		return `${prefix ? "*" : " "}${line.id}|${oldValue.padStart(6)}|${newValue.padStart(6)}|${line.text}`;
	};
	return [
		`# ${chunk.id} ${chunk.start}..${chunk.end} files=${chunk.fileIds.join(",") || "-"} changed=${chunk.changedRows}`,
		...prefixes.map((line) => render(line, true)),
		...selected.map((line) => render(line)),
	].join("\n");
}

export function validateEvidenceIds(
	bundle: ReviewSourceBundle,
	inspectedChunkIds: Iterable<string>,
	evidenceIds: Iterable<string>,
): string[] {
	const errors: string[] = [];
	const inspected = new Set(inspectedChunkIds);
	const linesById = new Map(bundle.lines.map((line) => [line.id, line]));
	const chunkByLine = new Map<string, string>();
	for (const chunk of bundle.chunks) {
		for (let index = chunk.startIndex; index <= chunk.endIndex; index += 1) chunkByLine.set(bundle.lines[index]!.id, chunk.id);
	}
	for (const id of evidenceIds) {
		const line = linesById.get(id);
		if (!line) {
			errors.push(`unknown evidence id: ${id}`);
			continue;
		}
		const chunkId = chunkByLine.get(id);
		if (!chunkId || !inspected.has(chunkId)) errors.push(`evidence ${id} belongs to uninspected chunk ${chunkId ?? "unknown"}`);
	}
	return errors;
}
