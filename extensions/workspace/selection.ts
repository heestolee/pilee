import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { WorkspaceSnapshot } from "./index.ts";

export type SnapshotReference = { id: string; path: string; realPath: string; hash: string };
export type PinnedSnapshotSource = SnapshotReference & { pinnedPath: string };
export type SnapshotSelection = { snapshot: WorkspaceSnapshot; reference: SnapshotReference; bytes: Buffer };
const hashBytes = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Read the displayed metadata and fingerprint from the same bytes. Never open a Pi session. */
export function readSnapshotSelection(path: string, expected?: SnapshotReference): SnapshotSelection {
	try {
		if (!statSync(path).isFile()) throw new Error("일반 파일이 아닙니다.");
		const realPath = realpathSync(path);
		const bytes = readFileSync(realPath);
		const hash = hashBytes(bytes);
		const snapshot = JSON.parse(bytes.toString("utf8")) as WorkspaceSnapshot;
		if (snapshot.version !== 1 || snapshot.host !== "ghostty" || typeof snapshot.id !== "string" || !snapshot.id ||
			typeof snapshot.name !== "string" || !Array.isArray(snapshot.tabs) ||
			!snapshot.tabs.every((tab) => tab && Array.isArray(tab.terminals) && tab.terminals.every((term) => term && typeof term === "object"))) {
			throw new Error("workspace snapshot 형식이 아닙니다.");
		}
		if (expected && (hash !== expected.hash || realPath !== expected.realPath || snapshot.id !== expected.id)) {
			throw new Error("목록 표시 후 내용이 변경되었습니다.");
		}
		return { snapshot, reference: { id: snapshot.id, path: resolve(path), realPath, hash }, bytes };
	} catch (error) {
		throw new Error(`${expected ? "stale snapshot — /workspace list로 다시 선택하세요" : "snapshot을 읽지 못했습니다"}: ${path}\n${String(error)}`);
	}
}

export function selectSnapshot(
	target: string | undefined,
	candidates: Array<SnapshotReference & { name: string }>,
	lastList: SnapshotReference[] | undefined,
	cwd: string,
): SnapshotSelection {
	if (!target) throw new Error("복구 대상을 지정하세요. /workspace list [--all]에서 확인한 번호, exact id 또는 파일 경로를 사용합니다.");
	if (/^\d+$/u.test(target)) {
		if (!lastList) throw new Error("이 세션에서 먼저 /workspace list [--all]을 실행하세요. 번호를 새 목록으로 추정하지 않습니다.");
		const reference = lastList[Number(target) - 1];
		if (!reference) throw new Error(`직전 목록에 없는 번호입니다: ${target}`);
		return readSnapshotSelection(reference.path, reference);
	}
	if (isAbsolute(target) || target.includes("/") || target.endsWith(".json")) return readSnapshotSelection(resolve(cwd, target));
	const normalized = target.toLowerCase();
	const exact = candidates.filter((item) => item.id.toLowerCase() === normalized);
	const matches = exact.length ? exact : candidates.filter((item) => item.name.toLowerCase().includes(normalized) || item.id.toLowerCase().includes(normalized));
	if (matches.length !== 1) throw new Error(matches.length ? `여러 snapshot이 일치합니다. exact id 또는 경로를 선택하세요: ${matches.map((item) => item.id).join(", ")}` : `snapshot을 찾지 못했습니다: ${target}`);
	return readSnapshotSelection(matches[0].path, matches[0]);
}

/** Content-addressed, exclusive creation: autosave replacement/pruning cannot change this source. */
export function pinSnapshotSelection(selection: SnapshotSelection, workspaceDir: string): PinnedSnapshotSource {
	if (hashBytes(selection.bytes) !== selection.reference.hash) throw new Error("선택한 snapshot bytes가 변경되었습니다.");
	const directory = join(workspaceDir, "restore-sources");
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	const pinnedPath = join(directory, `${selection.reference.hash}.json`);
	try {
		writeFileSync(pinnedPath, selection.bytes, { flag: "wx", mode: 0o400 });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	if (readSnapshotSelection(pinnedPath).reference.hash !== selection.reference.hash) throw new Error(`보존 source hash 불일치: ${pinnedPath}`);
	return { ...selection.reference, pinnedPath };
}
