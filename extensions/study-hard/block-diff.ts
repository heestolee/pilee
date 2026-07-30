import type { StudyNoteBlock } from "./studio.ts";

export type StudyNoteBlockDiffStatus = "unchanged" | "changed" | "removed" | "added";

export interface StudyNoteBlockDiffRow {
	status: StudyNoteBlockDiffStatus;
	left?: StudyNoteBlock;
	right?: StudyNoteBlock;
}

function comparableBlock(block: StudyNoteBlock): unknown {
	const { id: _id, ...value } = structuredClone(block);
	if (value.type === "image" && value.image) {
		delete value.image.path;
		if (value.image.attachmentId) delete value.image.url;
	}
	return value;
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
