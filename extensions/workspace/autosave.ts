import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceSnapshot } from "./index.ts";
import { writeAtomicJson } from "./files.ts";
import { saveCompleteSnapshot } from "./store.ts";

const HOUR_MS = 60 * 60 * 1000;
// Only event-loop/capture latency is tolerated, not a minute-late wake-up or a missed hour.
const SLOT_GRACE_MS = 5000;
export function nextWallClockHour(now: number): number {
	const date = new Date(now);
	return now - date.getMinutes() * 60_000 - date.getSeconds() * 1000 - date.getMilliseconds() + HOUR_MS;
}
export function hourSlotKey(slot: number): string {
	return new Date(slot).toISOString().replace(/[-:.]/gu, "").slice(0, 15);
}
export function isTimelySlot(slot: number, now: number): boolean {
	return slot === nextWallClockHour(slot) - HOUR_MS && now >= slot && now - slot <= SLOT_GRACE_MS;
}

/** One recursive wall-clock timer. An old timer never turns a wake-up into backfill. */
export function scheduleHourlyAutosave(run: (slot: number) => Promise<unknown>, isCurrent: () => boolean): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const current = () => { try { return !stopped && isCurrent(); } catch { return false; } };
	const schedule = () => {
		if (!current()) return;
		const slot = nextWallClockHour(Date.now());
		timer = setTimeout(async () => {
			if (!current()) return;
			try { if (isTimelySlot(slot, Date.now())) await run(slot); }
			catch { /* The autosave attempt owns its failure report, not the timer callback. */ }
			finally { schedule(); }
		}, slot - Date.now());
		timer.unref?.();
	};
	schedule();
	return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); };
}

type HourlyResult = { saved: boolean; reason?: string; path?: string; deleted?: string[] };
export async function saveHourlySnapshot(
	workspaceDir: string, slot: number, capture: () => Promise<WorkspaceSnapshot>,
	isCurrent: () => boolean, now = Date.now,
): Promise<HourlyResult> {
	const current = () => { try { return isCurrent(); } catch { return false; } };
	if (!current() || !isTimelySlot(slot, now())) return { saved: false, reason: "종료·stale context 또는 지난 정각: 소급 저장하지 않습니다." };
	const key = hourSlotKey(slot);
	const id = `autosave-${key}`;
	const claims = join(workspaceDir, "hourly-claims");
	mkdirSync(claims, { recursive: true, mode: 0o700 });
	const claim = join(claims, key);
	try { mkdirSync(claim, { mode: 0o700 }); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return { saved: false, reason: "같은 정각은 다른 패널이 이미 처리했습니다." };
		throw error;
	}
	// Never steal this slot, even after a crash. The next hour has an independent claim.
	const report = (status: string, detail: unknown = {}) => {
		const value = { slot: key, at: slot, pid: process.pid, status, detail };
		writeAtomicJson(join(claim, "attempt.json"), value);
		writeAtomicJson(join(workspaceDir, "autosave-state.json"), value);
	};
	try {
		report("capturing");
		if (existsSync(join(workspaceDir, "snapshots", `${id}.json`))) {
			const reason = "같은 정각 snapshot이 이미 있습니다.";
			report("skipped", { reason });
			return { saved: false, reason };
		}
		const snapshot = await capture();
		if (!current()) return { saved: false, reason: "capture 중 종료·전환: 저장하지 않습니다." };
		if (!isTimelySlot(slot, now())) {
			const reason = "capture 중 정각 유효시간 경과: 저장하지 않습니다.";
			report("skipped", { reason });
			return { saved: false, reason };
		}
		const result = saveCompleteSnapshot(workspaceDir, { ...snapshot, id, name: `자동 저장 ${new Date(slot).toLocaleString("ko-KR")}`,
			source: "auto", slot: key, createdAt: slot, updatedAt: slot });
		report("saved", result);
		return { saved: true, ...result };
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		if (current()) report("failed", { reason });
		return { saved: false, reason };
	}
}
