import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export type WorkUnitType = "worktree" | "session";
export type WorkContextMode = "light" | "standard" | "full" | "unknown";
export type WorkContextGateLevel = "pass" | "warn" | "block";

export interface WorkUnitIdentity {
	id: string;
	type: WorkUnitType;
	root?: string;
	cwd: string;
	sessionFile?: string;
	displayName: string;
	contextPath: string;
	tasksPath: string;
	framePath?: string;
}

export interface WorkContextSlice {
	id: string;
	title: string;
	scope: string[];
	acceptance: string[];
	status?: "pending" | "in_progress" | "completed" | "blocked";
}

export interface WorkContextQuestion {
	id: string;
	owner: "user" | "agent" | "reviewer" | "external";
	text: string;
	blocks?: string[];
}

export interface WorkContextCard {
	schemaVersion: 1;
	identity: WorkUnitIdentity;
	updatedAt: string;
	source: "manual" | "frame" | "derived";
	mode: WorkContextMode;
	goal: string;
	currentSlice?: WorkContextSlice;
	slices: WorkContextSlice[];
	mustKeep: string[];
	mustNot: string[];
	openQuestions: WorkContextQuestion[];
	verifyFocus: string[];
	lastKnownState: {
		branch?: string;
		base?: string;
		dirtyState?: string;
		lastValidation?: string;
		lastCommit?: string;
	};
	refs: {
		frame?: string;
		transcript?: string;
		tasks?: string;
	};
	notes?: string[];
}

export interface WorkContextGateResult {
	level: WorkContextGateLevel;
	reasons: string[];
	card?: WorkContextCard;
}

function sha(input: string): string {
	return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function safeExec(args: string[], cwd: string): string | undefined {
	try {
		return execFileSync(args[0], args.slice(1), { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {
		return undefined;
	}
}

function gitTopLevel(cwd: string): string | undefined {
	const top = safeExec(["git", "rev-parse", "--show-toplevel"], cwd);
	return top ? resolve(top) : undefined;
}

function gitBranch(cwd: string): string | undefined {
	return safeExec(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd);
}

function gitLastCommit(cwd: string): string | undefined {
	return safeExec(["git", "log", "-1", "--pretty=%h %s"], cwd);
}

function gitDirtyState(cwd: string): string | undefined {
	const status = safeExec(["git", "status", "--short"], cwd);
	if (status === undefined) return undefined;
	return status.trim() ? "dirty" : "clean";
}

function ensureDir(path: string): void {
	mkdirSync(path, { recursive: true });
}

function sessionWorkUnitDir(sessionFile: string | undefined, cwd: string): string {
	const key = sha(sessionFile || cwd);
	return join(homedir(), ".pi", "agent", "work-units", key);
}

export function resolveWorkUnit(cwd: string, sessionFile?: string): WorkUnitIdentity {
	const root = gitTopLevel(cwd);
	if (root) {
		const piDir = join(root, ".pi");
		const framePath = join(piDir, "frame.json");
		return {
			id: `worktree:${sha(root)}`,
			type: "worktree",
			root,
			cwd,
			sessionFile,
			displayName: root.split("/").filter(Boolean).slice(-1)[0] || root,
			contextPath: join(piDir, "work-context.json"),
			tasksPath: join(piDir, "work-tasks.json"),
			framePath: existsSync(framePath) ? framePath : undefined,
		};
	}
	const dir = sessionWorkUnitDir(sessionFile, cwd);
	return {
		id: `session:${sha(sessionFile || cwd)}`,
		type: "session",
		cwd,
		sessionFile,
		displayName: "session planning",
		contextPath: join(dir, "work-context.json"),
		tasksPath: join(dir, "work-tasks.json"),
	};
}

function readJson<T>(path: string): T | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function writeJsonAtomic(path: string, value: unknown): void {
	ensureDir(dirname(path));
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(tmp, path);
}

function uniqueStrings(values: Array<string | undefined | null>, limit = 12): string[] {
	const out: string[] = [];
	for (const value of values) {
		const text = String(value || "").trim();
		if (!text || out.includes(text)) continue;
		out.push(text);
		if (out.length >= limit) break;
	}
	return out;
}

function asArray(value: unknown): string[] {
	if (!value) return [];
	if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
	if (typeof value === "string") return [value.trim()].filter(Boolean);
	return [];
}

function sliceFromFrameSlice(item: any, index: number): WorkContextSlice {
	return {
		id: String(item?.id || `S${index + 1}`),
		title: String(item?.goal || item?.title || `Slice ${index + 1}`),
		scope: asArray(item?.expectedFiles ?? item?.scope),
		acceptance: asArray(item?.validation ?? item?.acceptance),
		status: item?.status === "completed" || item?.status === "in_progress" || item?.status === "blocked" ? item.status : "pending",
	};
}

function decisionQuestions(frame: any): WorkContextQuestion[] {
	const queue = Array.isArray(frame?.decision_queue) ? frame.decision_queue : [];
	const risks = Array.isArray(frame?.risk_register) ? frame.risk_register : [];
	const fromQueue = queue.map((item: any, index: number) => ({
		id: String(item?.taskId || item?.id || `D${index + 1}`),
		owner: "user" as const,
		text: String(item?.title || item?.risk || "열린 결정"),
		blocks: asArray(item?.blocks),
	}));
	const fromRisks = risks
		.filter((risk: any) => risk?.needs_decision)
		.map((risk: any, index: number) => ({
			id: String(risk?.id || `RISK-D${index + 1}`),
			owner: "user" as const,
			text: String(risk?.risk || risk?.title || "결정 필요한 리스크"),
			blocks: [],
		}));
	return [...fromQueue, ...fromRisks].slice(0, 8);
}

function deriveMode(frame: any): WorkContextMode {
	const plan = frame?.implementation_plan;
	const riskCount = Array.isArray(frame?.risk_register) ? frame.risk_register.length : 0;
	const criteriaCount = Array.isArray(frame?.success_criteria) ? frame.success_criteria.length : 0;
	const slices = Array.isArray(plan?.slices) ? plan.slices.length : 0;
	if (riskCount >= 5 || criteriaCount >= 5 || slices >= 5) return "full";
	if (riskCount >= 2 || criteriaCount >= 2 || slices >= 2) return "standard";
	return "light";
}

function chooseCurrentSlice(existing: WorkContextCard | undefined, slices: WorkContextSlice[]): WorkContextSlice | undefined {
	if (existing?.currentSlice) {
		const match = slices.find((slice) => slice.id === existing.currentSlice?.id);
		if (match) return { ...match, status: existing.currentSlice.status ?? match.status };
		return existing.currentSlice;
	}
	return slices.find((slice) => slice.status !== "completed") ?? slices[0];
}

export function loadWorkContext(cwd: string, sessionFile?: string): WorkContextCard | undefined {
	const unit = resolveWorkUnit(cwd, sessionFile);
	return readJson<WorkContextCard>(unit.contextPath);
}

export function deriveWorkContext(cwd: string, sessionFile?: string, existing?: WorkContextCard): WorkContextCard | undefined {
	const unit = resolveWorkUnit(cwd, sessionFile);
	const frame = unit.framePath ? readJson<any>(unit.framePath) : undefined;
	if (!frame && !existing) return undefined;
	const slices = frame?.implementation_plan?.slices?.map(sliceFromFrameSlice) ?? existing?.slices ?? [];
	const currentSlice = chooseCurrentSlice(existing, slices);
	const goal = String(frame?.goal || existing?.goal || "").trim();
	const transcript = frame?.provenance?.transcriptPath || existing?.refs?.transcript;
	const branch = unit.root ? gitBranch(unit.root) : undefined;
	const dirtyState = unit.root ? gitDirtyState(unit.root) : undefined;
	const lastCommit = unit.root ? gitLastCommit(unit.root) : undefined;
	return {
		schemaVersion: 1,
		identity: unit,
		updatedAt: new Date().toISOString(),
		source: frame ? "frame" : existing?.source ?? "manual",
		mode: existing?.mode && existing.mode !== "unknown" ? existing.mode : frame ? deriveMode(frame) : "unknown",
		goal,
		currentSlice,
		slices,
		mustKeep: uniqueStrings([
			...asArray(frame?.boundaries?.always),
			...(existing?.mustKeep ?? []),
		], 10),
		mustNot: uniqueStrings([
			...asArray(frame?.boundaries?.never),
			...asArray(frame?.out_of_scope).map((item) => `범위 밖: ${item}`),
			...(existing?.mustNot ?? []),
		], 10),
		openQuestions: existing?.openQuestions?.length ? existing.openQuestions : decisionQuestions(frame),
		verifyFocus: uniqueStrings([
			...asArray(frame?.verify_plan?.manual_checks),
			...asArray(frame?.verify_plan?.commands),
			...(Array.isArray(frame?.success_criteria) ? frame.success_criteria.map((sc: any) => sc?.statement || sc?.id) : []),
			...(existing?.verifyFocus ?? []),
		], 10),
		lastKnownState: {
			branch,
			base: existing?.lastKnownState?.base,
			dirtyState,
			lastValidation: existing?.lastKnownState?.lastValidation,
			lastCommit,
		},
		refs: {
			frame: unit.framePath,
			transcript,
			tasks: unit.tasksPath,
		},
		notes: existing?.notes,
	};
}

export function refreshWorkContext(cwd: string, sessionFile?: string, patch: Partial<WorkContextCard> = {}): WorkContextCard {
	const unit = resolveWorkUnit(cwd, sessionFile);
	const existing = readJson<WorkContextCard>(unit.contextPath);
	const derived = deriveWorkContext(cwd, sessionFile, existing) ?? {
		schemaVersion: 1 as const,
		identity: unit,
		updatedAt: new Date().toISOString(),
		source: "manual" as const,
		mode: "unknown" as const,
		goal: "",
		slices: [],
		mustKeep: [],
		mustNot: [],
		openQuestions: [],
		verifyFocus: [],
		lastKnownState: {},
		refs: { tasks: unit.tasksPath },
	};
	const merged: WorkContextCard = {
		...derived,
		...patch,
		identity: unit,
		updatedAt: new Date().toISOString(),
		refs: { ...derived.refs, ...(patch.refs ?? {}), tasks: unit.tasksPath },
	};
	writeJsonAtomic(unit.contextPath, merged);
	return merged;
}

export function saveWorkContext(card: WorkContextCard): void {
	writeJsonAtomic(card.identity.contextPath, { ...card, updatedAt: new Date().toISOString() });
}

export function loadOrDeriveWorkContext(cwd: string, sessionFile?: string): WorkContextCard | undefined {
	const existing = loadWorkContext(cwd, sessionFile);
	return deriveWorkContext(cwd, sessionFile, existing) ?? existing;
}

export function relativeToWorkUnit(card: WorkContextCard, path: string): string {
	const root = card.identity.root || card.identity.cwd;
	const absolute = isAbsolute(path) ? resolve(path) : resolve(card.identity.cwd, path);
	const rel = relative(root, absolute).replace(/\\/g, "/");
	return rel.startsWith("..") ? path.replace(/\\/g, "/") : rel;
}

function wildcardPattern(pattern: string): RegExp | undefined {
	if (!pattern.includes("*") && !pattern.includes("...")) return undefined;
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\\\.\\\.\\\./g, ".*")
		.replace(/\\\*/g, "[^/]*");
	return new RegExp(`^${escaped}(?:/.*)?$`);
}

export function pathMatchesScope(path: string, scope: string[]): boolean {
	const rel = path.replace(/^\.\//, "").replace(/\\/g, "/");
	if (scope.length === 0) return true;
	return scope.some((raw) => {
		const pattern = raw.trim().replace(/^\.\//, "").replace(/\\/g, "/");
		if (!pattern) return false;
		const wildcard = wildcardPattern(pattern);
		if (wildcard?.test(rel)) return true;
		const normalized = pattern.replace(/\.\.\.$/, "").replace(/\/$/, "");
		return rel === normalized || rel.startsWith(`${normalized}/`) || rel.includes(normalized);
	});
}

function isContextInternalPath(path: string): boolean {
	const rel = path.replace(/^\.\//, "").replace(/\\/g, "/");
	return rel === ".pi/work-context.json" || rel === ".pi/work-tasks.json" || rel === ".pi/frame.json" || rel === ".pi/frame.md" || rel.startsWith(".pi/tasks/");
}

export function gateWorkContext(card: WorkContextCard | undefined, options: { action: "mutate" | "commit" | "status"; paths?: string[]; requireSlice?: boolean } = { action: "status" }): WorkContextGateResult {
	if (!card) return { level: "pass", reasons: [] };
	const reasons: string[] = [];
	const currentId = card.currentSlice?.id;
	if (options.requireSlice && card.slices.length > 0 && !card.currentSlice) {
		reasons.push("implementation_plan.slices는 있지만 currentSlice가 없습니다. 먼저 work_context set_slice로 현재 slice를 고정해야 합니다.");
	}
	const blockingQuestions = card.openQuestions.filter((question) => currentId && question.blocks?.includes(currentId));
	if (blockingQuestions.length > 0) {
		reasons.push(`currentSlice ${currentId}는 열린 사용자 결정에 막혀 있습니다: ${blockingQuestions.map((q) => q.id).join(", ")}`);
	}
	const scope = card.currentSlice?.scope ?? [];
	if (scope.length > 0 && options.paths?.length) {
		const outside = options.paths
			.map((path) => relativeToWorkUnit(card, path))
			.filter((path) => !isContextInternalPath(path) && !pathMatchesScope(path, scope));
		if (outside.length > 0) {
			reasons.push(`currentSlice 범위 밖 파일이 포함됐습니다: ${outside.slice(0, 8).join(", ")}`);
		}
	}
	return { level: reasons.length > 0 ? "block" : "pass", reasons, card };
}

export function formatWorkContextCard(card: WorkContextCard, maxItems = 4): string {
	const slice = card.currentSlice;
	const lines = [
		"Working Context Card",
		`- work-unit: ${card.identity.displayName} (${card.identity.type}${card.lastKnownState.branch ? ` · ${card.lastKnownState.branch}` : ""})`,
		card.goal ? `- goal: ${card.goal}` : undefined,
		`- mode: ${card.mode}`,
		slice ? `- current slice: ${slice.id} · ${slice.title}${slice.scope.length ? ` · scope=${slice.scope.join(", ")}` : ""}` : card.slices.length ? "- current slice: not selected" : undefined,
		card.mustKeep.length ? `- must keep: ${card.mustKeep.slice(0, maxItems).join(" / ")}` : undefined,
		card.mustNot.length ? `- must not: ${card.mustNot.slice(0, maxItems).join(" / ")}` : undefined,
		card.openQuestions.length ? `- open questions: ${card.openQuestions.slice(0, maxItems).map((q) => `${q.id}:${q.text}`).join(" / ")}` : undefined,
		card.verifyFocus.length ? `- verify focus: ${card.verifyFocus.slice(0, maxItems).join(" / ")}` : undefined,
		card.lastKnownState.dirtyState ? `- state: ${card.lastKnownState.dirtyState}${card.lastKnownState.lastCommit ? ` · ${card.lastKnownState.lastCommit}` : ""}` : undefined,
		card.refs.frame ? `- refs: frame=${card.refs.frame}${card.refs.tasks ? ` · tasks=${card.refs.tasks}` : ""}` : card.refs.tasks ? `- refs: tasks=${card.refs.tasks}` : undefined,
	].filter(Boolean) as string[];
	return lines.join("\n");
}
