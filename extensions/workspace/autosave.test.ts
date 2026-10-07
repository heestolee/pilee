import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { hourSlotKey, nextWallClockHour, saveHourlySnapshot, scheduleHourlyAutosave } from "./autosave.ts";
import { listSnapshots } from "./store.ts";
import type { WorkspaceSnapshot } from "./index.ts";

const hour = 3_600_000;
const slot = Date.UTC(2026, 0, 1, 1);
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test("starting mid-hour has no initial save and schedules the next wall-clock hour repeatedly", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: slot - hour / 2 });
	const slots: number[] = [];
	const stop = scheduleHourlyAutosave(async (time) => { slots.push(time); }, () => true);
	try {
		t.mock.timers.tick(30_000); await flush();
		assert.deepEqual(slots, []);
		t.mock.timers.tick(hour / 2 - 30_000); await flush();
		assert.deepEqual(slots, [slot]);
		t.mock.timers.tick(hour); await flush();
		assert.deepEqual(slots, [slot, slot + hour]);
		assert.equal(nextWallClockHour(slot), slot + hour);
	} finally { stop(); }
});

test("late wake skips every missed slot and waits for the next hour; shutdown/stale context never reschedules", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: slot - 1000 });
	let current = true;
	const slots: number[] = [];
	const stop = scheduleHourlyAutosave(async (time) => { slots.push(time); }, () => current);
	try {
		t.mock.timers.setTime(slot + 3 * hour + 60_000);
		t.mock.timers.tick(0); await flush();
		assert.deepEqual(slots, []);
		t.mock.timers.tick(hour - 60_000); await flush();
		assert.deepEqual(slots, [slot + 4 * hour]);
		current = false;
		t.mock.timers.tick(hour); await flush();
		current = true;
		t.mock.timers.tick(hour); await flush();
		assert.equal(slots.length, 1);
		stop(); t.mock.timers.tick(hour); await flush();
		assert.equal(slots.length, 1);
	} finally { stop(); }
});

function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-hourly-")));
	const file = join(root, "session.jsonl");
	writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: "id", cwd: root }) + "\n");
	const snapshot: WorkspaceSnapshot = {
		version: 1, id: "capture", name: "capture", source: "auto", host: "ghostty", complete: true, createdAt: 1, updatedAt: 1,
		window: { id: "window", name: "window" }, tabs: [{ id: "tab", index: 1, name: "tab", selected: true, terminals: [
			{ id: "panel", index: 1, name: "same", cwd: root, sessionFile: file, match: "exact" },
		] }],
	};
	return { root, snapshot, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("same content at the next hour creates a new snapshot, with exact hour timestamp and no autosave alias", async () => {
	const f = fixture();
	try {
		for (const time of [slot, slot + hour]) assert.equal((await saveHourlySnapshot(f.root, time, async () => f.snapshot, () => true, () => time)).saved, true);
		const snapshots = listSnapshots(f.root);
		assert.deepEqual(snapshots.map((item) => item.updatedAt), [slot + hour, slot]);
		assert.ok(snapshots.every((item) => item.id !== "autosave"));
		for (const item of snapshots) {
			const saved = JSON.parse(readFileSync(item.path, "utf8"));
			assert.equal(saved.createdAt, saved.updatedAt);
			assert.equal(saved.slot, hourSlotKey(saved.updatedAt));
		}
		assert.equal((await saveHourlySnapshot(f.root, slot + hour, async () => { throw new Error("must not capture twice"); }, () => true, () => slot + hour)).saved, false);
	} finally { f.cleanup(); }
});

test("two independent processes claim one hour exactly once", async () => {
	const f = fixture();
	try {
		const script = `
			import { appendFileSync } from "node:fs";
			import { saveHourlySnapshot } from ${JSON.stringify(new URL("./autosave.ts", import.meta.url).href)};
			const result = await saveHourlySnapshot(${JSON.stringify(f.root)}, ${slot}, async () => {
				appendFileSync(${JSON.stringify(join(f.root, "captures"))}, "capture\\n");
				return ${JSON.stringify(f.snapshot)};
			}, () => true, () => ${slot});
			console.log(result.saved);
		`;
		const run = () => promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { env: { ...process.env, HOME: f.root, PI_CODING_AGENT_DIR: f.root } });
		const results = await Promise.all([run(), run()]);
		assert.deepEqual(results.map((result) => result.stdout.trim()).sort(), ["false", "true"]);
		assert.equal(readFileSync(join(f.root, "captures"), "utf8"), "capture\n");
		assert.equal(listSnapshots(f.root).length, 1);
	} finally { f.cleanup(); }
});

test("a dead owner's slot claim is not stolen by age; the next hour remains independent", async () => {
	const f = fixture();
	try {
		const claim = join(f.root, "hourly-claims", hourSlotKey(slot));
		mkdirSync(claim, { recursive: true });
		const path = join(claim, "attempt.json");
		writeFileSync(path, JSON.stringify({ pid: 99999999, at: 1 }));
		const before = readFileSync(path);
		const result = await saveHourlySnapshot(f.root, slot, async () => { throw new Error("must not recapture claimed slot"); }, () => true, () => slot);
		assert.equal(result.saved, false);
		assert.deepEqual(readFileSync(path), before);
		assert.equal((await saveHourlySnapshot(f.root, slot + hour, async () => f.snapshot, () => true, () => slot + hour)).saved, true);
	} finally { f.cleanup(); }
});

for (const outcome of ["success", "error"] as const) {
	test(`capture ${outcome} after the slot grace records a terminal reason, not a stuck capturing state`, async () => {
		const f = fixture();
		let now = slot;
		try {
			const result = await saveHourlySnapshot(f.root, slot, async () => {
				now = slot + 5001;
				if (outcome === "error") throw new Error("late host timeout");
				return f.snapshot;
			}, () => true, () => now);
			assert.equal(result.saved, false);
			for (const path of [join(f.root, "autosave-state.json"), join(f.root, "hourly-claims", hourSlotKey(slot), "attempt.json")]) {
				const state = JSON.parse(readFileSync(path, "utf8"));
				assert.equal(state.status, outcome === "error" ? "failed" : "skipped");
				assert.match(state.detail.reason, outcome === "error" ? /late host timeout/ : /정각 유효시간 경과/);
			}
			assert.deepEqual(listSnapshots(f.root), []);
		} finally { f.cleanup(); }
	});
}

test("failed/incomplete capture, old timer and cancellation after capture never prune previous saves", async () => {
	const f = fixture();
	try {
		for (let n = 0; n < 10; n++) {
			const time = slot + n * hour;
			await saveHourlySnapshot(f.root, time, async () => f.snapshot, () => true, () => time);
		}
		const before = listSnapshots(f.root).map((item) => item.hash);
		let now = slot + 10 * hour;
		const invalid = { ...f.snapshot, complete: undefined };
		assert.equal((await saveHourlySnapshot(f.root, now, async () => invalid, () => true, () => now)).saved, false);
		now += hour;
		assert.equal((await saveHourlySnapshot(f.root, now, async () => { throw new Error("host failure"); }, () => true, () => now)).saved, false);
		now += hour;
		let current = true;
		assert.equal((await saveHourlySnapshot(f.root, now, async () => { current = false; return f.snapshot; }, () => current, () => now)).saved, false);
		now += hour;
		assert.equal((await saveHourlySnapshot(f.root, now, async () => { now += 60_000; return f.snapshot; }, () => true, () => now)).saved, false);
		assert.equal((await saveHourlySnapshot(f.root, slot, async () => { appendFileSync(join(f.root, "unexpected"), "bad"); return f.snapshot; }, () => true, () => now)).saved, false);
		assert.deepEqual(listSnapshots(f.root).map((item) => item.hash), before);
	} finally { f.cleanup(); }
});
