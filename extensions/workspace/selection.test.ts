import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pinSnapshotSelection, readSnapshotSelection, selectSnapshot } from "./selection.ts";

test("number selection keeps the displayed identity across reorder, deletion and alias replacement", () => {
	const root = mkdtempSync(join(tmpdir(), "workspace-selection-"));
	try {
		const write = (id: string, name = "shared") => {
			const path = join(root, `${id}.json`);
			writeFileSync(path, JSON.stringify({ version: 1, host: "ghostty", id, name, tabs: [] }));
			const selected = readSnapshotSelection(path);
			return { ...selected.reference, name };
		};
		const first = write("first");
		const second = write("autosave");
		const lastList = [first, second];
		assert.equal(selectSnapshot("2", [second, first], lastList, root).reference.hash, second.hash);
		assert.throws(() => selectSnapshot("2", [first, second], undefined, root), /먼저 \/workspace list/);
		assert.throws(() => selectSnapshot(undefined, [first], lastList, root), /대상을 지정/);
		assert.throws(() => selectSnapshot("shared", [first, second], lastList, root), /여러 snapshot/);
		assert.equal(selectSnapshot("first", [first, second], undefined, root).reference.hash, first.hash);
		const selected = selectSnapshot(second.path, [], undefined, root);
		const pin = pinSnapshotSelection(selected, root);
		assert.deepEqual(readFileSync(pin.pinnedPath), selected.bytes);
		write("autosave", "replacement");
		assert.throws(() => selectSnapshot("2", [], lastList, root), /stale snapshot/);
		assert.deepEqual(readFileSync(pin.pinnedPath), selected.bytes);
		assert.deepEqual(pinSnapshotSelection(selected, root), pin);
		unlinkSync(first.path);
		assert.throws(() => selectSnapshot("1", [second], lastList, root), /stale snapshot/);
		assert.throws(() => selectSnapshot("3", [second], lastList, root), /직전 목록에 없는 번호/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
