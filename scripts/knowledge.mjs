#!/usr/bin/env node

/**
 * pilee knowledge CLI
 *
 * Public/sanitized knowledge docs live under docs/knowledge/.
 * Unlike product's code-scope knowledge base, pilee knowledge tracks
 * design decisions and currently valid operating rules. The private journal
 * can stay local; this CLI keeps the public layer searchable and coherent.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const KNOWLEDGE_DIR = path.join(REPO_ROOT, "docs", "knowledge");
const KNOWLEDGE_README_PATH = path.join(KNOWLEDGE_DIR, "README.md");
const ROOT_README_PATH = path.join(REPO_ROOT, "README.md");
const ROOT_README_EN_PATH = path.join(REPO_ROOT, "README.en.md");
const RESOLVER_DIR = path.join(REPO_ROOT, ".context", "knowledge-resolver");
const RESOLVER_RUNS_LOG = path.join(RESOLVER_DIR, "runs.jsonl");
const GRAPH_START = "<!-- PILEE_KNOWLEDGE_GRAPH_START -->";
const GRAPH_END = "<!-- PILEE_KNOWLEDGE_GRAPH_END -->";
const ROOT_LINKS_START = "<!-- PILEE_ROOT_KNOWLEDGE_LINKS_START -->";
const ROOT_LINKS_END = "<!-- PILEE_ROOT_KNOWLEDGE_LINKS_END -->";
const VALID_STATUSES = new Set(["active", "experimental", "deprecated", "draft"]);
const VALID_CONFIDENCES = new Set(["high", "medium", "low"]);
const MAX_QUERY_RESULTS = 8;

function rel(filePath) {
	return path.relative(REPO_ROOT, filePath);
}

function ensureKnowledgeDir() {
	if (!fs.existsSync(KNOWLEDGE_DIR)) {
		console.error(`❌ Knowledge directory not found: ${rel(KNOWLEDGE_DIR)}`);
		process.exit(1);
	}
}

function readText(filePath) {
	return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function parseFrontmatter(content) {
	const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) return { frontmatter: {}, body: content, raw: null };

	let frontmatter = {};
	try {
		frontmatter = YAML.parse(match[1], { prettyErrors: false }) || {};
	} catch (error) {
		frontmatter = { __parseError: error.message };
	}

	return {
		frontmatter,
		body: content.slice(match[0].length).trim(),
		raw: match[1],
	};
}

function normalizeArray(value) {
	if (value === undefined || value === null) return [];
	if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
	if (typeof value === "string") return [value.trim()].filter(Boolean);
	return [];
}

function normalizeDate(value) {
	if (!value) return "";
	if (value instanceof Date) return value.toISOString().slice(0, 10);
	return String(value).trim();
}

function isDate(value) {
	return /^\d{4}-\d{2}-\d{2}$/.test(normalizeDate(value));
}

function isCommitLike(value) {
	return /^[0-9a-f]{7,40}$/i.test(String(value || ""));
}

function today() {
	return new Date().toISOString().slice(0, 10);
}

function git(args, { allowFail = true } = {}) {
	try {
		return execFileSync("git", args, {
			cwd: REPO_ROOT,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();
	} catch (error) {
		if (allowFail) return null;
		throw error;
	}
}

function headCommit() {
	return git(["rev-parse", "HEAD"]) || "";
}

function commitExists(hash) {
	if (!isCommitLike(hash)) return false;
	return !!git(["rev-parse", "--verify", `${hash}^{commit}`]);
}

function extractMarkdownLinks(body) {
	const links = new Set();
	const regex = /\[[^\]]*\]\(\.?\/?([a-zA-Z0-9_-]+)\.md(?:#[^)]+)?\)/g;
	let match;
	while ((match = regex.exec(body)) !== null) {
		if (match[1] !== "README") links.add(match[1]);
	}
	return links;
}

function loadDocs() {
	ensureKnowledgeDir();
	const files = fs
		.readdirSync(KNOWLEDGE_DIR)
		.filter((file) => file.endsWith(".md") && file !== "README.md")
		.sort();

	return files.map((file) => {
		const filePath = path.join(KNOWLEDGE_DIR, file);
		const content = readText(filePath);
		const { frontmatter, body, raw } = parseFrontmatter(content);
		const id = file.replace(/\.md$/, "");
		const markdownLinks = extractMarkdownLinks(body);
		const related = new Set(normalizeArray(frontmatter.related));
		const links = new Set([...markdownLinks, ...related]);

		return {
			id,
			file,
			filePath,
			content,
			rawFrontmatter: raw,
			frontmatter,
			body,
			links,
			markdownLinks,
		};
	});
}

function getDoc(id) {
	return loadDocs().find((doc) => doc.id === id) || null;
}

function tagsOf(doc) {
	return normalizeArray(doc.frontmatter.tags);
}

function appliesToOf(doc) {
	return normalizeArray(doc.frontmatter.applies_to);
}

function titleOf(doc) {
	return String(doc.frontmatter.title || doc.id);
}

function categoryOf(doc) {
	return String(doc.frontmatter.category || "uncategorized");
}

function statusOf(doc) {
	return String(doc.frontmatter.status || "");
}

function confidenceOf(doc) {
	return String(doc.frontmatter.confidence || "high").trim().toLowerCase();
}

function confidenceRank(confidence) {
	return { high: 0, medium: 1, low: 2 }[confidence] ?? 3;
}

function reviewedAtOf(doc) {
	return normalizeDate(doc.frontmatter.reviewed_at);
}

function reviewedCommitOf(doc) {
	return String(doc.frontmatter.reviewed_commit || "").trim();
}

function printHelp() {
	console.log(`
🔥 pilee Knowledge CLI

Usage:
  node scripts/knowledge.mjs --help
  node scripts/knowledge.mjs <keywords>                  Search public knowledge docs
  node scripts/knowledge.mjs --validate                  Validate metadata, links, README graph, and root README freshness
  node scripts/knowledge.mjs --graph [--check]           Regenerate docs/knowledge/README.md + root README knowledge links, or fail if stale
  node scripts/knowledge.mjs --freshness [opts]          Report doctrine/readme freshness and deterministic vs AI actions
  node scripts/knowledge.mjs --review-candidates [opts]  Find docs likely needing review from commits/local history
  node scripts/knowledge.mjs --resolve-stale [opts]      Build a local resolver plan for stale/review_needed docs
  node scripts/knowledge.mjs --resolver-log [opts]       List local resolver runs from .context/knowledge-resolver/runs.jsonl
  node scripts/knowledge.mjs --confirm <doc-id> [--date YYYY-MM-DD] [--confidence high|medium|low]
                                                        Update reviewed_at + reviewed_commit after human/AI review

Report options:
  --since-days <n>   Fallback lookback when reviewed_commit is missing (default: 14)
  --json             Emit JSON instead of Markdown
  --output <path>    Write freshness JSON/report artifacts to a file or directory
                    Resolver outputs are local-only; freshness.local.json may contain private evidence
  --strict           Exit non-zero when freshness/review issues are found

Resolver options:
  --doc <id>         Resolve only a doc id. Can be repeated or comma-separated
  --topic <query>    Filter stale docs by topic/reason text
  --limit <n>        Max docs in this local batch (default: 8; ignored with --all or --doc)
  --all              Include every stale/review_needed doc in the resolver plan
  --no-session-hints Skip local Pi session path hints

Resolver log options:
  --limit <n>        Max resolver log entries to print (default: 10)
  --json             Emit resolver log JSON instead of Markdown

Notes:
  - Private journal entries should stay in docs/pilee-history.md or Notion.
  - Knowledge docs must be public/sanitized and describe currently valid decisions.
  - Knowledge README graph is generated between ${GRAPH_START} and ${GRAPH_END}.
  - Root README knowledge links are generated between ${ROOT_LINKS_START} and ${ROOT_LINKS_END}.
`);
}

function cmdQuery(query) {
	const docs = loadDocs();
	const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);

	const scored = docs
		.map((doc) => {
			let score = 0;
			const haystacks = {
				title: titleOf(doc).toLowerCase(),
				id: doc.id.toLowerCase(),
				tags: tagsOf(doc).join(" ").toLowerCase(),
				appliesTo: appliesToOf(doc).join(" ").toLowerCase(),
				body: doc.body.toLowerCase(),
			};

			for (const keyword of keywords) {
				if (tagsOf(doc).some((tag) => tag.toLowerCase() === keyword)) score += 12;
				if (haystacks.title.includes(keyword)) score += 9;
				if (haystacks.id.includes(keyword)) score += 8;
				if (haystacks.tags.includes(keyword)) score += 6;
				if (haystacks.appliesTo.includes(keyword)) score += 5;
				if (haystacks.body.includes(keyword)) score += 3;
			}

			return { ...doc, score };
		})
		.filter((doc) => doc.score > 0)
		.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

	if (scored.length === 0) {
		console.log(`🔍 "${query}" — matching docs not found.\n`);
		console.log("Available docs:");
		for (const doc of docs) {
			console.log(`  - ${doc.id} [${tagsOf(doc).slice(0, 6).join(", ")}]`);
		}
		return;
	}

	const visible = scored.slice(0, MAX_QUERY_RESULTS);
	const visibleIds = new Set(visible.map((doc) => doc.id));
	const linkedIds = new Set();
	for (const doc of visible) {
		for (const linkId of doc.links) {
			if (!visibleIds.has(linkId)) linkedIds.add(linkId);
		}
		for (const other of docs) {
			if (!visibleIds.has(other.id) && other.links.has(doc.id)) linkedIds.add(other.id);
		}
	}

	console.log(`🔍 "${query}" — ${scored.length} match(es)\n`);
	for (const doc of visible) printDocSummary(doc, "Primary");

	const linkedDocs = [...linkedIds]
		.map((id) => docs.find((doc) => doc.id === id))
		.filter(Boolean)
		.slice(0, Math.max(0, MAX_QUERY_RESULTS - visible.length));
	if (linkedDocs.length) {
		console.log("🔗 Linked documents:\n");
		for (const doc of linkedDocs) {
			console.log(`   📎 ${doc.id} — ${titleOf(doc)} (${rel(doc.filePath)})`);
		}
		console.log();
	}

	if (scored.length > visible.length) {
		console.log(`… ${scored.length - visible.length} more match(es) omitted.`);
	}
}

function printDocSummary(doc, label) {
	console.log(`📄 [${label}] ${doc.id} — ${titleOf(doc)}`);
	console.log(`   Status: ${statusOf(doc) || "unknown"}  Reviewed: ${reviewedAtOf(doc) || "unknown"}  Commit: ${shortHash(reviewedCommitOf(doc)) || "unknown"}`);
	console.log(`   Category: ${categoryOf(doc)}`);
	console.log(`   Tags: ${tagsOf(doc).join(", ")}`);
	console.log(`   File: ${rel(doc.filePath)}`);
	if (doc.links.size) console.log(`   → links: ${[...doc.links].join(", ")}`);
	const excerpt = extractExcerpt(doc.body);
	if (excerpt) {
		console.log("   ---");
		console.log(`   ${excerpt}`);
	}
	console.log();
}

function extractExcerpt(body) {
	const withoutHeadings = body
		.split("\n")
		.filter((line) => line.trim() && !line.trim().startsWith("#"))
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
	return withoutHeadings.slice(0, 160);
}

function cmdValidate({ includeGraph = true } = {}) {
	const docs = loadDocs();
	const ids = new Set(docs.map((doc) => doc.id));
	let issues = 0;

	console.log("🔍 pilee knowledge validation\n");

	for (const doc of docs) {
		const fm = doc.frontmatter;
		if (fm.__parseError) {
			console.log(`❌ ${doc.id}: frontmatter parse error — ${fm.__parseError}`);
			issues++;
			continue;
		}
		if (!fm.title || typeof fm.title !== "string") {
			console.log(`❌ ${doc.id}: missing string frontmatter.title`);
			issues++;
		}
		if (!normalizeArray(fm.tags).length) {
			console.log(`❌ ${doc.id}: missing non-empty frontmatter.tags`);
			issues++;
		}
		if (!fm.category || typeof fm.category !== "string") {
			console.log(`❌ ${doc.id}: missing string frontmatter.category`);
			issues++;
		}
		if (!VALID_STATUSES.has(statusOf(doc))) {
			console.log(`❌ ${doc.id}: status must be one of ${[...VALID_STATUSES].join(", ")}`);
			issues++;
		}
		if (fm.confidence !== undefined && !VALID_CONFIDENCES.has(confidenceOf(doc))) {
			console.log(`❌ ${doc.id}: confidence must be one of ${[...VALID_CONFIDENCES].join(", ")}`);
			issues++;
		}
		if (!normalizeArray(fm.applies_to).length) {
			console.log(`❌ ${doc.id}: missing non-empty frontmatter.applies_to`);
			issues++;
		}
		if (!isDate(fm.reviewed_at)) {
			console.log(`❌ ${doc.id}: reviewed_at must be YYYY-MM-DD`);
			issues++;
		}
		if (!isCommitLike(fm.reviewed_commit) || !commitExists(fm.reviewed_commit)) {
			console.log(`❌ ${doc.id}: reviewed_commit must be an existing git commit hash`);
			issues++;
		}

		for (const linkId of doc.markdownLinks) {
			if (!ids.has(linkId)) {
				console.log(`❌ ${doc.id}: broken markdown link → ${linkId}.md`);
				issues++;
			}
		}
		for (const relatedId of normalizeArray(fm.related)) {
			if (!ids.has(relatedId)) {
				console.log(`❌ ${doc.id}: related doc not found → ${relatedId}`);
				issues++;
			}
		}
	}

	for (const doc of docs) {
		const hasOutgoing = doc.links.size > 0;
		const hasIncoming = docs.some((other) => other.id !== doc.id && other.links.has(doc.id));
		if (!hasOutgoing && !hasIncoming) {
			console.log(`ℹ️  ${doc.id}: isolated document (allowed, but graph value is lower)`);
		}
	}

	if (includeGraph) {
		const freshness = inspectReadmeFreshness(docs);
		for (const issue of freshness.issues) {
			console.log(`❌ ${issue}`);
			issues++;
		}
	}

	if (issues === 0) console.log("✅ No issues found.");
	else console.log(`\n🔴 ${issues} issue(s) found.`);

	return issues;
}

function inspectReadmeFreshness(docs) {
	const issues = [];
	const reasons = [];
	const knowledgeExpected = renderKnowledgeReadme(docs);
	const knowledgeCurrent = fs.existsSync(KNOWLEDGE_README_PATH) ? readText(KNOWLEDGE_README_PATH) : "";
	const rootExpected = renderRootReadme(docs);
	const rootCurrent = fs.existsSync(ROOT_README_PATH) ? readText(ROOT_README_PATH) : "";
	const rootEnglishExpected = renderRootReadmeEnglish(docs);
	const rootEnglishCurrent = fs.existsSync(ROOT_README_EN_PATH) ? readText(ROOT_README_EN_PATH) : "";
	const extensionCount = countTopLevelDirs("extensions");
	const skillCount = countTopLevelDirs("skills");
	const declaredExtensionCount = extractDeclaredCount(rootCurrent, "Extensions");
	const declaredSkillCount = extractDeclaredCount(rootCurrent, "Skills");
	const coverage = buildSurfaceCoverage(docs);

	if (!knowledgeCurrent) {
		issues.push(`README missing: ${rel(KNOWLEDGE_README_PATH)}`);
		reasons.push({ type: "missing_readme", severity: "high", detail: `README missing: ${rel(KNOWLEDGE_README_PATH)}` });
	} else if (knowledgeCurrent !== knowledgeExpected) {
		issues.push("docs/knowledge/README.md generated graph is stale. Run `node scripts/knowledge.mjs --graph`.");
		reasons.push({ type: "stale_generated_block", severity: "medium", detail: "docs/knowledge/README.md generated graph is stale", action: "regenerate_index" });
	}
	if (!rootCurrent) {
		issues.push(`README missing: ${rel(ROOT_README_PATH)}`);
		reasons.push({ type: "missing_readme", severity: "high", detail: `README missing: ${rel(ROOT_README_PATH)}` });
	} else if (rootCurrent !== rootExpected) {
		issues.push("README.md knowledge link block is stale. Run `node scripts/knowledge.mjs --graph`.");
		reasons.push({ type: "stale_generated_block", severity: "medium", detail: "README.md knowledge link block is stale", action: "regenerate_readme_tables" });
	}
	if (!rootEnglishCurrent) {
		issues.push(`README missing: ${rel(ROOT_README_EN_PATH)}`);
		reasons.push({ type: "missing_readme", severity: "high", detail: `README missing: ${rel(ROOT_README_EN_PATH)}` });
	} else if (rootEnglishCurrent !== rootEnglishExpected) {
		issues.push("README.en.md knowledge link block is stale. Run `node scripts/knowledge.mjs --graph`.");
		reasons.push({ type: "stale_generated_block", severity: "medium", detail: "README.en.md knowledge link block is stale", action: "regenerate_readme_tables" });
	}
	if (declaredExtensionCount !== null && declaredExtensionCount !== extensionCount) {
		issues.push(`README.md Extensions count is stale: declared ${declaredExtensionCount}, actual ${extensionCount}.`);
		reasons.push({ type: "stale_count", severity: "medium", detail: `README.md Extensions count is stale: declared ${declaredExtensionCount}, actual ${extensionCount}` });
	}
	if (declaredSkillCount !== null && declaredSkillCount !== skillCount) {
		issues.push(`README.md Skills count is stale: declared ${declaredSkillCount}, actual ${skillCount}.`);
		reasons.push({ type: "stale_count", severity: "medium", detail: `README.md Skills count is stale: declared ${declaredSkillCount}, actual ${skillCount}` });
	}
	for (const surface of coverage.missing) {
		reasons.push({
			type: "missing_doctrine_link",
			severity: surface.type === "skill" ? "medium" : "low",
			detail: `${surface.surface} has no linked knowledge doc`,
			evidence: { surface: surface.surface, type: surface.type },
		});
	}

	const deterministicFresh = issues.length === 0;
	const coverageFresh = coverage.missing.length === 0;

	return {
		freshness: deterministicFresh && coverageFresh ? "fresh" : "stale",
		knowledge_readme: {
			path: rel(KNOWLEDGE_README_PATH),
			fresh: !!knowledgeCurrent && knowledgeCurrent === knowledgeExpected,
		},
		root_readme: {
			path: rel(ROOT_README_PATH),
			knowledge_links_fresh: !!rootCurrent && rootCurrent === rootExpected,
			english_path: rel(ROOT_README_EN_PATH),
			english_knowledge_links_fresh: !!rootEnglishCurrent && rootEnglishCurrent === rootEnglishExpected,
			extension_count: extensionCount,
			declared_extension_count: declaredExtensionCount,
			extension_count_fresh: declaredExtensionCount === null || declaredExtensionCount === extensionCount,
			skill_count: skillCount,
			declared_skill_count: declaredSkillCount,
			skill_count_fresh: declaredSkillCount === null || declaredSkillCount === skillCount,
		},
		coverage,
		reasons,
		issues,
	};
}

function renderKnowledgeReadme(docs) {
	const existing = fs.existsSync(KNOWLEDGE_README_PATH) ? readText(KNOWLEDGE_README_PATH) : defaultKnowledgeReadme();
	const generated = buildKnowledgeGeneratedSection(docs);
	if (existing.includes(GRAPH_START) && existing.includes(GRAPH_END)) {
		return existing.replace(
			new RegExp(`${escapeRegex(GRAPH_START)}[\\s\\S]*?${escapeRegex(GRAPH_END)}`),
			`${GRAPH_START}\n${generated}\n${GRAPH_END}`,
		);
	}
	return `${existing.trim()}\n\n${GRAPH_START}\n${generated}\n${GRAPH_END}\n`;
}

function defaultKnowledgeReadme() {
	return `# pilee Knowledge\n\nPublic, sanitized knowledge extracted from private pilee history.\n`;
}

function buildKnowledgeGeneratedSection(docs) {
	const sorted = [...docs].sort(
		(a, b) => categoryOf(a).localeCompare(categoryOf(b)) || a.id.localeCompare(b.id),
	);
	const categories = new Map();
	for (const doc of sorted) {
		const category = categoryOf(doc);
		if (!categories.has(category)) categories.set(category, []);
		categories.get(category).push(doc);
	}

	const lines = [];
	lines.push(`> Generated by \`node scripts/knowledge.mjs --graph\`. Do not edit this block manually.`);
	lines.push("");
	lines.push("## Topic Index");
	lines.push("");
	for (const [category, categoryDocs] of categories) {
		lines.push(`### ${category}`);
		lines.push("");
		lines.push("| Topic | Status | Confidence | Reviewed | Commit | Tags |");
		lines.push("|---|---|---:|---:|---:|---|");
		for (const doc of categoryDocs) {
			const tags = tagsOf(doc).slice(0, 6).join(", ");
			lines.push(`| [${escapeTable(titleOf(doc))}](./${doc.id}.md) | ${statusOf(doc)} | ${confidenceOf(doc)} | ${reviewedAtOf(doc)} | ${shortHash(reviewedCommitOf(doc))} | ${escapeTable(tags)} |`);
		}
		lines.push("");
	}

	lines.push("## Knowledge Map");
	lines.push("");
	lines.push("```mermaid");
	lines.push("graph TD");
	for (const doc of sorted) {
		lines.push(`  ${nodeId(doc.id)}["${escapeMermaid(titleOf(doc))}"]`);
	}

	let edgeCount = 0;
	const ids = new Set(docs.map((doc) => doc.id));
	for (const doc of sorted) {
		for (const linkId of [...doc.links].sort()) {
			if (!ids.has(linkId)) continue;
			lines.push(`  ${nodeId(doc.id)} --> ${nodeId(linkId)}`);
			edgeCount++;
		}
	}
	if (edgeCount === 0) lines.push("  %% No edges yet");
	lines.push("```");
	lines.push("");
	lines.push("## Review Metadata Summary");
	lines.push("");
	lines.push(`- Documents: ${docs.length}`);
	lines.push(`- Links: ${edgeCount}`);
	lines.push("- Generated at: deterministic README build (timestamp intentionally omitted)");
	return lines.join("\n");
}

function renderRootReadme(docs) {
	const existing = fs.existsSync(ROOT_README_PATH) ? readText(ROOT_README_PATH) : "";
	if (!existing) return "";
	const generated = buildRootKnowledgeLinksSection(docs);
	if (existing.includes(ROOT_LINKS_START) && existing.includes(ROOT_LINKS_END)) {
		return existing.replace(
			new RegExp(`${escapeRegex(ROOT_LINKS_START)}[\\s\\S]*?${escapeRegex(ROOT_LINKS_END)}`),
			`${ROOT_LINKS_START}\n${generated}\n${ROOT_LINKS_END}`,
		);
	}
	const section = `\n## Knowledge\n\n공개 가능한 최신 설계 지식은 [docs/knowledge/README.md](./docs/knowledge/README.md)에서 검색/그래프 형태로 확인합니다.\n\n${ROOT_LINKS_START}\n${generated}\n${ROOT_LINKS_END}\n\n---\n`;
	if (existing.includes("\n## Extensions\n")) {
		return existing.replace("\n## Extensions\n", `${section}\n## Extensions\n`);
	}
	return `${existing.trim()}\n${section}\n`;
}

function renderRootReadmeEnglish(docs) {
	const existing = fs.existsSync(ROOT_README_EN_PATH) ? readText(ROOT_README_EN_PATH) : "";
	if (!existing) return "";
	const generated = buildRootKnowledgeLinksSection(docs);
	if (existing.includes(ROOT_LINKS_START) && existing.includes(ROOT_LINKS_END)) {
		return existing.replace(
			new RegExp(`${escapeRegex(ROOT_LINKS_START)}[\\s\\S]*?${escapeRegex(ROOT_LINKS_END)}`),
			`${ROOT_LINKS_START}\n${generated}\n${ROOT_LINKS_END}`,
		);
	}
	const block = `\n${ROOT_LINKS_START}\n${generated}\n${ROOT_LINKS_END}\n`;
	if (existing.includes("\n---\n\n## Extensions\n")) {
		return existing.replace("\n---\n\n## Extensions\n", `${block}\n---\n\n## Extensions\n`);
	}
	return `${existing.trim()}\n\n${block}`;
}

function buildRootKnowledgeLinksSection(docs) {
	const coverage = buildSurfaceCoverage(docs);
	const lines = [];
	lines.push(`> Generated by \`node scripts/knowledge.mjs --graph\`. Do not edit this block manually.`);
	lines.push("");
	lines.push("| Type | Surface | Knowledge docs |");
	lines.push("|---|---|---|");
	for (const item of coverage.surfaces) {
		const docsForSurface = coverage.by_surface[item.surface] || [];
		const links = docsForSurface.length > 0
			? docsForSurface.map((doc) => `[${escapeTable(doc.title)}](./docs/knowledge/${doc.id}.md)`).join("<br>")
			: "TODO: knowledge 문서 필요";
		lines.push(`| ${item.type} | \`${escapeTable(item.surface)}\` | ${links} |`);
	}
	if (coverage.surfaces.length === 0) lines.push("| _none_ | _none_ | _no surfaces found_ |");
	return lines.join("\n");
}

function buildSurfaceCoverage(docs) {
	const discovered = listDiscoveredSurfaces(docs);
	const surfaceMap = new Map();
	for (const surface of discovered) surfaceMap.set(surface.surface, []);
	for (const doc of docs) {
		for (const target of appliesToOf(doc)) {
			const surface = normalizeSurface(target);
			if (!surface) continue;
			if (!surfaceMap.has(surface)) {
				surfaceMap.set(surface, []);
				discovered.push({ type: "concern", surface, source: "applies_to" });
			}
			surfaceMap.get(surface).push({ id: doc.id, title: titleOf(doc), status: statusOf(doc) });
		}
	}

	const surfaces = [...new Map(discovered.map((item) => [item.surface, item])).values()]
		.sort((a, b) => typeRank(a.type) - typeRank(b.type) || a.surface.localeCompare(b.surface));
	const bySurface = {};
	const covered = [];
	const missing = [];
	for (const item of surfaces) {
		const docsForSurface = [...new Map((surfaceMap.get(item.surface) || []).map((doc) => [doc.id, doc])).values()]
			.sort((a, b) => a.id.localeCompare(b.id));
		bySurface[item.surface] = docsForSurface;
		if (docsForSurface.length) covered.push({ ...item, docs: docsForSurface });
		else missing.push(item);
	}

	return {
		total: surfaces.length,
		covered_count: covered.length,
		missing_count: missing.length,
		surfaces,
		covered,
		missing,
		by_surface: bySurface,
	};
}

function listDiscoveredSurfaces(docs = []) {
	const surfaces = [];
	for (const entry of listTopLevelDirs("extensions")) {
		surfaces.push({ type: "extension", surface: `extensions/${entry}`, source: "filesystem" });
	}
	for (const entry of listTopLevelDirs("skills")) {
		surfaces.push({ type: "skill", surface: `skills/${entry}`, source: "filesystem" });
	}
	for (const doc of docs) {
		for (const target of appliesToOf(doc)) {
			const surface = normalizeSurface(target);
			if (!surface) continue;
			if (!surfaces.some((item) => item.surface === surface)) {
				surfaces.push({ type: inferSurfaceType(surface), surface, source: "applies_to" });
			}
		}
	}
	return surfaces;
}

function listTopLevelDirs(dirname) {
	const dir = path.join(REPO_ROOT, dirname);
	if (!fs.existsSync(dir)) return [];
	return fs.readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

function inferSurfaceType(surface) {
	if (surface.startsWith("extensions/")) return "extension";
	if (surface.startsWith("skills/")) return "skill";
	if (surface === "agents") return "agent";
	if (surface.startsWith("docs/")) return "docs";
	if (surface.startsWith("scripts/")) return "script";
	return "concern";
}

function typeRank(type) {
	return { extension: 1, skill: 2, agent: 3, script: 4, docs: 5, concern: 6 }[type] ?? 9;
}

function normalizeSurface(target) {
	const value = String(target || "").trim();
	const skillMatch = value.match(/^(skills\/[a-z0-9-]+)/);
	if (skillMatch) return skillMatch[1];
	const extensionMatch = value.match(/^(extensions\/[a-z0-9-]+)/);
	if (extensionMatch) return extensionMatch[1];
	if (value === "agents" || value.startsWith("agents/")) return "agents";
	if (value === "docs/knowledge" || value.startsWith("docs/knowledge/")) return "docs/knowledge";
	if (value === "scripts/knowledge.mjs") return "scripts/knowledge.mjs";
	if (value === "show-report") return "show-report";
	if (value.startsWith("web_search")) return "web_search";
	return null;
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeTable(value) {
	return String(value).replace(/\|/g, "\\|");
}

function escapeMermaid(value) {
	return String(value).replace(/"/g, "&quot;");
}

function nodeId(id) {
	return `doc_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function shortHash(hash) {
	return hash ? String(hash).slice(0, 7) : "";
}

function countTopLevelDirs(dirname) {
	const dir = path.join(REPO_ROOT, dirname);
	if (!fs.existsSync(dir)) return 0;
	return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
}

function extractDeclaredCount(content, heading) {
	const regex = new RegExp(`## ${escapeRegex(heading)}\\n\\n(\\d+)개`);
	const match = content.match(regex);
	return match ? Number(match[1]) : null;
}

function cmdGraph({ check = false } = {}) {
	const docs = loadDocs();
	const nextKnowledge = renderKnowledgeReadme(docs);
	const currentKnowledge = fs.existsSync(KNOWLEDGE_README_PATH) ? readText(KNOWLEDGE_README_PATH) : "";
	const nextRoot = renderRootReadme(docs);
	const currentRoot = fs.existsSync(ROOT_README_PATH) ? readText(ROOT_README_PATH) : "";
	const nextRootEnglish = renderRootReadmeEnglish(docs);
	const currentRootEnglish = fs.existsSync(ROOT_README_EN_PATH) ? readText(ROOT_README_EN_PATH) : "";
	if (check) {
		const stale = [];
		if (currentKnowledge !== nextKnowledge) stale.push(rel(KNOWLEDGE_README_PATH));
		if (currentRoot !== nextRoot) stale.push(rel(ROOT_README_PATH));
		if (currentRootEnglish !== nextRootEnglish) stale.push(rel(ROOT_README_EN_PATH));
		if (stale.length === 0) {
			console.log("✅ knowledge generated README blocks are up to date.");
			return 0;
		}
		console.log(`❌ Generated README block(s) stale: ${stale.join(", ")}. Run \`node scripts/knowledge.mjs --graph\`.`);
		return 1;
	}
	fs.writeFileSync(KNOWLEDGE_README_PATH, nextKnowledge);
	if (nextRoot) fs.writeFileSync(ROOT_README_PATH, nextRoot);
	if (nextRootEnglish) fs.writeFileSync(ROOT_README_EN_PATH, nextRootEnglish);
	console.log(`💾 Updated ${rel(KNOWLEDGE_README_PATH)}`);
	if (nextRoot) console.log(`💾 Updated ${rel(ROOT_README_PATH)}`);
	if (nextRootEnglish) console.log(`💾 Updated ${rel(ROOT_README_EN_PATH)}`);
	return 0;
}

function cmdConfirm(docId, date = today(), confidence = null) {
	const doc = getDoc(docId);
	if (!doc) {
		console.error(`❌ Document not found: ${docId}`);
		process.exit(1);
	}
	if (!isDate(date)) {
		console.error(`❌ --date must be YYYY-MM-DD: ${date}`);
		process.exit(1);
	}
	if (confidence !== null && !VALID_CONFIDENCES.has(confidence)) {
		console.error(`❌ --confidence must be one of ${[...VALID_CONFIDENCES].join(", ")}: ${confidence}`);
		process.exit(1);
	}

	const commit = headCommit();
	const fm = { ...doc.frontmatter, reviewed_at: date, reviewed_commit: commit };
	if (confidence !== null) fm.confidence = confidence;
	delete fm.__parseError;
	const nextFrontmatter = stringifyFrontmatter(fm);
	const nextContent = `---\n${nextFrontmatter}---\n\n${doc.body.trim()}\n`;
	fs.writeFileSync(doc.filePath, nextContent);
	console.log(`✅ ${doc.id}: reviewed_at=${date}, reviewed_commit=${shortHash(commit)}`);
	cmdGraph();
}

function stringifyFrontmatter(fm) {
	const preferred = [
		"title",
		"tags",
		"category",
		"status",
		"confidence",
		"applies_to",
		"source",
		"reviewed_at",
		"reviewed_commit",
		"related",
		"supersedes",
	];
	const ordered = {};
	for (const key of preferred) {
		if (fm[key] !== undefined && fm[key] !== null) ordered[key] = fm[key];
	}
	for (const key of Object.keys(fm).sort()) {
		if (!(key in ordered)) ordered[key] = fm[key];
	}
	return YAML.stringify(ordered, { lineWidth: 0 });
}

function cmdReviewCandidates({ sinceDays = 14, json = false, strict = false } = {}) {
	const candidates = buildReviewCandidates({ sinceDays });
	if (json) {
		console.log(JSON.stringify({ generatedAt: new Date().toISOString(), candidates }, null, 2));
	} else {
		printReviewCandidates(candidates, { historyAvailable: fs.existsSync(path.join(REPO_ROOT, "docs", "pilee-history.md")) });
	}

	if (strict && candidates.length > 0) return 1;
	return 0;
}

function buildReviewCandidates({ sinceDays = 14 } = {}) {
	const docs = loadDocs();
	const fallbackDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
	const historyEntries = readHistoryEntries();
	const candidates = [];

	for (const doc of docs) {
		const sinceDate = reviewedAtOf(doc) || fallbackDate;
		const reviewedCommit = reviewedCommitOf(doc);
		const gitCommits = readGitCommitsForDoc(doc, fallbackDate);
		const tokens = tokensForDoc(doc);
		const commitEvidence = gitCommits
			.map((commit) => ({ commit, matches: matchingTokens(tokens, `${commit.subject}\n${actionableFiles(commit).join("\n")}`) }))
			.filter((item) => item.matches.length > 0)
			.slice(0, 8);
		const historyEvidence = historyEntries
			.filter((entry) => entry.date > sinceDate)
			.map((entry) => ({ entry, matches: matchingTokens(tokens, entry.text) }))
			.filter((item) => item.matches.length > 0)
			.slice(0, 8);

		if (commitEvidence.length || historyEvidence.length || !commitExists(reviewedCommit)) {
			candidates.push({
				id: doc.id,
				title: titleOf(doc),
				category: categoryOf(doc),
				status: statusOf(doc),
				reviewed_at: sinceDate,
				reviewed_commit: reviewedCommit || null,
				reviewed_commit_valid: commitExists(reviewedCommit),
				commitEvidence: commitEvidence.map(({ commit, matches }) => ({
					hash: shortHash(commit.hash),
					date: commit.date,
					subject: commit.subject,
					files: actionableFiles(commit).slice(0, 6),
					matches,
				})),
				historyEvidence: historyEvidence.map(({ entry, matches }) => ({
					date: entry.date,
					title: entry.title,
					matches,
				})),
			});
		}
	}

	return candidates;
}

function readGitCommitsForDoc(doc, fallbackDate) {
	const reviewedCommit = reviewedCommitOf(doc);
	if (commitExists(reviewedCommit)) {
		return readGitCommitsRange(`${reviewedCommit}..HEAD`).filter((commit) => actionableFiles(commit).length > 0);
	}
	return readGitCommitsSince(fallbackDate).filter((commit) => actionableFiles(commit).length > 0);
}

function readGitCommitsSince(date) {
	return readGitCommits([`--since=${date} 00:00:00`]);
}

function readGitCommitsRange(range) {
	return readGitCommits([range]);
}

function readGitCommits(extraArgs) {
	try {
		const output = execFileSync(
			"git",
			[
				"log",
				...extraArgs,
				"--date=short",
				"--name-only",
				"--pretty=format:@@@%H%x09%cs%x09%s",
			],
			{ cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
		if (!output) return [];
		return output
			.split("@@@")
			.map((block) => block.trim())
			.filter(Boolean)
			.map((block) => {
				const lines = block.split("\n").filter(Boolean);
				const [hash = "", dateValue = "", ...subjectParts] = (lines.shift() || "").split("\t");
				return {
					hash,
					date: dateValue,
					subject: subjectParts.join("\t"),
					files: lines.filter((line) => !line.startsWith("@@@")),
				};
			});
	} catch {
		return [];
	}
}

function actionableFiles(commit) {
	return commit.files.filter((file) => !isKnowledgeDocFile(file));
}

function isKnowledgeDocFile(file) {
	return file === "README.md"
		|| file === "docs/knowledge-review.md"
		|| file === "docs/knowledge/README.md"
		|| /^docs\/knowledge\/[^/]+\.md$/.test(file);
}

function readHistoryEntries() {
	const historyPath = path.join(REPO_ROOT, "docs", "pilee-history.md");
	if (!fs.existsSync(historyPath)) return [];
	const content = readText(historyPath);
	const entries = [];
	const sectionRegex = /^## (\d{4}-\d{2}-\d{2})([^\n]*)\n([\s\S]*?)(?=^## \d{4}-\d{2}-\d{2}|$)/gm;
	let section;
	while ((section = sectionRegex.exec(content)) !== null) {
		const [, date, rawTitle, sectionBody] = section;
		const itemRegex = /^####\s+\d+\.\s+([^\n]+)\n([\s\S]*?)(?=^####\s+\d+\.|$)/gm;
		let item;
		let foundItem = false;
		while ((item = itemRegex.exec(sectionBody)) !== null) {
			foundItem = true;
			entries.push({ date, title: item[1].trim(), text: item[0] });
		}
		if (!foundItem) {
			entries.push({ date, title: rawTitle.replace(/^:\s*/, "").trim() || date, text: sectionBody });
		}
	}
	return entries;
}

function tokensForDoc(doc) {
	const values = [doc.id, titleOf(doc), categoryOf(doc), ...tagsOf(doc), ...appliesToOf(doc)];
	const tokens = new Set();
	for (const value of values) {
		const lower = String(value).toLowerCase();
		if (lower.length >= 3) tokens.add(lower);
		for (const part of lower.split(/[^\p{L}\p{N}]+/u)) {
			if (part.length >= 3) tokens.add(part);
		}
	}
	const noisy = new Set([
		"docs",
		"doc",
		"skill",
		"skills",
		"script",
		"scripts",
		"extension",
		"extensions",
		"index",
		"main",
		"workflow",
		"source",
		"report",
		"리포트",
		"pilee",
		"mjs",
		"ts",
		"md",
	]);
	return [...tokens].filter((token) => !noisy.has(token));
}

function matchingTokens(tokens, text) {
	const lower = text.toLowerCase();
	return tokens.filter((token) => lower.includes(token)).slice(0, 10);
}

function printReviewCandidates(candidates, { historyAvailable }) {
	console.log("📊 pilee knowledge review candidates\n");
	if (!historyAvailable) {
		console.log("ℹ️  Local private journal docs/pilee-history.md not found; using git commits only.\n");
	}
	if (!candidates.length) {
		console.log("✅ No review candidates found.");
		return;
	}
	for (const candidate of candidates) {
		console.log(`📄 ${candidate.id} — ${candidate.title}`);
		console.log(`   reviewed_at: ${candidate.reviewed_at}  reviewed_commit: ${shortHash(candidate.reviewed_commit) || "missing"}  status: ${candidate.status}`);
		if (!candidate.reviewed_commit_valid) console.log("   ❓ reviewed_commit is missing or invalid; run --confirm after review.");
		for (const evidence of candidate.historyEvidence) {
			console.log(`   📝 history ${evidence.date}: ${evidence.title}`);
			console.log(`      matches: ${evidence.matches.join(", ")}`);
		}
		for (const evidence of candidate.commitEvidence) {
			console.log(`   🔧 commit ${evidence.hash} ${evidence.date}: ${evidence.subject}`);
			console.log(`      matches: ${evidence.matches.join(", ")}`);
			if (evidence.files.length) console.log(`      files: ${evidence.files.join(", ")}`);
		}
		console.log();
	}
	console.log("Next: review each doc, edit if needed, then `node scripts/knowledge.mjs --confirm <doc-id>`.");
}

function cmdFreshness({ sinceDays = 14, json = false, strict = false, output = null } = {}) {
	const report = buildFreshnessReport({ sinceDays });

	if (output) {
		fs.mkdirSync(path.dirname(path.resolve(REPO_ROOT, output)), { recursive: true });
		fs.writeFileSync(path.resolve(REPO_ROOT, output), `${JSON.stringify(report, null, 2)}\n`);
	}

	if (json) console.log(JSON.stringify(report, null, 2));
	else printFreshness(report, { output });

	if (strict && (report.deterministic_actions.length > 0 || report.ai_actions.length > 0 || report.readme_freshness.issues.length > 0)) return 1;
	return 0;
}

function buildFreshnessReport({ sinceDays = 14 } = {}) {
	const docs = loadDocs();
	const generatedAt = new Date().toISOString();
	const candidates = buildReviewCandidates({ sinceDays });
	const candidateIds = new Set(candidates.map((candidate) => candidate.id));
	const readmeFreshness = inspectReadmeFreshness(docs);
	const currentHead = headCommit();
	const base = {
		repo: (git(["config", "--get", "remote.origin.url"]) || "").replace(/^git@github.com:/, "https://github.com/").replace(/\.git$/, ""),
		head: currentHead,
		head_short: shortHash(currentHead),
		since_days: sinceDays,
		private_history_available: fs.existsSync(path.join(REPO_ROOT, "docs", "pilee-history.md")),
	};
	const doctrine = docs.map((doc) => {
		const reviewedCommit = reviewedCommitOf(doc);
		const validCommit = commitExists(reviewedCommit);
		const candidate = candidates.find((item) => item.id === doc.id);
		const confidence = confidenceOf(doc);
		const confidenceReviewNeeded = confidenceRank(confidence) > confidenceRank("high");
		const reasons = [];
		if (!validCommit) {
			reasons.push({
				type: "missing_reviewed_commit",
				severity: "high",
				detail: "reviewed_commit is missing or invalid",
				evidence: { reviewed_commit: reviewedCommit || null },
			});
		}
		for (const evidence of candidate?.commitEvidence || []) {
			reasons.push({
				type: "recent_commit",
				severity: "medium",
				detail: `${evidence.subject}`,
				evidence: { commit: evidence.hash, date: evidence.date, files: evidence.files, matches: evidence.matches },
			});
		}
		for (const evidence of candidate?.historyEvidence || []) {
			reasons.push({
				type: "recent_history",
				severity: "high",
				detail: evidence.title,
				evidence: { date: evidence.date, matches: evidence.matches },
			});
		}
		if (confidenceReviewNeeded) {
			reasons.push({
				type: "confidence_review",
				severity: confidence === "low" ? "high" : "medium",
				detail: `confidence is ${confidence}; keep in review queue until user/AI review promotes it`,
				evidence: { confidence },
			});
		}
		const freshness = !validCommit ? "unknown" : (candidateIds.has(doc.id) || confidenceReviewNeeded) ? "stale" : "fresh";
		return {
			id: doc.id,
			title: titleOf(doc),
			status: statusOf(doc),
			confidence,
			reviewed_at: reviewedAtOf(doc),
			reviewed_commit: reviewedCommit || null,
			freshness,
			reasons,
			deterministic_actions: ["keep_in_index", "include_in_graph"],
			ai_actions: freshness === "fresh" ? [] : ["review_doc_content"],
		};
	});
	const deterministicActions = [];
	if (!readmeFreshness.knowledge_readme.fresh || !readmeFreshness.root_readme.knowledge_links_fresh) {
		deterministicActions.push({
			type: "regenerate-readme-graphs",
			command: "npm run knowledge:graph",
			reason: "generated README knowledge graph/link block is stale",
		});
	}
	if (!readmeFreshness.root_readme.extension_count_fresh || !readmeFreshness.root_readme.skill_count_fresh) {
		deterministicActions.push({
			type: "update-root-readme-counts",
			file: "README.md",
			reason: "declared extension/skill counts do not match filesystem",
		});
	}
	const coverageActions = readmeFreshness.coverage.missing.map((surface) => ({
		type: "create-or-link-doctrine",
		target: surface.surface,
		reason: "surface has no linked knowledge doc",
	}));
	const confidenceActions = doctrine
		.filter((doc) => doc.freshness === "stale" && confidenceRank(doc.confidence) > confidenceRank("high") && !candidateIds.has(doc.id))
		.map((doc) => ({
			type: "review-doctrine-confidence",
			doc: doc.id,
			reason: `confidence is ${doc.confidence}; user review requested`,
		}));
	const aiActions = [
		...candidates.map((candidate) => ({
			type: "review-doctrine",
			doc: candidate.id,
			reason: candidate.reviewed_commit_valid ? "related commit/history evidence found" : "reviewed_commit missing or invalid",
		})),
		...confidenceActions,
		...coverageActions,
	];
	const freshnessDocs = {
		fresh: doctrine.filter((doc) => doc.freshness === "fresh").length,
		stale: doctrine.filter((doc) => doc.freshness === "stale").length,
		unknown: doctrine.filter((doc) => doc.freshness === "unknown").length,
	};
	const summary = {
		status: deterministicActions.length || aiActions.length ? "stale" : "fresh",
		active_docs: doctrine.filter((doc) => doc.status === "active").length,
		deprecated_docs: doctrine.filter((doc) => doc.status === "deprecated").length,
		doctrine_stale: freshnessDocs.stale,
		doctrine_unknown: freshnessDocs.unknown,
		readme_stale: readmeFreshness.freshness === "fresh" ? 0 : 1,
		missing_coverage: readmeFreshness.coverage.missing_count,
		broken_links: 0,
		ai_review_candidates: aiActions.length,
	};
	const readme = {
		freshness: readmeFreshness.freshness,
		reasons: readmeFreshness.reasons,
		coverage: readmeFreshness.coverage,
		deterministic_actions: deterministicActions.map((action) => action.type),
		ai_actions: coverageActions.map((action) => action.type),
	};
	const freshnessCandidates = [
		...candidates.map((candidate) => ({
			kind: "doc_update",
			target: candidate.id,
			priority: candidate.reviewed_commit_valid ? "medium" : "high",
			reason: candidate.reviewed_commit_valid ? "related commit/history evidence found" : "reviewed_commit missing or invalid",
			source: [
				...candidate.commitEvidence.map((evidence) => `commit:${evidence.hash}`),
				...candidate.historyEvidence.map((evidence) => `history:${evidence.date}:${evidence.title}`),
			],
			suggested_action: "Review the doctrine, update if needed, then run --confirm",
		})),
		...confidenceActions.map((action) => ({
			kind: "confidence_review",
			target: action.doc,
			priority: action.reason.includes("low") ? "high" : "medium",
			reason: action.reason,
			source: ["frontmatter:confidence"],
			suggested_action: "Review the doctrine; if accepted, run --confirm <doc-id> --confidence high",
		})),
		...readmeFreshness.coverage.missing.map((surface) => ({
			kind: "coverage_gap",
			target: surface.surface,
			priority: surface.type === "skill" ? "medium" : "low",
			reason: "README surface has no linked knowledge doctrine",
			source: [surface.source],
			suggested_action: "Create a doctrine doc or add this surface to an existing doc applies_to",
		})),
	];

	return {
		generated_at: generatedAt,
		generatedAt,
		base,
		summary,
		doctrine,
		readme,
		doctrine_freshness: {
			total: doctrine.length,
			fresh: freshnessDocs.fresh,
			review_needed: freshnessDocs.stale,
			unreviewed: freshnessDocs.unknown,
			docs: doctrine.map((doc) => ({
				id: doc.id,
				title: doc.title,
				status: doc.status,
				confidence: doc.confidence,
				reviewed_at: doc.reviewed_at,
				reviewed_commit: doc.reviewed_commit,
				freshness: doc.freshness === "stale" ? "review_needed" : doc.freshness === "unknown" ? "unreviewed" : "fresh",
				reasons: doc.reasons,
			})),
		},
		readme_freshness: readmeFreshness,
		deterministic_actions: deterministicActions,
		ai_actions: aiActions,
		candidates: freshnessCandidates,
	};
}

function printFreshness(report, { output = null } = {}) {
	console.log("📊 pilee knowledge freshness\n");
	console.log(`Base: ${report.base.head_short || "unknown"}  private_history: ${report.base.private_history_available ? "yes" : "no"}`);
	console.log(`Summary: ${report.summary.status}`);
	console.log(`Doctrine: ✅ ${report.doctrine_freshness.fresh} fresh  ⚠️ ${report.doctrine_freshness.review_needed} stale  ❓ ${report.doctrine_freshness.unreviewed} unknown`);
	console.log(`README: ${report.readme.freshness === "fresh" ? "✅ fresh" : "⚠️ stale"}  coverage: ${report.readme.coverage.covered_count}/${report.readme.coverage.total} linked`);
	if (output) console.log(`Report saved: ${output}`);
	console.log("");
	for (const reason of report.readme.reasons.filter((item) => item.type !== "missing_doctrine_link").slice(0, 8)) {
		console.log(`  - [${reason.severity}] ${reason.detail}`);
	}
	if (report.readme.coverage.missing_count > 0) {
		console.log(`  - [coverage] ${report.readme.coverage.missing_count} surface(s) need doctrine links`);
		for (const surface of report.readme.coverage.missing.slice(0, 12)) {
			console.log(`    · ${surface.surface}`);
		}
		if (report.readme.coverage.missing.length > 12) {
			console.log(`    … ${report.readme.coverage.missing.length - 12} more`);
		}
	}
	console.log("");
	if (report.deterministic_actions.length) {
		console.log("Deterministic actions:");
		for (const action of report.deterministic_actions) console.log(`  - ${action.type}: ${action.command || action.file} — ${action.reason}`);
		console.log("");
	}
	if (report.ai_actions.length) {
		console.log("AI/human review actions:");
		for (const action of report.ai_actions.slice(0, 20)) console.log(`  - ${action.doc || action.target}: ${action.reason}`);
		if (report.ai_actions.length > 20) console.log(`  … ${report.ai_actions.length - 20} more`);
		console.log("");
	}
	if (!report.deterministic_actions.length && !report.ai_actions.length) {
		console.log("✅ No freshness actions needed.");
	}
}

function timestampForPath(date = new Date()) {
	return date.toISOString().replace(/[:.]/g, "-");
}

function displayLocalPath(filePath) {
	const home = os.homedir();
	if (filePath === home) return "~";
	if (filePath.startsWith(`${home}${path.sep}`)) return `~/${path.relative(home, filePath)}`;
	return filePath;
}

function markdownEscapeTable(value) {
	return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function reasonText(reason) {
	const evidence = reason?.evidence || {};
	const chunks = [reason?.type, reason?.detail, evidence.commit, evidence.date, ...(evidence.files || []), ...(evidence.matches || [])];
	return chunks.filter(Boolean).join(" ");
}

function reportDocSearchText(reportDoc, doc = null) {
	return [
		reportDoc?.id,
		reportDoc?.title,
		reportDoc?.confidence,
		...(reportDoc?.reasons || []).map(reasonText),
		doc ? titleOf(doc) : "",
		doc ? categoryOf(doc) : "",
		...(doc ? tagsOf(doc) : []),
		...(doc ? appliesToOf(doc) : []),
	].filter(Boolean).join("\n").toLowerCase();
}

function selectResolverDocs(report, docs, { docIds = [], topic = "", limit = 8, all = false } = {}) {
	const docsById = new Map(docs.map((doc) => [doc.id, doc]));
	let candidates = (report.doctrine || [])
		.filter((doc) => doc.freshness !== "fresh")
		.map((reportDoc) => ({ reportDoc, doc: docsById.get(reportDoc.id) || null }));

	if (docIds.length > 0) {
		const requested = new Set(docIds);
		candidates = candidates.filter(({ reportDoc }) => requested.has(reportDoc.id));
	}

	const query = String(topic || "").trim().toLowerCase();
	if (query) {
		const terms = query.split(/\s+/).filter(Boolean);
		candidates = candidates.filter(({ reportDoc, doc }) => {
			const text = reportDocSearchText(reportDoc, doc);
			return terms.every((term) => text.includes(term));
		});
	}

	candidates.sort((a, b) => {
		const confidenceDiff = confidenceRank(a.reportDoc.confidence) - confidenceRank(b.reportDoc.confidence);
		if (confidenceDiff !== 0) return confidenceDiff;
		const reasonDiff = (b.reportDoc.reasons || []).length - (a.reportDoc.reasons || []).length;
		if (reasonDiff !== 0) return reasonDiff;
		return a.reportDoc.id.localeCompare(b.reportDoc.id);
	});

	if (!all && docIds.length === 0) candidates = candidates.slice(0, limit);
	return candidates;
}

function redactPrivateReason(reason) {
	if (!reason || reason.type !== "recent_history") return reason;
	return {
		...reason,
		detail: "local private history evidence found (redacted)",
		evidence: { date: reason.evidence?.date || null, redacted: true },
	};
}

function resolverReasonDisplay(reason) {
	const safeReason = redactPrivateReason(reason) || {};
	const evidence = safeReason.evidence || {};
	const suffix = evidence.commit ? ` (${evidence.commit})` : evidence.date ? ` (${evidence.date})` : "";
	return `${safeReason.type || "reason"}: ${safeReason.detail || ""}${suffix}`;
}

function sanitizeFreshnessReportForArtifact(report) {
	const copy = JSON.parse(JSON.stringify(report));
	const redactReasons = (item) => {
		if (!item || !Array.isArray(item.reasons)) return;
		item.reasons = item.reasons.map(redactPrivateReason);
	};
	for (const item of copy.doctrine || []) redactReasons(item);
	for (const item of copy.doctrine_freshness?.docs || []) redactReasons(item);
	for (const candidate of copy.candidates || []) {
		if (!Array.isArray(candidate.source)) continue;
		candidate.source = candidate.source.map((source) => String(source).startsWith("history:") ? "history:redacted" : source);
	}
	return copy;
}

function resolverTokensForDoc(reportDoc, doc) {
	const tokenSet = new Set(doc ? tokensForDoc(doc) : []);
	for (const reason of reportDoc.reasons || []) {
		if (reason?.type === "recent_history") continue;
		for (const part of reasonText(reason).toLowerCase().split(/[^\p{L}\p{N}_/-]+/u)) {
			const normalized = part.replace(/^[-_/]+|[-_/]+$/g, "");
			if (normalized.length >= 3) tokenSet.add(normalized);
		}
	}
	const noisy = new Set(["chore", "docs", "feat", "fix", "knowledge", "review", "stale", "commit", "github", "workflow", "script", "scripts"]);
	return [...tokenSet]
		.map((token) => token.toLowerCase())
		.filter((token) => token.length >= 3 && !noisy.has(token))
		.slice(0, 24);
}

function listLocalSessionFiles() {
	const root = path.join(os.homedir(), ".pi", "agent", "sessions");
	if (!fs.existsSync(root)) return [];
	const files = [];
	function walk(dir) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "subagents" || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
				walk(full);
				continue;
			}
			if (entry.isFile() && /\.(jsonl|json)$/i.test(entry.name)) files.push(full);
		}
	}
	walk(root);
	return files
		.map((file) => ({ file, stat: fs.statSync(file) }))
		.filter(({ stat }) => stat.size > 0 && stat.size <= 8 * 1024 * 1024)
		.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
		.slice(0, 1200);
}

function buildSessionHints(selectedDocs, { maxPerDoc = 4 } = {}) {
	const sessionFiles = listLocalSessionFiles();
	const tokenMap = new Map(selectedDocs.map(({ reportDoc, doc }) => [reportDoc.id, resolverTokensForDoc(reportDoc, doc)]));
	const hints = new Map(selectedDocs.map(({ reportDoc }) => [reportDoc.id, []]));
	if (sessionFiles.length === 0) return { available: false, scanned: 0, hints };

	for (const { file, stat } of sessionFiles) {
		let content = "";
		try {
			content = fs.readFileSync(file, "utf8").toLowerCase();
		} catch {
			continue;
		}
		for (const { reportDoc } of selectedDocs) {
			const tokens = tokenMap.get(reportDoc.id) || [];
			const matched = tokens.filter((token) => content.includes(token)).slice(0, 10);
			if (matched.length === 0) continue;
			const list = hints.get(reportDoc.id);
			list.push({
				path: displayLocalPath(file),
				mtime: stat.mtime.toISOString(),
				score: matched.length,
				matched,
			});
		}
	}

	for (const [docId, list] of hints) {
		hints.set(docId, list.sort((a, b) => b.score - a.score || b.mtime.localeCompare(a.mtime)).slice(0, maxPerDoc));
	}
	return { available: true, scanned: sessionFiles.length, hints };
}

function renderResolverPlan(report, selectedDocs, sessionHintResult, { outputDir, topic = "", all = false } = {}) {
	const lines = [];
	lines.push("# pilee knowledge stale resolver plan");
	lines.push("");
	lines.push("> Local-only resolver artifact. 이 파일은 `.context/` 아래에 두고 PR에 올리지 않습니다. 로컬 session/private history 근거는 민감할 수 있으므로 공개 PR에는 sanitized 결론만 옮깁니다.");
	lines.push("");
	lines.push("## 목적");
	lines.push("");
	lines.push("GitHub Actions의 review queue PR은 stale 후보만 공개적으로 보여줍니다. 실제 해소는 로컬에서 관련 커밋, 문서, private journal/Pi session 전문을 확인한 뒤 public/sanitized 문서 수정 또는 `--confirm`으로 처리합니다.");
	lines.push("");
	lines.push("## 현재 freshness 요약");
	lines.push("");
	lines.push("| 항목 | 값 |");
	lines.push("|---|---:|");
	lines.push(`| 기준 커밋 | ${report.base.head_short || "unknown"} |`);
	lines.push(`| 전체 상태 | ${report.summary.status} |`);
	lines.push(`| 전체 문서 | ${report.doctrine_freshness.total}개 |`);
	lines.push(`| fresh | ${report.doctrine_freshness.fresh}개 |`);
	lines.push(`| stale / review_needed | ${report.doctrine_freshness.review_needed}개 |`);
	lines.push(`| unreviewed | ${report.doctrine_freshness.unreviewed}개 |`);
	lines.push(`| README coverage | ${report.readme.coverage.covered_count}/${report.readme.coverage.total} |`);
	lines.push(`| deterministic action | ${report.deterministic_actions.length}개 |`);
	lines.push(`| AI/사람 검토 action | ${report.ai_actions.length}개 |`);
	lines.push("");
	lines.push("## 이번 로컬 배치");
	lines.push("");
	lines.push(`- 선택 기준: ${all ? "all stale docs" : topic ? `topic=${topic}` : "top stale docs"}`);
	lines.push(`- 선택 문서: ${selectedDocs.length}개`);
	lines.push(`- 산출물 디렉터리: \`${displayLocalPath(outputDir)}\``);
	lines.push(`- 민감도: local-only. \`freshness.local.json\`은 private history evidence를 포함할 수 있고, \`freshness.public-redacted.json\`은 공유 가능한 redacted 참고용입니다.`);
	lines.push(`- 로컬 session hint: ${sessionHintResult.available ? `${sessionHintResult.scanned}개 session 파일 스캔` : "사용 불가"}`);
	lines.push("");
	lines.push("| 문서 | confidence | reason 수 | 대표 사유 |");
	lines.push("|---|---|---:|---|");
	for (const { reportDoc } of selectedDocs) {
		const firstReason = (reportDoc.reasons || [])[0];
		lines.push(`| \`${reportDoc.id}\` | ${reportDoc.confidence || "high"} | ${(reportDoc.reasons || []).length} | ${markdownEscapeTable(resolverReasonDisplay(firstReason))} |`);
	}
	lines.push("");
	lines.push("## 문서별 검토 카드");
	for (const { reportDoc, doc } of selectedDocs) {
		lines.push("");
		lines.push(`### ${reportDoc.id} — ${reportDoc.title}`);
		lines.push("");
		lines.push(`- 파일: \`docs/knowledge/${reportDoc.id}.md\``);
		lines.push(`- confidence: ${reportDoc.confidence || "high"}`);
		lines.push(`- reviewed_commit: ${reportDoc.reviewed_commit || "missing"}`);
		if (doc) lines.push(`- applies_to: ${appliesToOf(doc).map((item) => `\`${item}\``).join(", ") || "없음"}`);
		lines.push("");
		lines.push("검토 사유:");
		for (const reason of reportDoc.reasons || []) lines.push(`- ${resolverReasonDisplay(reason)}`);
		const hints = sessionHintResult.hints.get(reportDoc.id) || [];
		lines.push("");
		if (hints.length > 0) {
			lines.push("로컬 session hint (경로만 제공, 전문은 plan에 복사하지 않음):");
			for (const hint of hints) lines.push(`- \`${hint.path}\` — score ${hint.score}, tokens: ${hint.matched.join(", ")}`);
		} else {
			lines.push("로컬 session hint: 없음. 커밋/문서 근거만으로 판단하거나 별도 검색이 필요합니다.");
		}
		lines.push("");
		lines.push("판정 기록:");
		lines.push("- [ ] 내용 수정 필요 — public/sanitized 문서로 수정");
		lines.push("- [ ] 내용은 유효 — `node scripts/knowledge.mjs --confirm <doc-id>`");
		lines.push("- [ ] 사용자 판단 필요 — PR/보고서에 보류 사유 기록");
	}
	lines.push("");
	lines.push("## 실제 해소 PR 흐름");
	lines.push("");
	lines.push("1. 로컬 브랜치를 만든다.");
	lines.push("");
	lines.push("```bash");
	lines.push("git switch -c docs/knowledge-resolve-stale-$(date +%Y%m%d)");
	lines.push("```");
	lines.push("");
	lines.push("2. 각 문서를 실제로 검토한다. session hint가 있으면 파일 전문을 읽고, 없으면 관련 커밋과 적용 파일을 확인한다.");
	lines.push("3. 문서 내용이 현재 판단과 다르면 수정한다. 여전히 맞으면 `--confirm <doc-id>`만 실행한다. confidence 승격은 사용자/AI 검토 근거가 있을 때만 `--confidence high`를 붙인다.");
	lines.push("4. 검증한다.");
	lines.push("");
	lines.push("```bash");
	lines.push("node scripts/knowledge.mjs --graph");
	lines.push("node scripts/knowledge.mjs --validate");
	lines.push("node scripts/knowledge.mjs --freshness");
	lines.push("```");
	lines.push("");
	lines.push("5. 커밋하고 PR을 만든다. PR에는 수정/confirm-only/보류 문서를 구분해 적는다.");
	lines.push("");
	lines.push("```bash");
	lines.push("git add docs/knowledge README.md");
	lines.push("git commit -m \"docs: resolve pilee knowledge stale batch\"");
	lines.push("git push -u origin HEAD");
	lines.push(`gh pr create --title "docs: pilee knowledge stale 해소" --body-file "${path.join(outputDir, "pr-body.md")}"`);
	lines.push("```");
	lines.push("");
	return `${lines.join("\n")}\n`;
}

function renderResolverPrompt(selectedDocs, outputDir) {
	const ids = selectedDocs.map(({ reportDoc }) => reportDoc.id);
	return `pilee knowledge stale을 로컬 맥락으로 실제 해소해줘.

Resolver plan: ${displayLocalPath(path.join(outputDir, "resolve-plan.md"))}
Local freshness JSON: ${displayLocalPath(path.join(outputDir, "freshness.local.json"))} (local-only, 공유 금지)
Redacted freshness JSON: ${displayLocalPath(path.join(outputDir, "freshness.public-redacted.json"))}
대상 문서: ${ids.join(", ")}

절차:
1. plan의 문서별 검토 카드를 읽는다.
2. 관련 docs/knowledge 문서, 커밋 diff, 필요한 경우 로컬 Pi session hint의 전문을 확인한다.
3. 각 문서를 다음 중 하나로 판정한다: 내용 수정 / confirm-only / 사용자 판단 필요.
4. private journal/session 원문, 로컬 session 경로, private history 제목은 공개 문서나 PR body에 복사하지 말고 sanitized judgment만 남긴다.
5. 수정 또는 \`node scripts/knowledge.mjs --confirm <doc-id>\`로 stale을 해소한다.
6. \`node scripts/knowledge.mjs --graph && node scripts/knowledge.mjs --validate && node scripts/knowledge.mjs --freshness\`로 검증한다.
7. 로컬 브랜치에 커밋하고 실제 update PR을 만든다. PR에는 수정/confirm-only/보류를 구분해 적는다.
`;
}

function renderResolverPrBody(selectedDocs) {
	const ids = selectedDocs.map(({ reportDoc }) => `- [ ] ${reportDoc.id}`).join("\n");
	return `## 개요
로컬 knowledge resolver로 stale/review_needed 문서를 실제 검토해 해소합니다.

<이번 PR의 의미를 1-2문장으로 설명합니다. 예: public/private split 이후 핵심 boundary doctrine을 갱신합니다.>

## 대상 문서
${ids}

## 해소 결과

### 내용 수정
- 없음

### confirm-only
- 없음

### 사용자 판단 필요/보류
- 없음

## Privacy
- \`.context/knowledge-resolver/...\` 산출물은 PR에 포함하지 않았습니다.
- \`freshness.local.json\`, session hint, private history 원문/제목은 PR body와 public docs에 복사하지 않았습니다.
- PR에는 sanitized 판단과 문서 수정 결과만 포함했습니다.

## 검증
- [ ] \`npm run knowledge:validate\`
- [ ] \`npm run knowledge:graph -- --check\`
- [ ] \`node scripts/knowledge.mjs --freshness --json\`
- [ ] \`git diff --check\`

## Freshness
이 PR은 선택된 ${selectedDocs.length}개 문서를 fresh로 전환합니다. 전체 freshness는 남은 batch가 있으면 아직 stale일 수 있습니다.

## Merge policy
stale resolver PR입니다. 사용자가 명시적으로 auto-merge/merge를 허용한 경우에만 병합합니다.
`;
}

function appendResolverRunLog({ outputDir, report, selectedDocs, sessionHintResult, options }) {
	fs.mkdirSync(RESOLVER_DIR, { recursive: true });
	const entry = {
		created_at: new Date().toISOString(),
		base: report.base.head_short || report.base.head || "unknown",
		output_dir: displayLocalPath(outputDir),
		counts: {
			total: report.doctrine_freshness.total,
			fresh: report.doctrine_freshness.fresh,
			review_needed: report.doctrine_freshness.review_needed,
			unreviewed: report.doctrine_freshness.unreviewed,
		},
		selected_docs: selectedDocs.map(({ reportDoc }) => ({
			id: reportDoc.id,
			title: reportDoc.title,
			confidence: reportDoc.confidence || "high",
			reason_count: (reportDoc.reasons || []).length,
		})),
		options: {
			since_days: options.sinceDays,
			doc_ids: options.docIds,
			topic: options.topic,
			limit: options.limit,
			all: options.all,
			session_hints: options.sessionHints,
		},
		session_hints: {
			enabled: options.sessionHints,
			scanned: sessionHintResult.scanned || 0,
			per_doc_counts: Object.fromEntries(selectedDocs.map(({ reportDoc }) => [reportDoc.id, (sessionHintResult.hints.get(reportDoc.id) || []).length])),
		},
		privacy: "local-only log; no session paths or private history text stored",
	};
	fs.appendFileSync(RESOLVER_RUNS_LOG, `${JSON.stringify(entry)}\n`);
	return entry;
}

function readResolverRunLog() {
	if (!fs.existsSync(RESOLVER_RUNS_LOG)) return [];
	return fs.readFileSync(RESOLVER_RUNS_LOG, "utf8")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			try { return JSON.parse(line); }
			catch { return null; }
		})
		.filter(Boolean);
}

function cmdResolverLog({ limit = 10, json = false } = {}) {
	const entries = readResolverRunLog().reverse().slice(0, limit);
	if (json) {
		console.log(JSON.stringify({ log_path: displayLocalPath(RESOLVER_RUNS_LOG), entries }, null, 2));
		return 0;
	}
	console.log("📚 pilee knowledge resolver local runs\n");
	console.log(`Log: ${displayLocalPath(RESOLVER_RUNS_LOG)}`);
	console.log("Privacy: local-only summary log. Raw session paths/private text are not stored here.\n");
	if (entries.length === 0) {
		console.log("No resolver runs found.");
		return 0;
	}
	for (const entry of entries) {
		console.log(`- ${entry.created_at}  base=${entry.base}  docs=${entry.selected_docs.length}  output=${entry.output_dir}`);
		console.log(`  selected: ${entry.selected_docs.map((doc) => doc.id).join(", ")}`);
		console.log(`  counts: fresh ${entry.counts.fresh} / review_needed ${entry.counts.review_needed} / unreviewed ${entry.counts.unreviewed}`);
	}
	return 0;
}

function cmdResolveStale({ sinceDays = 14, docIds = [], topic = "", limit = 8, all = false, output = null, sessionHints = true } = {}) {
	const docs = loadDocs();
	const report = buildFreshnessReport({ sinceDays });
	const selectedDocs = selectResolverDocs(report, docs, { docIds, topic, limit, all });
	const outputDir = path.resolve(REPO_ROOT, output || path.join(RESOLVER_DIR, timestampForPath()));
	fs.mkdirSync(outputDir, { recursive: true });
	fs.writeFileSync(path.join(outputDir, "freshness.local.json"), `${JSON.stringify(report, null, 2)}\n`);
	fs.writeFileSync(path.join(outputDir, "freshness.public-redacted.json"), `${JSON.stringify(sanitizeFreshnessReportForArtifact(report), null, 2)}\n`);

	const sessionHintResult = sessionHints ? buildSessionHints(selectedDocs) : { available: false, scanned: 0, hints: new Map(selectedDocs.map(({ reportDoc }) => [reportDoc.id, []])) };
	fs.writeFileSync(path.join(outputDir, "resolve-plan.md"), renderResolverPlan(report, selectedDocs, sessionHintResult, { outputDir, topic, all }));
	fs.writeFileSync(path.join(outputDir, "prompt.md"), renderResolverPrompt(selectedDocs, outputDir));
	fs.writeFileSync(path.join(outputDir, "pr-body.md"), renderResolverPrBody(selectedDocs));
	appendResolverRunLog({ outputDir, report, selectedDocs, sessionHintResult, options: { sinceDays, docIds, topic, limit, all, sessionHints } });

	console.log("🧭 pilee knowledge local resolver plan");
	console.log("");
	console.log(`Selected docs: ${selectedDocs.length}`);
	console.log(`Output dir: ${displayLocalPath(outputDir)}`);
	console.log(`Plan: ${displayLocalPath(path.join(outputDir, "resolve-plan.md"))}`);
	console.log(`Local freshness JSON: ${displayLocalPath(path.join(outputDir, "freshness.local.json"))}`);
	console.log(`Redacted freshness JSON: ${displayLocalPath(path.join(outputDir, "freshness.public-redacted.json"))}`);
	console.log(`Prompt: ${displayLocalPath(path.join(outputDir, "prompt.md"))}`);
	console.log(`PR body template: ${displayLocalPath(path.join(outputDir, "pr-body.md"))}`);
	if (sessionHints) console.log(`Session hints: ${sessionHintResult.available ? `${sessionHintResult.scanned} files scanned` : "not available"}`);
	console.log("");
	console.log(`Local run log: ${displayLocalPath(RESOLVER_RUNS_LOG)}`);
	console.log("Privacy: resolver artifacts are local-only; do not attach freshness.local.json or session paths to public PRs.");
	console.log("Next: read prompt.md or run `/ember resolve` to let Pi review docs, update/confirm, and create the actual PR. Use `node scripts/knowledge.mjs --resolver-log` to view local runs.");
	return 0;
}

function readOption(name, fallback = null) {
	const idx = args.indexOf(name);
	if (idx < 0) return fallback;
	return args[idx + 1] ?? fallback;
}

function readOptions(name) {
	const values = [];
	for (let i = 0; i < args.length; i += 1) {
		if (args[i] !== name) continue;
		const value = args[i + 1];
		if (!value || value.startsWith("--")) continue;
		values.push(...value.split(",").map((item) => item.trim()).filter(Boolean));
	}
	return values;
}

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
	printHelp();
	process.exit(0);
}

if (args.includes("--validate")) {
	process.exit(cmdValidate() > 0 ? 1 : 0);
}

if (args.includes("--graph")) {
	process.exit(cmdGraph({ check: args.includes("--check") }));
}

if (args.includes("--freshness")) {
	const sinceDays = Number(readOption("--since-days", "14"));
	process.exit(cmdFreshness({
		sinceDays: Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : 14,
		json: args.includes("--json"),
		strict: args.includes("--strict"),
		output: readOption("--output", null),
	}));
}

if (args.includes("--resolve-stale")) {
	const sinceDays = Number(readOption("--since-days", "14"));
	const limit = Number(readOption("--limit", "8"));
	process.exit(cmdResolveStale({
		sinceDays: Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : 14,
		docIds: readOptions("--doc"),
		topic: readOption("--topic", ""),
		limit: Number.isFinite(limit) && limit > 0 ? limit : 8,
		all: args.includes("--all"),
		output: readOption("--output", null),
		sessionHints: !args.includes("--no-session-hints"),
	}));
}

if (args.includes("--resolver-log")) {
	const limit = Number(readOption("--limit", "10"));
	process.exit(cmdResolverLog({
		limit: Number.isFinite(limit) && limit > 0 ? limit : 10,
		json: args.includes("--json"),
	}));
}

if (args.includes("--confirm") || args.includes("--review")) {
	const flag = args.includes("--confirm") ? "--confirm" : "--review";
	const docId = readOption(flag);
	if (!docId) {
		console.error(`${flag} requires a document id.`);
		process.exit(1);
	}
	cmdConfirm(docId, readOption("--date", today()), readOption("--confidence", null));
	process.exit(0);
}

if (args.includes("--review-candidates") || args.includes("--stale")) {
	const sinceDays = Number(readOption("--since-days", "14"));
	process.exit(cmdReviewCandidates({
		sinceDays: Number.isFinite(sinceDays) && sinceDays > 0 ? sinceDays : 14,
		json: args.includes("--json"),
		strict: args.includes("--strict"),
	}));
}

cmdQuery(args.join(" "));
