/**
 * /diff — Git diff overlay
 *
 * Split-pane view with mode toggle:
 * - Diff mode: left = changed files (tree), right = file diff with syntax highlighting
 * - Commit mode: left = commits, right = changed files per commit (fold/unfold inline diffs)
 *
 * Tab / v toggles Diff ↔ Commit mode.
 */

import path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, getLanguageFromPath, highlightCode } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

// ─── Domain types ──────────────────────────────────────────────────────────

type DiffFileStatus = "added" | "deleted" | "modified" | "renamed" | "copied" | "untracked" | "ignored";
type CommitState = "committed" | "uncommitted" | "both";
type OverlayViewMode = "diff" | "commit";
type OverlayDiffScope = "branch" | "working" | "last-commit";
type DiffLineCategory = "meta" | "hunk" | "added" | "removed" | "context";
type FocusPane = "left" | "right";

interface ParsedDiffEntry {
	path: string;
	status: DiffFileStatus;
	rawStatus: string;
	previousPath?: string | null;
}

interface MergedDiffEntry extends ParsedDiffEntry {
	commitState: CommitState;
}

interface BranchCommitEntry {
	hash: string;
	shortHash: string;
	author: string;
	relativeDate: string;
	subject: string;
}

interface ParsedDiffLine {
	category: DiffLineCategory;
	prefix: string;
	code: string;
	originalLine: string;
	oldLineNumber?: number;
	newLineNumber?: number;
}

interface DirTreeNode {
	type: "dir";
	name: string;
	fullPath: string;
	children: FileTreeNode[];
}

interface FileLeafNode {
	type: "file";
	name: string;
	fullPath: string;
}

type FileTreeNode = DirTreeNode | FileLeafNode;

interface VisibleDirRow {
	type: "dir";
	depth: number;
	fullPath: string;
	name: string;
	expanded: boolean;
}

interface VisibleFileRow {
	type: "file";
	depth: number;
	fullPath: string;
	name: string;
}

type VisibleRow = VisibleDirRow | VisibleFileRow;

interface DiffFile {
	path: string;
	status: DiffFileStatus;
	rawStatus: string;
	commitState: CommitState;
	previousPath?: string | null;
}

interface CommitFile {
	path: string;
	status: DiffFileStatus;
	rawStatus: string;
	previousPath?: string | null;
}

interface ReviewDraft {
	scope: OverlayDiffScope;
	filePath: string;
	fileDisplayPath: string;
	lineRange: string | null;
	prompt: string;
}

interface ReviewInputState {
	active: boolean;
	buffer: string;
	error: string | null;
	lineRange: string | null;
	lineRangeSelectMode: boolean;
	lineRangeSelectIndex: number;
	lineRangeDirectInputMode: boolean;
	lineRangeBuffer: string;
}

interface DiffState {
	// Diff mode
	files: DiffFile[];
	filesByScope: Record<OverlayDiffScope, DiffFile[]>;
	scope: OverlayDiffScope;
	searchQuery: string;
	searchMode: boolean;
	selectedIndex: number;
	fileScrollOffset: number;
	diffCache: Map<string, string>;
	highlightedDiffCache: Map<string, string[]>;
	diffScrollOffset: number;
	diffScrollMemory: Map<string, number>;
	selectedFilePathByScope: Record<OverlayDiffScope, string | null>;
	wrapLines: boolean;
	changedOnly: boolean;
	showFullFile: boolean;
	showHelp: boolean;
	reviewDrafts: ReviewDraft[];
	reviewInput: ReviewInputState;

	// Tree state
	treeNodes: FileTreeNode[];
	expandedDirs: Set<string>;
	selectedFilePath: string | null;

	// Commit mode
	commits: BranchCommitEntry[];
	commitSelectedIndex: number;
	commitScrollOffset: number;
	commitFilesCache: Map<string, CommitFile[]>;
	commitFilesLoading: Set<string>;
	commitFileDiffCache: Map<string, string>;
	commitFileDiffLoading: Set<string>;
	commitExpandedByHash: Map<string, Set<string>>;
	commitFileSelectedIndex: number;
	commitFileScrollOffset: number;
	commitFileManualScroll: boolean;

	viewMode: OverlayViewMode;
	focus: FocusPane;

	branch: string;
	mergeBase: string | null;
	baseBranch: string | null;
	error: string | null;
}

interface Theme {
	fg: (color: ThemeColor, text: string) => string;
	bg: (color: "toolSuccessBg" | "toolErrorBg" | "selectedBg", text: string) => string;
	bold: (text: string) => string;
}

interface Tui {
	requestRender: () => void;
	terminal?: { rows?: number };
}

// ─── Constants ─────────────────────────────────────────────────────────────

const UNCOMMITTED_HASH = "__uncommitted__";
const ARROW_SCROLL_STEP = 5;
const PAGE_SCROLL_STEP = 20;
const COMMIT_HISTORY_LIMIT = 200;
const GIT_LOG_PRETTY = "%H%x1f%h%x1f%an%x1f%ar%x1f%s%x1e";

const FILE_STATUS_ORDER: Record<DiffFileStatus, number> = {
	modified: 0,
	added: 1,
	untracked: 2,
	ignored: 3,
	renamed: 4,
	deleted: 5,
	copied: 6,
};

// ─── Pure helpers (formatting, math) ───────────────────────────────────────

function clamp(n: number, min: number, max: number): number {
	if (n < min) return min;
	if (n > max) return max;
	return n;
}

function expandTabs(s: string, tabSize = 4): string {
	return s.replace(/\t/g, " ".repeat(tabSize));
}

function basename(filePath: string): string {
	return filePath.split("/").pop() ?? filePath;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function sliceToDisplayWidth(value: string, maxWidth: number): string {
	if (maxWidth <= 0 || value.length === 0) return "";
	let result = "";
	let width = 0;
	for (const { segment } of graphemeSegmenter.segment(value)) {
		const segmentWidth = visibleWidth(segment);
		if (segmentWidth <= 0) {
			result += segment;
			continue;
		}
		if (width + segmentWidth > maxWidth) break;
		result += segment;
		width += segmentWidth;
	}
	return result;
}

function truncatePlainToWidth(value: string, maxWidth: number, ellipsis = "..."): string {
	if (maxWidth <= 0) return "";
	if (visibleWidth(value) <= maxWidth) return value;
	if (!ellipsis) return sliceToDisplayWidth(value, maxWidth);
	const ellipsisWidth = visibleWidth(ellipsis);
	if (ellipsisWidth >= maxWidth) return sliceToDisplayWidth(ellipsis, maxWidth);
	return `${sliceToDisplayWidth(value, maxWidth - ellipsisWidth)}${ellipsis}`;
}

// ─── Diff status parsing ───────────────────────────────────────────────────

function mapDiffStatusCode(code: string): DiffFileStatus {
	const c = code.charAt(0);
	if (c === "A") return "added";
	if (c === "D") return "deleted";
	if (c === "R") return "renamed";
	if (c === "C") return "copied";
	return "modified";
}

function parseStatus(code: string): DiffFileStatus {
	const second = code.charAt(1);
	const effective = second !== " " && second !== "?" ? second : code.charAt(0);
	if (code === "!!") return "ignored";
	if (code === "??") return "untracked";
	if (effective === "A") return "added";
	if (effective === "D") return "deleted";
	if (effective === "R") return "renamed";
	if (effective === "C") return "copied";
	return "modified";
}

function parseNameStatusZ(stdout: string): ParsedDiffEntry[] {
	if (!stdout) return [];
	const tokens = stdout.split("\0").filter((token) => token.length > 0);
	const entries: ParsedDiffEntry[] = [];

	for (let i = 0; i < tokens.length; i++) {
		const rawCode = (tokens[i] ?? "").trim();
		if (!rawCode) continue;
		const code = rawCode.charAt(0);
		if (code === "R" || code === "C") {
			const previousPath = tokens[i + 1];
			const newPath = tokens[i + 2];
			if (!newPath) break;
			entries.push({
				path: newPath,
				status: mapDiffStatusCode(rawCode),
				rawStatus: rawCode,
				previousPath: previousPath ?? null,
			});
			i += 2;
			continue;
		}
		const filePath = tokens[i + 1];
		if (!filePath) break;
		entries.push({
			path: filePath,
			status: mapDiffStatusCode(rawCode),
			rawStatus: rawCode,
		});
		i += 1;
	}
	return entries;
}

function parsePorcelainStatusZ(stdout: string): ParsedDiffEntry[] {
	if (!stdout) return [];
	const statusParts = stdout.split("\0").filter(Boolean);
	const entries: ParsedDiffEntry[] = [];

	for (let i = 0; i < statusParts.length; i++) {
		const entry = statusParts[i] ?? "";
		if (entry.length < 4) continue;
		const raw = entry.slice(0, 2);
		const filePath = entry.slice(3);
		let previousPath: string | null = null;
		if ((raw.startsWith("R") || raw.startsWith("C")) && statusParts[i + 1]) {
			previousPath = statusParts[i + 1] ?? null;
			i += 1;
		}
		if (!filePath) continue;
		entries.push({
			path: filePath,
			status: parseStatus(raw),
			rawStatus: raw.trim() || raw,
			previousPath,
		});
	}
	return entries;
}

function toCommitState(hasCommitted: boolean, hasWorking: boolean): CommitState {
	if (hasCommitted && hasWorking) return "both";
	if (hasCommitted) return "committed";
	return "uncommitted";
}

function mergeDiffEntries(
	committedEntries: ParsedDiffEntry[],
	workingEntries: ParsedDiffEntry[],
): MergedDiffEntry[] {
	const byPath = new Map<string, { committed?: ParsedDiffEntry; working?: ParsedDiffEntry }>();

	for (const entry of committedEntries) {
		const prev = byPath.get(entry.path);
		if (prev) prev.committed = entry;
		else byPath.set(entry.path, { committed: entry });
	}
	for (const entry of workingEntries) {
		const prev = byPath.get(entry.path);
		if (prev) prev.working = entry;
		else byPath.set(entry.path, { working: entry });
	}

	const merged: MergedDiffEntry[] = [];
	for (const [filePath, value] of byPath.entries()) {
		const source = value.working ?? value.committed;
		if (!source) continue;
		merged.push({
			path: filePath,
			status: source.status,
			rawStatus: source.rawStatus,
			previousPath: value.committed?.previousPath ?? source.previousPath,
			commitState: toCommitState(Boolean(value.committed), Boolean(value.working)),
		});
	}

	merged.sort(
		(a, b) => (FILE_STATUS_ORDER[a.status] ?? 9) - (FILE_STATUS_ORDER[b.status] ?? 9) || a.path.localeCompare(b.path),
	);
	return merged;
}

function commitStateBadge(state: CommitState): string {
	if (state === "committed") return "C";
	if (state === "uncommitted") return "W";
	return "C+W";
}

function toggleOverlayViewMode(mode: OverlayViewMode): OverlayViewMode {
	return mode === "diff" ? "commit" : "diff";
}

function cycleOverlayDiffScope(scope: OverlayDiffScope): OverlayDiffScope {
	if (scope === "branch") return "working";
	if (scope === "working") return "last-commit";
	return "branch";
}

// ─── Search / filter ───────────────────────────────────────────────────────

function normalizeOverlaySearchQuery(query: string): string {
	return query.trim().toLowerCase().replace(/\s+/g, "");
}

function scoreOverlayPathMatch(query: string, candidate: string): number {
	if (!query) return 0;
	let queryIndex = 0;
	let score = 0;
	let firstMatchIndex = -1;
	let previousMatchIndex = -2;

	for (let i = 0; i < candidate.length && queryIndex < query.length; i++) {
		if (candidate[i] !== query[queryIndex]) continue;
		if (firstMatchIndex === -1) firstMatchIndex = i;
		score += 10;
		if (i === previousMatchIndex + 1) score += 8;
		const previousChar = i > 0 ? candidate[i - 1] : "";
		if (i === 0 || previousChar === "/" || previousChar === "_" || previousChar === "-" || previousChar === ".") {
			score += 12;
		}
		previousMatchIndex = i;
		queryIndex += 1;
	}

	if (queryIndex !== query.length) return -1;
	if (firstMatchIndex >= 0) score += Math.max(0, 20 - firstMatchIndex);
	return score;
}

function filterEntriesByOverlayQuery<T extends { path: string; previousPath?: string | null }>(
	entries: T[],
	query: string,
): T[] {
	const normalizedQuery = normalizeOverlaySearchQuery(query);
	if (!normalizedQuery) return [...entries];

	return entries
		.map((entry) => {
			const p = entry.path.toLowerCase();
			const baseName = p.split("/").pop() ?? p;
			const previousPath = (entry.previousPath ?? "").toLowerCase();
			const pathScore = scoreOverlayPathMatch(normalizedQuery, p);
			const baseScore = scoreOverlayPathMatch(normalizedQuery, baseName);
			const previousScore = previousPath ? scoreOverlayPathMatch(normalizedQuery, previousPath) : -1;
			let score = Math.max(
				pathScore,
				baseScore >= 0 ? baseScore + 40 : -1,
				previousScore >= 0 ? previousScore + 25 : -1,
			);
			if (score < 0) return { entry, score };
			if (baseName === normalizedQuery) score += 200;
			else if (baseName.startsWith(normalizedQuery)) score += 120;
			else if (p.includes(normalizedQuery) || previousPath.includes(normalizedQuery)) score += 35;
			return { entry, score };
		})
		.filter((item) => item.score >= 0)
		.sort((a, b) => b.score - a.score || a.entry.path.localeCompare(b.entry.path))
		.map((item) => item.entry);
}

// ─── File tree ─────────────────────────────────────────────────────────────

interface TempDir {
	children: Map<string, TempDir>;
	files: string[];
}

function buildFileTree(paths: string[]): FileTreeNode[] {
	const root: TempDir = { children: new Map(), files: [] };

	for (const filePath of paths) {
		const parts = filePath.split("/");
		let current = root;
		for (let i = 0; i < parts.length - 1; i++) {
			const dirName = parts[i];
			if (!current.children.has(dirName)) {
				current.children.set(dirName, { children: new Map(), files: [] });
			}
			const next = current.children.get(dirName);
			if (!next) throw new Error(`Missing tree node for directory: ${dirName}`);
			current = next;
		}
		current.files.push(filePath);
	}

	function convert(dir: TempDir, parentPath: string): FileTreeNode[] {
		const nodes: FileTreeNode[] = [];
		const sortedDirs = [...dir.children.entries()].sort(([a], [b]) => a.localeCompare(b));
		const sortedFiles = [...dir.files].sort((a, b) => {
			const aName = a.split("/").pop() ?? a;
			const bName = b.split("/").pop() ?? b;
			return aName.localeCompare(bName);
		});
		for (const [name, subDir] of sortedDirs) {
			const fullPath = parentPath ? `${parentPath}/${name}` : name;
			nodes.push({ type: "dir", name, fullPath, children: convert(subDir, fullPath) });
		}
		for (const filePath of sortedFiles) {
			nodes.push({ type: "file", name: filePath.split("/").pop() ?? filePath, fullPath: filePath });
		}
		return nodes;
	}

	return convert(root, "");
}

function collapseFileTree(nodes: FileTreeNode[]): FileTreeNode[] {
	return nodes.map((node) => {
		if (node.type === "file") return node;
		let collapsed: DirTreeNode = { ...node, children: collapseFileTree(node.children) };
		while (collapsed.children.length === 1 && collapsed.children[0].type === "dir") {
			const child = collapsed.children[0];
			collapsed = {
				type: "dir",
				name: `${collapsed.name}/${child.name}`,
				fullPath: child.fullPath,
				children: child.children,
			};
		}
		return collapsed;
	});
}

function flattenVisibleTree(nodes: FileTreeNode[], expandedDirs: Set<string>, depth = 0): VisibleRow[] {
	const rows: VisibleRow[] = [];
	for (const node of nodes) {
		if (node.type === "file") {
			rows.push({ type: "file", depth, fullPath: node.fullPath, name: node.name });
		} else {
			const expanded = expandedDirs.has(node.fullPath);
			rows.push({ type: "dir", depth, fullPath: node.fullPath, name: node.name, expanded });
			if (expanded) rows.push(...flattenVisibleTree(node.children, expandedDirs, depth + 1));
		}
	}
	return rows;
}

function collectAllDirPaths(nodes: FileTreeNode[]): string[] {
	const paths: string[] = [];
	for (const node of nodes) {
		if (node.type === "dir") {
			paths.push(node.fullPath);
			paths.push(...collectAllDirPaths(node.children));
		}
	}
	return paths;
}

// ─── Diff parsing & syntax highlight ───────────────────────────────────────

function parseHunkHeader(line: string): { oldStart: number; newStart: number; newCount: number } | null {
	const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
	if (!match) return null;
	const oldStart = Number(match[1]);
	const newStart = Number(match[2]);
	const newCount = match[3] ? Number(match[3]) : 1;
	if (!Number.isInteger(oldStart) || !Number.isInteger(newStart)) return null;
	return { oldStart, newStart, newCount };
}

interface HunkInfo {
	index: number;
	startLine: number;
	endLine: number;
	label: string;
}

function extractHunksFromDiff(rawDiff: string): HunkInfo[] {
	const lines = rawDiff.split("\n");
	const hunks: HunkInfo[] = [];
	let hunkIndex = 0;
	for (const line of lines) {
		if (line.startsWith("@@")) {
			const header = parseHunkHeader(line);
			if (header) {
				hunkIndex++;
				const endLine = header.newStart + header.newCount - 1;
				const label = header.newStart === endLine
					? `Hunk ${hunkIndex}: L${header.newStart}`
					: `Hunk ${hunkIndex}: L${header.newStart}-${endLine}`;
				hunks.push({
					index: hunkIndex,
					startLine: header.newStart,
					endLine,
					label,
				});
			}
		}
	}
	return hunks;
}

function parseDiffLines(rawDiff: string): ParsedDiffLine[] {
	if (rawDiff === "") return [{ category: "context", prefix: "", code: "", originalLine: "" }];
	const lines = rawDiff.split("\n");
	let inHunk = lines.length > 0 && !lines[0].startsWith("diff ");
	let oldLineNumber = inHunk ? 1 : 0;
	let newLineNumber = inHunk ? 1 : 0;

	return lines.map((line): ParsedDiffLine => {
		if (line.startsWith("diff ")) {
			inHunk = false;
			oldLineNumber = 0;
			newLineNumber = 0;
			return { category: "meta", prefix: "", code: "", originalLine: line };
		}
		if (line.startsWith("@@")) {
			inHunk = true;
			const header = parseHunkHeader(line);
			if (header) {
				oldLineNumber = header.oldStart;
				newLineNumber = header.newStart;
			}
			return { category: "hunk", prefix: "", code: "", originalLine: line };
		}
		if (!inHunk) return { category: "meta", prefix: "", code: "", originalLine: line };

		if (line.startsWith("+")) {
			const parsed: ParsedDiffLine = {
				category: "added",
				prefix: "+",
				code: line.slice(1),
				originalLine: line,
				newLineNumber,
			};
			newLineNumber += 1;
			return parsed;
		}
		if (line.startsWith("-")) {
			const parsed: ParsedDiffLine = {
				category: "removed",
				prefix: "-",
				code: line.slice(1),
				originalLine: line,
				oldLineNumber,
			};
			oldLineNumber += 1;
			return parsed;
		}
		if (line.startsWith(" ")) {
			const parsed: ParsedDiffLine = {
				category: "context",
				prefix: " ",
				code: line.slice(1),
				originalLine: line,
				oldLineNumber,
				newLineNumber,
			};
			oldLineNumber += 1;
			newLineNumber += 1;
			return parsed;
		}
		if (line.startsWith("\\")) {
			return { category: "meta", prefix: "", code: "", originalLine: line };
		}
		const parsed: ParsedDiffLine = {
			category: "context",
			prefix: "",
			code: line,
			originalLine: line,
			oldLineNumber,
			newLineNumber,
		};
		oldLineNumber += 1;
		newLineNumber += 1;
		return parsed;
	});
}

function extractCodeBlock(parsed: ParsedDiffLine[]): { code: string; indices: number[] } {
	const codeLines: string[] = [];
	const indices: number[] = [];
	for (let i = 0; i < parsed.length; i++) {
		const line = parsed[i];
		if (line.category === "added" || line.category === "removed" || line.category === "context") {
			codeLines.push(line.code);
			indices.push(i);
		}
	}
	return { code: codeLines.join("\n"), indices };
}

function applyHighlightToDiff(
	parsed: ParsedDiffLine[],
	highlightedCode: string[],
	colorMeta: (line: string) => string,
	colorHunk: (line: string) => string,
	colorPrefix: (category: "added" | "removed" | "context", prefix: string) => string,
): string[] {
	const result: string[] = [];
	let codeIdx = 0;
	for (const line of parsed) {
		if (line.category === "meta") {
			result.push(colorMeta(line.originalLine));
		} else if (line.category === "hunk") {
			result.push(colorHunk(line.originalLine));
		} else {
			const hlContent = highlightedCode[codeIdx] ?? line.code;
			codeIdx++;
			const coloredPrefix = colorPrefix(line.category, line.prefix);
			result.push(`${coloredPrefix}${hlContent}`);
		}
	}
	return result;
}

function parseGitLogOutput(stdout: string): BranchCommitEntry[] {
	if (!stdout) return [];
	const rows = stdout.split("\x1e").map((line) => line.trim()).filter(Boolean);
	const commits: BranchCommitEntry[] = [];
	for (const row of rows) {
		const [hash = "", shortHash = "", author = "", relativeDate = "", subject = ""] = row.split("\x1f");
		if (!hash || !shortHash) continue;
		commits.push({ hash, shortHash, author, relativeDate, subject });
	}
	return commits;
}

// ─── Domain helpers ────────────────────────────────────────────────────────

function commitDiffKey(commitHash: string, filePath: string): string {
	return `${commitHash}\x00${filePath}`;
}

function scopedDiffKey(scope: OverlayDiffScope, filePath: string): string {
	return `${scope}\x00${filePath}`;
}

function scopeLabel(scope: OverlayDiffScope): string {
	if (scope === "branch") return "branch";
	if (scope === "working") return "working";
	return "last commit";
}

function scopeFilesLabel(scope: OverlayDiffScope): string {
	if (scope === "branch") return "branch changes";
	if (scope === "working") return "working tree";
	return "last commit";
}

function fileDisplayPath(file: { path: string; previousPath?: string | null }): string {
	return file.previousPath ? `${file.previousPath} → ${file.path}` : file.path;
}

function fileTreeLabel(file: { path: string; previousPath?: string | null }, fallbackName: string): string {
	if (!file.previousPath) return fallbackName;
	return `${basename(file.previousPath)} → ${fallbackName}`;
}

function buildReviewTransferPrompt(drafts: ReviewDraft[]): string {
	if (drafts.length === 0) return "";
	const lines: string[] = [];
	for (const [index, draft] of drafts.entries()) {
		const lineInfo = draft.lineRange ? `:${draft.lineRange}` : "";
		lines.push(`${index + 1}. [${scopeLabel(draft.scope)}] ${draft.fileDisplayPath}${lineInfo}`);
		lines.push(`   ${draft.prompt}`);
		lines.push("");
	}
	return lines.join("\n").trim();
}

interface CommitRowsMeta {
	totalRows: number;
	fileStarts: number[];
	fileEnds: number[];
}

function overlayContentHeight(totalHeight: number): number {
	const bodyHeight = Math.max(3, totalHeight - 6);
	return Math.max(1, bodyHeight - 2);
}

function isCommitFileMarkerLine(line: string): boolean {
	return /^(\+\+\+|---)\s/.test(line);
}

function shouldHideCommitParsedLine(line: ParsedDiffLine | undefined): boolean {
	if (!line || line.category !== "meta") return false;
	return line.originalLine.startsWith("diff ") || isCommitFileMarkerLine(line.originalLine);
}

function shouldHideDiffMetaLine(line: ParsedDiffLine | undefined): boolean {
	if (!line || line.category !== "meta") return false;
	return !line.originalLine.startsWith("\\");
}

function buildCommitRowsMeta(
	files: CommitFile[],
	commitHash: string,
	expanded: Set<string>,
	diffCache: Map<string, string>,
): CommitRowsMeta {
	let row = 0;
	const fileStarts: number[] = [];
	const fileEnds: number[] = [];

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		fileStarts[i] = row;
		row += 1;
		if (expanded.has(file.path)) {
			const raw = diffCache.get(commitDiffKey(commitHash, file.path));
			if (raw === undefined) {
				row += 1;
			} else {
				const parsed = parseDiffLines(raw);
				const visibleDiffLines = parsed.filter((line) => !shouldHideCommitParsedLine(line));
				row += Math.max(1, visibleDiffLines.length);
			}
		}
		fileEnds[i] = row - 1;
	}

	return { totalRows: row, fileStarts, fileEnds };
}

// ─── Tree state helpers ────────────────────────────────────────────────────

function rebuildTree(files: DiffFile[]): { treeNodes: FileTreeNode[]; expandedDirs: Set<string> } {
	const treeNodes = collapseFileTree(buildFileTree(files.map((f) => f.path)));
	const expandedDirs = new Set(collectAllDirPaths(treeNodes));
	return { treeNodes, expandedDirs };
}

function getVisibleRows(st: DiffState): VisibleRow[] {
	return flattenVisibleTree(st.treeNodes, st.expandedDirs);
}

function findFileByPath(st: DiffState, filePath: string | null): DiffFile | null {
	if (!filePath) return null;
	return st.files.find((f) => f.path === filePath) ?? null;
}

function saveDiffScroll(st: DiffState): void {
	if (!st.selectedFilePath) return;
	st.diffScrollMemory.set(scopedDiffKey(st.scope, st.selectedFilePath), st.diffScrollOffset);
}

function restoreDiffScroll(st: DiffState): void {
	if (!st.selectedFilePath) {
		st.diffScrollOffset = 0;
		return;
	}
	st.diffScrollOffset = st.diffScrollMemory.get(scopedDiffKey(st.scope, st.selectedFilePath)) ?? 0;
}

function applyScopeFiles(st: DiffState): void {
	const scopedFiles = st.filesByScope[st.scope] ?? [];
	st.files = filterEntriesByOverlayQuery(scopedFiles, st.searchQuery);

	const { treeNodes, expandedDirs } = rebuildTree(st.files);
	st.treeNodes = treeNodes;
	st.expandedDirs = expandedDirs;

	const visibleRows = getVisibleRows(st);
	const preferredPath = st.selectedFilePathByScope[st.scope];
	const hasPreferred = preferredPath ? st.files.some((file) => file.path === preferredPath) : false;
	const firstFileRow = visibleRows.find((row) => row.type === "file");
	st.selectedFilePath = hasPreferred ? preferredPath : firstFileRow?.type === "file" ? firstFileRow.fullPath : null;
	st.selectedFilePathByScope[st.scope] = st.selectedFilePath;

	const nextIndex = st.selectedFilePath
		? visibleRows.findIndex((row) => row.type === "file" && row.fullPath === st.selectedFilePath)
		: -1;
	st.selectedIndex = clamp(nextIndex >= 0 ? nextIndex : 0, 0, Math.max(0, visibleRows.length - 1));
	st.fileScrollOffset = clamp(st.fileScrollOffset, 0, Math.max(0, visibleRows.length - 1));
	restoreDiffScroll(st);
}

// ─── Syntax highlighted diff builder ───────────────────────────────────────

function buildHighlightedDiff(rawDiff: string, filePath: string, t: Theme): string[] {
	const expanded = rawDiff.split("\n").map((l) => expandTabs(l)).join("\n");
	const parsed = parseDiffLines(expanded);
	const lang = getLanguageFromPath(filePath);
	const { code } = extractCodeBlock(parsed);
	const highlighted = lang ? highlightCode(code, lang) : code.split("\n");

	return applyHighlightToDiff(
		parsed,
		highlighted,
		(line) => {
			if (line.startsWith("+++") || line.startsWith("---")) return t.fg("muted", line);
			return t.fg("dim", line);
		},
		(line) => t.fg("accent", line),
		(category, prefix) => {
			if (category === "added") return t.fg("success", prefix);
			if (category === "removed") return t.fg("error", prefix);
			return prefix;
		},
	);
}

// ─── Git command helpers ───────────────────────────────────────────────────

async function gitRoot(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	return r.code === 0 ? (r.stdout ?? "").trim() || null : null;
}

async function currentBranch(pi: ExtensionAPI, cwd: string): Promise<string> {
	const r = await pi.exec("git", ["branch", "--show-current"], { cwd });
	return r.code === 0 ? (r.stdout ?? "").trim() || "HEAD" : "HEAD";
}

interface MergeBaseInfo {
	commit: string;
	baseBranch: string;
}

async function findMergeBase(pi: ExtensionAPI, cwd: string, branch: string): Promise<MergeBaseInfo | null> {
	const defaults = ["main", "master", "develop"];
	if (defaults.includes(branch) || branch === "HEAD") return null;

	const symRef = await pi.exec("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "--short"], { cwd });
	if (symRef.code === 0 && symRef.stdout?.trim()) {
		const defaultBranch = symRef.stdout.trim().replace(/^origin\//, "");
		if (defaultBranch !== branch) {
			const r = await pi.exec("git", ["merge-base", branch, `origin/${defaultBranch}`], { cwd });
			if (r.code === 0 && r.stdout?.trim()) {
				return { commit: r.stdout.trim(), baseBranch: defaultBranch };
			}
		}
	}

	for (const base of defaults) {
		if (base === branch) continue;
		const r = await pi.exec("git", ["merge-base", branch, `origin/${base}`], { cwd });
		if (r.code === 0 && r.stdout?.trim()) return { commit: r.stdout.trim(), baseBranch: base };
	}
	return null;
}

async function repositoryHasHead(pi: ExtensionAPI, cwd: string): Promise<boolean> {
	const r = await pi.exec("git", ["rev-parse", "--verify", "HEAD"], { cwd });
	return r.code === 0;
}

async function committedFiles(pi: ExtensionAPI, cwd: string, mergeBase: string | null): Promise<DiffFile[]> {
	if (!mergeBase) return [];
	const r = await pi.exec("git", ["diff", "--name-status", "-z", `${mergeBase}..HEAD`], { cwd });
	if (r.code !== 0 || !r.stdout) return [];
	return parseNameStatusZ(r.stdout).map((entry) => ({ ...entry, commitState: "committed" as CommitState }));
}

async function workingTreeFiles(pi: ExtensionAPI, cwd: string): Promise<DiffFile[]> {
	const r = await pi.exec("git", ["status", "--porcelain=1", "-uall", "--ignored", "-z"], { cwd });
	if (r.code !== 0 || !r.stdout) return [];
	const IGNORED_DIRS = ["node_modules/", "dist/", ".git/", ".DS_Store"];
	return parsePorcelainStatusZ(r.stdout)
		.filter((entry) => entry.status !== "ignored" || !IGNORED_DIRS.some((d) => entry.path.startsWith(d) || entry.path === d.replace("/", "")))
		.map((entry) => ({ ...entry, commitState: "uncommitted" as CommitState }));
}

async function lastCommitFiles(pi: ExtensionAPI, cwd: string): Promise<DiffFile[]> {
	if (!(await repositoryHasHead(pi, cwd))) return [];
	const r = await pi.exec("git", ["show", "--name-status", "--format=", "-z", "HEAD"], { cwd });
	if (r.code !== 0 || !r.stdout) return [];
	return parseNameStatusZ(r.stdout).map((entry) => ({ ...entry, commitState: "committed" as CommitState }));
}

async function changedFiles(pi: ExtensionAPI, cwd: string, mergeBase: string | null): Promise<DiffFile[]> {
	const [committed, working] = await Promise.all([committedFiles(pi, cwd, mergeBase), workingTreeFiles(pi, cwd)]);
	return mergeDiffEntries(committed, working) as DiffFile[];
}

async function branchCommits(pi: ExtensionAPI, cwd: string, mergeBase: string | null): Promise<BranchCommitEntry[]> {
	const range = mergeBase ? `${mergeBase}..HEAD` : "HEAD";
	const r = await pi.exec(
		"git",
		["log", "--no-color", `--max-count=${COMMIT_HISTORY_LIMIT}`, `--pretty=format:${GIT_LOG_PRETTY}`, range],
		{ cwd },
	);

	const commits = r.code === 0 && r.stdout ? parseGitLogOutput(r.stdout) : [];
	if (commits.length > 0 || !mergeBase) return commits;

	const fallback = await pi.exec(
		"git",
		[
			"log",
			"--no-color",
			`--max-count=${Math.min(50, COMMIT_HISTORY_LIMIT)}`,
			`--pretty=format:${GIT_LOG_PRETTY}`,
			"HEAD",
		],
		{ cwd },
	);
	if (fallback.code !== 0 || !fallback.stdout) return [];
	return parseGitLogOutput(fallback.stdout);
}

interface OverlayData {
	filesByScope: Record<OverlayDiffScope, DiffFile[]>;
	commits: BranchCommitEntry[];
	uncommittedFiles: DiffFile[];
}

async function loadOverlayData(pi: ExtensionAPI, cwd: string, mergeBase: string | null): Promise<OverlayData> {
	const [branchFiles, workingFiles, lastCommitScopeFiles, commits] = await Promise.all([
		changedFiles(pi, cwd, mergeBase),
		workingTreeFiles(pi, cwd),
		lastCommitFiles(pi, cwd),
		branchCommits(pi, cwd, mergeBase),
	]);

	return {
		filesByScope: {
			branch: branchFiles,
			working: workingFiles,
			"last-commit": lastCommitScopeFiles,
		},
		commits,
		uncommittedFiles: [...workingFiles],
	};
}

async function commitFilesForHash(pi: ExtensionAPI, cwd: string, commitHash: string): Promise<CommitFile[]> {
	const r = await pi.exec("git", ["show", "--name-status", "--format=", "-z", commitHash], { cwd });
	if (r.code !== 0 || !r.stdout) return [];
	return parseNameStatusZ(r.stdout);
}

async function asAddedFileDiff(pi: ExtensionAPI, cwd: string, filePath: string): Promise<string> {
	const r = await pi.exec("cat", [filePath], { cwd });
	if (r.code !== 0) return "(cannot read file)";
	return (r.stdout ?? "").split("\n").map((line) => `+ ${line}`).join("\n");
}

async function workingTreeFileDiff(
	pi: ExtensionAPI,
	cwd: string,
	file: { path: string; status: DiffFileStatus },
	contextArg?: string,
): Promise<string> {
	if (file.status === "untracked" || file.status === "ignored") return asAddedFileDiff(pi, cwd, file.path);

	if (await repositoryHasHead(pi, cwd)) {
		const args = ["diff", "--no-color"];
		if (contextArg) args.push(contextArg);
		args.push("HEAD", "--", file.path);
		const againstHead = await pi.exec("git", args, { cwd });
		if (againstHead.code === 0 && (againstHead.stdout ?? "").trim()) return (againstHead.stdout ?? "").trim();
	}

	const workingArgs = ["diff", "--no-color"];
	if (contextArg) workingArgs.push(contextArg);
	workingArgs.push("--", file.path);
	const working = await pi.exec("git", workingArgs, { cwd });

	const stagedArgs = ["diff", "--cached", "--no-color"];
	if (contextArg) stagedArgs.push(contextArg);
	stagedArgs.push("--", file.path);
	const staged = await pi.exec("git", stagedArgs, { cwd });

	if (working.code === 0 && (working.stdout ?? "").trim()) return (working.stdout ?? "").trim();
	if (staged.code === 0 && (staged.stdout ?? "").trim()) return (staged.stdout ?? "").trim();

	if (file.status === "added") return asAddedFileDiff(pi, cwd, file.path);
	return "(no diff available)";
}

async function commitFileDiff(pi: ExtensionAPI, cwd: string, commitHash: string, file: CommitFile, showFullFile = false): Promise<string> {
	const contextArg = showFullFile ? "-U99999" : undefined;
	if (commitHash === UNCOMMITTED_HASH) return workingTreeFileDiff(pi, cwd, file, contextArg);

	const primaryArgs = ["show", "--no-color", "--format=", "--diff-merges=first-parent"];
	if (contextArg) primaryArgs.push(contextArg);
	primaryArgs.push(commitHash, "--", file.path);
	const primary = await pi.exec("git", primaryArgs, { cwd });
	if (primary.code === 0 && (primary.stdout ?? "").trim()) return (primary.stdout ?? "").trim();

	const fallbackArgs = ["show", "--no-color", "--format="];
	if (contextArg) fallbackArgs.push(contextArg);
	fallbackArgs.push(commitHash, "--", file.path);
	const fallback = await pi.exec("git", fallbackArgs, { cwd });
	if (fallback.code === 0 && (fallback.stdout ?? "").trim()) return (fallback.stdout ?? "").trim();
	return "(no diff available)";
}

async function fileDiff(
	pi: ExtensionAPI,
	cwd: string,
	file: DiffFile,
	scope: OverlayDiffScope,
	mergeBase: string | null,
	showFullFile = false,
): Promise<string> {
	const contextArg = showFullFile ? "-U99999" : undefined;

	if (scope === "working") return workingTreeFileDiff(pi, cwd, file, contextArg);

	if (scope === "last-commit") {
		if (!(await repositoryHasHead(pi, cwd))) return "(no commit available)";
		const r = await pi.exec("git", ["show", "--no-color", "--format=", "HEAD", "--", file.path], { cwd });
		if (r.code === 0 && (r.stdout ?? "").trim()) return (r.stdout ?? "").trim();
		return "(no diff available)";
	}

	if (file.status === "untracked" || file.status === "ignored") return asAddedFileDiff(pi, cwd, file.path);

	if (mergeBase) {
		const args = ["diff", "--no-color"];
		if (contextArg) args.push(contextArg);
		args.push(mergeBase, "--", file.path);
		const r = await pi.exec("git", args, { cwd });
		if (r.code === 0 && (r.stdout ?? "").trim()) return (r.stdout ?? "").trim();
	}

	return workingTreeFileDiff(pi, cwd, file, contextArg);
}

// ─── Render helpers ────────────────────────────────────────────────────────

function icon(s: DiffFileStatus): string {
	if (s === "added" || s === "untracked" || s === "ignored") return "+";
	if (s === "deleted") return "-";
	if (s === "renamed") return "→";
	if (s === "copied") return "©";
	return "~";
}

function statusColor(s: DiffFileStatus): ThemeColor {
	if (s === "added" || s === "untracked" || s === "ignored") return "success";
	if (s === "deleted") return "error";
	return "warning";
}

function commitStateColor(state: CommitState): ThemeColor {
	if (state === "both") return "accent";
	if (state === "committed") return "success";
	return "warning";
}

function colorDiffLine(t: Theme, line: string): string {
	if (isCommitFileMarkerLine(line)) return t.fg("muted", line);
	if (line.startsWith("+")) return t.fg("success", line);
	if (line.startsWith("-")) return t.fg("error", line);
	if (line.startsWith("@@")) return t.fg("accent", line);
	if (line.startsWith("diff ") || line.startsWith("index ")) return t.fg("dim", line);
	return line;
}

function padStyledLine(line: string, width: number): string {
	const truncated = truncateToWidth(line, width, "");
	const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
	return `${truncated}${pad}`;
}

function diffLineNumberWidth(parsed: ParsedDiffLine[]): number {
	const maxLineNumber = parsed.reduce(
		(max, line) => Math.max(max, line.oldLineNumber ?? 0, line.newLineNumber ?? 0),
		0,
	);
	return Math.max(3, String(maxLineNumber || 0).length);
}

function buildCommitRenderedDiffLines(
	t: Theme,
	rawDiff: string,
	width: number,
	wrapLines: boolean,
): RenderedDiffLine[] {
	const parsed = parseDiffLines(rawDiff);
	const lineNumberWidth = diffLineNumberWidth(parsed);
	const blankLineNumber = " ".repeat(lineNumberWidth);
	const rendered: RenderedDiffLine[] = [];

	for (const line of parsed) {
		if (shouldHideCommitParsedLine(line)) continue;
		const oldNumber = line.oldLineNumber ? String(line.oldLineNumber).padStart(lineNumberWidth, " ") : blankLineNumber;
		const newNumber = line.newLineNumber ? String(line.newLineNumber).padStart(lineNumberWidth, " ") : blankLineNumber;
		const gutter = t.fg("muted", `${oldNumber} ${newNumber} │`);
		const content = colorDiffLine(t, expandTabs(line.originalLine));
		const contentWidth = Math.max(1, width - visibleWidth(gutter) - 1);

		if (wrapLines) {
			const wrapped = wrapTextWithAnsi(` ${content}`, contentWidth);
			for (const [segmentIndex, segment] of wrapped.entries()) {
				const lineGutter = segmentIndex === 0 ? gutter : t.fg("muted", `${blankLineNumber} ${blankLineNumber} │`);
				rendered.push({ text: padStyledLine(`${lineGutter} ${segment}`, width), category: line.category, newLineNumber: segmentIndex === 0 ? line.newLineNumber : undefined });
			}
			continue;
		}

		rendered.push({ text: padStyledLine(`${gutter} ${content}`, width), category: line.category, newLineNumber: line.newLineNumber });
	}

	return rendered;
}

interface RenderedDiffLine {
	text: string;
	category: DiffLineCategory;
	newLineNumber?: number;
}

function buildRenderedDiffLines(
	t: Theme,
	all: string[],
	parsed: ParsedDiffLine[],
	width: number,
	wrapLines: boolean,
	changedOnly: boolean,
): RenderedDiffLine[] {
	const rendered: RenderedDiffLine[] = [];
	const lineNumberWidth = diffLineNumberWidth(parsed);
	const blankLineNumber = " ".repeat(lineNumberWidth);

	for (let i = 0; i < all.length; i++) {
		const text = all[i] ?? "";
		const line = parsed[i];
		const category = line?.category ?? "context";
		if (shouldHideDiffMetaLine(line)) continue;
		if (changedOnly && category === "context") continue;

		const oldNumber = line?.oldLineNumber ? String(line.oldLineNumber).padStart(lineNumberWidth, " ") : blankLineNumber;
		const newNumber = line?.newLineNumber ? String(line.newLineNumber).padStart(lineNumberWidth, " ") : blankLineNumber;
		const gutter = t.fg("muted", `${oldNumber} ${newNumber} │`);
		const contentWidth = Math.max(1, width - visibleWidth(gutter) - 1);

		if (wrapLines) {
			const wrapped = wrapTextWithAnsi(` ${text}`, contentWidth);
			for (const [segmentIndex, segment] of wrapped.entries()) {
				const lineGutter = segmentIndex === 0 ? gutter : t.fg("muted", `${blankLineNumber} ${blankLineNumber} │`);
				rendered.push({ text: padStyledLine(`${lineGutter} ${segment}`, width), category, newLineNumber: segmentIndex === 0 ? line?.newLineNumber : undefined });
			}
			continue;
		}

		rendered.push({ text: padStyledLine(`${gutter} ${text}`, width), category, newLineNumber: line?.newLineNumber });
	}

	return rendered;
}

function countRenderedDiffLines(
	all: string[],
	parsed: ParsedDiffLine[],
	width: number,
	wrapLines: boolean,
	changedOnly: boolean,
): number {
	const lineNumberWidth = diffLineNumberWidth(parsed);
	const gutterWidth = lineNumberWidth * 2 + 4;
	const contentWidth = Math.max(1, width - gutterWidth - 1);
	let count = 0;

	for (let i = 0; i < all.length; i++) {
		const line = parsed[i];
		const category = line?.category ?? "context";
		if (shouldHideDiffMetaLine(line)) continue;
		if (changedOnly && category === "context") continue;
		if (wrapLines) count += wrapTextWithAnsi(` ${all[i] ?? ""}`, contentWidth).length;
		else count += 1;
	}

	return count;
}

// ─── Pane renderers ────────────────────────────────────────────────────────

function renderFiles(t: Theme, st: DiffState, w: number, h: number): string[] {
	const visibleRows = getVisibleRows(st);
	if (visibleRows.length === 0) {
		return [t.fg("muted", st.searchQuery ? ` (no files match: ${st.searchQuery})` : " (no changes)")];
	}

	const active = st.focus === "left";
	const max = Math.max(1, h);

	st.selectedIndex = clamp(st.selectedIndex, 0, Math.max(0, visibleRows.length - 1));
	if (st.selectedIndex < st.fileScrollOffset) st.fileScrollOffset = st.selectedIndex;
	if (st.selectedIndex >= st.fileScrollOffset + max) st.fileScrollOffset = st.selectedIndex - max + 1;

	const start = st.fileScrollOffset;
	const end = Math.min(visibleRows.length, start + max);
	const lines: string[] = [];
	const fileByPath = new Map(st.files.map((f) => [f.path, f]));

	for (let i = start; i < end; i++) {
		const row = visibleRows[i];
		const sel = i === st.selectedIndex;
		const indent = " ".repeat(row.depth * 2);
		const cursor = sel ? (active ? t.fg("accent", "▶") : t.fg("muted", "▸")) : " ";

		if (row.type === "dir") {
			const fold = row.expanded ? "▾" : "▸";
			const foldColored = row.expanded ? t.fg("accent", fold) : t.fg("dim", fold);
			const prefix = `${cursor} ${indent}${foldColored} `;
			const nameW = Math.max(4, w - visibleWidth(prefix) - 1);
			const dirLabel = truncatePlainToWidth(`${row.name}/`, nameW);
			const dirName =
				sel && active ? t.fg("accent", t.bold(dirLabel)) : sel ? t.fg("muted", dirLabel) : t.fg("muted", dirLabel);
			lines.push(truncateToWidth(`${prefix}${dirName}`, w, ""));
		} else {
			const file = fileByPath.get(row.fullPath);
			const reviewCount = file ? st.reviewDrafts.filter((draft) => draft.filePath === file.path).length : 0;
			const reviewMark = reviewCount > 0 ? t.fg("accent", String(reviewCount)) : t.fg("dim", "·");
			const ic = file ? t.fg(statusColor(file.status), icon(file.status)) : " ";
			const badge = file ? t.fg(commitStateColor(file.commitState), `[${commitStateBadge(file.commitState)}]`) : "";
			const prefix = `${cursor} ${indent}${reviewMark} ${ic} ${badge} `;
			const nameW = Math.max(4, w - visibleWidth(prefix));
			const fileName = file ? fileTreeLabel(file, row.name) : row.name;

			let label: string;
			const fileLabel = truncatePlainToWidth(fileName, nameW);
			if (sel && active) label = t.fg("accent", fileLabel);
			else if (sel) label = t.fg("muted", fileLabel);
			else label = t.fg("text", fileLabel);
			lines.push(truncateToWidth(`${prefix}${label}`, w, ""));
		}
	}

	if (visibleRows.length > max) {
		const info = t.fg("dim", ` ${start + 1}–${end}/${visibleRows.length}`);
		while (lines.length < max) lines.push("");
		lines[max - 1] = info;
	}

	while (lines.length < max) lines.push("");
	return lines;
}

function renderCommits(t: Theme, st: DiffState, w: number, h: number): string[] {
	if (st.commits.length === 0) return [t.fg("muted", " (no commits in branch scope)")];

	const active = st.focus === "left";
	const max = Math.max(1, h);
	st.commitSelectedIndex = clamp(st.commitSelectedIndex, 0, Math.max(0, st.commits.length - 1));

	if (st.commitSelectedIndex < st.commitScrollOffset) st.commitScrollOffset = st.commitSelectedIndex;
	if (st.commitSelectedIndex >= st.commitScrollOffset + max) st.commitScrollOffset = st.commitSelectedIndex - max + 1;

	const start = st.commitScrollOffset;
	const end = Math.min(st.commits.length, start + max);
	const lines: string[] = [];

	for (let i = start; i < end; i++) {
		const c = st.commits[i];
		const sel = i === st.commitSelectedIndex;
		const cursor = sel ? (active ? t.fg("accent", "▶") : t.fg("muted", "▸")) : " ";
		const isUncommitted = c.hash === UNCOMMITTED_HASH;

		if (isUncommitted) {
			const marker = t.fg(sel && active ? "accent" : "warning", "●●●");
			const prefix = `${cursor} ${marker} `;
			const subjectW = Math.max(4, w - visibleWidth(prefix));
			const subjectText = truncatePlainToWidth(c.subject, subjectW);
			const subject = sel && active ? t.fg("accent", subjectText) : t.fg("warning", subjectText);
			lines.push(truncateToWidth(`${prefix}${subject}`, w, ""));
		} else {
			const hash = t.fg(sel && active ? "accent" : "muted", c.shortHash);
			const meta = c.author || c.relativeDate
				? t.fg("dim", ` ${[c.author, c.relativeDate].filter(Boolean).join(" · ")}`)
				: "";
			const prefix = `${cursor} ${hash} `;
			const subjectW = Math.max(4, w - visibleWidth(prefix) - visibleWidth(meta));
			const subjectText = truncatePlainToWidth(c.subject, Math.max(4, subjectW));
			const subject = sel && active ? t.fg("accent", subjectText) : t.fg("text", subjectText);
			lines.push(truncateToWidth(`${prefix}${subject}${meta}`, w, ""));
		}
	}

	if (st.commits.length > max) {
		const info = t.fg("dim", ` ${start + 1}–${end}/${st.commits.length}`);
		while (lines.length < max) lines.push("");
		lines[max - 1] = info;
	}

	while (lines.length < max) lines.push("");
	return lines;
}

function parseLineRange(range: string): { start: number; end: number } | null {
	const match = /^(\d+)(?:-(\d+))?$/.exec(range);
	if (!match) return null;
	const start = Number(match[1]);
	const end = match[2] ? Number(match[2]) : start;
	return { start, end };
}

function injectReviewComments(
	rendered: RenderedDiffLine[],
	drafts: ReviewDraft[],
	t: Theme,
	w: number,
): RenderedDiffLine[] {
	if (drafts.length === 0) return rendered;

	const fileDrafts = drafts.filter((d) => d.lineRange);
	const wholeDrafts = drafts.filter((d) => !d.lineRange);

	const insertions = new Map<number, ReviewDraft[]>();
	for (const draft of fileDrafts) {
		const range = parseLineRange(draft.lineRange!);
		if (!range) continue;
		let insertAfter = -1;
		for (let i = 0; i < rendered.length; i++) {
			const ln = rendered[i]?.newLineNumber;
			if (ln !== undefined && ln >= range.start && ln <= range.end) {
				insertAfter = i;
			}
		}
		if (insertAfter >= 0) {
			const existing = insertions.get(insertAfter) ?? [];
			existing.push(draft);
			insertions.set(insertAfter, existing);
		}
	}

	const result: RenderedDiffLine[] = [];

	const commentBg = (s: string) => `\x1b[48;2;130;130;130m${s}\x1b[49m`;

	if (wholeDrafts.length > 0) {
		for (const draft of wholeDrafts) {
			const content = `  ${t.fg("warning", "│ \u{1f4ac}")} ${t.fg("text", draft.prompt)}`;
			result.push({ text: commentBg(padStyledLine(content, w)), category: "context" });
		}
	}

	for (let i = 0; i < rendered.length; i++) {
		result.push(rendered[i]!);
		const comments = insertions.get(i);
		if (comments) {
			for (const draft of comments) {
				const rangeLabel = draft.lineRange ? t.fg("warning", `L:${draft.lineRange} `) : "";
				const content = `  ${t.fg("warning", "│ \u{1f4ac}")} ${rangeLabel}${t.fg("text", draft.prompt)}`;
				result.push({ text: commentBg(padStyledLine(content, w)), category: "context" });
			}
		}
	}

	return result;
}

function renderDiff(t: Theme, st: DiffState, w: number, h: number): string[] {
	if (st.files.length === 0) return [t.fg("muted", "  No changes")];

	const f = findFileByPath(st, st.selectedFilePath);
	if (!f) return [t.fg("muted", "  Select a file to view diff")];

	const diffKey = scopedDiffKey(st.scope, f.path);
	const raw = st.diffCache.get(diffKey);
	if (raw === undefined) return [t.fg("muted", "  Loading…")];

	if (!st.highlightedDiffCache.has(diffKey)) {
		st.highlightedDiffCache.set(diffKey, buildHighlightedDiff(raw, f.path, t));
	}
	const all = st.highlightedDiffCache.get(diffKey);
	if (!all || all.length === 0) return [t.fg("muted", "  (empty diff)")];
	const parsed = parseDiffLines(raw);

	const rendered = buildRenderedDiffLines(t, all, parsed, w, st.wrapLines, st.changedOnly);
	if (rendered.length === 0) return [t.fg("muted", "  (all context hidden by filter)")];

	const fileDrafts = st.reviewDrafts.filter((d) => d.filePath === f.path);
	const withComments = injectReviewComments(rendered, fileDrafts, t, w);

	const max = Math.max(1, h);
	const maxOffset = Math.max(0, withComments.length - max);
	if (st.diffScrollOffset > maxOffset) st.diffScrollOffset = maxOffset;

	const start = st.diffScrollOffset;
	const end = Math.min(withComments.length, start + max);

	const lines: string[] = [];
	for (let i = start; i < end; i++) {
		const line = withComments[i];
		if (!line) continue;
		if (line.category === "added") lines.push(t.bg("toolSuccessBg", line.text));
		else if (line.category === "removed") lines.push(t.bg("toolErrorBg", line.text));
		else lines.push(line.text);
	}

	while (lines.length < max) lines.push("");

	if (withComments.length > max) {
		const pct = maxOffset > 0 ? Math.round((st.diffScrollOffset / maxOffset) * 100) : 0;
		const indicator = t.fg("dim", `${pct}% (${start + 1}–${end}/${withComments.length})`);
		lines[max - 1] = truncateToWidth(` ${indicator}`, w, t.fg("dim", "..."));
	}

	return lines;
}

function renderCommitFiles(t: Theme, st: DiffState, w: number, h: number): string[] {
	const selectedCommit = st.commits[st.commitSelectedIndex];
	if (!selectedCommit) return [t.fg("muted", "  (no commit selected)")];

	const commitHash = selectedCommit.hash;
	const files = st.commitFilesCache.get(commitHash);
	if (!files) {
		return [
			t.fg(
				"muted",
				st.commitFilesLoading.has(commitHash) ? "  Loading changed files…" : "  (press Enter to load files)",
			),
		];
	}
	if (files.length === 0) return [t.fg("muted", "  (no changed files)")];

	st.commitFileSelectedIndex = clamp(st.commitFileSelectedIndex, 0, Math.max(0, files.length - 1));
	const expanded = st.commitExpandedByHash.get(commitHash) ?? new Set<string>();
	const active = st.focus === "right";

	const rows: string[] = [];
	const fileLineStart: number[] = [];

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		const selected = i === st.commitFileSelectedIndex;
		fileLineStart[i] = rows.length;

		const cursor = selected ? (active ? t.fg("accent", "▶") : t.fg("muted", "▸")) : " ";
		const fold = expanded.has(file.path) ? t.fg("accent", "▾") : t.fg("dim", "▸");
		const ic = t.fg(statusColor(file.status), icon(file.status));
		const prefix = `${cursor} ${fold} ${ic} `;
		const nameW = Math.max(4, w - visibleWidth(prefix));

		const fileName = truncatePlainToWidth(fileDisplayPath(file), nameW);
		const label = selected ? (active ? t.fg("accent", fileName) : t.fg("muted", fileName)) : t.fg("text", fileName);
		rows.push(truncateToWidth(`${prefix}${label}`, w, ""));

		if (!expanded.has(file.path)) continue;

		const diffKey = commitDiffKey(commitHash, file.path);
		const raw = st.commitFileDiffCache.get(diffKey);
		if (raw === undefined) {
			const loading = st.commitFileDiffLoading.has(diffKey) ? "    Loading diff…" : "    (no diff loaded)";
			rows.push(t.fg("muted", truncatePlainToWidth(loading, w)));
			continue;
		}

		const renderedDiffLines = buildCommitRenderedDiffLines(t, raw, w, st.wrapLines);
		if (renderedDiffLines.length === 0) {
			rows.push(t.fg("muted", "    (empty diff)"));
			continue;
		}

		const fileDrafts = st.reviewDrafts.filter((d) => d.filePath === file.path);
		const withComments = injectReviewComments(renderedDiffLines, fileDrafts, t, w);

		for (const line of withComments) {
			if (line.category === "added") rows.push(t.bg("toolSuccessBg", line.text));
			else if (line.category === "removed") rows.push(t.bg("toolErrorBg", line.text));
			else rows.push(line.text);
		}
	}

	const max = Math.max(1, h);
	const selectedLine = fileLineStart[st.commitFileSelectedIndex] ?? 0;
	if (!st.commitFileManualScroll) {
		if (selectedLine < st.commitFileScrollOffset) st.commitFileScrollOffset = selectedLine;
		if (selectedLine >= st.commitFileScrollOffset + max) st.commitFileScrollOffset = selectedLine - max + 1;
	}

	const maxOffset = Math.max(0, rows.length - max);
	if (st.commitFileScrollOffset < 0) st.commitFileScrollOffset = 0;
	if (st.commitFileScrollOffset > maxOffset) st.commitFileScrollOffset = maxOffset;

	const start = st.commitFileScrollOffset;
	const end = Math.min(rows.length, start + max);
	const visible = rows.slice(start, end);

	while (visible.length < max) visible.push("");
	if (rows.length > max) {
		const info = t.fg("dim", ` ${start + 1}–${end}/${rows.length}`);
		visible[max - 1] = info;
	}

	return visible;
}

// ─── Overlay controller ────────────────────────────────────────────────────

class DiffOverlay {
	private st: DiffState;
	private pi: ExtensionAPI;
	private cwd: string;
	private done: (reviewPrompt?: string) => void;
	private diffLoading = false;
	private lastRightWidth = 80;

	constructor(pi: ExtensionAPI, cwd: string, st: DiffState, done: (reviewPrompt?: string) => void) {
		this.pi = pi;
		this.cwd = cwd;
		this.st = st;
		this.done = done;
	}

	private selectedDiffFile(): DiffFile | null {
		return findFileByPath(this.st, this.st.selectedFilePath);
	}

	private selectDiffFile(filePath: string | null, tui: Tui): void {
		saveDiffScroll(this.st);
		this.st.selectedFilePath = filePath;
		this.st.selectedFilePathByScope[this.st.scope] = filePath;
		restoreDiffScroll(this.st);
		void this.ensureDiff(tui);
	}

	private applyScopeAndFilter(tui: Tui): void {
		applyScopeFiles(this.st);
		void this.ensureDiff(tui);
	}

	private openReviewDraftInput(): void {
		if (!this.selectedDiffFile()) {
			this.st.error = "Select a file before adding review feedback";
			return;
		}
		this.st.reviewInput = {
			active: true,
			buffer: "",
			error: null,
			lineRange: null,
			lineRangeSelectMode: true,
			lineRangeSelectIndex: 0,
			lineRangeDirectInputMode: false,
			lineRangeBuffer: "",
		};
	}

	private getHunksForSelectedFile(): HunkInfo[] {
		if (this.st.viewMode === "commit") return this.getHunksForCommitFile();
		const file = this.selectedDiffFile();
		if (!file) return [];
		const rawDiff = this.st.diffCache.get(scopedDiffKey(this.st.scope, file.path));
		if (!rawDiff) return [];
		return extractHunksFromDiff(rawDiff);
	}

	private getHunksForCommitFile(): HunkInfo[] {
		const commit = this.selectedCommit();
		const file = this.selectedCommitFile();
		if (!commit || !file) return [];
		const rawDiff = this.st.commitFileDiffCache.get(commitDiffKey(commit.hash, file.path));
		if (!rawDiff) return [];
		return extractHunksFromDiff(rawDiff);
	}

	private openCommitReviewDraftInput(): void {
		const file = this.selectedCommitFile();
		if (!file) {
			this.st.error = "Select a file before adding review feedback";
			return;
		}
		this.st.reviewInput = {
			active: true,
			buffer: "",
			error: null,
			lineRange: null,
			lineRangeSelectMode: true,
			lineRangeSelectIndex: 0,
			lineRangeDirectInputMode: false,
			lineRangeBuffer: "",
		};
	}

	private selectLineRangeAndProceed(lineRange: string | null): void {
		this.st.reviewInput.lineRange = lineRange;
		this.st.reviewInput.lineRangeSelectMode = false;
		this.st.reviewInput.lineRangeDirectInputMode = false;
	}

	private submitReviewDraft(): void {
		const file = this.st.viewMode === "commit" ? this.selectedCommitFile() : this.selectedDiffFile();
		if (!file) {
			this.st.reviewInput.error = "No file selected";
			return;
		}
		const prompt = this.st.reviewInput.buffer.trim();
		if (!prompt) {
			this.st.reviewInput.error = "Review message cannot be empty";
			return;
		}
		this.st.reviewDrafts.push({
			scope: this.st.scope,
			filePath: file.path,
			fileDisplayPath: fileDisplayPath(file),
			lineRange: this.st.reviewInput.lineRange,
			prompt,
		});
		this.resetReviewInput();
		this.st.error = null;
	}

	private resetReviewInput(): void {
		this.st.reviewInput = {
			active: false,
			buffer: "",
			error: null,
			lineRange: null,
			lineRangeSelectMode: false,
			lineRangeSelectIndex: 0,
			lineRangeDirectInputMode: false,
			lineRangeBuffer: "",
		};
	}

	private closeReviewDraftInput(): void {
		this.resetReviewInput();
	}

	private getLineRangeOptions(): { value: string; label: string }[] {
		const options: { value: string; label: string }[] = [
			{ value: "__entire__", label: "(전체 파일 코멘트)" },
			{ value: "__direct__", label: "[직접 입력]" },
		];
		const hunks = this.getHunksForSelectedFile();
		for (const hunk of hunks) {
			options.push({
				value: hunk.startLine === hunk.endLine ? String(hunk.startLine) : `${hunk.startLine}-${hunk.endLine}`,
				label: hunk.label,
			});
		}
		return options;
	}

	private handleLineRangeSelectInput(data: string, tui: Tui): void {
		const st = this.st;
		const options = this.getLineRangeOptions();
		const maxIndex = options.length - 1;

		if (matchesKey(data, Key.escape)) {
			this.closeReviewDraftInput();
			tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
			st.reviewInput.lineRangeSelectIndex = Math.max(0, st.reviewInput.lineRangeSelectIndex - 1);
			tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
			st.reviewInput.lineRangeSelectIndex = Math.min(maxIndex, st.reviewInput.lineRangeSelectIndex + 1);
			tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const selected = options[st.reviewInput.lineRangeSelectIndex];
			if (!selected) return;
			if (selected.value === "__entire__") {
				this.selectLineRangeAndProceed(null);
			} else if (selected.value === "__direct__") {
				st.reviewInput.lineRangeSelectMode = false;
				st.reviewInput.lineRangeDirectInputMode = true;
				st.reviewInput.lineRangeBuffer = "";
			} else {
				this.selectLineRangeAndProceed(selected.value);
			}
			tui.requestRender();
			return;
		}
	}

	private handleLineRangeDirectInput(data: string, tui: Tui): void {
		const st = this.st;

		if (matchesKey(data, Key.escape)) {
			st.reviewInput.lineRangeDirectInputMode = false;
			st.reviewInput.lineRangeSelectMode = true;
			st.reviewInput.lineRangeBuffer = "";
			tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.enter)) {
			const range = st.reviewInput.lineRangeBuffer.trim();
			if (!range) {
				st.reviewInput.error = "줄 번호를 입력하세요 (예: 42 또는 42-50)";
				tui.requestRender();
				return;
			}
			if (!/^\d+(-\d+)?$/.test(range)) {
				st.reviewInput.error = "형식: 42 또는 42-50";
				tui.requestRender();
				return;
			}
			this.selectLineRangeAndProceed(range);
			tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.backspace)) {
			st.reviewInput.lineRangeBuffer = st.reviewInput.lineRangeBuffer.slice(0, -1);
			st.reviewInput.error = null;
			tui.requestRender();
			return;
		}
		if (/^[0-9-]$/.test(data)) {
			st.reviewInput.lineRangeBuffer += data;
			st.reviewInput.error = null;
			tui.requestRender();
		}
	}

	private closeOverlay(): void {
		const reviewPrompt = buildReviewTransferPrompt(this.st.reviewDrafts);
		this.done(reviewPrompt || undefined);
	}

	private switchScope(nextScope: OverlayDiffScope, tui: Tui): void {
		if (nextScope === this.st.scope) return;
		saveDiffScroll(this.st);
		this.st.scope = nextScope;
		this.st.searchMode = false;
		this.st.diffCache.clear();
		this.st.highlightedDiffCache.clear();
		this.applyScopeAndFilter(tui);
	}

	private selectedCommit(): BranchCommitEntry | null {
		if (this.st.commits.length === 0) return null;
		this.st.commitSelectedIndex = clamp(this.st.commitSelectedIndex, 0, this.st.commits.length - 1);
		return this.st.commits[this.st.commitSelectedIndex] ?? null;
	}

	private selectedCommitFile(): CommitFile | null {
		const commit = this.selectedCommit();
		if (!commit) return null;
		const files = this.st.commitFilesCache.get(commit.hash);
		if (!files || files.length === 0) return null;
		this.st.commitFileSelectedIndex = clamp(this.st.commitFileSelectedIndex, 0, files.length - 1);
		return files[this.st.commitFileSelectedIndex] ?? null;
	}

	private expandedSet(commitHash: string): Set<string> {
		let set = this.st.commitExpandedByHash.get(commitHash);
		if (!set) {
			set = new Set<string>();
			this.st.commitExpandedByHash.set(commitHash, set);
		}
		return set;
	}

	private resetCommitFilesPanel(): void {
		this.st.commitFileSelectedIndex = 0;
		this.st.commitFileScrollOffset = 0;
		this.st.commitFileManualScroll = false;
	}

	private async ensureDiff(tui: Tui): Promise<void> {
		const f = this.selectedDiffFile();
		if (!f) return;
		const key = scopedDiffKey(this.st.scope, f.path);
		if (this.st.diffCache.has(key) || this.diffLoading) return;
		this.diffLoading = true;
		try {
			this.st.diffCache.set(key, await fileDiff(this.pi, this.cwd, f, this.st.scope, this.st.mergeBase, this.st.showFullFile));
		} finally {
			this.diffLoading = false;
		}
		tui.requestRender();
		const current = this.selectedDiffFile();
		if (current) {
			const currentKey = scopedDiffKey(this.st.scope, current.path);
			if (!this.st.diffCache.has(currentKey)) void this.ensureDiff(tui);
		}
	}

	private async ensureCommitFiles(tui: Tui): Promise<void> {
		const commit = this.selectedCommit();
		if (!commit) return;
		if (this.st.commitFilesCache.has(commit.hash) || this.st.commitFilesLoading.has(commit.hash)) return;

		this.st.commitFilesLoading.add(commit.hash);
		tui.requestRender();
		try {
			if (commit.hash === UNCOMMITTED_HASH) {
				const wtFiles = await workingTreeFiles(this.pi, this.cwd);
				this.st.commitFilesCache.set(
					UNCOMMITTED_HASH,
					wtFiles.map((f) => ({
						path: f.path,
						status: f.status,
						rawStatus: f.rawStatus,
						previousPath: f.previousPath ?? null,
					})),
				);
			} else {
				const files = await commitFilesForHash(this.pi, this.cwd, commit.hash);
				this.st.commitFilesCache.set(commit.hash, files);
			}
		} finally {
			this.st.commitFilesLoading.delete(commit.hash);
		}
		tui.requestRender();
	}

	private async ensureCommitFileDiff(commitHash: string, file: CommitFile, tui: Tui): Promise<void> {
		const key = commitDiffKey(commitHash, file.path);
		if (this.st.commitFileDiffCache.has(key) || this.st.commitFileDiffLoading.has(key)) return;
		this.st.commitFileDiffLoading.add(key);
		tui.requestRender();
		try {
			const raw = await commitFileDiff(this.pi, this.cwd, commitHash, file, this.st.showFullFile);
			this.st.commitFileDiffCache.set(key, raw);
		} finally {
			this.st.commitFileDiffLoading.delete(key);
		}
		tui.requestRender();
	}

	private async openPath(targetPath: string): Promise<void> {
		const filePath = path.isAbsolute(targetPath) ? targetPath : path.resolve(this.cwd, targetPath);
		const command = process.platform === "darwin" ? "open" : "xdg-open";
		const r = await this.pi.exec(command, [filePath], { cwd: this.cwd });
		this.st.error = r.code === 0 ? null : r.stderr?.trim() || `Failed to open ${targetPath}`;
	}

	private async revealPath(targetPath: string): Promise<void> {
		const filePath = path.isAbsolute(targetPath) ? targetPath : path.resolve(this.cwd, targetPath);
		const command = process.platform === "darwin" ? "open" : "xdg-open";
		const args = process.platform === "darwin" ? ["-R", filePath] : [path.dirname(filePath)];
		const r = await this.pi.exec(command, args, { cwd: this.cwd });
		this.st.error = r.code === 0 ? null : r.stderr?.trim() || `Failed to reveal ${targetPath}`;
	}

	private async refreshFiles(tui: Tui): Promise<void> {
		const data = await loadOverlayData(this.pi, this.cwd, this.st.mergeBase);
		this.st.filesByScope = data.filesByScope;
		this.st.commits = data.commits;
		this.st.diffCache.clear();
		this.st.highlightedDiffCache.clear();
		this.st.commitFilesCache.clear();
		this.st.commitFileDiffCache.clear();
		this.st.commitExpandedByHash.clear();
		this.applyScopeAndFilter(tui);
		if (data.uncommittedFiles.length > 0) {
			this.st.commits.unshift({
				hash: UNCOMMITTED_HASH,
				shortHash: "•••",
				author: "",
				relativeDate: "now",
				subject: `Uncommitted Changes (${data.uncommittedFiles.length} file${data.uncommittedFiles.length !== 1 ? "s" : ""})`,
			});
			this.st.commitFilesCache.set(
				UNCOMMITTED_HASH,
				data.uncommittedFiles.map((f) => ({
					path: f.path,
					status: f.status,
					rawStatus: f.rawStatus,
					previousPath: f.previousPath ?? null,
				})),
			);
		}
		if (this.st.files.length === 0) {
			this.st.selectedIndex = 0;
			this.st.fileScrollOffset = 0;
			this.st.diffScrollOffset = 0;
			this.st.selectedFilePath = null;
			this.st.focus = "left";
		}
	}

	private async stashChanges(tui: Tui): Promise<void> {
		const r = await this.pi.exec("git", ["stash", "push", "-u"], { cwd: this.cwd });
		if (r.code !== 0) {
			this.st.error = r.stderr?.trim() || "Failed to stash changes";
			return;
		}
		this.st.error = null;
		await this.refreshFiles(tui);
		if (this.st.viewMode === "diff") void this.ensureDiff(tui);
	}

	private selectCommit(nextIndex: number, tui: Tui): void {
		if (this.st.commits.length === 0) return;
		const clamped = clamp(nextIndex, 0, this.st.commits.length - 1);
		if (clamped === this.st.commitSelectedIndex) return;
		this.st.commitSelectedIndex = clamped;
		this.resetCommitFilesPanel();
		void this.ensureCommitFiles(tui);
	}

	private syncSelectedFile(tui: Tui): void {
		const rows = getVisibleRows(this.st);
		const row = rows[this.st.selectedIndex];
		if (row?.type === "file") this.selectDiffFile(row.fullPath, tui);
	}

	// ─── Input: diff mode ────────────────────────────────────────────────────

	private handleDiffModeInput(data: string, tui: Tui): void {
		const st = this.st;

		if (st.reviewInput.active) {
			if (st.reviewInput.lineRangeSelectMode) {
				this.handleLineRangeSelectInput(data, tui);
				return;
			}
			if (st.reviewInput.lineRangeDirectInputMode) {
				this.handleLineRangeDirectInput(data, tui);
				return;
			}
			if (matchesKey(data, Key.escape)) {
				this.closeReviewDraftInput();
				tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.enter)) {
				this.submitReviewDraft();
				tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.backspace)) {
				st.reviewInput.buffer = st.reviewInput.buffer.slice(0, -1);
				st.reviewInput.error = null;
				tui.requestRender();
				return;
			}
			if (data.length === 1 && data >= " " && data !== "\u007f") {
				st.reviewInput.buffer += data;
				st.reviewInput.error = null;
				tui.requestRender();
			}
			return;
		}

		if (st.searchMode) {
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
				st.searchMode = false;
				tui.requestRender();
				return;
			}
			if (matchesKey(data, Key.backspace)) {
				st.searchQuery = st.searchQuery.slice(0, -1);
				this.applyScopeAndFilter(tui);
				tui.requestRender();
				return;
			}
			if (data.length === 1 && data >= " " && data !== "\u007f") {
				st.searchQuery += data;
				this.applyScopeAndFilter(tui);
				tui.requestRender();
			}
			return;
		}

		const rows = getVisibleRows(st);
		const n = rows.length;
		const currentRow = rows[st.selectedIndex];
		const f = this.selectedDiffFile();

		if (matchesKey(data, "/")) {
			st.searchMode = true;
			tui.requestRender();
			return;
		}
		if (matchesKey(data, "s")) {
			this.switchScope(cycleOverlayDiffScope(st.scope), tui);
			tui.requestRender();
			return;
		}
		if (matchesKey(data, "w")) {
			st.wrapLines = !st.wrapLines;
			tui.requestRender();
			return;
		}
		if (matchesKey(data, "a")) {
			st.showFullFile = !st.showFullFile;
			st.diffCache.clear();
			st.highlightedDiffCache.clear();
			void this.ensureDiff(tui);
			tui.requestRender();
			return;
		}
		if (matchesKey(data, "c")) {
			st.changedOnly = !st.changedOnly;
			tui.requestRender();
			return;
		}
		if (matchesKey(data, "r")) {
			this.openReviewDraftInput();
			tui.requestRender();
			return;
		}

		if (st.focus === "left") {
			if (matchesKey(data, Key.escape)) {
				this.closeOverlay();
				return;
			}
			if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
				if (st.selectedIndex > 0) {
					st.selectedIndex -= 1;
					this.syncSelectedFile(tui);
				}
			} else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
				if (st.selectedIndex < n - 1) {
					st.selectedIndex += 1;
					this.syncSelectedFile(tui);
				}
			} else if (matchesKey(data, "g")) {
				st.selectedIndex = 0;
				this.syncSelectedFile(tui);
			} else if (matchesKey(data, "G")) {
				st.selectedIndex = Math.max(0, n - 1);
				this.syncSelectedFile(tui);
			} else if (matchesKey(data, Key.enter)) {
				if (currentRow?.type === "dir") {
					if (st.expandedDirs.has(currentRow.fullPath)) st.expandedDirs.delete(currentRow.fullPath);
					else st.expandedDirs.add(currentRow.fullPath);
				} else if (currentRow?.type === "file") {
					this.selectDiffFile(currentRow.fullPath, tui);
					st.focus = "right";
				}
			} else if (matchesKey(data, "o") && f) {
				void this.openPath(f.path).then(() => tui.requestRender());
			} else if (matchesKey(data, "f") && f) {
				void this.revealPath(f.path).then(() => tui.requestRender());
			}

			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.escape)) {
			saveDiffScroll(st);
			st.focus = "left";
			tui.requestRender();
			return;
		}

		const raw = f ? (st.diffCache.get(scopedDiffKey(st.scope, f.path)) ?? "") : "";
		const parsed = parseDiffLines(raw);
		const highlighted = f ? (st.highlightedDiffCache.get(scopedDiffKey(st.scope, f.path)) ?? raw.split("\n")) : [];
		const fileDrafts = f ? st.reviewDrafts.filter((d) => d.filePath === f.path) : [];
		const diffLen = countRenderedDiffLines(
			highlighted,
			parsed,
			Math.max(1, this.lastRightWidth),
			st.wrapLines,
			st.changedOnly,
		) + fileDrafts.length;
		if (matchesKey(data, Key.up)) {
			st.diffScrollOffset = Math.max(0, st.diffScrollOffset - ARROW_SCROLL_STEP);
		} else if (matchesKey(data, Key.down)) {
			st.diffScrollOffset = Math.min(st.diffScrollOffset + ARROW_SCROLL_STEP, Math.max(0, diffLen - 3));
		} else if (matchesKey(data, "k")) {
			st.diffScrollOffset = Math.max(0, st.diffScrollOffset - 1);
		} else if (matchesKey(data, "j")) {
			st.diffScrollOffset = Math.min(st.diffScrollOffset + 1, Math.max(0, diffLen - 3));
		} else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("u"))) {
			st.diffScrollOffset = Math.max(0, st.diffScrollOffset - PAGE_SCROLL_STEP);
		} else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("d"))) {
			st.diffScrollOffset = Math.min(st.diffScrollOffset + PAGE_SCROLL_STEP, Math.max(0, diffLen - 3));
		} else if (matchesKey(data, "g")) {
			st.diffScrollOffset = 0;
		} else if (matchesKey(data, "G")) {
			st.diffScrollOffset = Math.max(0, diffLen - 3);
		} else if (matchesKey(data, Key.left)) {
			saveDiffScroll(st);
			st.focus = "left";
		} else if (matchesKey(data, "o") && f) {
			void this.openPath(f.path).then(() => tui.requestRender());
		} else if (matchesKey(data, "f") && f) {
			void this.revealPath(f.path).then(() => tui.requestRender());
		}

		saveDiffScroll(st);
		tui.requestRender();
	}

	// ─── Input: commit mode ──────────────────────────────────────────────────

	private handleCommitModeInput(data: string, tui: Tui): void {
		const st = this.st;

		if (matchesKey(data, "w")) {
			st.wrapLines = !st.wrapLines;
			tui.requestRender();
			return;
		}
		if (matchesKey(data, "a")) {
			st.showFullFile = !st.showFullFile;
			st.diffCache.clear();
			st.highlightedDiffCache.clear();
			st.commitFileDiffCache.clear();
			st.commitFileDiffLoading.clear();
			const commit = this.selectedCommit();
			if (commit) {
				const expanded = this.st.commitExpandedByHash.get(commit.hash);
				const files = st.commitFilesCache.get(commit.hash);
				if (expanded && files) {
					for (const filePath of expanded) {
						const file = files.find((f) => f.path === filePath);
						if (file) void this.ensureCommitFileDiff(commit.hash, file, tui);
					}
				}
			}
			tui.requestRender();
			return;
		}

		if (st.focus === "left") {
			if (matchesKey(data, Key.escape)) {
				this.closeOverlay();
				return;
			}

			if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
				this.selectCommit(st.commitSelectedIndex - 1, tui);
			} else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
				this.selectCommit(st.commitSelectedIndex + 1, tui);
			} else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("u"))) {
				this.selectCommit(st.commitSelectedIndex - 10, tui);
			} else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("d"))) {
				this.selectCommit(st.commitSelectedIndex + 10, tui);
			} else if (matchesKey(data, "g")) {
				this.selectCommit(0, tui);
			} else if (matchesKey(data, "G")) {
				this.selectCommit(Math.max(0, st.commits.length - 1), tui);
			} else if (matchesKey(data, Key.enter)) {
				st.focus = "right";
				this.resetCommitFilesPanel();
				void this.ensureCommitFiles(tui);
			}

			tui.requestRender();
			return;
		}

		if (matchesKey(data, Key.escape) || matchesKey(data, Key.left)) {
			st.focus = "left";
			tui.requestRender();
			return;
		}

		const commit = this.selectedCommit();
		if (!commit) {
			tui.requestRender();
			return;
		}

		void this.ensureCommitFiles(tui);
		const files = st.commitFilesCache.get(commit.hash);
		if (!files || files.length === 0) {
			tui.requestRender();
			return;
		}

		const maxIndex = files.length - 1;
		st.commitFileSelectedIndex = clamp(st.commitFileSelectedIndex, 0, maxIndex);
		const selectedIndex = st.commitFileSelectedIndex;
		const selectedFile = files[selectedIndex];
		const expanded = this.expandedSet(commit.hash);
		const selectedExpanded = Boolean(selectedFile && expanded.has(selectedFile.path));

		const contentH = overlayContentHeight(tui.terminal?.rows ?? 40);
		const rowsMeta = buildCommitRowsMeta(files, commit.hash, expanded, st.commitFileDiffCache);
		const maxOffset = Math.max(0, rowsMeta.totalRows - contentH);
		st.commitFileScrollOffset = clamp(st.commitFileScrollOffset, 0, maxOffset);
		const viewportStart = st.commitFileScrollOffset;
		const viewportEnd = viewportStart + contentH - 1;

		const prevIndex = selectedIndex - 1;
		const nextIndex = selectedIndex + 1;
		const prevStart = prevIndex >= 0 ? (rowsMeta.fileStarts[prevIndex] ?? 0) : -1;
		const nextStart =
			nextIndex <= maxIndex ? (rowsMeta.fileStarts[nextIndex] ?? rowsMeta.totalRows) : rowsMeta.totalRows;
		const selectedStart = rowsMeta.fileStarts[selectedIndex] ?? 0;
		const selectedEnd = rowsMeta.fileEnds[selectedIndex] ?? selectedStart;

		const shouldArrowUpScroll =
			selectedExpanded &&
			st.commitFileScrollOffset > 0 &&
			((prevIndex >= 0 && prevStart < viewportStart) || (prevIndex < 0 && selectedStart < viewportStart));
		const shouldArrowDownScroll =
			selectedExpanded &&
			st.commitFileScrollOffset < maxOffset &&
			((nextIndex <= maxIndex && nextStart > viewportEnd) || (nextIndex > maxIndex && selectedEnd > viewportEnd));

		if (matchesKey(data, Key.up)) {
			if (shouldArrowUpScroll) {
				st.commitFileScrollOffset = Math.max(0, st.commitFileScrollOffset - ARROW_SCROLL_STEP);
				st.commitFileManualScroll = true;
			} else {
				st.commitFileSelectedIndex = clamp(selectedIndex - 1, 0, maxIndex);
				st.commitFileManualScroll = false;
			}
		} else if (matchesKey(data, Key.down)) {
			if (shouldArrowDownScroll) {
				st.commitFileScrollOffset = Math.min(maxOffset, st.commitFileScrollOffset + ARROW_SCROLL_STEP);
				st.commitFileManualScroll = true;
			} else {
				st.commitFileSelectedIndex = clamp(selectedIndex + 1, 0, maxIndex);
				st.commitFileManualScroll = false;
			}
		} else if (matchesKey(data, "k")) {
			st.commitFileSelectedIndex = clamp(selectedIndex - 1, 0, maxIndex);
			st.commitFileManualScroll = false;
		} else if (matchesKey(data, "j")) {
			st.commitFileSelectedIndex = clamp(selectedIndex + 1, 0, maxIndex);
			st.commitFileManualScroll = false;
		} else if (matchesKey(data, Key.pageUp) || matchesKey(data, Key.ctrl("u"))) {
			st.commitFileScrollOffset = Math.max(0, st.commitFileScrollOffset - PAGE_SCROLL_STEP);
			st.commitFileManualScroll = true;
		} else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.ctrl("d"))) {
			st.commitFileScrollOffset = Math.min(maxOffset, st.commitFileScrollOffset + PAGE_SCROLL_STEP);
			st.commitFileManualScroll = true;
		} else if (matchesKey(data, "g")) {
			st.commitFileSelectedIndex = 0;
			st.commitFileManualScroll = false;
		} else if (matchesKey(data, "G")) {
			st.commitFileSelectedIndex = maxIndex;
			st.commitFileManualScroll = false;
		} else if (matchesKey(data, Key.enter)) {
			const file = files[st.commitFileSelectedIndex];
			if (file) {
				if (expanded.has(file.path)) {
					expanded.delete(file.path);
				} else {
					expanded.add(file.path);
					void this.ensureCommitFileDiff(commit.hash, file, tui);
				}
				st.commitFileManualScroll = false;
			}
		} else if (matchesKey(data, "r")) {
			this.openCommitReviewDraftInput();
		} else if (matchesKey(data, "o")) {
			const file = this.selectedCommitFile();
			if (file) void this.openPath(file.path).then(() => tui.requestRender());
		} else if (matchesKey(data, "f")) {
			const file = this.selectedCommitFile();
			if (file) void this.revealPath(file.path).then(() => tui.requestRender());
		}

		tui.requestRender();
	}

	// ─── Input dispatch ──────────────────────────────────────────────────────

	handleInput(data: string, tui: Tui): void {
		if (this.st.showHelp) {
			this.st.showHelp = false;
			tui.requestRender();
			return;
		}

		if (matchesKey(data, ",")) {
			this.st.showHelp = true;
			tui.requestRender();
			return;
		}

		if (matchesKey(data, "q") && !this.st.searchMode && !this.st.reviewInput.active) {
			this.closeOverlay();
			return;
		}

		if (this.st.reviewInput.active) {
			this.handleDiffModeInput(data, tui);
			return;
		}

		if (this.st.viewMode === "diff" && this.st.searchMode) {
			this.handleDiffModeInput(data, tui);
			return;
		}

		if (matchesKey(data, "S")) {
			void this.stashChanges(tui).then(() => tui.requestRender());
			return;
		}

		if (matchesKey(data, Key.tab) || matchesKey(data, "v")) {
			this.st.viewMode = toggleOverlayViewMode(this.st.viewMode);
			this.st.focus = "left";
			if (this.st.viewMode === "diff") {
				void this.ensureDiff(tui);
			} else {
				this.resetCommitFilesPanel();
				void this.ensureCommitFiles(tui);
			}
			tui.requestRender();
			return;
		}

		if (this.st.viewMode === "diff") this.handleDiffModeInput(data, tui);
		else this.handleCommitModeInput(data, tui);
	}

	// ─── Frame render ────────────────────────────────────────────────────────

	private renderHelp(w: number, h: number, t: Theme): string[] {
		const lines: string[] = [];
		lines.push(...new DynamicBorder((s: string) => t.fg("accent", s)).render(w));
		lines.push(`  ${t.fg("accent", t.bold("KEYBINDINGS"))}`);
		lines.push("");
		lines.push(`  ${t.fg("accent", "── 공통 ──")}`);
		lines.push(`  ${t.fg("warning", "Tab/v")}  ${t.fg("muted", "diff ↔ commit 모드 전환")}`);
		lines.push(`  ${t.fg("warning", "/")}      ${t.fg("muted", "파일 검색")}`);
		lines.push(`  ${t.fg("warning", "s")}      ${t.fg("muted", "scope 변경 (branch/working/last-commit)")}`);
		lines.push(`  ${t.fg("warning", "w")}      ${t.fg("muted", "줄바꿈 토글")}`);
		lines.push(`  ${t.fg("warning", "a")}      ${t.fg("muted", "파일 전체 보기 토글")}`);
		lines.push(`  ${t.fg("warning", "c")}      ${t.fg("muted", "변경된 줄만 보기 토글")}`);
		lines.push(`  ${t.fg("warning", "r")}      ${t.fg("muted", "리뷰 드래프트 작성")}`);
		lines.push(`  ${t.fg("warning", "o")}      ${t.fg("muted", "파일 열기")}`);
		lines.push(`  ${t.fg("warning", "f")}      ${t.fg("muted", "Finder에서 열기")}`);
		lines.push(`  ${t.fg("warning", "S")}      ${t.fg("muted", "git stash")}`);
		lines.push(`  ${t.fg("warning", ",")}      ${t.fg("muted", "이 도움말")}`);
		lines.push(`  ${t.fg("warning", "q/Esc")}  ${t.fg("muted", "닫기")}`);
		lines.push("");
		lines.push(`  ${t.fg("accent", "── diff 모드: 왼쪽 (파일 선택) ──")}`);
		lines.push(`  ${t.fg("warning", "↑/↓")}    ${t.fg("muted", "파일 선택")}`);
		lines.push(`  ${t.fg("warning", "Enter")}  ${t.fg("muted", "오른쪽 diff 패널로 이동")}`);
		lines.push("");
		lines.push(`  ${t.fg("accent", "── diff 모드: 오른쪽 (diff 보기) ──")}`);
		lines.push(`  ${t.fg("warning", "↑/↓")}    ${t.fg("muted", "5줄 스크롤")}`);
		lines.push(`  ${t.fg("warning", "j/k")}    ${t.fg("muted", "1줄 스크롤")}`);
		lines.push(`  ${t.fg("warning", "PgUp/Dn")} ${t.fg("muted", "빠른 스크롤")}`);
		lines.push(`  ${t.fg("warning", "g/G")}    ${t.fg("muted", "맨 위/맨 아래")}`);
		lines.push(`  ${t.fg("warning", "←/Esc")}  ${t.fg("muted", "파일 패널로 복귀")}`);
		lines.push("");
		lines.push(`  ${t.fg("accent", "── commit 모드: 왼쪽 (커밋 선택) ──")}`);
		lines.push(`  ${t.fg("warning", "↑/↓")}    ${t.fg("muted", "커밋 선택")}`);
		lines.push(`  ${t.fg("warning", "Enter")}  ${t.fg("muted", "오른쪽 파일 패널로 이동")}`);
		lines.push("");
		lines.push(`  ${t.fg("accent", "── commit 모드: 오른쪽 (파일/diff) ──")}`);
		lines.push(`  ${t.fg("warning", "j/k")}    ${t.fg("muted", "파일 선택")}`);
		lines.push(`  ${t.fg("warning", "Enter")}  ${t.fg("muted", "diff 펼치기/접기")}`);
		lines.push(`  ${t.fg("warning", "←/Esc")}  ${t.fg("muted", "커밋 패널로 복귀")}`);
		lines.push("");
		lines.push(`  ${t.fg("dim", "아무 키나 누르면 닫힘")}`);
		lines.push(...new DynamicBorder((s: string) => t.fg("accent", s)).render(w));
		while (lines.length < h) lines.push("");
		return lines;
	}

	render(w: number, h: number, t: Theme): string[] {
		if (this.st.showHelp) return this.renderHelp(w, h, t);

		const st = this.st;

		const header: string[] = [];
		header.push(...new DynamicBorder((s: string) => t.fg("accent", s)).render(w));

		const branch = st.branch ? t.fg("muted", st.branch) : t.fg("dim", "(detached)");
		const baseInfo = st.baseBranch ? ` ${t.fg("dim", "vs")} ${t.fg("muted", st.baseBranch)}` : "";
		const scopeFileCount = st.filesByScope[st.scope].length;
		const fileCnt = t.fg(
			"muted",
			st.searchQuery
				? `${st.files.length}/${scopeFileCount} file${scopeFileCount !== 1 ? "s" : ""}`
				: `${scopeFileCount} file${scopeFileCount !== 1 ? "s" : ""}`,
		);
		const commitCnt = t.fg("muted", `${st.commits.length} commit${st.commits.length !== 1 ? "s" : ""}`);
		const mode = st.viewMode === "diff" ? t.fg("accent", "diff") : t.fg("accent", "commit");
		header.push(
			`  ${t.fg("accent", t.bold("DIFF"))} ${t.fg("dim", "|")} ${branch}${baseInfo} ${t.fg("dim", "·")} ${fileCnt} ${t.fg("dim", "·")} ${commitCnt} ${t.fg("dim", "·")} mode:${mode}`,
		);
		header.push(
			`  ${t.fg("muted", "scope:")}${t.fg("muted", scopeLabel(st.scope))} ${t.fg("muted", "· filter:")}${t.fg(st.searchMode ? "accent" : "muted", st.searchQuery || "-")} ${t.fg("muted", "· wrap:")}${t.fg(st.wrapLines ? "success" : "muted", st.wrapLines ? "on" : "off")} ${t.fg("muted", "· full:")}${t.fg(st.showFullFile ? "success" : "muted", st.showFullFile ? "on" : "off")} ${t.fg("muted", "· changed-only:")}${t.fg(st.changedOnly ? "success" : "muted", st.changedOnly ? "on" : "off")} ${t.fg("muted", "· reviews:")}${t.fg(st.reviewDrafts.length > 0 ? "accent" : "muted", String(st.reviewDrafts.length))}`,
		);

		const footer: string[] = [];
		if (st.reviewInput.active) {
			if (st.reviewInput.lineRangeSelectMode) {
				const options = this.getLineRangeOptions();
				footer.push(`  ${t.fg("accent", t.bold("Select line range:"))}`);
				for (let i = 0; i < options.length; i++) {
					const opt = options[i]!;
					const isSelected = i === st.reviewInput.lineRangeSelectIndex;
					const prefix = isSelected ? t.fg("accent", "> ") : "  ";
					const label = isSelected ? t.fg("accent", opt.label) : t.fg("muted", opt.label);
					footer.push(`  ${prefix}${label}`);
				}
				footer.push(st.reviewInput.error ? t.fg("error", `  ${st.reviewInput.error}`) : "");
			} else if (st.reviewInput.lineRangeDirectInputMode) {
				footer.push(
					truncateToWidth(
						`  ${t.fg("accent", "줄 번호>")} ${st.reviewInput.lineRangeBuffer || t.fg("dim", "예: 42 또는 42-50")}`,
						w,
					),
				);
				footer.push(st.reviewInput.error ? t.fg("error", `  ${st.reviewInput.error}`) : "");
			} else {
				const lineInfo = st.reviewInput.lineRange ? t.fg("warning", ` [L:${st.reviewInput.lineRange}]`) : t.fg("dim", " [전체]");
				footer.push(
					truncateToWidth(
						`  ${t.fg("accent", "review")}${lineInfo}${t.fg("accent", ">")} ${st.reviewInput.buffer || t.fg("dim", "리뷰 메시지 입력")}`,
						w,
					),
				);
				footer.push(st.reviewInput.error ? t.fg("error", `  ${st.reviewInput.error}`) : "");
			}
		} else {
			footer.push(st.error ? t.fg("error", `  ${st.error}`) : "");
		}

		const hint =
			st.viewMode === "diff"
				? st.reviewInput.active
					? st.reviewInput.lineRangeSelectMode
						? "  ↑/↓ 선택  ·  Enter 확인  ·  Esc 취소"
						: st.reviewInput.lineRangeDirectInputMode
							? "  줄 번호 입력  ·  Enter 확인  ·  Esc 뒤로"
							: "  리뷰 메시지 입력  ·  Enter 저장  ·  Esc 취소"
					: st.searchMode
						? "  Search mode · type to filter · Backspace delete · Enter/Esc close"
						: st.focus === "left"
							? "  ↑/↓ Select File  ·  / Search  ·  s Scope  ·  w Wrap  ·  a Full  ·  c Changed-only  ·  r Review draft  ·  Enter → Diff  ·  Tab/v Commit  ·  o Open  ·  f Finder  ·  S Stash  ·  q/Esc Close"
							: "  ↑/↓ Scroll 5 lines  ·  j/k Scroll 1 line  ·  PgUp/PgDn Fast  ·  / Search  ·  s Scope  ·  w Wrap  ·  a Full  ·  c Changed-only  ·  r Review draft  ·  Tab/v Commit  ·  o Open  ·  f Finder  ·  ←/Esc → Files  ·  q Close"
				: st.focus === "left"
					? "  ↑/↓ Select Commit  ·  Enter → Changed Files  ·  Tab/v Toggle Diff  ·  S Stash  ·  q/Esc Close"
					: "  ↑/↓ Select (overflow → 5-line scroll)  ·  j/k Select File  ·  Enter Fold/Unfold Diff  ·  PgUp/PgDn Scroll  ·  r Review draft  ·  Tab/v Toggle Diff  ·  o Open  ·  f Finder  ·  ←/Esc → Commits  ·  q Close";
		footer.push(t.fg("dim", hint));
		footer.push(...new DynamicBorder((s: string) => t.fg("accent", s)).render(w));

		const bodyH = Math.max(3, h - header.length - footer.length);
		const leftW = Math.max(14, Math.min(Math.floor(w * 0.28), 44));
		const rightW = Math.max(10, w - leftW - 3);
		this.lastRightWidth = rightW;

		const leftTitleLabel = st.viewMode === "diff" ? ` FILES · ${scopeFilesLabel(st.scope)}` : " COMMITS";
		const rightTitleLabel = st.viewMode === "diff" ? " DIFF" : " CHANGED FILES";
		const leftTitle = st.focus === "left" ? t.fg("accent", t.bold(leftTitleLabel)) : t.fg("dim", leftTitleLabel);
		const rightTitle = st.focus === "right" ? t.fg("accent", t.bold(rightTitleLabel)) : t.fg("dim", rightTitleLabel);

		const selectedFile = findFileByPath(st, st.selectedFilePath);
		const selectedFileReviewCount = selectedFile
			? st.reviewDrafts.filter((draft) => draft.filePath === selectedFile.path).length
			: 0;
		const fileLabel = selectedFile
			? `${t.fg(statusColor(selectedFile.status), icon(selectedFile.status))} ${t.fg(commitStateColor(selectedFile.commitState), `[${commitStateBadge(selectedFile.commitState)}]`)} ${t.fg(selectedFileReviewCount > 0 ? "accent" : "dim", selectedFileReviewCount > 0 ? `${selectedFileReviewCount} review${selectedFileReviewCount !== 1 ? "s" : ""}` : "no reviews")} ${t.fg("muted", fileDisplayPath(selectedFile))}`
			: t.fg("muted", "(no file)");

		const selectedCommit = st.commits[st.commitSelectedIndex];
		let commitLabel = t.fg("muted", "(no commit)");
		if (selectedCommit) {
			const commitFiles = st.commitFilesCache.get(selectedCommit.hash);
			const filesInfo = commitFiles
				? `${commitFiles.length} file${commitFiles.length !== 1 ? "s" : ""}`
				: st.commitFilesLoading.has(selectedCommit.hash)
					? "loading files…"
					: "files: -";
			if (selectedCommit.hash === UNCOMMITTED_HASH) {
				commitLabel = `${t.fg("warning", "●●●")} ${t.fg("warning", selectedCommit.subject)} ${t.fg("dim", `· ${filesInfo}`)}`;
			} else {
				commitLabel = `${t.fg("muted", selectedCommit.shortHash)} ${t.fg("text", selectedCommit.subject)} ${t.fg("dim", `· ${filesInfo}`)}`;
			}
		}

		const rightHeader = st.viewMode === "diff" ? `${rightTitle} ${fileLabel}` : `${rightTitle} ${commitLabel}`;
		const fittedLeftTitle = truncateToWidth(leftTitle, leftW, "");
		const fittedRightHeader = truncateToWidth(rightHeader, rightW, t.fg("muted", "..."));
		const titleLine = `${fittedLeftTitle}${" ".repeat(Math.max(0, leftW - visibleWidth(fittedLeftTitle)))} ${t.fg("dim", "│")} ${fittedRightHeader}`;

		const separatorLine = `${t.fg("dim", "─".repeat(leftW))} ${t.fg("dim", "┼")} ${t.fg("dim", "─".repeat(rightW))}`;
		const contentH = Math.max(1, bodyH - 2);

		const left = st.viewMode === "diff" ? renderFiles(t, st, leftW, contentH) : renderCommits(t, st, leftW, contentH);
		const right =
			st.viewMode === "diff" ? renderDiff(t, st, rightW, contentH) : renderCommitFiles(t, st, rightW, contentH);

		while (left.length < contentH) left.push("");
		while (right.length < contentH) right.push("");

		const body: string[] = [titleLine, separatorLine];
		for (let i = 0; i < contentH; i++) {
			const l = truncateToWidth(left[i] ?? "", leftW, "");
			const pad = Math.max(0, leftW - visibleWidth(l));
			const r = truncateToWidth(right[i] ?? "", rightW, "");
			body.push(`${l}${" ".repeat(pad)} ${t.fg("dim", "│")} ${r}`);
		}

		return [...header, ...body, ...footer].map((line) => truncateToWidth(expandTabs(line), w, ""));
	}
}

// ─── Extension entry point ────────────────────────────────────────────────

export default function diffOverlayExtension(pi: ExtensionAPI) {
	const handler = async (_args: string, ctx: ExtensionCommandContext) => {
		const root = await gitRoot(pi, ctx.cwd);
		if (!root) {
			if (ctx.hasUI) ctx.ui.notify("Not a git repository", "error");
			else console.log("Not a git repository");
			return;
		}

		const branch = await currentBranch(pi, root);
		const mergeBaseInfo = await findMergeBase(pi, root, branch);
		const mergeBase = mergeBaseInfo?.commit ?? null;
		const overlayData = await loadOverlayData(pi, root, mergeBase);
		const commits = [...overlayData.commits];
		const workingFiles = overlayData.filesByScope.working;
		const initialScope: OverlayDiffScope =
			overlayData.filesByScope.branch.length > 0 ? "branch" : workingFiles.length > 0 ? "working" : "last-commit";
		const files = overlayData.filesByScope[initialScope];
		const { treeNodes, expandedDirs } = rebuildTree(files);
		const firstVisibleRows = flattenVisibleTree(treeNodes, expandedDirs);
		const firstFileRow = firstVisibleRows.find((r) => r.type === "file");
		const initialSelectedFilePath = firstFileRow ? firstFileRow.fullPath : files.length > 0 ? files[0].path : null;

		if (overlayData.uncommittedFiles.length > 0) {
			commits.unshift({
				hash: UNCOMMITTED_HASH,
				shortHash: "•••",
				author: "",
				relativeDate: "now",
				subject: `Uncommitted Changes (${overlayData.uncommittedFiles.length} file${overlayData.uncommittedFiles.length !== 1 ? "s" : ""})`,
			});
		}

		const st: DiffState = {
			files,
			filesByScope: overlayData.filesByScope,
			scope: initialScope,
			searchQuery: "",
			searchMode: false,
			selectedIndex: 0,
			fileScrollOffset: 0,
			diffCache: new Map(),
			highlightedDiffCache: new Map(),
			diffScrollOffset: 0,
			diffScrollMemory: new Map(),
			selectedFilePathByScope: {
				branch: initialScope === "branch" ? initialSelectedFilePath : null,
				working: initialScope === "working" ? initialSelectedFilePath : null,
				"last-commit": initialScope === "last-commit" ? initialSelectedFilePath : null,
			},
			wrapLines: true,
			changedOnly: false,
			showFullFile: false,
			showHelp: false,
			reviewDrafts: [],
			reviewInput: { active: false, buffer: "", error: null, lineRange: null, lineRangeSelectMode: false, lineRangeSelectIndex: 0, lineRangeDirectInputMode: false, lineRangeBuffer: "" },

			treeNodes,
			expandedDirs,
			selectedFilePath: initialSelectedFilePath,

			commits,
			commitSelectedIndex: 0,
			commitScrollOffset: 0,
			commitFilesCache: new Map(),
			commitFilesLoading: new Set(),
			commitFileDiffCache: new Map(),
			commitFileDiffLoading: new Set(),
			commitExpandedByHash: new Map(),
			commitFileSelectedIndex: 0,
			commitFileScrollOffset: 0,
			commitFileManualScroll: false,

			viewMode: "diff",
			focus: "left",
			branch,
			mergeBase,
			baseBranch: mergeBaseInfo?.baseBranch ?? null,
			error: null,
		};

		if (overlayData.uncommittedFiles.length > 0) {
			st.commitFilesCache.set(
				UNCOMMITTED_HASH,
				overlayData.uncommittedFiles.map((f) => ({
					path: f.path,
					status: f.status,
					rawStatus: f.rawStatus,
					previousPath: f.previousPath ?? null,
				})),
			);
		}

		if (!ctx.hasUI) {
			if (files.length === 0) {
				console.log("No changes.");
				return;
			}
			for (const f of files) console.log(`${icon(f.status)} ${f.path}`);
			return;
		}

		if (st.selectedFilePath) {
			const firstFile = files.find((f) => f.path === st.selectedFilePath);
			if (firstFile) {
				st.diffCache.set(
					scopedDiffKey(st.scope, firstFile.path),
					await fileDiff(pi, root, firstFile, st.scope, mergeBase),
				);
			}
		}

		const reviewPrompt = await ctx.ui.custom<string | undefined>(
			(tui, theme, _kb, done) => {
				const overlay = new DiffOverlay(pi, root, st, (prompt) => done(prompt));
				const tuiRef = tui as unknown as Tui;
				return {
					render: (w) => overlay.render(w, tuiRef.terminal?.rows ?? 40, theme),
					handleInput: (data) => overlay.handleInput(data, tuiRef),
					invalidate: () => {},
				};
			},
			{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
		);
		if (reviewPrompt) {
			ctx.ui.setEditorText(reviewPrompt);
			ctx.ui.notify("Moved review feedback into the editor.", "info");
		}
	};

	pi.registerCommand("diff", {
		description: "Git diff viewer — diff mode + commit mode (per-commit foldable file diffs)",
		handler,
	});
}
