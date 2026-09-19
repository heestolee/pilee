import assert from "node:assert/strict";
import test from "node:test";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { transcriptEntries } from "./transcript-history.ts";

function fixture() {
	const session = SessionManager.inMemory();
	const old = session.appendMessage({ role: "user", content: "압축 전 질문 원문", timestamp: 1 });
	const kept = session.appendMessage({ role: "user", content: "최근 질문", timestamp: 2 });
	const compact = session.appendCompaction("요약만 모델에 전달", kept, 100_000);
	return { session, old, kept, compact };
}

test("reload shows original entries in chronological order without changing model context", () => {
	const { session, old, kept, compact } = fixture();
	const branch = session.getBranch();
	const snapshot = JSON.stringify(branch);
	const contextBefore = session.buildSessionContext();
	const selected = [branch[2], branch[1]];
	assert.deepEqual(transcriptEntries(branch, selected).map((entry) => entry.id), [old, kept, compact]);
	assert.equal(JSON.stringify(branch), snapshot);
	assert.deepEqual(session.buildSessionContext(), contextBefore);
	assert.equal(contextBefore.messages.some((message) => message.role === "user" && message.content === "압축 전 질문 원문"), false);
});

test("compaction completion restores history but lets core append the latest summary once", () => {
	const { session, old, kept } = fixture();
	const branch = session.getBranch();
	assert.deepEqual(transcriptEntries(branch, [branch[1]]).map((entry) => entry.id), [old, kept]);
});

test("compact-all with no retained tail still preserves every original message", () => {
	const session = SessionManager.inMemory();
	const old = session.appendMessage({ role: "user", content: "전체 압축 전 원문", timestamp: 1 });
	session.appendCompaction("전체 요약", "", 100_000);
	assert.deepEqual(transcriptEntries(session.getBranch(), []).map((entry) => entry.id), [old]);
});

test("uncompacted sessions keep the original render input", () => {
	const session = SessionManager.inMemory();
	session.appendMessage({ role: "user", content: "아직 압축 없음", timestamp: 1 });
	const branch = session.getBranch();
	assert.equal(transcriptEntries(branch, branch), branch);
});
