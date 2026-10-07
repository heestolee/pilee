import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Readers see the previous complete bytes or the new complete bytes, never a partial JSON file. */
export function writeAtomicJson(path: string, data: unknown): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}-${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, JSON.stringify(data, null, 2), { flag: "wx", mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		try { unlinkSync(temporary); } catch { /* rename already consumed the temporary file. */ }
	}
}
