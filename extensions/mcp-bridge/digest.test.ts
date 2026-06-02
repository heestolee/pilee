import assert from "node:assert/strict";
import test from "node:test";
import { __buildMcpDigestForTesting, __shouldReturnDigestForTesting } from "./index.ts";

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
	const output = JSON.stringify({
		ok: true,
		channel_name: "product-dev",
		thread_ts: "1780000000.000100",
		messages: [
			{ ts: "1780000000.000100", user: "U1", username: "changhee", text: "예약 취소 조건이 이상해요", files: [{ title: "screenshot.png", permalink: "https://slack.example/file" }] },
			{ ts: "1780000060.000200", user: "U2", username: "reviewer", text: "정책 구간 기준으로 봐야 할 것 같아요" },
		],
	});
	const digest = __buildMcpDigestForTesting({ server: "slack", tool: "slack_get_thread", output });
	assert.match(digest, /💬 Slack 결과 확인/);
	assert.match(digest, /채널: product-dev/);
	assert.match(digest, /참여자: changhee, reviewer/);
	assert.match(digest, /## 대화 스레드/);
	assert.match(digest, /changhee/);
	assert.match(digest, /예약 취소 조건/);
	assert.match(digest, /파일: screenshot\.png/);
	assert.doesNotMatch(digest, /"messages"\s*:/, "Slack thread should not expose raw JSON structure");
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
