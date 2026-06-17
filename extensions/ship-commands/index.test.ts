import assert from "node:assert/strict";
import test from "node:test";
import {
	buildParallelAnalysisRequest,
	isCiShipExcludedByDefaultCheck,
	parseParallelAnalysisCommand,
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
