import { lstatSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { WorkspaceSnapshot } from "./index.ts";
import { writeAtomicJson } from "./files.ts";
import { planWorkspaceRestore } from "./planner.ts";
import { readSnapshotSelection, type SnapshotReference } from "./selection.ts";

export type WorkspaceSummary = SnapshotReference & {
	name: string; source: WorkspaceSnapshot["source"]; updatedAt: number; tabs: number; terminals: number; matched: number;
};
export function workspaceSnapshotStats(snapshot: Pick<WorkspaceSnapshot, "tabs">) {
	const terminals = snapshot.tabs.flatMap((tab) => tab.terminals);
	return { tabs: snapshot.tabs.length, terminals: terminals.length, matched: terminals.filter((term) => term.sessionFile).length };
}
export function compareWorkspaceSummaries(a: Pick<WorkspaceSummary, "updatedAt" | "id">, b: Pick<WorkspaceSummary, "updatedAt" | "id">): number {
	return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

/** Listing is read-only: do not hide or prune anything just because it ranks poorly. */
export function listSnapshots(workspaceDir: string): WorkspaceSummary[] {
	const directory = join(workspaceDir, "snapshots");
	let entries: string[];
	try { entries = readdirSync(directory); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
	return entries.filter((entry) => entry.endsWith(".json")).flatMap((entry) => {
		try {
			const path = join(directory, entry);
			if (!lstatSync(path).isFile()) return [];
			const { snapshot, reference } = readSnapshotSelection(path);
			if ((snapshot.source !== "auto" && snapshot.source !== "manual") || !Number.isFinite(snapshot.updatedAt) ||
				!Number.isFinite(snapshot.createdAt) || typeof snapshot.window?.id !== "string" || typeof snapshot.window.name !== "string" ||
				!snapshot.tabs.every((tab) => typeof tab.id === "string" && typeof tab.name === "string" &&
					tab.terminals.every((term) => typeof term.id === "string" && typeof term.name === "string" && typeof term.cwd === "string"))) return [];
			return [{ ...reference, name: snapshot.name, source: snapshot.source, updatedAt: snapshot.updatedAt, ...workspaceSnapshotStats(snapshot) }];
		} catch { return []; } // Unknown/corrupt files are neither listed nor deletion candidates.
	}).sort(compareWorkspaceSummaries);
}

/** New saves must be entirely exact; old snapshots remain readable without being upgraded. */
export function saveCompleteSnapshot(workspaceDir: string, snapshot: WorkspaceSnapshot): { path: string; deleted: string[] } {
	if (!/^[a-z0-9가-힣._-]+$/iu.test(snapshot.id) || snapshot.id === "." || snapshot.id === "..") throw new Error("잘못된 snapshot ID");
	const terms = snapshot.tabs.flatMap((tab) => tab.terminals);
	if (!snapshot.complete || !snapshot.window.id || !snapshot.tabs.length || snapshot.tabs.some((tab) => !tab.id || !tab.terminals.length) ||
		terms.some((term) => !term.id || term.match !== "exact") || new Set(terms.map((term) => term.id)).size !== terms.length ||
		new Set(snapshot.tabs.map((tab) => tab.id)).size !== snapshot.tabs.length) throw new Error("불완전 capture: 저장·자동본 정리 금지");
	const plan = planWorkspaceRestore(snapshot, () => "preflight");
	if (plan.blocked || !plan.total) throw new Error(`불완전 capture: ${plan.actions.flat().filter((action) => action.blockedReason).map((action) => `${action.sourcePanelKey}: ${action.blockedReason}`).join("\n")}`);
	const path = join(workspaceDir, "snapshots", `${snapshot.id}.json`);
	writeAtomicJson(path, snapshot);
	const deleted: string[] = [];
	// A successful rename of the new complete snapshot is the only retention trigger.
	if (snapshot.source === "auto") {
		for (const old of listSnapshots(workspaceDir).filter((item) => item.source === "auto" && item.path !== path).slice(9)) {
			try { unlinkSync(old.path); deleted.push(old.path); } catch { /* Keep excess history rather than invalidate the new save. */ }
		}
	}
	return { path, deleted };
}
