import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseGitHubPrUrl, registerPrReview } from "./index.ts";

const DIFF = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,4 +1,5 @@
 export function visible(status: string) {
-  return status !== "HIDDEN";
+  const allowed = new Set(["OPEN", "READY"]);
+  return allowed.has(status);
 }
`;

function fixture() {
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const messages: Array<{ message: any; options: any }> = [];
	const execCalls: Array<{ command: string; args: string[] }> = [];
	const pi = {
		registerCommand(name: string, value: any) { commands.set(name, value); },
		registerTool(value: any) { tools.set(value.name, value); },
		on() {},
		async exec(command: string, args: string[]) {
			execCalls.push({ command, args });
			if (args[1] === "view") {
				return {
					code: 0,
					stdout: JSON.stringify({
						number: 42,
						title: "Visibility contract",
						url: "https://github.com/acme/repo/pull/42",
						body: "Do not expose future states.",
						author: { login: "author" },
						baseRefName: "main",
						baseRefOid: "base1234",
						headRefName: "feature/visibility",
						headRefOid: "head1234567890",
						state: "OPEN",
						isDraft: false,
						mergeable: "MERGEABLE",
					}),
					stderr: "",
				};
			}
			return { code: 0, stdout: DIFF, stderr: "" };
		},
		sendMessage(message: any, options: any) { messages.push({ message, options }); },
	} as any;
	return { pi, commands, tools, messages, execCalls };
}

test("parseGitHubPrUrl accepts canonical and changes URLs", () => {
	assert.deepEqual(parseGitHubPrUrl("https://github.com/creatrip/product/pull/4919/changes"), {
		url: "https://github.com/creatrip/product/pull/4919",
		owner: "creatrip",
		repo: "product",
		number: 4919,
	});
	assert.throws(() => parseGitHubPrUrl("https://example.com/a/b/pull/1"), /github.com/);
	assert.throws(() => parseGitHubPrUrl("https://github.com/a/b/issues/1"), /owner\/repo\/pull/);
});

test("/pr-review captures one PR from any cwd and sends the inlined workflow", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-pr-review-command-"));
	try {
		const { pi, commands, tools, messages, execCalls } = fixture();
		registerPrReview(pi, { stateRoot, now: () => 1000 });
		assert.ok(commands.has("pr-review"));
		assert.ok(tools.has("pr_review_run"));
		assert.ok(tools.has("pr_review_chat"));
		const notifications: Array<{ message: string; level: string }> = [];
		const statuses: Array<[string, string | undefined]> = [];
		await commands.get("pr-review").handler("https://github.com/acme/repo/pull/42/changes", {
			cwd: "/tmp",
			ui: {
				notify(message: string, level: string) { notifications.push({ message, level }); },
				setStatus(key: string, value?: string) { statuses.push([key, value]); },
			},
		});
		assert.deepEqual(execCalls.map((call) => call.args.slice(0, 4)), [
			["pr", "view", "42", "--repo"],
			["pr", "diff", "42", "--repo"],
		]);
		assert.equal(messages.length, 1);
		assert.equal(messages[0]?.options.deliverAs, "followUp");
		assert.equal(messages[0]?.options.triggerTurn, true);
		assert.equal(messages[0]?.message.customType, "pilee-pr-review-command");
		assert.equal(messages[0]?.message.display, false);
		assert.match(messages[0]?.message.content, /human-pr-review/);
		assert.match(messages[0]?.message.content, /Do not expose future states/);
		assert.equal(notifications.at(-1)?.level, "info");
		assert.deepEqual(statuses.at(-1), ["pr-review", undefined]);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("/pr-review hands a UI invocation to a head-pinned review workspace session", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-pr-review-workspace-command-"));
	try {
		const { pi, commands, messages } = fixture();
		const requests: any[] = [];
		registerPrReview(pi, {
			stateRoot,
			now: () => 1500,
			reviewWorkspaceRunner: async (_pi, _ctx, request) => {
				requests.push(request);
				return { status: "activated", name: "review-pr-42-head1234", branch: "review/pr-42-head1234", path: "/tmp/review-pr-42", sessionFile: "/tmp/review.jsonl", reused: false, activation: { status: "activated", panelLabel: "P1", placement: "right" } };
			},
		});
		await commands.get("pr-review").handler("https://github.com/acme/repo/pull/42", {
			cwd: "/tmp",
			hasUI: true,
			ui: { notify() {}, setStatus() {} },
		});
		assert.equal(requests.length, 1);
		assert.equal(requests[0].repo, "repo");
		assert.equal(requests[0].number, 42);
		assert.equal(requests[0].baseSha, "base1234");
		assert.equal(requests[0].headSha, "head1234567890");
		assert.match(requests[0].afterSwitchFollowUp.content, /pr_review_run.*open/);
		assert.match(requests[0].afterSwitchFollowUp.content, /\.pi\/pr-review\.json/);
		assert.equal(messages.length, 0);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});

test("pr_review_run requires full inspection before evidence-anchored submit", async () => {
	const stateRoot = mkdtempSync(join(tmpdir(), "pilee-pr-review-tool-"));
	try {
		const { pi, commands, tools, messages } = fixture();
		registerPrReview(pi, { stateRoot, now: () => 2000 });
		await commands.get("pr-review").handler("https://github.com/acme/repo/pull/42", {
			cwd: "/tmp",
			ui: { notify() {}, setStatus() {} },
		});
		const runId = messages[0]?.message.details.runId as string;
		const tool = tools.get("pr_review_run");
		const status = await tool.execute("call-1", { action: "status", runId }, undefined, undefined, {});
		assert.match(status.content[0].text, /inspection: 0\/1/);
		await assert.rejects(
			() => tool.execute("call-2", { action: "submit", runId, cards: [] }, undefined, undefined, {}),
			/submit 전에 모든 chunk/,
		);
		await assert.rejects(
			() => tool.execute("call-search-before", { action: "search", runId, query: "상태 allowlist" }, undefined, undefined, {}),
			/blind source inspection 뒤에만/,
		);
		const inspection = await tool.execute("call-3", { action: "inspect", runId, chunkId: "C001" }, undefined, undefined, {});
		assert.match(inspection.content[0].text, /D000001/);
		const noCorpus = await tool.execute("call-search-after", { action: "search", runId, query: "상태 allowlist" }, undefined, undefined, {});
		assert.match(noCorpus.content[0].text, /not configured/);
		const source = JSON.parse(readFileSync(join(stateRoot, "runs", runId, "source.json"), "utf8"));
		const evidenceId = source.lines.find((line: any) => line.kind === "deletion").id;
		const submitted = await tool.execute("call-4", {
			action: "submit",
			runId,
			cards: [{
				id: "R-01",
				title: "허용 상태를 명시한다",
				strength: "required",
				confidence: "high",
				evidenceIds: [evidenceId],
				reviewDraft: "새 상태가 자동 노출되지 않도록 허용 상태를 명시해주세요.",
				explanation: "부정 조건은 이후 상태 추가를 자동 허용합니다.",
				meta: { summary: "focused test로 재발을 막을 수 있습니다.", scope: "current-pr" },
			}],
		}, undefined, undefined, {});
		assert.match(submitted.content[0].text, /cards saved: 1/);
		assert.equal(submitted.terminate, true);
		const markdown = readFileSync(submitted.details.reportPath, "utf8");
		assert.match(markdown, /### 리뷰 초안/);
		assert.match(markdown, /### 메타적 관점/);
	} finally {
		rmSync(stateRoot, { recursive: true, force: true });
	}
});
