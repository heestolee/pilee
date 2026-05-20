import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { promotePlanningWorkArtifactsToWorktree, workUnitDirForSessionFile } from "./frame-artifacts.ts";

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path: string): any {
	return JSON.parse(readFileSync(path, "utf8"));
}

test("planning frame promotion carries task board into worktree work-unit", () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-wt-artifacts-"));
	const workUnitsRoot = join(root, "work-units");
	const sourceSessionFile = join(root, "source-session.jsonl");
	writeFileSync(sourceSessionFile, "");
	const sourceFramePath = join(root, "planning", "frame.json");
	const sourceTasksPath = join(workUnitDirForSessionFile(sourceSessionFile, workUnitsRoot), "work-tasks.json");
	writeJson(sourceTasksPath, {
		nextId: 3,
		tasks: [
			{
				id: "1",
				subject: "SLICE-4 Web 예약 상세 사용자 흐름 정렬",
				status: "pending",
				kind: "slice",
				owner: "agent",
				area: "FE web",
				source: "frame",
				refs: { frame: sourceFramePath, sliceId: "SLICE-4" },
				metadata: { surface: "web" },
			},
			{
				id: "2",
				subject: "다른 planning 작업",
				status: "pending",
				kind: "slice",
				owner: "agent",
				area: "기타",
				source: "manual",
				refs: { frame: join(root, "planning", "other-frame.json") },
			},
		],
	});

	const worktreePath = join(root, "worktree");
	mkdirSync(worktreePath, { recursive: true });
	spawnSync("git", ["init", "-q"], { cwd: worktreePath, stdio: "ignore" });
	const targetFramePath = join(worktreePath, ".pi", "frame.json");
	writeJson(targetFramePath, {
		version: 1,
		identity: { mode: "worktree", key: "worktree:test", sourceSessionFile, displayTitle: "Frame · test" },
		workspace: "test",
		worktree: worktreePath,
		goal: "task board carry test",
		boundaries: { always: ["keep"], never: ["do not drop tasks"] },
		implementation_plan: { slices: [{ id: "SLICE-4", goal: "Web flow", validation: ["task visible"] }] },
		success_criteria: [{ id: "SC-4", statement: "Web task remains visible" }],
		verify_plan: { commands: [], manual_checks: [] },
		provenance: { canonicalHash: "test" },
	});

	const result = promotePlanningWorkArtifactsToWorktree({
		frame: readJson(targetFramePath),
		worktreePath,
		targetFramePath,
		sourceFramePath,
		workUnitsRoot,
		now: 1234,
	});

	assert.equal(result.tasks.status, "copied");
	assert.equal(result.tasks.count, 1);
	assert.equal(result.context.status, "refreshed");

	const targetTasksPath = join(worktreePath, ".pi", "work-tasks.json");
	const targetTasks = readJson(targetTasksPath);
	assert.equal(targetTasks.tasks.length, 1, "unrelated planning tasks must not be promoted");
	assert.equal(targetTasks.tasks[0].area, "FE web");
	assert.equal(targetTasks.tasks[0].refs.frame, targetFramePath);
	assert.equal(targetTasks.tasks[0].metadata.surface, "web");
	assert.equal(targetTasks.tasks[0].metadata.promotedFromWorkUnit, sourceTasksPath);
	assert.equal(targetTasks.tasks[0].metadata.promotedToWorktree, worktreePath);

	const contextPath = join(worktreePath, ".pi", "work-context.json");
	assert.ok(existsSync(contextPath), "work-context should be refreshed in the worktree .pi directory");
	const context = readJson(contextPath);
	assert.equal(realpathSync.native(context.refs.tasks), realpathSync.native(targetTasksPath));
	assert.equal(context.currentSlice.id, "SLICE-4");

	const second = promotePlanningWorkArtifactsToWorktree({
		frame: readJson(targetFramePath),
		worktreePath,
		targetFramePath,
		sourceFramePath,
		workUnitsRoot,
	});
	assert.equal(second.tasks.status, "target-exists");
	assert.equal(readJson(targetTasksPath).tasks.length, 1);
});
