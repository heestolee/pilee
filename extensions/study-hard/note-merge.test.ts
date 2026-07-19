import assert from "node:assert/strict";
import test from "node:test";
import { mergeStudyNoteProposal } from "./note-merge.ts";
import type { StudyNoteDocument } from "./studio.ts";

function note(blocks: Array<{ id: string; text: string }>, sections: StudyNoteDocument["sections"] = []): StudyNoteDocument {
	return {
		title: "노트",
		sections: [{
			id: "overview",
			kind: "overview",
			title: "개요",
			blocks: blocks.map((block) => ({ id: block.id, type: "paragraph", text: block.text })),
		}, ...sections],
	};
}

test("서로 다른 블록의 worker 제안과 최신 변경을 함께 보존한다", () => {
	const base = note([{ id: "a", text: "A0" }, { id: "b", text: "B0" }]);
	const proposed = note([{ id: "a", text: "A-worker" }, { id: "b", text: "B0" }]);
	const current = note([{ id: "a", text: "A0" }, { id: "b", text: "B-current" }]);
	const result = mergeStudyNoteProposal(base, proposed, current);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.noteDocument.sections[0].blocks.map((block) => [block.id, block.text]), [["a", "A-worker"], ["b", "B-current"]]);
});

test("worker가 한 블록을 여러 블록으로 자유롭게 분할해도 최신 주변 변경을 보존한다", () => {
	const base = note([{ id: "combined", text: "A+B" }, { id: "tail", text: "tail0" }]);
	const proposed = note([{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "tail", text: "tail0" }]);
	const current = note([{ id: "combined", text: "A+B" }, { id: "tail", text: "tail-current" }]);
	const result = mergeStudyNoteProposal(base, proposed, current);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.noteDocument.sections[0].blocks.map((block) => [block.id, block.text]), [["a", "A"], ["b", "B"], ["tail", "tail-current"]]);
});

test("worker와 최신 노트가 같은 블록의 서로 다른 필드를 수정하면 병합한다", () => {
	const base: StudyNoteDocument = { title: "노트", sections: [{ id: "overview", kind: "overview", title: "개요", blocks: [{ id: "model", type: "callout", title: "기존 제목", body: "기존 본문" }] }] };
	const proposed = structuredClone(base);
	proposed.sections[0].blocks[0].title = "worker 제목";
	const current = structuredClone(base);
	current.sections[0].blocks[0].body = "최신 본문";
	const result = mergeStudyNoteProposal(base, proposed, current);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.noteDocument.sections[0].blocks[0], { id: "model", type: "callout", title: "worker 제목", body: "최신 본문" });
});

test("worker와 최신 노트가 같은 필드를 다르게 수정하면 conflict로 남긴다", () => {
	const base = note([{ id: "a", text: "A0" }]);
	const proposed = note([{ id: "a", text: "A-worker" }]);
	const current = note([{ id: "a", text: "A-current" }]);
	const result = mergeStudyNoteProposal(base, proposed, current);
	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.equal(result.conflicts[0]?.kind, "concurrent-change");
	assert.match(result.conflicts[0]?.path || "", /sections\[overview\]\.blocks\[a\]\.text/);
});

test("삭제와 최신 수정이 겹치면 삭제로 덮어쓰지 않는다", () => {
	const base = note([{ id: "a", text: "A0" }, { id: "b", text: "B0" }]);
	const proposed = note([{ id: "b", text: "B0" }]);
	const current = note([{ id: "a", text: "A-current" }, { id: "b", text: "B0" }]);
	const result = mergeStudyNoteProposal(base, proposed, current);
	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.equal(result.conflicts[0]?.kind, "delete-vs-change");
});

test("양쪽의 독립 삽입을 같은 section에 모두 보존한다", () => {
	const base = note([{ id: "a", text: "A" }, { id: "b", text: "B" }]);
	const proposed = note([{ id: "a", text: "A" }, { id: "worker", text: "worker" }, { id: "b", text: "B" }]);
	const current = note([{ id: "a", text: "A" }, { id: "current", text: "current" }, { id: "b", text: "B" }]);
	const result = mergeStudyNoteProposal(base, proposed, current);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.noteDocument.sections[0].blocks.map((block) => block.id), ["a", "current", "worker", "b"]);
});

test("양립할 수 없는 양쪽 순서 변경은 order conflict로 남긴다", () => {
	const base = note([{ id: "a", text: "A" }, { id: "b", text: "B" }, { id: "c", text: "C" }]);
	const proposed = note([{ id: "b", text: "B" }, { id: "a", text: "A" }, { id: "c", text: "C" }]);
	const current = note([{ id: "a", text: "A" }, { id: "c", text: "C" }, { id: "b", text: "B" }]);
	const result = mergeStudyNoteProposal(base, proposed, current);
	assert.equal(result.ok, false);
	if (result.ok) return;
	assert.ok(result.conflicts.some((conflict) => conflict.kind === "order-conflict"));
});

test("서로 다른 section의 동시 구조 변경을 함께 보존한다", () => {
	const extra = { id: "details", kind: "node" as const, title: "상세", blocks: [{ id: "c", type: "paragraph" as const, text: "C0" }] };
	const base = note([{ id: "a", text: "A0" }], [extra]);
	const proposed = structuredClone(base);
	proposed.sections[0].blocks.push({ id: "worker", type: "paragraph", text: "worker" });
	const current = structuredClone(base);
	current.sections[1].blocks[0].text = "C-current";
	const result = mergeStudyNoteProposal(base, proposed, current);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.equal(result.noteDocument.sections[0].blocks.at(-1)?.id, "worker");
	assert.equal(result.noteDocument.sections[1].blocks[0].text, "C-current");
});
