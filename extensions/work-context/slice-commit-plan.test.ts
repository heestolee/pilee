import assert from "node:assert/strict";
import test from "node:test";
import { buildSliceCommitPlan, defaultSliceCommitMessage, parseGitStatusPorcelain } from "./slice-commit-plan.ts";
import type { WorkContextCard } from "../utils/work-context.ts";

function card(scope: string[] = ["src/feature"], title = "예약 버튼 노출 조건 수정"): WorkContextCard {
	return {
		schemaVersion: 1,
		identity: {
			id: "worktree:test",
			type: "worktree",
			root: "/repo",
			cwd: "/repo",
			displayName: "repo",
			contextPath: "/repo/.pi/work-context.json",
			tasksPath: "/repo/.pi/work-tasks.json",
			framePath: "/repo/.pi/frame.json",
		},
		updatedAt: "2026-05-20T00:00:00.000Z",
		source: "frame",
		mode: "standard",
		goal: "예약 플로우 개선",
		currentSlice: { id: "S1", title, scope, acceptance: ["검증 통과"], status: "in_progress" },
		slices: [],
		mustKeep: [],
		mustNot: [],
		openQuestions: [],
		verifyFocus: [],
		lastKnownState: {},
		refs: { tasks: "/repo/.pi/work-tasks.json" },
	};
}

test("parseGitStatusPorcelain handles normal, untracked, and rename entries", () => {
	assert.deepEqual(parseGitStatusPorcelain([" M src/a.ts", "?? src/new.ts", "R  old.ts -> src/renamed.ts"]), [
		{ index: " ", worktree: "M", path: "src/a.ts" },
		{ index: "?", worktree: "?", path: "src/new.ts" },
		{ index: "R", worktree: " ", originalPath: "old.ts", path: "src/renamed.ts" },
	]);
});

test("buildSliceCommitPlan includes only current slice scope and leaves leftovers", () => {
	const output = buildSliceCommitPlan({
		card: card(),
		expectedHead: "abc123",
		statusLines: [" M src/feature/index.ts", " M src/feature/view.tsx", " M docs/readme.md"],
	});
	assert.equal(output.message, "feat: 예약 버튼 노출 조건 수정");
	assert.deepEqual(output.included, ["src/feature/index.ts", "src/feature/view.tsx"]);
	assert.deepEqual(output.skipped, ["docs/readme.md"]);
	assert.equal(output.plan.allowLeftovers, true);
	assert.deepEqual(output.plan.commits, [{ message: "feat: 예약 버튼 노출 조건 수정", paths: ["src/feature/index.ts", "src/feature/view.tsx"] }]);
});

test("buildSliceCommitPlan can include outside scope when explicitly requested", () => {
	const output = buildSliceCommitPlan({
		card: card(),
		message: "fix: 예약 플로우 수정",
		includeOutsideScope: true,
		statusLines: [" M src/feature/index.ts", " M docs/readme.md"],
	});
	assert.deepEqual(output.included, ["docs/readme.md", "src/feature/index.ts"]);
	assert.deepEqual(output.skipped, []);
	assert.equal(output.plan.allowLeftovers, false);
	assert.equal(output.plan.commits[0].message, "fix: 예약 플로우 수정");
});

test("buildSliceCommitPlan carries a safe push target into the plan", () => {
	const output = buildSliceCommitPlan({
		card: card(),
		message: "fix: 예약 플로우 수정",
		statusLines: [" M src/feature/index.ts"],
		push: { remote: "origin", branch: "feature/test" },
	});
	assert.deepEqual(output.plan.push, { remote: "origin", branch: "feature/test" });
});

test("buildSliceCommitPlan records commit readiness metadata without blocking caveats", () => {
	const output = buildSliceCommitPlan({
		card: card(["backend/apps/trip", "frontend/apps/admin", "frontend/schema.graphql"]),
		message: "feat: 스팟 리뷰 답글 노출 타입",
		statusLines: [
			"?? backend/apps/trip/migrations/20260527042440-add-display-author-type.js",
			" M frontend/apps/admin/src/components/spotReviews/SpotReviewDetailModal.tsx",
			" M frontend/schema.graphql",
		],
	});

	assert.equal(output.readiness.commitReadiness, "ready_with_caveats");
	assert.equal(output.readiness.shipReadiness, "blocked_by_caveats");
	assert.equal(output.plan.metadata?.commitReadiness, "ready_with_caveats");
	assert.equal(output.plan.metadata?.shipReadiness, "blocked_by_caveats");
	assert.match(output.plan.metadata?.notBlockers.join("\n") ?? "", /deferred migration execution/);
});

test("defaultSliceCommitMessage falls back to goal when slice title is empty", () => {
	const c = card([], "");
	c.currentSlice = { ...c.currentSlice!, title: "" };
	assert.equal(defaultSliceCommitMessage(c), "feat: 예약 플로우 개선");
});
