import assert from "node:assert/strict";
import test from "node:test";
import { __test__ } from "./index.ts";

function toolResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text", text }], details };
}

test("MCP Slack result collapses to one-line summary and preserves Ctrl+O hint", () => {
	const text = [
		"🔌 MCP 결과 — digest-first",
		"server: creatrip-internal",
		"tool: slack_getThreadReplies",
		"responseId: mcp_test",
		"",
		"## 요약",
		"💬 Slack 결과 확인",
		"",
		"메시지: 23개",
		"채널: CPJ04855E",
		"참여자: creatripapp, Yilin Hung (홍이린), Jeonghyeon Kim (김정현), hermes, Bohyeon Kim (김보현)",
		"시간 범위: 2026-06-02 11:39:18 UTC (1780400358.433669) → 2026-06-02 13:58:40 UTC (1780408720.456209)",
		"",
		"## 대화 스레드",
		"[2026-06-02 11:39:18 UTC] creatripapp",
		"버그제보 제보가 도착했어요!",
	].join("\n");
	const line = __test__.formatMcpCollapsedLine(toolResult("💬 Slack thread · 23개 메시지 · 참여자 5명 · 11:39–13:58 · Ctrl+O 펼쳐보기", { server: "creatrip-internal", tool: "slack_getThreadReplies", originalChars: 11907, fullDigest: text }));
	assert.equal(line, "💬 Slack thread · 23개 메시지 · 참여자 5명 · 11:39–13:58 · Ctrl+O 펼쳐보기");
	assert.doesNotMatch(line, /버그제보|대화 스레드|responseId/);
});

test("MCP Notion result collapses to page title and image count", () => {
	const text = [
		"# 취소/환불 정책 통합 변경",
		"본문입니다.",
		"- 이미지: 08B5E9F1-48CE-486A-AE1E-A76F48A0915D.png · Notion 원문에서 확인",
		"### 확인 완료 사항",
	].join("\n\n");
	const line = __test__.formatMcpCollapsedLine(toolResult("📝 Notion page · 취소/환불 정책 통합 변경 · 이미지 1개 · Ctrl+O 펼쳐보기", { server: "creatrip-internal", tool: "notion_readPage", fullDigest: text }));
	assert.equal(line, "📝 Notion page · 취소/환불 정책 통합 변경 · 이미지 1개 · Ctrl+O 펼쳐보기");
	assert.doesNotMatch(line, /X-Amz|prod-files-secure|본문입니다/);
});

test("MCP expanded hint changes when tool output is expanded", () => {
	const line = __test__.formatMcpCollapsedLine(toolResult("# 문서", { server: "creatrip-internal", tool: "notion_readPage" }), undefined, true);
	assert.match(line, /Ctrl\+O 접기$/);
});
