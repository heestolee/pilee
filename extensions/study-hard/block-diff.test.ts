import assert from "node:assert/strict";
import test from "node:test";
import { diffStudyNoteBlocks } from "./block-diff.ts";
import type { StudyNoteBlock } from "./studio.ts";

const paragraph = (id: string, text: string): StudyNoteBlock => ({ id, type: "paragraph", text });
const callout = (id: string, body: string): StudyNoteBlock => ({ id, type: "callout", tone: "info", title: "핵심", body });

test("block diff는 동일 anchor 사이의 같은 type 변경과 양쪽 전용 block을 구분한다", () => {
	const left: StudyNoteBlock[] = [
		paragraph("notion-a", "같은 도입"),
		callout("notion-b", "현재 설명"),
		{ id: "notion-image", type: "image", image: { url: "https://example.com/image.png", caption: "Notion 전용" } },
		paragraph("notion-c", "같은 결론"),
	];
	const right: StudyNoteBlock[] = [
		paragraph("study-a", "같은 도입"),
		callout("study-b", "변경 설명"),
		{ id: "study-table", type: "table", columns: ["개념"], rows: [["Fabric"]] },
		paragraph("study-c", "같은 결론"),
	];
	const rows = diffStudyNoteBlocks(left, right);
	assert.deepEqual(rows.map((row) => row.status), ["unchanged", "changed", "removed", "added", "unchanged"]);
	assert.equal(rows[1].left?.id, "notion-b");
	assert.equal(rows[1].right?.id, "study-b");
	assert.equal(rows[2].left?.type, "image");
	assert.equal(rows[3].right?.type, "table");
});

test("block diff는 block id가 달라도 의미가 같으면 unchanged로 본다", () => {
	const rows = diffStudyNoteBlocks([paragraph("notion-id", "같은 내용")], [paragraph("canonical-id", "같은 내용")]);
	assert.equal(rows.length, 1);
	assert.equal(rows[0].status, "unchanged");
});

test("block diff는 type과 무관한 round-trip 기본 필드를 semantic 변경으로 보지 않는다", () => {
	const current = [
		{ id: "notion-callout", type: "callout", tone: "question", title: "핵심 질문", body: "같은 내용" },
		{ id: "notion-table", type: "table", columns: ["개념"], rows: [["Fabric"]] },
	] as StudyNoteBlock[];
	const desired = [
		{ id: "study-callout", type: "callout", tone: "question", title: "핵심 질문", body: "같은 내용", level: 2, text: "", ordered: false, items: [], columns: [], rows: [], references: [], flowId: "" },
		{ id: "study-table", type: "table", columns: ["개념"], rows: [["Fabric"]], level: 2, text: "", title: "", body: "", tone: "info", ordered: false, items: [], references: [], flowId: "" },
	] as StudyNoteBlock[];
	assert.deepEqual(diffStudyNoteBlocks(current, desired).map((row) => row.status), ["unchanged", "unchanged"]);
});

test("block diff는 type별 의미 필드가 달라지면 changed로 본다", () => {
	const rows = diffStudyNoteBlocks(
		[callout("left", "기존 설명"), { id: "table-left", type: "table", columns: ["개념"], rows: [["Fabric"]] }],
		[callout("right", "변경 설명"), { id: "table-right", type: "table", columns: ["개념"], rows: [["Bridgeless"]] }],
	);
	assert.deepEqual(rows.map((row) => row.status), ["changed", "changed"]);
});

test("block diff는 callout disclosure presentation 변경을 semantic 변경으로 본다", () => {
	const plain = { id: "plain", type: "callout", tone: "question", title: "왜 분리하는가?", body: "책임이 다르기 때문입니다." } as StudyNoteBlock;
	const collapsed = { ...plain, id: "collapsed", presentation: { container: "details", defaultOpen: false } } as StudyNoteBlock;
	const opened = { ...collapsed, id: "opened", presentation: { container: "details", defaultOpen: true } } as StudyNoteBlock;
	assert.equal(diffStudyNoteBlocks([plain], [collapsed])[0]?.status, "changed");
	assert.equal(diffStudyNoteBlocks([collapsed], [opened])[0]?.status, "changed");
});

test("block diff는 같은 type block 여러 개를 순서대로 changed로 짝짓는다", () => {
	const rows = diffStudyNoteBlocks(
		[callout("left-1", "A"), callout("left-2", "B")],
		[callout("right-1", "A 수정"), callout("right-2", "B 수정")],
	);
	assert.deepEqual(rows.map((row) => row.status), ["changed", "changed"]);
	assert.equal(rows[1].left?.id, "left-2");
	assert.equal(rows[1].right?.id, "right-2");
});
