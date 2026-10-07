import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { planWorkspaceRestore, readSessionIdentity, validateRestoreLaunch } from "./planner.ts";
import type { WorkspaceSnapshot, WorkspaceTerminalSnapshot } from "./index.ts";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "workspace-plan-"));
	const work = join(root, "work");
	mkdirSync(work);
	const session = (name: string, content = JSON.stringify({ type: "session", version: 3, id: "shared-fork-id", cwd: work })) => {
		const path = join(root, `${name}.jsonl`);
		writeFileSync(path, `${content}\n`);
		return path;
	};
	const term = (file?: string, match: WorkspaceTerminalSnapshot["match"] = "active"): WorkspaceTerminalSnapshot => ({ id: "source-panel", index: 1, name: "same title", cwd: root, sessionFile: file, match });
	const plan = (terms: WorkspaceTerminalSnapshot[]) => planWorkspaceRestore({
		version: 1, id: "snapshot", name: "fixture", host: "ghostty", source: "manual", createdAt: 1, updatedAt: 1, window: { id: "w", name: "w" },
		tabs: [{ id: "tab", index: 1, name: "tab", selected: true, terminals: terms }],
	} satisfies WorkspaceSnapshot, (target) => `cd '${target.cwd}' && pi --session '${target.sessionFile}'`);
	return { root, work, session, term, plan, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("header cwd owns launch identity; same header ID and title in distinct files are not merged", () => {
	const f = fixture();
	try {
		const plan = f.plan([f.term(f.session("original")), f.term(f.session("fork"))]);
		assert.equal(plan.total, 2);
		assert.equal(plan.ready, 2);
		assert.equal(plan.blocked, 0);
		assert.notEqual(plan.actions[0][0].sourcePanelKey, plan.actions[0][1].sourcePanelKey);
		for (const action of plan.actions[0]) {
			assert.equal(action.terminalCwd, f.root);
			assert.equal(action.cwd, readSessionIdentity(action.sessionFile!).sessionCwd);
			assert.equal(action.sessionCwd, action.cwd);
			assert.match(action.command!, new RegExp(`cd '${action.cwd}'`));
			assert.doesNotThrow(() => validateRestoreLaunch(action));
		}
	} finally { f.cleanup(); }
});

test("preflight accounts for every original panel, never replaces missing links or trusts legacy fallback", () => {
	const f = fixture();
	try {
		const good = f.session("good");
		const empty = f.session("empty", "");
		const nonPi = f.session("non-pi", "{}");
		const noCwd = f.session("deleted-cwd", JSON.stringify({ type: "session", version: 3, id: "id", cwd: join(f.root, "deleted") }));
		const plan = f.plan([f.term(good), f.term(), f.term(join(f.root, "missing.jsonl")), f.term(empty), f.term(nonPi), f.term(noCwd), f.term(f.session("fallback"), "fallback"), f.term(f.root)]);
		assert.deepEqual([plan.total, plan.ready, plan.blocked], [8, 1, 7]);
		assert.ok(plan.actions[0].slice(1).every((action) => action.blockedReason && !action.command));
		assert.match(plan.actions[0][1].blockedReason!, /unresolved/);
		assert.match(plan.actions[0][6].blockedReason!, /추정 fallback/);
		assert.equal(readFileSync(empty, "utf8"), "\n");
		assert.equal(readFileSync(nonPi, "utf8"), "{}\n");
	} finally { f.cleanup(); }
});

test("headers that require migration or an unverified future format are blocked without rewriting source bytes", () => {
	const f = fixture();
	try {
		for (const version of [undefined, 1, 2, 4]) {
			const file = f.session(`version-${version}`, JSON.stringify({ type: "session", version, id: "legacy", cwd: f.work }));
			const before = readFileSync(file);
			const plan = f.plan([f.term(file)]);
			assert.deepEqual([plan.ready, plan.blocked], [0, 1]);
			assert.match(plan.actions[0][0].blockedReason!, /session version/);
			assert.deepEqual(readFileSync(file), before);
		}
	} finally { f.cleanup(); }
});

test("realpath duplicates block both panels and TOCTOU detects a changed header without hashing transcript bodies", () => {
	const f = fixture();
	try {
		const file = f.session("original");
		const alias = join(f.root, "alias.jsonl");
		symlinkSync(file, alias);
		const duplicate = f.plan([f.term(file), f.term(alias)]);
		assert.deepEqual([duplicate.ready, duplicate.blocked], [0, 2]);
		assert.ok(duplicate.actions[0].every((action) => /동일 sessionFile 중복/.test(action.blockedReason!)));
		const [action] = f.plan([f.term(file)]).actions[0];
		writeFileSync(file, `${readFileSync(file, "utf8")}{"type":"session_info","name":"renamed"}\n`);
		assert.doesNotThrow(() => validateRestoreLaunch(action));
		f.session("original", JSON.stringify({ type: "session", version: 3, id: "different", cwd: f.work }));
		assert.throws(() => validateRestoreLaunch(action), /identity가 변경/);
	} finally { f.cleanup(); }
});
