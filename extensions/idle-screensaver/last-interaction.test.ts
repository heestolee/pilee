import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import {
	formatLastInteractionLine,
	formatRelativeTime,
	latestInteractionFromEntries,
	latestInteractionFromSessionFile,
	nextRelativeTimeRefreshDelayMs,
	resolveLastInteractionAt,
} from "./last-interaction.ts";

function writeSession(lines: unknown[]): string {
	const dir = mkdtempSync(join(tmpdir(), "screensaver-last-interaction-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
	return file;
}

test("entries에서 timestamp가 있는 최신 user/assistant 메시지를 찾는다", () => {
	const older = Date.parse("2026-05-19T10:00:00.000Z");
	const latest = Date.parse("2026-05-19T10:05:00.000Z");
	const result = latestInteractionFromEntries([
		{ type: "message", timestamp: "2026-05-19T10:00:00.000Z", message: { role: "user" } },
		{ type: "message", timestamp: "2026-05-19T10:03:00.000Z", message: { role: "toolResult" } },
		{ type: "message", timestamp: "2026-05-19T10:05:00.000Z", message: { role: "assistant" } },
	]);
	assert.equal(result, latest);
	assert.notEqual(result, older);
});

test("in-memory entries에 timestamp가 없으면 session JSONL과 fallback 중 최신값을 사용한다", () => {
	const sessionFile = writeSession([
		{ type: "session", timestamp: "2026-05-19T09:00:00.000Z", cwd: "/tmp" },
		{ type: "message", timestamp: "2026-05-19T09:10:00.000Z", message: { role: "user" } },
		{ type: "message", timestamp: "2026-05-19T09:20:00.000Z", message: { role: "toolResult" } },
		{ type: "message", timestamp: "2026-05-19T09:30:00.000Z", message: { role: "assistant" } },
	]);
	try {
		const fallbackFromSlashCommand = Date.parse("2026-05-19T10:00:00.000Z");
		const resolved = resolveLastInteractionAt({
			entries: [{ type: "message", message: { role: "assistant" } }],
			sessionFile,
			fallbackMs: fallbackFromSlashCommand,
		});
		assert.equal(resolved, fallbackFromSlashCommand);
	} finally {
		rmSync(join(sessionFile, ".."), { recursive: true, force: true });
	}
});

test("entries/session file/fallback 중 가장 최신 timestamp를 사용한다", () => {
	const sessionFile = writeSession([
		{ type: "message", timestamp: "2026-05-19T08:00:00.000Z", message: { role: "assistant" } },
	]);
	try {
		const resolved = resolveLastInteractionAt({
			entries: [{ type: "message", timestamp: "2026-05-19T11:00:00.000Z", message: { role: "user" } }],
			sessionFile,
			fallbackMs: Date.parse("2026-05-19T12:00:00.000Z"),
		});
		assert.equal(resolved, Date.parse("2026-05-19T12:00:00.000Z"));
	} finally {
		rmSync(join(sessionFile, ".."), { recursive: true, force: true });
	}
});

test("session file 파서가 깨진 줄과 비대화 message role을 건너뛴다", () => {
	const dir = mkdtempSync(join(tmpdir(), "screensaver-last-interaction-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, [
		"not json",
		JSON.stringify({ type: "message", timestamp: "2026-05-19T07:00:00.000Z", message: { role: "toolResult" } }),
		JSON.stringify({ type: "message", timestamp: "2026-05-19T07:30:00.000Z", message: { role: "assistant" } }),
	].join("\n"), "utf8");
	try {
		assert.equal(latestInteractionFromSessionFile(file), Date.parse("2026-05-19T07:30:00.000Z"));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("상대 시간과 최종 표시 라인을 안정적으로 만든다", () => {
	const ts = Date.parse("2026-05-19T09:00:00.000Z");
	assert.equal(formatRelativeTime(ts, ts + 65_000), "1분 전");
	const line = formatLastInteractionLine(ts, ts + 65_000);
	assert.ok(line?.startsWith("🕘 마지막 인터랙션 "));
	assert.ok(line?.endsWith(" · 1분 전"));
});

test("screensaver 상대시간 갱신 주기는 30분 전까지 1분, 이후 5분이다", () => {
	const ts = Date.parse("2026-05-19T09:00:00.000Z");
	assert.equal(nextRelativeTimeRefreshDelayMs(ts, ts + 29 * 60_000), 60_000);
	assert.equal(nextRelativeTimeRefreshDelayMs(ts, ts + 30 * 60_000), 5 * 60_000);
	assert.equal(nextRelativeTimeRefreshDelayMs(null, ts), 60_000);
});
