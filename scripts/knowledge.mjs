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
const GRAPH_START = "<!-- PILEE_KNOWLEDGE_GRAPH_START -->";
const GRAPH_END = "<!-- PILEE_KNOWLEDGE_GRAPH_END -->";
const ROOT_LINKS_START = "<!-- PILEE_ROOT_KNOWLEDGE_LINKS_START -->";
const ROOT_LINKS_END = "<!-- PILEE_ROOT_KNOWLEDGE_LINKS_END -->";
const VALID_STATUSES = new Set(["active", "experimental", "deprecated", "draft"]);
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
  node scripts/knowledge.mjs --confirm <doc-id> [--date YYYY-MM-DD]
                                                        Update reviewed_at + reviewed_commit after human/AI review

Report options:
  --since-days <n>   Fallback lookback when reviewed_commit is missing (default: 14)
  --json             Emit JSON instead of Markdown
  --strict           Exit non-zero when freshness/review issues are found

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
	const knowledgeExpected = renderKnowledgeReadme(docs);
	const knowledgeCurrent = fs.existsSync(KNOWLEDGE_README_PATH) ? readText(KNOWLEDGE_README_PATH) : "";
	const rootExpected = renderRootReadme(docs);
	const rootCurrent = fs.existsSync(ROOT_README_PATH) ? readText(ROOT_README_PATH) : "";
	const extensionCount = countTopLevelDirs("extensions");
	const skillCount = countTopLevelDirs("skills");
	const declaredExtensionCount = extractDeclaredCount(rootCurrent, "Extensions");
	const declaredSkillCount = extractDeclaredCount(rootCurrent, "Skills");

	if (!knowledgeCurrent) issues.push(`README missing: ${rel(KNOWLEDGE_README_PATH)}`);
	else if (knowledgeCurrent !== knowledgeExpected) issues.push("docs/knowledge/README.md generated graph is stale. Run `node scripts/knowledge.mjs --graph`.");
	if (!rootCurrent) issues.push(`README missing: ${rel(ROOT_README_PATH)}`);
	else if (rootCurrent !== rootExpected) issues.push("README.md knowledge link block is stale. Run `node scripts/knowledge.mjs --graph`.");
	if (declaredExtensionCount !== null && declaredExtensionCount !== extensionCount) {
		issues.push(`README.md Extensions count is stale: declared ${declaredExtensionCount}, actual ${extensionCount}.`);
	}
	if (declaredSkillCount !== null && declaredSkillCount !== skillCount) {
		issues.push(`README.md Skills count is stale: declared ${declaredSkillCount}, actual ${skillCount}.`);
	}

	return {
		knowledge_readme: {
			path: rel(KNOWLEDGE_README_PATH),
			fresh: !!knowledgeCurrent && knowledgeCurrent === knowledgeExpected,
		},
		root_readme: {
			path: rel(ROOT_README_PATH),
			knowledge_links_fresh: !!rootCurrent && rootCurrent === rootExpected,
			extension_count: extensionCount,
			declared_extension_count: declaredExtensionCount,
			extension_count_fresh: declaredExtensionCount === null || declaredExtensionCount === extensionCount,
			skill_count: skillCount,
			declared_skill_count: declaredSkillCount,
			skill_count_fresh: declaredSkillCount === null || declaredSkillCount === skillCount,
		},
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
		lines.push("| Topic | Status | Reviewed | Commit | Tags |");
		lines.push("|---|---|---:|---:|---|");
		for (const doc of categoryDocs) {
			const tags = tagsOf(doc).slice(0, 6).join(", ");
			lines.push(`| [${escapeTable(titleOf(doc))}](./${doc.id}.md) | ${statusOf(doc)} | ${reviewedAtOf(doc)} | ${shortHash(reviewedCommitOf(doc))} | ${escapeTable(tags)} |`);
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

function buildRootKnowledgeLinksSection(docs) {
	const surfaceMap = new Map();
	for (const doc of docs) {
		for (const target of appliesToOf(doc)) {
			const surface = normalizeSurface(target);
			if (!surface) continue;
			if (!surfaceMap.has(surface)) surfaceMap.set(surface, []);
			surfaceMap.get(surface).push(doc);
		}
	}

	const lines = [];
	lines.push(`> Generated by \`node scripts/knowledge.mjs --graph\`. Do not edit this block manually.`);
	lines.push("");
	lines.push("| Surface | Knowledge docs |");
	lines.push("|---|---|");
	for (const [surface, surfaceDocs] of [...surfaceMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
		const uniqueDocs = [...new Map(surfaceDocs.map((doc) => [doc.id, doc])).values()].sort((a, b) => a.id.localeCompare(b.id));
		const links = uniqueDocs.map((doc) => `[${escapeTable(titleOf(doc))}](./docs/knowledge/${doc.id}.md)`).join("<br>");
		lines.push(`| \`${escapeTable(surface)}\` | ${links} |`);
	}
	if (surfaceMap.size === 0) lines.push("| _none_ | _no applies_to surface links yet_ |");
	return lines.join("\n");
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
	if (check) {
		const stale = [];
		if (currentKnowledge !== nextKnowledge) stale.push(rel(KNOWLEDGE_README_PATH));
		if (currentRoot !== nextRoot) stale.push(rel(ROOT_README_PATH));
		if (stale.length === 0) {
			console.log("✅ knowledge generated README blocks are up to date.");
			return 0;
		}
		console.log(`❌ Generated README block(s) stale: ${stale.join(", ")}. Run \`node scripts/knowledge.mjs --graph\`.`);
		return 1;
	}
	fs.writeFileSync(KNOWLEDGE_README_PATH, nextKnowledge);
	if (nextRoot) fs.writeFileSync(ROOT_README_PATH, nextRoot);
	console.log(`💾 Updated ${rel(KNOWLEDGE_README_PATH)}`);
	if (nextRoot) console.log(`💾 Updated ${rel(ROOT_README_PATH)}`);
	return 0;
}

function cmdConfirm(docId, date = today()) {
	const doc = getDoc(docId);
	if (!doc) {
		console.error(`❌ Document not found: ${docId}`);
		process.exit(1);
	}
	if (!isDate(date)) {
		console.error(`❌ --date must be YYYY-MM-DD: ${date}`);
		process.exit(1);
	}

	const commit = headCommit();
	const fm = { ...doc.frontmatter, reviewed_at: date, reviewed_commit: commit };
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
	return file === "docs/knowledge/README.md" || /^docs\/knowledge\/[^/]+\.md$/.test(file);
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

function cmdFreshness({ sinceDays = 14, json = false, strict = false } = {}) {
	const docs = loadDocs();
	const candidates = buildReviewCandidates({ sinceDays });
	const candidateIds = new Set(candidates.map((candidate) => candidate.id));
	const readmeFreshness = inspectReadmeFreshness(docs);
	const doctrineDocs = docs.map((doc) => {
		const reviewedCommit = reviewedCommitOf(doc);
		const validCommit = commitExists(reviewedCommit);
		return {
			id: doc.id,
			title: titleOf(doc),
			status: statusOf(doc),
			reviewed_at: reviewedAtOf(doc),
			reviewed_commit: reviewedCommit || null,
			freshness: !validCommit ? "unreviewed" : candidateIds.has(doc.id) ? "review_needed" : "fresh",
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
	const aiActions = candidates.map((candidate) => ({
		type: "review-doctrine",
		doc: candidate.id,
		reason: candidate.reviewed_commit_valid ? "related commit/history evidence found" : "reviewed_commit missing or invalid",
	}));
	const report = {
		generatedAt: new Date().toISOString(),
		doctrine_freshness: {
			total: doctrineDocs.length,
			fresh: doctrineDocs.filter((doc) => doc.freshness === "fresh").length,
			review_needed: doctrineDocs.filter((doc) => doc.freshness === "review_needed").length,
			unreviewed: doctrineDocs.filter((doc) => doc.freshness === "unreviewed").length,
			docs: doctrineDocs,
		},
		readme_freshness: readmeFreshness,
		deterministic_actions: deterministicActions,
		ai_actions: aiActions,
		candidates,
	};

	if (json) console.log(JSON.stringify(report, null, 2));
	else printFreshness(report);

	if (strict && (deterministicActions.length > 0 || aiActions.length > 0 || readmeFreshness.issues.length > 0)) return 1;
	return 0;
}

function printFreshness(report) {
	console.log("📊 pilee knowledge freshness\n");
	console.log(`Doctrine: ✅ ${report.doctrine_freshness.fresh} fresh  ⚠️ ${report.doctrine_freshness.review_needed} review_needed  ❓ ${report.doctrine_freshness.unreviewed} unreviewed`);
	console.log(`README: ${report.readme_freshness.issues.length === 0 ? "✅ fresh" : "⚠️ stale"}`);
	for (const issue of report.readme_freshness.issues) console.log(`  - ${issue}`);
	console.log("");
	if (report.deterministic_actions.length) {
		console.log("Deterministic actions:");
		for (const action of report.deterministic_actions) console.log(`  - ${action.type}: ${action.command || action.file} — ${action.reason}`);
		console.log("");
	}
	if (report.ai_actions.length) {
		console.log("AI/human review actions:");
		for (const action of report.ai_actions) console.log(`  - ${action.doc}: ${action.reason}`);
		console.log("");
	}
	if (!report.deterministic_actions.length && !report.ai_actions.length) {
		console.log("✅ No freshness actions needed.");
	}
}

function readOption(name, fallback = null) {
	const idx = args.indexOf(name);
	if (idx < 0) return fallback;
	return args[idx + 1] ?? fallback;
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
	}));
}

if (args.includes("--confirm") || args.includes("--review")) {
	const flag = args.includes("--confirm") ? "--confirm" : "--review";
	const docId = readOption(flag);
	if (!docId) {
		console.error(`${flag} requires a document id.`);
		process.exit(1);
	}
	cmdConfirm(docId, readOption("--date", today()));
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
