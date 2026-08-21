import assert from "node:assert/strict";
import test from "node:test";
import shipCommands, {
	buildParallelAnalysisRequest,
	isCiShipExcludedByDefaultCheck,
	parseParallelAnalysisCommand,
	parsePullRequestReviewUrl,
} from "./index.ts";

test("ci-ship excludes intentional FIXME policy gates from default auto-fix targets", () => {
	assert.equal(isCiShipExcludedByDefaultCheck({
		name: "fixme-alert",
		workflowName: "[Frontend development] FIXME 코멘트 체크",
		status: "COMPLETED",
		conclusion: "FAILURE",
		detailsUrl: "https://github.com/example/repo/actions/runs/1/job/2",
		startedAt: null,
		completedAt: null,
	}), true);
});

test("ci-ship keeps real PR checks actionable by default", () => {
	assert.equal(isCiShipExcludedByDefaultCheck({
		name: "pr-checks",
		workflowName: "[Backend] PR Checks",
		status: "COMPLETED",
		conclusion: "FAILURE",
		detailsUrl: "https://github.com/example/repo/actions/runs/1/job/3",
		startedAt: null,
		completedAt: null,
	}), false);
});

test("pr-ship parses a pull request review URL without confusing it with the PR", () => {
	assert.deepEqual(
		parsePullRequestReviewUrl("https://github.com/acme/product/pull/7#pullrequestreview-99"),
		{
			owner: "acme",
			repo: "product",
			number: 7,
			reviewId: 99,
			url: "https://github.com/acme/product/pull/7#pullrequestreview-99",
		},
	);
	assert.equal(parsePullRequestReviewUrl("https://github.com/acme/product/pull/7"), null);
});

test("parallel analysis parser accepts only safe steering workflow commands", () => {
	assert.deepEqual(parseParallelAnalysisCommand("/ci-ship 3796"), {
		command: "ci-ship",
		args: "3796",
	});
	assert.deepEqual(parseParallelAnalysisCommand(" /pr-ship --push-only https://github.com/o/r/pull/1 "), {
		command: "pr-ship",
		args: "--push-only https://github.com/o/r/pull/1",
	});
	assert.deepEqual(parseParallelAnalysisCommand("/self-healing"), {
		command: "self-healing",
		args: "",
	});
	assert.equal(parseParallelAnalysisCommand("/ship"), null);
	assert.equal(parseParallelAnalysisCommand("/frame"), null);
});

test("pr-ship extension blocks raw review writes only while its invocation is active", () => {
	const handlers = new Map<string, (event: any) => any>();
	const tools: string[] = [];
	shipCommands({
		registerTool(tool: any) {
			tools.push(tool.name);
		},
		registerCommand() {},
		on(name: string, handler: (event: any) => any) {
			handlers.set(name, handler);
		},
	} as any);

	assert.ok(tools.includes("pr_ship_review_write"));
	const beforeAgentStart = handlers.get("before_agent_start");
	const toolCall = handlers.get("tool_call");
	const agentSettled = handlers.get("agent_settled");
	assert.ok(beforeAgentStart && toolCall && agentSettled);

	beforeAgentStart({ prompt: "You are executing `/pr-ship https://github.com/acme/product/pull/7`." });
	assert.deepEqual(toolCall({
		toolName: "bash",
		input: { command: "gh api repos/acme/product/pulls/7/requested_reviewers --method POST -f reviewers[]=HumanReviewer" },
	}), {
		block: true,
		reason: "Blocked raw GitHub review write during /pr-ship. Use pr_ship_review_write; it re-checks the exact allowlisted reviewer login and rejects humans/unknown actors.",
	});
	assert.equal(toolCall({ toolName: "bash", input: { command: "gh api repos/acme/product/pulls/7" } }), undefined);

	agentSettled({});
	assert.equal(toolCall({
		toolName: "bash",
		input: { command: "gh api repos/acme/product/pulls/7/requested_reviewers --method POST -f reviewers[]=HumanReviewer" },
	}), undefined);
});

test("parallel analysis request captures command-time basis", () => {
	const request = buildParallelAnalysisRequest({
		cwd: "/tmp/repo",
		sessionManager: {
			getSessionFile: () => "/tmp/session.jsonl",
			getSessionName: () => "PR writer",
			getLeafId: () => "leaf-123",
		} as any,
	}, "ci-ship", "3796", "steering");

	assert.equal(request.command, "ci-ship");
	assert.equal(request.args, "3796");
	assert.equal(request.cwd, "/tmp/repo");
	assert.equal(request.source, "steering");
	assert.equal(request.sessionFile, "/tmp/session.jsonl");
	assert.equal(request.sessionName, "PR writer");
	assert.equal(request.leafId, "leaf-123");
	assert.ok(request.requestedAt);
});
