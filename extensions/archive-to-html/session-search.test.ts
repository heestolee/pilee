import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildMatchingSnippetHtml, parseSearchTerms, searchSessionCandidates, type ConversationSessionCandidate } from "./session-search.ts";

function tempSession(lines: unknown[]): { dir: string; file: string; candidate: ConversationSessionCandidate } {
	const dir = mkdtempSync(join(tmpdir(), "pilee-session-search-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, lines.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf-8");
	return {
		dir,
		file,
		candidate: {
			path: file,
			title: "검색 테스트 세션",
			workspace: "pilee",
			cwd: dir,
			sourceLabel: "Pi 대화",
			panelLabel: "P0",
			time: "now",
			mtime: Date.now(),
		},
	};
}

test("parseSearchTerms normalizes whitespace and de-duplicates terms", () => {
	assert.deepEqual(parseSearchTerms("  부트스트랩   worker 부트스트랩  "), ["부트스트랩", "worker"]);
});

test("buildMatchingSnippetHtml highlights matching terms safely", () => {
	const snippet = buildMatchingSnippetHtml("대화에서 <부트스트랩> worker 이야기를 했다", ["부트스트랩", "worker"], 30);
	assert.match(snippet, /&lt;<mark>부트스트랩<\/mark>&gt;/);
	assert.match(snippet, /<mark>worker<\/mark>/);
});

test("searchSessionCandidates scans JSONL user and assistant text and returns snippets", async () => {
	const { dir, candidate } = tempSession([
		{ type: "session", version: 3, id: "s1", timestamp: "2026-05-25T00:00:00.000Z", cwd: "/tmp" },
		{ type: "message", timestamp: "2026-05-25T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "오늘은 archive 카드만 이야기한다" }] } },
		{ type: "message", timestamp: "2026-05-25T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "worktree bootstrapper와 부트스트랩 worker 재귀를 점검했다" }] } },
	]);
	try {
		const result = await searchSessionCandidates([candidate], "부트스트랩 worker");
		assert.equal(result.results.length, 1);
		assert.equal(result.results[0].matches.length, 1);
		assert.equal(result.results[0].matches[0].role, "assistant");
		assert.match(result.results[0].matches[0].snippetHtml, /<mark>부트스트랩<\/mark>/);
		assert.match(result.results[0].matches[0].snippetHtml, /<mark>worker<\/mark>/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("searchSessionCandidates ignores tool-result and system noise", async () => {
	const { dir, candidate } = tempSession([
		{ type: "session", version: 3, id: "s1", timestamp: "2026-05-25T00:00:00.000Z", cwd: "/tmp" },
		{ type: "message", timestamp: "2026-05-25T00:00:01.000Z", message: { role: "toolResult", content: [{ type: "text", text: "부트스트랩" }] } },
		{ type: "message", timestamp: "2026-05-25T00:00:02.000Z", message: { role: "user", content: [{ type: "text", text: "<system>부트스트랩</system>" }] } },
	]);
	try {
		const result = await searchSessionCandidates([candidate], "부트스트랩");
		assert.equal(result.results.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
