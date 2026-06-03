import assert from "node:assert/strict";
import test from "node:test";
import { __buildMcpDigestForTesting, __buildMcpFullContentForTesting, __buildMcpModelInjectionForTesting, __formatMcpFullContentCardForTesting, __formatMcpOutputForTesting, __shouldReturnDigestForTesting } from "./index.ts";

test("small JSON MCP output is digest-first instead of raw inline", () => {
	const output = JSON.stringify({ ok: true, title: "작은 JSON", token: "secret-token-value" });
	assert.equal(__shouldReturnDigestForTesting({ output }), true);
	const digest = __buildMcpDigestForTesting({ server: "generic", tool: "example", output });
	assert.match(digest, /MCP 결과 — digest-first/);
	assert.match(digest, /JSON object/);
	assert.doesNotMatch(digest, /"token"\s*:/, "raw JSON key/value should not be printed as raw payload");
	assert.doesNotMatch(digest, /secret-token-value/, "sensitive values should be redacted or omitted from digest");
});

test("Slack JSON is rendered as a readable conversation thread", () => {
	const payload = {
		ok: true,
		channel_name: "product-dev",
		thread_ts: "1780000000.000100",
		messages: [
			{ ts: "1780000000.000100", user: "U1", username: "changhee", text: "예약 취소 조건이 이상해요", files: [{ title: "screenshot.png", permalink: "https://slack.example/file" }] },
			{ ts: "1780000060.000200", user: "U2", username: "reviewer", text: "정책 구간 기준으로 봐야 할 것 같아요" },
		],
	};
	const output = `Retrieved 2 message(s) from thread.\n${JSON.stringify(payload, null, 2)}`;
	assert.equal(__shouldReturnDigestForTesting({ output }), true);
	const digest = __buildMcpDigestForTesting({ server: "slack", tool: "slack_get_thread", output });
	assert.match(digest, /💬 Slack 결과 확인/);
	assert.match(digest, /채널: product-dev/);
	assert.match(digest, /참여자: changhee, reviewer/);
	assert.match(digest, /## 대화 스레드/);
	assert.match(digest, /changhee/);
	assert.match(digest, /예약 취소 조건/);
	assert.match(digest, /파일: screenshot\.png/);
	assert.doesNotMatch(digest, /"messages"\s*:/, "Slack thread should not expose raw JSON structure");
	assert.doesNotMatch(digest, /보존한 식별자|원문 artifact|raw json|full text/, "Pi-visible Slack block should not expose generic identifier previews or artifacts");
});

test("Slack thread resolves participants from user id maps", () => {
	const output = JSON.stringify({
		ok: true,
		channel: "CPJ04855E",
		thread_ts: "1780400358.433669",
		messages: [
			{ ts: "1780400358.433669", userId: "U01", text: "버그 제보가 도착했어요", files: [{ name: "image.png", url_private: "https://files.slack.example/image.png" }] },
			{ ts: "1780401182.758529", userId: "U02", text: "보현님 확인 부탁드려요" },
		],
		users: [
			{ id: "U01", name: "creatripapp" },
			{ id: "U02", real_name: "Yilin Hung (홍이린)" },
		],
	});
	const digest = __buildMcpDigestForTesting({ server: "slack", tool: "slack_getThreadReplies", output });
	assert.match(digest, /참여자: creatripapp, Yilin Hung \(홍이린\)/);
	assert.match(digest, /\] creatripapp\n버그 제보/);
	assert.match(digest, /\] Yilin Hung \(홍이린\)\n보현님 확인/);
	assert.doesNotMatch(digest, /unknown/);
	assert.doesNotMatch(digest, /## 보존한 식별자\/URL preview/);
});

test("MCP output returns one-line card while keeping full digest in details", () => {
	const output = JSON.stringify({ ok: true, messages: [{ ts: "1780000000.000100", username: "changhee", text: "스크롤만 줄이면 됩니다" }] });
	const formatted = __formatMcpOutputForTesting({ server: "slack", tool: "slack_get_thread", output });
	assert.equal(formatted.details?.mcpDigest, true);
	assert.equal(formatted.details?.mcpCollapsed, true);
	assert.match(formatted.text, /^💬 Slack thread · 1개 메시지 · 참여자 1명 · \d{2}:\d{2} · Ctrl\+O 펼쳐보기\nresponseId: mcp_/);
	assert.match(formatted.text, /get_mcp_content\(responseId="mcp_[^"]+"\)/);
	assert.doesNotMatch(formatted.text, /스크롤만 줄이면 됩니다|원문 artifact|raw json|full text/);
	assert.match(String(formatted.details?.fullDigest), /responseId: mcp_/);
	assert.match(String(formatted.details?.fullDigest), /스크롤만 줄이면 됩니다/);
	assert.equal(Object.hasOwn(formatted.details ?? {}, "artifactPath"), false);
	assert.equal(Object.hasOwn(formatted.details ?? {}, "rawJsonPath"), false);
	assert.equal(Object.hasOwn(formatted.details ?? {}, "fullTextPath"), false);
});

test("get_mcp_content full content includes raw MCP result for lazy retrieval", () => {
	const full = __buildMcpFullContentForTesting({
		server: "creatrip-internal",
		tool: "slack_getThreadReplies",
		output: "💬 Slack thread · 4개 메시지 · Ctrl+O 펼쳐보기",
		rawData: {
			result: {
				content: [{ type: "text", text: "💬 Slack thread · 4개 메시지 · Ctrl+O 펼쳐보기" }],
				structuredContent: { messages: [{ username: "changhee", text: "원문 메시지" }] },
			},
		},
	});
	assert.match(full, /## MCP content text/);
	assert.match(full, /## Raw MCP result/);
	assert.match(full, /structuredContent/);
	assert.match(full, /원문 메시지/);
});

test("get_mcp_content render card hides full content text", () => {
	const full = __buildMcpFullContentForTesting({
		id: "mcp_test",
		server: "creatrip-internal",
		tool: "slack_getThreadReplies",
		output: "Retrieved 4 message(s) from thread.\n{\"messageCount\":4,\"messages\":[{\"text\":\"원문 메시지\"}]}",
		rawData: { result: { structuredContent: { messages: [{ text: "원문 메시지" }] } } },
	});
	const card = __formatMcpFullContentCardForTesting({
		text: full,
		details: { mcpFullContent: true, responseId: "mcp_test", server: "creatrip-internal", tool: "slack_getThreadReplies" },
	});
	assert.equal(card, "📦 MCP 원문 · creatrip-internal/slack_getThreadReplies · 4개 메시지 · mcp_test · Ctrl+O 펼쳐보기");
	assert.doesNotMatch(card, /원문 메시지|structuredContent|Raw MCP result/);
	assert.match(full, /원문 메시지/, "full content remains intact outside the user-visible card");
});

test("get_mcp_content model injection keeps full content out of user-visible card", () => {
	const full = __buildMcpFullContentForTesting({
		id: "mcp_test",
		server: "creatrip-internal",
		tool: "slack_getThreadReplies",
		output: "Retrieved 4 message(s) from thread.\n원문 메시지",
	});
	const injection = __buildMcpModelInjectionForTesting({
		responseId: "mcp_test",
		server: "creatrip-internal",
		tool: "slack_getThreadReplies",
		fullContent: full,
	});
	assert.match(injection, /\[MCP full content for model-only context\]/);
	assert.match(injection, /원문 메시지/);
	assert.match(injection, /responseId: mcp_test/);
});

test("Notion markdown image links are shortened without signed URLs", () => {
	const output = [
		"# 취소/환불 정책 통합 변경",
		"본문입니다.",
		"![08B5E9F1-48CE-486A-AE1E-A76F48A0915D.png](https://prod-files-secure.s3.us-west-2.amazonaws.com/path/08B5E9F1-48CE-486A-AE1E-A76F48A0915D.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=secret)",
		"### 확인 완료 사항",
	].join("\n\n");
	const formatted = __formatMcpOutputForTesting({ server: "creatrip-internal", tool: "notion_readPage", output });
	assert.equal(formatted.details?.mcpDigest, true);
	assert.equal(formatted.details?.mcpCollapsed, true);
	assert.equal(formatted.details?.mcpSanitized, true);
	assert.match(formatted.text, /^📝 Notion page · 취소\/환불 정책 통합 변경 · 이미지 1개 · Ctrl\+O 펼쳐보기\nresponseId: mcp_/);
	assert.match(formatted.text, /get_mcp_content\(responseId="mcp_[^"]+"\)/);
	assert.match(String(formatted.details?.fullDigest), /- 이미지: 08B5E9F1-48CE-486A-AE1E-A76F48A0915D\.png · Notion 원문에서 확인/);
	assert.match(String(formatted.details?.fullDigest), /### 확인 완료 사항/);
	assert.doesNotMatch(formatted.text, /prod-files-secure|X-Amz-|AWS4-HMAC|secret|본문입니다/);
	assert.doesNotMatch(String(formatted.details?.fullDigest), /prod-files-secure|X-Amz-|AWS4-HMAC|secret/);
	assert.doesNotMatch(String(formatted.details?.fullDigest), /!\[[^\]]*\]\(https?:\/\//);
});

test("Notion JSON is rendered around title properties and block text", () => {
	const output = JSON.stringify({
		object: "list",
		results: [
			{
				object: "page",
				id: "page-1",
				url: "https://notion.so/page-1",
				last_edited_time: "2026-06-02T10:00:00.000Z",
				properties: {
					Name: { type: "title", title: [{ plain_text: "MCP 출력 개선" }] },
					Status: { type: "status", status: { name: "진행중" } },
					Tags: { type: "multi_select", multi_select: [{ name: "pilee" }, { name: "mcp" }] },
				},
			},
			{ object: "block", type: "paragraph", paragraph: { rich_text: [{ plain_text: "원문 JSON 대신 읽기 좋은 digest가 필요하다." }] } },
		],
	});
	const digest = __buildMcpDigestForTesting({ server: "notion", tool: "notion_read_page", output });
	assert.match(digest, /📝 Notion 결과 확인/);
	assert.match(digest, /MCP 출력 개선/);
	assert.match(digest, /Status: 진행중/);
	assert.match(digest, /Tags: pilee, mcp/);
	assert.match(digest, /원문 JSON 대신 읽기 좋은 digest/);
	assert.doesNotMatch(digest, /"properties"\s*:/, "Notion digest should not expose raw JSON structure");
});

test("Jira JSON is rendered as issue metadata and description text", () => {
	const output = JSON.stringify({
		issues: [
			{
				key: "COM-1234",
				self: "https://creatrip.atlassian.net/rest/api/3/issue/COM-1234",
				fields: {
					summary: "MCP 결과 digest 개선",
					status: { name: "In Progress" },
					assignee: { displayName: "Changhee" },
					reporter: { displayName: "PM" },
					description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Slack/Notion/Jira를 사람이 읽기 좋게 표시한다." }] }] },
				},
			},
		],
	});
	const digest = __buildMcpDigestForTesting({ server: "atlassian", tool: "jira_search", output });
	assert.match(digest, /🎫 Jira 결과 확인/);
	assert.match(digest, /COM-1234: MCP 결과 digest 개선/);
	assert.match(digest, /In Progress/);
	assert.match(digest, /담당 Changhee/);
	assert.match(digest, /보고 PM/);
	assert.match(digest, /Slack\/Notion\/Jira를 사람이 읽기 좋게 표시한다/);
	assert.doesNotMatch(digest, /"fields"\s*:/, "Jira digest should not expose raw JSON structure");
});
