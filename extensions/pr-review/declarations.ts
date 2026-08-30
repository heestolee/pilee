import { createHash } from "node:crypto";
import { extname } from "node:path";
import ts from "typescript";
import type {
	ReviewDeclarationKind,
	ReviewDeclarationRange,
	ReviewDeclarationSource,
	ReviewDeclarationUnit,
	ReviewDiffFile,
	ReviewFileSourceSnapshot,
	ReviewSourceBundle,
} from "./evidence.ts";

export const MAX_DECLARATION_SOURCE_BYTES_PER_SIDE = 512 * 1024;
export const MAX_DECLARATION_SOURCE_BYTES_TOTAL = 4 * 1024 * 1024;

export interface ParsedReviewDeclaration extends ReviewDeclarationRange {
	key: string;
	parentKey?: string;
	kind: ReviewDeclarationKind;
	name: string;
	symbolPath: string[];
	depth: number;
}

export interface ReviewSourceLoadRequest {
	file: ReviewDiffFile;
	side: "before" | "after";
	path: string;
}

export type ReviewSourceLoader = (request: ReviewSourceLoadRequest) => Promise<string | undefined>;

function languageForPath(path: string): ReviewFileSourceSnapshot["language"] | undefined {
	const lower = path.toLowerCase();
	if (lower.endsWith(".tsx")) return "tsx";
	if (lower.endsWith(".jsx")) return "jsx";
	if ([".ts", ".mts", ".cts"].includes(extname(lower))) return "typescript";
	if ([".js", ".mjs", ".cjs"].includes(extname(lower))) return "javascript";
	return undefined;
}

function scriptKind(path: string): ts.ScriptKind {
	const language = languageForPath(path);
	if (language === "tsx") return ts.ScriptKind.TSX;
	if (language === "jsx") return ts.ScriptKind.JSX;
	if (language === "javascript") return ts.ScriptKind.JS;
	return ts.ScriptKind.TS;
}

function declarationName(node: ts.DeclarationName | undefined, sourceFile: ts.SourceFile): string {
	if (!node) return "anonymous";
	if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
	return node.getText(sourceFile).replace(/\s+/g, " ").trim() || "anonymous";
}

function callName(expression: ts.Expression): string {
	if (ts.isIdentifier(expression)) return expression.text;
	if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
	if (ts.isCallExpression(expression)) return callName(expression.expression);
	return "";
}

function stringArgument(node: ts.CallExpression): string {
	const value = node.arguments[0];
	return value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) ? value.text : "anonymous";
}

function unwrapFunctionLike(node: ts.Expression | undefined): ts.FunctionExpression | ts.ArrowFunction | undefined {
	if (!node) return undefined;
	if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
	if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) {
		return unwrapFunctionLike(node.expression);
	}
	if (ts.isCallExpression(node)) {
		for (const argument of node.arguments) {
			const found = unwrapFunctionLike(argument);
			if (found) return found;
		}
	}
	return undefined;
}

function variableKind(name: string, initializer: ts.Expression | undefined): ReviewDeclarationKind {
	if (!unwrapFunctionLike(initializer)) return "variable";
	if (/^use[A-Z0-9]/.test(name)) return "hook";
	if (/^[A-Z]/.test(name)) return "component";
	return "function";
}

interface DeclarationMeta {
	kind: ReviewDeclarationKind;
	name: string;
	rangeNode: ts.Node;
}

function declarationMeta(node: ts.Node, sourceFile: ts.SourceFile): DeclarationMeta | undefined {
	if (ts.isImportDeclaration(node) || ts.isImportEqualsDeclaration(node)) {
		const name = ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : node.getText(sourceFile);
		return { kind: "import", name, rangeNode: node };
	}
	if (ts.isVariableDeclaration(node)) {
		const name = declarationName(node.name, sourceFile);
		const list = node.parent;
		const statement = ts.isVariableDeclarationList(list) && list.declarations.length === 1 && ts.isVariableStatement(list.parent) ? list.parent : node;
		return { kind: variableKind(name, node.initializer), name, rangeNode: statement };
	}
	if (ts.isFunctionDeclaration(node)) return { kind: "function", name: declarationName(node.name, sourceFile), rangeNode: node };
	if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return { kind: "class", name: declarationName(node.name, sourceFile), rangeNode: node };
	if (ts.isInterfaceDeclaration(node)) return { kind: "interface", name: node.name.text, rangeNode: node };
	if (ts.isTypeAliasDeclaration(node)) return { kind: "type", name: node.name.text, rangeNode: node };
	if (ts.isEnumDeclaration(node)) return { kind: "enum", name: node.name.text, rangeNode: node };
	if (ts.isModuleDeclaration(node)) return { kind: "namespace", name: declarationName(node.name, sourceFile), rangeNode: node };
	if (ts.isConstructorDeclaration(node)) return { kind: "constructor", name: "constructor", rangeNode: node };
	if (ts.isMethodDeclaration(node)) return { kind: "method", name: declarationName(node.name, sourceFile), rangeNode: node };
	if (ts.isPropertyDeclaration(node)) return { kind: "property", name: declarationName(node.name, sourceFile), rangeNode: node };
	if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return { kind: "accessor", name: declarationName(node.name, sourceFile), rangeNode: node };
	if (ts.isCallExpression(node)) {
		const name = callName(node.expression);
		if (name === "describe") return { kind: "test-suite", name: stringArgument(node), rangeNode: ts.isExpressionStatement(node.parent) ? node.parent : node };
		if (["it", "test", "specify"].includes(name)) return { kind: "test", name: stringArgument(node), rangeNode: ts.isExpressionStatement(node.parent) ? node.parent : node };
	}
	return undefined;
}

function nodeRange(sourceFile: ts.SourceFile, node: ts.Node): ReviewDeclarationRange {
	const startPosition = node.getStart(sourceFile);
	const endPosition = Math.max(startPosition, node.getEnd() - 1);
	return {
		startLine: sourceFile.getLineAndCharacterOfPosition(startPosition).line + 1,
		endLine: sourceFile.getLineAndCharacterOfPosition(endPosition).line + 1,
	};
}

export function parseReviewDeclarations(path: string, text: string): ParsedReviewDeclaration[] {
	if (!languageForPath(path)) return [];
	const normalized = text.replace(/\r\n/g, "\n");
	const sourceFile = ts.createSourceFile(path, normalized, ts.ScriptTarget.Latest, true, scriptKind(path));
	const lineCount = normalized.split("\n").length;
	const declarations: ParsedReviewDeclaration[] = [{
		key: "file",
		kind: "file",
		name: path,
		symbolPath: [path],
		depth: 0,
		startLine: 1,
		endLine: lineCount,
	}];
	const byKey = new Map<string, ParsedReviewDeclaration>([["file", declarations[0]!]]);
	const occurrences = new Map<string, number>();
	const visit = (node: ts.Node, parentKey: string) => {
		const meta = declarationMeta(node, sourceFile);
		let childParentKey = parentKey;
		if (meta) {
			const parent = byKey.get(parentKey)!;
			const displayName = meta.kind === "test" && parent.kind === "test-suite" ? `${parent.name} ${meta.name}` : meta.name;
			const baseKey = `${parentKey}/${meta.kind}:${displayName}`;
			const occurrence = (occurrences.get(baseKey) ?? 0) + 1;
			occurrences.set(baseKey, occurrence);
			const key = `${baseKey}#${occurrence}`;
			const parsed: ParsedReviewDeclaration = {
				key,
				parentKey,
				kind: meta.kind,
				name: displayName,
				symbolPath: [...parent.symbolPath, displayName],
				depth: parent.depth + 1,
				...nodeRange(sourceFile, meta.rangeNode),
			};
			declarations.push(parsed);
			byKey.set(key, parsed);
			childParentKey = key;
		}
		ts.forEachChild(node, (child) => visit(child, childParentKey));
	};
	ts.forEachChild(sourceFile, (node) => visit(node, "file"));
	return declarations;
}

function sourceSnapshot(path: string, text: string): ReviewDeclarationSource {
	const normalized = text.replace(/\r\n/g, "\n");
	return {
		path,
		text: normalized,
		sha256: createHash("sha256").update(normalized).digest("hex"),
		lineCount: normalized.split("\n").length,
	};
}

function declarationId(fileId: string, key: string): string {
	return `A-${fileId}-${createHash("sha256").update(key).digest("hex").slice(0, 12)}`;
}

function changedLinesForFile(bundle: ReviewSourceBundle, fileId: string) {
	return bundle.lines.filter((line) => line.fileId === fileId && (line.kind === "addition" || line.kind === "deletion"));
}

function buildDeclarationUnits(
	bundle: ReviewSourceBundle,
	file: ReviewDiffFile,
	before: ParsedReviewDeclaration[],
	after: ParsedReviewDeclaration[],
): ReviewDeclarationUnit[] {
	const beforeByKey = new Map(before.map((item) => [item.key, item]));
	const afterByKey = new Map(after.map((item) => [item.key, item]));
	const keys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])];
	const idByKey = new Map(keys.map((key) => [key, declarationId(file.id, key)]));
	const changedLines = changedLinesForFile(bundle, file.id);
	const units = keys.map((key): ReviewDeclarationUnit => {
		const beforeItem = beforeByKey.get(key);
		const afterItem = afterByKey.get(key);
		const representative = afterItem ?? beforeItem!;
		const parentKey = afterItem?.parentKey ?? beforeItem?.parentKey;
		const evidenceIds = changedLines.filter((line) => {
			if (line.kind === "addition" && afterItem && line.newLine !== undefined) return line.newLine >= afterItem.startLine && line.newLine <= afterItem.endLine;
			if (line.kind === "deletion" && beforeItem && line.oldLine !== undefined) return line.oldLine >= beforeItem.startLine && line.oldLine <= beforeItem.endLine;
			return false;
		}).map((line) => line.id);
		return {
			id: idByKey.get(key)!,
			fileId: file.id,
			kind: representative.kind,
			name: representative.name,
			symbolPath: representative.symbolPath,
			parentId: parentKey ? idByKey.get(parentKey) : undefined,
			childIds: [],
			depth: representative.depth,
			before: beforeItem ? { startLine: beforeItem.startLine, endLine: beforeItem.endLine } : undefined,
			after: afterItem ? { startLine: afterItem.startLine, endLine: afterItem.endLine } : undefined,
			evidenceIds,
		};
	}).filter((unit) => unit.evidenceIds.length > 0);
	const retained = new Set(units.map((unit) => unit.id));
	for (const unit of units) {
		if (unit.parentId && !retained.has(unit.parentId)) unit.parentId = undefined;
	}
	const byId = new Map(units.map((unit) => [unit.id, unit]));
	for (const unit of units) {
		if (unit.parentId) byId.get(unit.parentId)?.childIds.push(unit.id);
	}
	return units.sort((left, right) => left.depth - right.depth
		|| (left.after?.startLine ?? left.before?.startLine ?? 0) - (right.after?.startLine ?? right.before?.startLine ?? 0)
		|| left.id.localeCompare(right.id));
}

async function loadSource(loader: ReviewSourceLoader, request: ReviewSourceLoadRequest): Promise<string | undefined> {
	try {
		const value = await loader(request);
		if (typeof value !== "string") return undefined;
		const normalized = value.replace(/\r\n/g, "\n");
		if (Buffer.byteLength(normalized, "utf8") > MAX_DECLARATION_SOURCE_BYTES_PER_SIDE) return undefined;
		return normalized;
	} catch {
		return undefined;
	}
}

export async function enrichReviewSourceDeclarations(bundle: ReviewSourceBundle, loader: ReviewSourceLoader): Promise<ReviewSourceBundle> {
	const fileSources: ReviewFileSourceSnapshot[] = [];
	let totalBytes = 0;
	for (const file of bundle.files) {
		const language = languageForPath(file.path);
		if (!language || file.binary) continue;
		const beforePath = file.oldPath || file.path;
		const beforeText = file.status === "added" ? undefined : await loadSource(loader, { file, side: "before", path: beforePath });
		const afterText = file.status === "deleted" ? undefined : await loadSource(loader, { file, side: "after", path: file.path });
		const bytes = Buffer.byteLength(beforeText || "", "utf8") + Buffer.byteLength(afterText || "", "utf8");
		if ((!beforeText && !afterText) || totalBytes + bytes > MAX_DECLARATION_SOURCE_BYTES_TOTAL) continue;
		totalBytes += bytes;
		const before = beforeText ? sourceSnapshot(beforePath, beforeText) : undefined;
		const after = afterText ? sourceSnapshot(file.path, afterText) : undefined;
		const declarations = buildDeclarationUnits(
			bundle,
			file,
			before ? parseReviewDeclarations(before.path, before.text) : [],
			after ? parseReviewDeclarations(after.path, after.text) : [],
		);
		if (!declarations.length) continue;
		fileSources.push({ fileId: file.id, path: file.path, language, before, after, declarations });
	}
	return { ...bundle, fileSources };
}

export function findSmallestReviewDeclaration(
	snapshot: ReviewFileSourceSnapshot,
	side: "before" | "after",
	line: number,
): ReviewDeclarationUnit | undefined {
	return snapshot.declarations.filter((unit) => {
		const range = unit[side];
		return !!range && line >= range.startLine && line <= range.endLine;
	}).sort((left, right) => {
		const leftRange = left[side]!;
		const rightRange = right[side]!;
		const leftSpan = leftRange.endLine - leftRange.startLine;
		const rightSpan = rightRange.endLine - rightRange.startLine;
		return leftSpan - rightSpan || right.depth - left.depth || left.id.localeCompare(right.id);
	})[0];
}
