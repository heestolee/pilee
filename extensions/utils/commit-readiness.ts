export type CommitReadiness = "clean" | "ready" | "ready_with_caveats";
export type ShipReadiness = "clean" | "not_assessed" | "blocked_by_caveats";
export type SplitRecommendation = "none" | "recommended";

export interface CommitReadinessGroup {
	id: string;
	label: string;
	paths: string[];
}

export interface CommitReadinessDiagnostic {
	commitReadiness: CommitReadiness;
	shipReadiness: ShipReadiness;
	splitRecommendation: SplitRecommendation;
	changedPaths: string[];
	groups: CommitReadinessGroup[];
	caveats: string[];
	notBlockers: string[];
	reasons: string[];
}

interface PathRule {
	id: string;
	label: string;
	test: RegExp;
}

const PATH_RULES: PathRule[] = [
	{ id: "migration", label: "DB / migration", test: /(^|\/)(migrations?|migration)(\/|$)|\.sql$/iu },
	{ id: "schema-codegen", label: "GraphQL / schema / codegen", test: /schema\.(gql|graphql)$|(^|\/)__generated__(\/|$)|(^|\/)generated\.[cm]?[jt]sx?$|(^|\/)graphql\/(types|mock|generated)/iu },
	{ id: "backend", label: "Backend / API", test: /(^|\/)(backend|server|api)(\/|$)|^apps\/[^/]+\/src\//iu },
	{ id: "frontend-admin", label: "Frontend / Admin", test: /(^|\/)(apps\/admin|admin)(\/|$)/iu },
	{ id: "frontend-web", label: "Frontend / Web", test: /(^|\/)(apps\/web|web)(\/|$)|(^|\/)domain\//iu },
	{ id: "test", label: "Tests", test: /\.(test|spec)\.[cm]?[jt]sx?$/iu },
];

function stripQuotes(value: string): string {
	const trimmed = value.trim();
	if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
	try {
		return JSON.parse(trimmed) as string;
	} catch {
		return trimmed.slice(1, -1);
	}
}

function normalizePath(path: string): string {
	return stripQuotes(path).trim().replace(/^\.\//u, "").replace(/\\/g, "/").replace(/\/$/u, "");
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values.map(normalizePath).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function pathsFromGitStatus(statusLines: string[]): string[] {
	const paths: string[] = [];
	for (const rawLine of statusLines) {
		const line = rawLine.trimEnd();
		if (!line.trim()) continue;
		const porcelain = line.match(/^(.{2})\s+(.+)$/u);
		const compact = line.trim().match(/^([ MADRCU?!]{1,2})\s+(.+)$/u);
		const rest = porcelain ? porcelain[2] : compact ? compact[2] : line.trim();
		const renameParts = rest.split(/\s+->\s+/u);
		if (renameParts.length === 2) paths.push(...renameParts);
		else paths.push(rest);
	}
	return uniqueSorted(paths);
}

function classifyPath(path: string): PathRule {
	return PATH_RULES.find((rule) => rule.test.test(path)) ?? { id: "other", label: "Other", test: /.*/u };
}

function groupPaths(paths: string[]): CommitReadinessGroup[] {
	const byId = new Map<string, CommitReadinessGroup>();
	for (const path of paths) {
		const rule = classifyPath(path);
		const existing = byId.get(rule.id);
		if (existing) existing.paths.push(path);
		else byId.set(rule.id, { id: rule.id, label: rule.label, paths: [path] });
	}
	return [...byId.values()].map((group) => ({ ...group, paths: uniqueSorted(group.paths) }));
}

function hasGroup(groups: CommitReadinessGroup[], id: string): boolean {
	return groups.some((group) => group.id === id);
}

export function buildCommitReadinessDiagnostic(paths: string[]): CommitReadinessDiagnostic {
	const changedPaths = uniqueSorted(paths);
	if (changedPaths.length === 0) {
		return {
			commitReadiness: "clean",
			shipReadiness: "clean",
			splitRecommendation: "none",
			changedPaths,
			groups: [],
			caveats: [],
			notBlockers: [],
			reasons: ["working tree clean"],
		};
	}

	const groups = groupPaths(changedPaths);
	const caveats: string[] = [];
	const notBlockers: string[] = [];
	const reasons: string[] = [];
	const hasMigration = hasGroup(groups, "migration");
	const hasUi = hasGroup(groups, "frontend-admin") || hasGroup(groups, "frontend-web");
	const hasSchema = hasGroup(groups, "schema-codegen");
	const reviewAreaCount = groups.filter((group) => group.id !== "test").length;

	if (hasMigration) {
		caveats.push("migration/DB schema execution may still be pending");
		notBlockers.push("deferred migration execution is a ship/runtime caveat, not a commit blocker after nearest validation passes");
	}
	if (hasUi) {
		caveats.push("UI capture or visual verification may still be pending");
		notBlockers.push("pending UI capture/verify-report is a ship evidence caveat, not a commit blocker for a verified code slice");
	}
	if (hasSchema) {
		reasons.push("schema/codegen files are present; keep contract artifacts with the relevant API or consumer commit");
	}
	if (reviewAreaCount > 1) {
		reasons.push(`multiple review areas detected (${reviewAreaCount}); split into reviewable commits unless the user requested a single commit`);
	}

	return {
		commitReadiness: caveats.length > 0 ? "ready_with_caveats" : "ready",
		shipReadiness: caveats.length > 0 ? "blocked_by_caveats" : "not_assessed",
		splitRecommendation: reviewAreaCount > 1 ? "recommended" : "none",
		changedPaths,
		groups,
		caveats,
		notBlockers,
		reasons,
	};
}

function formatLevel(value: string): string {
	return value.toUpperCase();
}

export function formatCommitReadinessDiagnostic(diagnostic: CommitReadinessDiagnostic): string {
	if (diagnostic.commitReadiness === "clean") {
		return "commit readiness: CLEAN\nship readiness: CLEAN\nworking tree clean";
	}
	const lines = [
		`commit readiness: ${formatLevel(diagnostic.commitReadiness)} (after nearest validation)`,
		`ship readiness: ${formatLevel(diagnostic.shipReadiness)}`,
		`split recommendation: ${diagnostic.splitRecommendation === "recommended" ? "RECOMMENDED" : "none"}`,
		"commit candidates:",
	];
	for (const [index, group] of diagnostic.groups.entries()) {
		lines.push(`${index + 1}. ${group.label}`);
		for (const path of group.paths.slice(0, 6)) lines.push(`   - ${path}`);
		if (group.paths.length > 6) lines.push(`   - … ${group.paths.length - 6} more`);
	}
	if (diagnostic.caveats.length > 0) {
		lines.push("caveats, not commit blockers:");
		for (const caveat of diagnostic.caveats) lines.push(`- ${caveat}`);
	}
	if (diagnostic.notBlockers.length > 0) {
		lines.push("not blockers:");
		for (const notBlocker of diagnostic.notBlockers) lines.push(`- ${notBlocker}`);
	}
	if (diagnostic.reasons.length > 0) {
		lines.push("reasons:");
		for (const reason of diagnostic.reasons) lines.push(`- ${reason}`);
	}
	return lines.join("\n");
}
