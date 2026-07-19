import type { StudyNoteBlock, StudyNoteDocument, StudyNoteSection } from "./studio.ts";

export interface StudyNoteMergeConflict {
	path: string;
	kind: "concurrent-change" | "delete-vs-change" | "id-collision" | "order-conflict" | "invalid-id";
	message: string;
}

export type StudyNoteMergeResult =
	| { ok: true; noteDocument: StudyNoteDocument; changedPaths: string[] }
	| { ok: false; conflicts: StudyNoteMergeConflict[]; changedPaths: string[] };

type JsonRecord = Record<string, unknown>;
type MergeContext = {
	conflicts: StudyNoteMergeConflict[];
	changedPaths: Set<string>;
};

function cloneValue<T>(value: T): T {
	return value === undefined ? value : structuredClone(value);
}

function equalValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is JsonRecord {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function addConflict(context: MergeContext, conflict: StudyNoteMergeConflict): void {
	context.conflicts.push(conflict);
}

function mergeValue(base: unknown, proposed: unknown, current: unknown, path: string, context: MergeContext): unknown {
	if (equalValue(proposed, base)) return cloneValue(current);
	context.changedPaths.add(path);
	if (equalValue(current, base) || equalValue(proposed, current)) return cloneValue(proposed);
	if (isRecord(base) && isRecord(proposed) && isRecord(current)) return mergeRecord(base, proposed, current, path, context);
	addConflict(context, {
		path,
		kind: "concurrent-change",
		message: `worker와 최신 노트가 ${path}을 서로 다르게 변경했습니다.`,
	});
	return cloneValue(current);
}

function mergeRecord(base: JsonRecord, proposed: JsonRecord, current: JsonRecord, path: string, context: MergeContext): JsonRecord {
	const merged: JsonRecord = {};
	const keys = new Set([...Object.keys(base), ...Object.keys(proposed), ...Object.keys(current)]);
	for (const key of keys) {
		const value = mergeValue(base[key], proposed[key], current[key], `${path}.${key}`, context);
		if (value !== undefined) merged[key] = value;
	}
	return merged;
}

function entityMap<T extends { id: string }>(items: T[], path: string, context: MergeContext): Map<string, T> | undefined {
	const map = new Map<string, T>();
	for (const item of items) {
		if (!item || typeof item.id !== "string" || !item.id.trim() || map.has(item.id)) {
			addConflict(context, {
				path,
				kind: "invalid-id",
				message: `${path}에는 비어 있거나 중복된 id가 있습니다.`,
			});
			return undefined;
		}
		map.set(item.id, item);
	}
	return map;
}

function addOrderConstraints(ids: string[], surviving: Set<string>, edges: Map<string, Set<string>>, indegree: Map<string, number>): void {
	const filtered = ids.filter((id) => surviving.has(id));
	for (let index = 1; index < filtered.length; index++) {
		const from = filtered[index - 1];
		const to = filtered[index];
		if (from === to || edges.get(from)?.has(to)) continue;
		edges.get(from)?.add(to);
		indegree.set(to, (indegree.get(to) || 0) + 1);
	}
}

function mergeOrder(
	baseIds: string[],
	proposedIds: string[],
	currentIds: string[],
	surviving: Set<string>,
	path: string,
	context: MergeContext,
): string[] {
	const workerStructuralChange = !equalValue(baseIds, proposedIds);
	const currentStructuralChange = !equalValue(baseIds, currentIds);
	const edges = new Map<string, Set<string>>();
	const indegree = new Map<string, number>();
	for (const id of surviving) {
		edges.set(id, new Set());
		indegree.set(id, 0);
	}
	if (workerStructuralChange) addOrderConstraints(proposedIds, surviving, edges, indegree);
	if (currentStructuralChange) addOrderConstraints(currentIds, surviving, edges, indegree);
	if (!workerStructuralChange && !currentStructuralChange) addOrderConstraints(baseIds, surviving, edges, indegree);

	const preferred = currentStructuralChange
		? [...currentIds, ...proposedIds, ...baseIds]
		: workerStructuralChange
			? [...proposedIds, ...currentIds, ...baseIds]
			: [...baseIds, ...proposedIds, ...currentIds];
	const rank = new Map<string, number>();
	for (const id of preferred) if (!rank.has(id)) rank.set(id, rank.size);
	const compare = (left: string, right: string) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER) || left.localeCompare(right);
	const ready = [...surviving].filter((id) => indegree.get(id) === 0).sort(compare);
	const ordered: string[] = [];
	while (ready.length) {
		const id = ready.shift()!;
		ordered.push(id);
		for (const next of edges.get(id) || []) {
			const nextDegree = (indegree.get(next) || 0) - 1;
			indegree.set(next, nextDegree);
			if (nextDegree === 0) {
				ready.push(next);
				ready.sort(compare);
			}
		}
	}
	if (ordered.length !== surviving.size) {
		addConflict(context, {
			path,
			kind: "order-conflict",
			message: `worker와 최신 노트가 ${path}의 순서를 양립할 수 없게 변경했습니다.`,
		});
		return [...surviving].sort(compare);
	}
	return ordered;
}

function mergeEntityArrays<T extends { id: string }>(
	base: T[],
	proposed: T[],
	current: T[],
	path: string,
	context: MergeContext,
	mergeExisting: (baseItem: T, proposedItem: T, currentItem: T, itemPath: string, context: MergeContext) => T,
): T[] {
	const baseMap = entityMap(base, path, context);
	const proposedMap = entityMap(proposed, path, context);
	const currentMap = entityMap(current, path, context);
	if (!baseMap || !proposedMap || !currentMap) return cloneValue(current);
	const ids = new Set([...baseMap.keys(), ...proposedMap.keys(), ...currentMap.keys()]);
	const mergedMap = new Map<string, T>();
	for (const id of ids) {
		const baseItem = baseMap.get(id);
		const proposedItem = proposedMap.get(id);
		const currentItem = currentMap.get(id);
		const itemPath = `${path}[${id}]`;
		if (!baseItem) {
			if (proposedItem && currentItem && !equalValue(proposedItem, currentItem)) {
				addConflict(context, { path: itemPath, kind: "id-collision", message: `worker와 최신 노트가 새 id ${id}를 서로 다른 내용으로 추가했습니다.` });
				mergedMap.set(id, cloneValue(currentItem));
			} else if (proposedItem || currentItem) {
				if (proposedItem) context.changedPaths.add(itemPath);
				mergedMap.set(id, cloneValue((proposedItem || currentItem)!));
			}
			continue;
		}
		if (!proposedItem && !currentItem) {
			context.changedPaths.add(itemPath);
			continue;
		}
		if (!proposedItem && currentItem) {
			context.changedPaths.add(itemPath);
			if (equalValue(currentItem, baseItem)) continue;
			addConflict(context, { path: itemPath, kind: "delete-vs-change", message: `worker가 삭제한 ${id}를 최신 노트가 수정했습니다.` });
			mergedMap.set(id, cloneValue(currentItem));
			continue;
		}
		if (proposedItem && !currentItem) {
			if (equalValue(proposedItem, baseItem)) continue;
			context.changedPaths.add(itemPath);
			addConflict(context, { path: itemPath, kind: "delete-vs-change", message: `최신 노트가 삭제한 ${id}를 worker가 수정했습니다.` });
			continue;
		}
		mergedMap.set(id, mergeExisting(baseItem, proposedItem!, currentItem!, itemPath, context));
	}
	const order = mergeOrder(base.map(({ id }) => id), proposed.map(({ id }) => id), current.map(({ id }) => id), new Set(mergedMap.keys()), `${path}#order`, context);
	return order.map((id) => mergedMap.get(id)!).filter(Boolean);
}

function mergeBlock(base: StudyNoteBlock, proposed: StudyNoteBlock, current: StudyNoteBlock, path: string, context: MergeContext): StudyNoteBlock {
	return mergeRecord(base as unknown as JsonRecord, proposed as unknown as JsonRecord, current as unknown as JsonRecord, path, context) as unknown as StudyNoteBlock;
}

function mergeSection(base: StudyNoteSection, proposed: StudyNoteSection, current: StudyNoteSection, path: string, context: MergeContext): StudyNoteSection {
	const merged = mergeRecord(
		{ ...base, blocks: undefined },
		{ ...proposed, blocks: undefined },
		{ ...current, blocks: undefined },
		path,
		context,
	) as unknown as StudyNoteSection;
	merged.blocks = mergeEntityArrays(base.blocks, proposed.blocks, current.blocks, `${path}.blocks`, context, mergeBlock);
	return merged;
}

/**
 * Applies a worker's complete note proposal onto the latest note with strict
 * three-way conflict detection. Generation may be broad; only conflict-free
 * changes are returned as an applicable document.
 */
export function mergeStudyNoteProposal(base: StudyNoteDocument, proposed: StudyNoteDocument, current: StudyNoteDocument): StudyNoteMergeResult {
	const context: MergeContext = { conflicts: [], changedPaths: new Set() };
	const title = mergeValue(base.title, proposed.title, current.title, "noteDocument.title", context) as string;
	const sections = mergeEntityArrays(base.sections, proposed.sections, current.sections, "noteDocument.sections", context, mergeSection);
	const changedPaths = [...context.changedPaths].sort();
	if (context.conflicts.length) return { ok: false, conflicts: context.conflicts, changedPaths };
	return { ok: true, noteDocument: { title, sections }, changedPaths };
}
