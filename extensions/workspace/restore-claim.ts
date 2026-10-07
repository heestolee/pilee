import { mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { PinnedSnapshotSource } from "./selection.ts";

/** mkdir is the cross-process claim. Never expire a claim that may own a target. */
export function claimRestoreSource(workspaceDir: string, source: PinnedSnapshotSource, reportPath: string): () => void {
	if (!/^[a-f0-9]{64}$/u.test(source.hash)) throw new Error("유효한 source SHA256이 필요합니다.");
	const claims = join(workspaceDir, "restore-claims");
	mkdirSync(claims, { recursive: true, mode: 0o700 });
	const directory = join(claims, source.hash);
	const path = join(directory, "attempt.json");
	try {
		mkdirSync(directory, { mode: 0o700 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		let previous = path;
		try { previous = JSON.parse(readFileSync(path, "utf8")).reportPath || path; } catch {}
		throw new Error(`같은 source의 기존 복구 기록이 있습니다. 진행 중이거나 target 생성 여부가 불확실하므로 새 append를 차단합니다.\n기록: ${previous}`);
	}
	try {
		writeFileSync(path, JSON.stringify({ source, reportPath, pid: process.pid, claimedAt: Date.now() }, null, 2), { flag: "wx", mode: 0o600 });
	} catch (error) {
		// This invocation owns the directory and has not called the host yet.
		try { unlinkSync(path); } catch {}
		rmdirSync(directory);
		throw error;
	}
	return () => { unlinkSync(path); rmdirSync(directory); };
}
