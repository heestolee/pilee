import assert from "node:assert/strict";
import test from "node:test";
import { isCiShipExcludedByDefaultCheck } from "./index.ts";

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
