import type { StudyNoteBlock } from "./studio.ts";

export type StudyNoteBlockDiffStatus = "unchanged" | "changed" | "removed" | "added";

export interface StudyNoteBlockDiffRow {
	status: StudyNoteBlockDiffStatus;
	left?: StudyNoteBlock;
	right?: StudyNoteBlock;
}

function normalizedText(value: unknown): string {
	return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function normalizedStrings(value: unknown): string[] {
	return Array.isArray(value) ? value.map(normalizedText) : [];
}

function comparableBlock(block: StudyNoteBlock): unknown {
	switch (block.type) {
		case "heading":
			return { type: block.type, level: block.level || 2, text: normalizedText(block.text) };
		case "paragraph":
			return { type: block.type, text: normalizedText(block.text) };
		case "callout":
			return { type: block.type, tone: block.tone || "info", title: normalizedText(block.title), body: normalizedText(block.body) };
		case "list":
			return { type: block.type, ordered: block.ordered === true, items: normalizedStrings(block.items) };
		case "table":
			return { type: block.type, columns: normalizedStrings(block.columns), rows: (block.rows || []).map((row) => normalizedStrings(row)) };
		case "code":
			return {
				type: block.type,
				language: block.code?.language || "",
				code: block.code?.code.replace(/\r\n/g, "\n") || "",
				lineNumberMode: block.code?.lineNumberMode || "relative",
				startLine: block.code?.startLine || 1,
				annotations: (block.code?.annotations || []).map((item) => ({ line: item.line, endLine: item.endLine, kind: item.kind, text: normalizedText(item.text) })),
			};
		case "reference-list":
			return { type: block.type, references: (block.references || []).map((item) => ({ kind: item.kind, label: normalizedText(item.label), path: item.path, url: item.url, symbol: item.symbol, location: item.location, excerpt: item.excerpt, note: item.note, revision: item.revision, startLine: item.startLine })) };
		case "flow-ref":
			return { type: block.type, flowId: block.flowId || "" };
		case "image":
			return { type: block.type, alt: normalizedText(block.image?.alt), caption: normalizedText(block.image?.caption) };
		case "visual":
			return { type: block.type, title: normalizedText(block.title), body: normalizedText(block.body), visual: block.visual || {} };
		case "visual-ref":
			return { type: block.type, title: normalizedText(block.title), body: normalizedText(block.body), visualRef: block.visualRef || {} };
		case "divider":
			return { type: block.type };
	}
}

function semanticKey(block: StudyNoteBlock): string {
	return JSON.stringify(comparableBlock(block));
}

function exactAnchors(left: StudyNoteBlock[], right: StudyNoteBlock[]): Array<[number, number]> {
	const leftKeys = left.map(semanticKey);
	const rightKeys = right.map(semanticKey);
	const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
	for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
		for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
			table[leftIndex][rightIndex] = leftKeys[leftIndex] === rightKeys[rightIndex]
				? table[leftIndex + 1][rightIndex + 1] + 1
				: Math.max(table[leftIndex + 1][rightIndex], table[leftIndex][rightIndex + 1]);
		}
	}
	const anchors: Array<[number, number]> = [];
	let leftIndex = 0;
	let rightIndex = 0;
	while (leftIndex < left.length && rightIndex < right.length) {
		if (leftKeys[leftIndex] === rightKeys[rightIndex]) {
			anchors.push([leftIndex, rightIndex]);
			leftIndex += 1;
			rightIndex += 1;
		} else if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) leftIndex += 1;
		else rightIndex += 1;
	}
	return anchors;
}

function diffGap(left: StudyNoteBlock[], right: StudyNoteBlock[]): StudyNoteBlockDiffRow[] {
	const rightUsed = new Set<number>();
	const paired = new Map<number, number>();
	for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
		const match = right.findIndex((block, rightIndex) => !rightUsed.has(rightIndex) && block.type === left[leftIndex].type);
		if (match >= 0) {
			paired.set(leftIndex, match);
			rightUsed.add(match);
		}
	}
	const rows: StudyNoteBlockDiffRow[] = left.map((block, leftIndex) => {
		const rightIndex = paired.get(leftIndex);
		return rightIndex === undefined
			? { status: "removed", left: structuredClone(block) }
			: { status: "changed", left: structuredClone(block), right: structuredClone(right[rightIndex]) };
	});
	for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
		if (!rightUsed.has(rightIndex)) rows.push({ status: "added", right: structuredClone(right[rightIndex]) });
	}
	return rows;
}

export function diffStudyNoteBlocks(left: StudyNoteBlock[], right: StudyNoteBlock[]): StudyNoteBlockDiffRow[] {
	const anchors = exactAnchors(left, right);
	const rows: StudyNoteBlockDiffRow[] = [];
	let leftStart = 0;
	let rightStart = 0;
	for (const [leftIndex, rightIndex] of [...anchors, [left.length, right.length] as [number, number]]) {
		rows.push(...diffGap(left.slice(leftStart, leftIndex), right.slice(rightStart, rightIndex)));
		if (leftIndex < left.length && rightIndex < right.length) rows.push({ status: "unchanged", left: structuredClone(left[leftIndex]), right: structuredClone(right[rightIndex]) });
		leftStart = leftIndex + 1;
		rightStart = rightIndex + 1;
	}
	return rows;
}
