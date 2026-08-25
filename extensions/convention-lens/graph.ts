import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { ReviewSourceBundle } from "../pr-review/evidence.ts";
import {
	expandProfileTemplate,
	type ConventionLensAuthority,
	type ConventionLensPackProfile,
	type ConventionLensProfile,
	type ConventionLensNodeStatus,
} from "../utils/private-profiles.ts";
import type {
	ConventionLensCandidate,
	ConventionLensFactSet,
	ConventionLensGraph,
	ConventionLensNode,
	ConventionLensRelation,
	ConventionLensRelationType,
	ConventionLensSelection,
} from "./types.ts";

const RELATION_TYPES = new Set<ConventionLensRelationType>([
	"alias_of",
	"contains",
	"refines",
	"supports",
	"requires",
	"balances",
	"separate_axis",
	"evidenced_by",
	"related",
]);
const NON_EXPANDING_RELATIONS = new Set<ConventionLensRelationType>(["alias_of", "contains", "evidenced_by", "separate_axis"]);

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function parseInlineArray(value: string | undefined): string[] {
	if (!value) return [];
	const trimmed = value.trim();
	if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return [trimmed.replace(/^['"]|['"]$/g, "")].filter(Boolean);
	return trimmed
		.slice(1, -1)
		.split(",")
		.map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
		.filter(Boolean);
}

function parseFrontmatter(markdown: string): { values: Record<string, string>; body: string } {
	const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!match) return { values: {}, body: markdown };
	const values: Record<string, string> = {};
	for (const line of match[1]!.split(/\r?\n/)) {
		const field = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
		if (field) values[field[1]!] = field[2]!.trim().replace(/^['"]|['"]$/g, "");
	}
	return { values, body: markdown.slice(match[0].length) };
}

function firstHeading(body: string, fallback: string): string {
	return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function parseRelations(values: Record<string, string>): ConventionLensRelation[] {
	return parseInlineArray(values.relations ?? values.related)
		.map((item): ConventionLensRelation | undefined => {
			const separator = item.indexOf(":");
			if (separator < 1) return { type: "related", target: item };
			const type = item.slice(0, separator) as ConventionLensRelationType;
			const target = item.slice(separator + 1).trim();
			if (!RELATION_TYPES.has(type) || !target) return undefined;
			return { type, target };
		})
		.filter((item): item is ConventionLensRelation => Boolean(item));
}

function bodySection(body: string, heading: string): string {
	const pattern = new RegExp(`^## ${heading}\\s*$([\\s\\S]*?)(?=^## |\\Z)`, "m");
	return pattern.exec(body)?.[1]?.trim() || "";
}

function inferredSignals(id: string, title: string, body: string): string[] {
	const trigger = bodySection(body, "Trigger");
	const backticks = [...trigger.matchAll(/`([^`]+)`/g)].map((match) => match[1]!);
	const words = `${id} ${title} ${trigger}`
		.toLowerCase()
		.split(/[^\p{L}\p{N}._/-]+/u)
		.map((word) => word.trim())
		.filter((word) => word.length >= 3 && !["현재", "다음", "경우", "한다", "있다", "사용", "작업"].includes(word));
	return [...new Set([...backticks, ...words])].slice(0, 40);
}

function normalizeAuthority(value: string | undefined, fallback: ConventionLensAuthority): ConventionLensAuthority {
	return ["team-convention", "generic-guideline", "personal-precedent", "private-case"].includes(value || "")
		? value as ConventionLensAuthority
		: fallback;
}

function normalizeStatus(value: string | undefined, fallback: ConventionLensNodeStatus): ConventionLensNodeStatus {
	return ["draft", "candidate", "reviewed", "deprecated"].includes(value || "")
		? value as ConventionLensNodeStatus
		: fallback;
}

function walkMarkdownFiles(dir: string): string[] {
	if (!existsSync(dir)) return [];
	const output: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) output.push(...walkMarkdownFiles(path));
		else if (entry.isFile() && entry.name.endsWith(".md")) output.push(path);
	}
	return output.sort();
}

function loadMarkdownCardPack(pack: ConventionLensPackProfile): ConventionLensNode[] {
	if (!pack.rootDir) throw new Error(`convention lens pack ${pack.id} requires rootDir`);
	const rootDir = expandProfileTemplate(pack.rootDir);
	if (!existsSync(rootDir)) throw new Error(`convention lens pack directory not found: ${rootDir}`);
	const excluded = new Set(pack.excludeFiles ?? ["index.md", "README.md"]);
	const fallbackStatus = pack.defaultStatus ?? "candidate";
	return walkMarkdownFiles(rootDir)
		.filter((path) => !excluded.has(basename(path)))
		.map((path): ConventionLensNode | undefined => {
			const markdown = readFileSync(path, "utf8");
			const { values, body } = parseFrontmatter(markdown);
			const id = values.id?.trim();
			if (!id) return undefined;
			const title = firstHeading(body, id);
			const explicitSignals = parseInlineArray(values.signals);
			return {
				id,
				title,
				kind: ["category", "rule", "decision-lens", "case"].includes(values.kind) ? values.kind as ConventionLensNode["kind"] : "decision-lens",
				authority: normalizeAuthority(values.authority, pack.authority),
				status: normalizeStatus(values.status, fallbackStatus),
				packId: pack.id,
				scope: values.scope,
				confidence: ["high", "medium", "low"].includes(values.confidence) ? values.confidence as ConventionLensNode["confidence"] : undefined,
				appliesTo: parseInlineArray(values.applies_to ?? values.appliesTo),
				signals: explicitSignals.length ? explicitSignals : inferredSignals(id, title, body),
				aliases: parseInlineArray(values.aliases),
				relations: parseRelations(values),
				body: body.trim(),
				source: {
					path,
					heading: title,
					digest: sha256(body.trim()),
				},
			};
		})
		.filter((node): node is ConventionLensNode => Boolean(node));
}

interface SourceSection {
	category: string;
	title: string;
	startLine: number;
	endLine: number;
	body: string;
}

function sourceSections(markdown: string): SourceSection[] {
	const lines = markdown.replace(/\r\n/g, "\n").split("\n");
	const sections: SourceSection[] = [];
	let category = "";
	let categoryStart = 0;
	let categoryIntro: string[] = [];
	let current: { title: string; startLine: number; lines: string[] } | undefined;
	let categoryRuleCount = 0;
	const flushRule = (endLine: number) => {
		if (!current) return;
		sections.push({ category, title: current.title, startLine: current.startLine, endLine, body: current.lines.join("\n").trim() });
		current = undefined;
		categoryRuleCount += 1;
	};
	const flushCategoryBody = (endLine: number) => {
		if (!category || category === "목차" || categoryRuleCount > 0 || !categoryIntro.join("\n").trim()) return;
		sections.push({ category, title: category, startLine: categoryStart, endLine, body: categoryIntro.join("\n").trim() });
	};

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index]!;
		if (line.startsWith("## ")) {
			flushRule(index);
			flushCategoryBody(index);
			category = line.slice(3).trim();
			categoryStart = index + 1;
			categoryIntro = [];
			categoryRuleCount = 0;
			continue;
		}
		if (line.startsWith("### ")) {
			const title = line.slice(4).replace(/^\*+|\*+$/g, "").trim();
			if (/^(Bad|Good)$/i.test(title) && current) {
				current.lines.push(line);
				continue;
			}
			flushRule(index);
			current = { title, startLine: index + 1, lines: [] };
			continue;
		}
		if (current) current.lines.push(line);
		else if (category) categoryIntro.push(line);
	}
	flushRule(lines.length);
	flushCategoryBody(lines.length);
	return sections;
}

function stableSourceId(packId: string, kind: "category" | "rule", value: string): string {
	return `${packId}.${kind}.${sha256(value).slice(0, 12)}`;
}

interface SourceNodeOverride {
	category: string;
	title: string;
	id?: string;
	status?: ConventionLensNodeStatus;
	appliesTo?: string[];
	signals?: string[];
	aliases?: string[];
	relations?: string[];
}

function loadSourceOverrides(pack: ConventionLensPackProfile, cwd: string): Map<string, SourceNodeOverride> {
	if (!pack.overridesPath) return new Map();
	const path = resolve(cwd, expandProfileTemplate(pack.overridesPath));
	if (!existsSync(path)) throw new Error(`convention lens overrides not found: ${path}`);
	const raw = JSON.parse(readFileSync(path, "utf8")) as { nodes?: SourceNodeOverride[] } | SourceNodeOverride[];
	const values = Array.isArray(raw) ? raw : raw.nodes ?? [];
	return new Map(values.map((value) => [`${value.category}\u0000${value.title}`, value]));
}

function sectionSignals(section: SourceSection): string[] {
	const codeTerms = [...section.body.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!);
	const titleTerms = section.title
		.toLowerCase()
		.split(/[^\p{L}\p{N}._/-]+/u)
		.filter((term) => term.length >= 2);
	const special: string[] = [];
	if (/단일 책임|한 가지만/i.test(section.title)) special.push("create", "update", "mode", "mutation", "handler", "modal", "component");
	if (/플래그|flag/i.test(section.title)) special.push("is", "has", "should", "mode", "flag");
	if (/조건문/i.test(section.title)) special.push("if", "switch", "condition", "ternary");
	if (/테스트/i.test(section.category)) special.push("test", "spec", "mock", "fixture", "expect");
	return [...new Set([...codeTerms, ...titleTerms, ...special])].slice(0, 40);
}

function overrideRelations(override: SourceNodeOverride | undefined): ConventionLensRelation[] {
	if (!override?.relations?.length) return [];
	return parseRelations({ relations: `[${override.relations.join(",")}]` });
}

function loadSectionedMarkdownPack(pack: ConventionLensPackProfile, cwd: string): ConventionLensNode[] {
	if (!pack.sourcePath) throw new Error(`convention lens pack ${pack.id} requires sourcePath`);
	const sourcePath = resolve(cwd, expandProfileTemplate(pack.sourcePath));
	if (!existsSync(sourcePath)) throw new Error(`convention lens source not found: ${sourcePath}`);
	const markdown = readFileSync(sourcePath, "utf8");
	const sections = sourceSections(markdown);
	const overrides = loadSourceOverrides(pack, cwd);
	const overrideFor = (section: SourceSection) => overrides.get(`${section.category}\u0000${section.title}`);
	const ruleId = (section: SourceSection) => overrideFor(section)?.id ?? stableSourceId(pack.id, "rule", `${section.category}:${section.title}`);
	const categoryIds = new Map<string, string>();
	for (const section of sections) {
		if (!categoryIds.has(section.category)) categoryIds.set(section.category, stableSourceId(pack.id, "category", section.category));
	}
	const categoryNodes: ConventionLensNode[] = [...categoryIds.entries()].map(([category, id]) => ({
		id,
		title: category,
		kind: "category",
		authority: pack.authority,
		status: pack.defaultStatus ?? "reviewed",
		packId: pack.id,
		appliesTo: [],
		signals: [category],
		aliases: [],
		relations: sections.filter((section) => section.category === category).map((section) => ({
			type: "contains" as const,
			target: ruleId(section),
		})),
		body: "",
		source: { path: sourcePath, heading: category },
	}));
	const ruleNodes: ConventionLensNode[] = sections.map((section) => {
		const override = overrideFor(section);
		return {
			id: ruleId(section),
			title: section.title,
			kind: "rule",
			authority: pack.authority,
			status: override?.status ?? pack.defaultStatus ?? "reviewed",
			packId: pack.id,
			scope: section.category,
			appliesTo: override?.appliesTo ?? [],
			signals: [...new Set([...sectionSignals(section), ...(override?.signals ?? [])])],
			aliases: override?.aliases ?? [],
			relations: [
				{ type: "related", target: categoryIds.get(section.category)! },
				...overrideRelations(override),
			],
			body: section.body,
			source: {
				path: sourcePath,
				heading: section.title,
				startLine: section.startLine,
				endLine: section.endLine,
				digest: sha256(section.body),
			},
		};
	});
	return [...categoryNodes, ...ruleNodes];
}

export function loadConventionGraph(profile: ConventionLensProfile, cwd: string): ConventionLensGraph {
	const nodes: ConventionLensNode[] = [];
	const errors: string[] = [];
	const warnings: string[] = [];
	for (const pack of profile.packs) {
		try {
			nodes.push(...(pack.kind === "markdown-cards" ? loadMarkdownCardPack(pack) : loadSectionedMarkdownPack(pack, cwd)));
		} catch (error) {
			errors.push(error instanceof Error ? error.message : String(error));
		}
	}
	const ids = new Set<string>();
	for (const node of nodes) {
		if (ids.has(node.id)) errors.push(`duplicate convention lens node id: ${node.id}`);
		ids.add(node.id);
	}
	for (const node of nodes) {
		for (const relation of node.relations) {
			if (!ids.has(relation.target)) warnings.push(`${node.id}: relation target not loaded: ${relation.type}:${relation.target}`);
		}
	}
	const version = sha256(JSON.stringify(nodes.map((node) => ({
		id: node.id,
		status: node.status,
		authority: node.authority,
		digest: node.source.digest,
		relations: node.relations,
	}))));
	return { profileId: profile.id, version, nodes, errors, warnings };
}

function normalizeTerm(value: string): string {
	return value.trim().toLowerCase();
}

function pathPatternMatches(pattern: string, path: string): boolean {
	const escaped = pattern
		.replaceAll("**/", "\u0001")
		.replaceAll("**", "\u0002")
		.replaceAll("*", "\u0003")
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replaceAll("\u0001", "(?:.*/)?")
		.replaceAll("\u0002", ".*")
		.replaceAll("\u0003", "[^/]*");
	try { return new RegExp(`^${escaped}$`, "i").test(path); } catch { return path.includes(pattern); }
}

export function factsFromDiff(bundle: ReviewSourceBundle): ConventionLensFactSet {
	const paths = bundle.files.filter((file) => !file.binary).map((file) => file.path);
	const changedLines = bundle.lines
		.filter((line) => line.kind === "addition" || line.kind === "deletion")
		.map((line) => line.text.slice(1));
	const terms = [...new Set(`${paths.join(" ")} ${changedLines.join(" ")}`
		.toLowerCase()
		.split(/[^\p{L}\p{N}._/-]+/u)
		.map((term) => term.trim())
		.filter((term) => term.length >= 2))];
	return { paths, terms, changedLines };
}

function scoreNode(node: ConventionLensNode, facts: ConventionLensFactSet): ConventionLensCandidate | undefined {
	if (node.kind === "category" || node.status === "deprecated") return undefined;
	const haystack = `${facts.paths.join("\n")}\n${facts.changedLines.join("\n")}`.toLowerCase();
	const matchedSignals = node.signals.filter((signal) => {
		const normalized = normalizeTerm(signal);
		return normalized.length >= 2 && haystack.includes(normalized);
	});
	const matchedPaths = node.appliesTo.length
		? facts.paths.filter((path) => node.appliesTo.some((pattern) => pathPatternMatches(pattern, path)))
		: [];
	const titleTerms = `${node.id} ${node.title} ${node.aliases.join(" ")}`
		.toLowerCase()
		.split(/[^\p{L}\p{N}._/-]+/u)
		.filter((term) => term.length >= 3);
	const titleMatches = titleTerms.filter((term) => facts.terms.includes(term));
	let score = matchedSignals.length * 4 + matchedPaths.length * 3 + titleMatches.length;
	if (node.appliesTo.length && matchedPaths.length === 0) score -= 2;
	if (score <= 0) return undefined;
	return {
		node,
		score,
		matchedSignals,
		matchedPaths,
		reasons: [
			...matchedSignals.map((signal) => `signal:${signal}`),
			...matchedPaths.map((path) => `path:${path}`),
			...titleMatches.map((term) => `term:${term}`),
		],
	};
}

export function selectConventionLenses(
	graph: ConventionLensGraph,
	facts: ConventionLensFactSet,
	options: { threshold?: number; limit?: number; includeDraft?: boolean } = {},
): ConventionLensSelection {
	const threshold = options.threshold ?? 4;
	const limit = Math.max(1, options.limit ?? 3);
	const seeds = graph.nodes
		.filter((node) => options.includeDraft || node.status !== "draft")
		.map((node) => scoreNode(node, facts))
		.filter((candidate): candidate is ConventionLensCandidate => Boolean(candidate) && candidate.score >= threshold)
		.sort((left, right) => right.score - left.score || left.node.id.localeCompare(right.node.id));
	const selected = seeds.slice(0, limit);
	const selectedIds = new Set(selected.map((candidate) => candidate.node.id));
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	for (const seed of [...selected]) {
		if (selected.length >= limit) break;
		for (const relation of seed.node.relations) {
			if (NON_EXPANDING_RELATIONS.has(relation.type) || selectedIds.has(relation.target)) continue;
			const related = nodesById.get(relation.target);
			if (!related || related.kind === "category" || related.status === "deprecated" || (!options.includeDraft && related.status === "draft")) continue;
			selected.push({
				node: related,
				score: Math.max(threshold, seed.score - 1),
				matchedSignals: [],
				matchedPaths: [],
				reasons: [`${relation.type}:${seed.node.id}`],
			});
			selectedIds.add(related.id);
			if (selected.length >= limit) break;
		}
	}
	return { profileId: graph.profileId, graphVersion: graph.version, facts, candidates: selected };
}

export function conventionGraphCoverage(graph: ConventionLensGraph) {
	const byPack: Record<string, { nodes: number; categories: number; rules: number; relations: number }> = {};
	const byAuthority: Record<string, number> = {};
	const byStatus: Record<string, number> = {};
	for (const node of graph.nodes) {
		const pack = byPack[node.packId] ?? { nodes: 0, categories: 0, rules: 0, relations: 0 };
		pack.nodes += 1;
		pack.categories += node.kind === "category" ? 1 : 0;
		pack.rules += node.kind === "category" ? 0 : 1;
		pack.relations += node.relations.length;
		byPack[node.packId] = pack;
		byAuthority[node.authority] = (byAuthority[node.authority] ?? 0) + 1;
		byStatus[node.status] = (byStatus[node.status] ?? 0) + 1;
	}
	return {
		profileId: graph.profileId,
		graphVersion: graph.version,
		nodes: graph.nodes.length,
		categories: graph.nodes.filter((node) => node.kind === "category").length,
		rules: graph.nodes.filter((node) => node.kind !== "category").length,
		relations: graph.nodes.reduce((sum, node) => sum + node.relations.length, 0),
		byPack,
		byAuthority,
		byStatus,
		errors: graph.errors,
		warnings: graph.warnings,
		pass: graph.errors.length === 0 && graph.warnings.length === 0,
	};
}

export const __test = { parseFrontmatter, parseInlineArray, sourceSections, pathPatternMatches, inferredSignals };
