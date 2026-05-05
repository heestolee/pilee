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
const README_PATH = path.join(KNOWLEDGE_DIR, "README.md");
const GRAPH_START = "<!-- PILEE_KNOWLEDGE_GRAPH_START -->";
const GRAPH_END = "<!-- PILEE_KNOWLEDGE_GRAPH_END -->";
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

function today() {
	return new Date().toISOString().slice(0, 10);
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

function printHelp() {
	console.log(`
🔥 pilee Knowledge CLI

Usage:
  node scripts/knowledge.mjs --help
  node scripts/knowledge.mjs <keywords>                  Search public knowledge docs
  node scripts/knowledge.mjs --validate                  Validate metadata, links, and README graph
  node scripts/knowledge.mjs --graph [--check]           Regenerate docs/knowledge/README.md graph, or fail if stale
  node scripts/knowledge.mjs --review-candidates [opts]  Find docs likely needing review from commits/local history
  node scripts/knowledge.mjs --confirm <doc-id> [--date YYYY-MM-DD]
                                                        Update reviewed_at after human/AI review

Review candidate options:
  --since-days <n>   Fallback lookback when reviewed_at is missing (default: 14)
  --json             Emit JSON instead of Markdown
  --strict           Exit non-zero when candidates are found

Notes:
  - Private journal entries should stay in docs/pilee-history.md or Notion.
  - Knowledge docs must be public/sanitized and describe currently valid decisions.
  - README's Knowledge Map is generated between ${GRAPH_START} and ${GRAPH_END}.
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
	console.log(`   Status: ${statusOf(doc) || "unknown"}  Reviewed: ${reviewedAtOf(doc) || "unknown"}`);
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
		const expected = renderReadme(loadDocs());
		if (!fs.existsSync(README_PATH)) {
			console.log(`❌ README missing: ${rel(README_PATH)}`);
			issues++;
		} else if (readText(README_PATH) !== expected) {
			console.log("❌ docs/knowledge/README.md generated graph is stale. Run `node scripts/knowledge.mjs --graph`.");
			issues++;
		}
	}

	if (issues === 0) console.log("✅ No issues found.");
	else console.log(`\n🔴 ${issues} issue(s) found.`);

	return issues;
}

function renderReadme(docs) {
	const existing = fs.existsSync(README_PATH) ? readText(README_PATH) : defaultReadme();
	const generated = buildGeneratedSection(docs);
	if (existing.includes(GRAPH_START) && existing.includes(GRAPH_END)) {
		return existing.replace(
			new RegExp(`${escapeRegex(GRAPH_START)}[\\s\\S]*?${escapeRegex(GRAPH_END)}`),
			`${GRAPH_START}\n${generated}\n${GRAPH_END}`,
		);
	}
	return `${existing.trim()}\n\n${GRAPH_START}\n${generated}\n${GRAPH_END}\n`;
}

function defaultReadme() {
	return `# pilee Knowledge\n\nPublic, sanitized knowledge extracted from private pilee history.\n`;
}

function buildGeneratedSection(docs) {
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
		lines.push("| Topic | Status | Reviewed | Tags |");
		lines.push("|---|---|---:|---|");
		for (const doc of categoryDocs) {
			const tags = tagsOf(doc).slice(0, 6).join(", ");
			lines.push(`| [${escapeTable(titleOf(doc))}](./${doc.id}.md) | ${statusOf(doc)} | ${reviewedAtOf(doc)} | ${escapeTable(tags)} |`);
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

function cmdGraph({ check = false } = {}) {
	const next = renderReadme(loadDocs());
	const current = fs.existsSync(README_PATH) ? readText(README_PATH) : "";
	if (check) {
		if (current === next) {
			console.log("✅ docs/knowledge/README.md graph is up to date.");
			return 0;
		}
		console.log("❌ docs/knowledge/README.md graph is stale. Run `node scripts/knowledge.mjs --graph`.");
		return 1;
	}
	fs.writeFileSync(README_PATH, next);
	console.log(`💾 Updated ${rel(README_PATH)}`);
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

	const fm = { ...doc.frontmatter, reviewed_at: date };
	delete fm.__parseError;
	const nextFrontmatter = stringifyFrontmatter(fm);
	const nextContent = `---\n${nextFrontmatter}---\n\n${doc.body.trim()}\n`;
	fs.writeFileSync(doc.filePath, nextContent);
	console.log(`✅ ${doc.id}: reviewed_at updated to ${date}`);
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
	const docs = loadDocs();
	const fallbackDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 10);
	const gitCommits = readGitCommitsSince(fallbackDate);
	const historyEntries = readHistoryEntries();
	const candidates = [];

	for (const doc of docs) {
		const since = reviewedAtOf(doc) || fallbackDate;
		const tokens = tokensForDoc(doc);
		const commitEvidence = gitCommits
			.filter((commit) => commit.date > since)
			.map((commit) => ({ commit, matches: matchingTokens(tokens, `${commit.subject}\n${commit.files.join("\n")}`) }))
			.filter((item) => item.matches.length > 0)
			.slice(0, 8);
		const historyEvidence = historyEntries
			.filter((entry) => entry.date > since)
			.map((entry) => ({ entry, matches: matchingTokens(tokens, entry.text) }))
			.filter((item) => item.matches.length > 0)
			.slice(0, 8);

		if (commitEvidence.length || historyEvidence.length) {
			candidates.push({
				id: doc.id,
				title: titleOf(doc),
				category: categoryOf(doc),
				status: statusOf(doc),
				reviewed_at: since,
				commitEvidence: commitEvidence.map(({ commit, matches }) => ({
					hash: commit.hash.slice(0, 7),
					date: commit.date,
					subject: commit.subject,
					files: commit.files.slice(0, 6),
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

	if (json) {
		console.log(JSON.stringify({ generatedAt: new Date().toISOString(), candidates }, null, 2));
	} else {
		printReviewCandidates(candidates, { historyAvailable: fs.existsSync(path.join(REPO_ROOT, "docs", "pilee-history.md")) });
	}

	if (strict && candidates.length > 0) return 1;
	return 0;
}

function readGitCommitsSince(date) {
	try {
		const output = execFileSync(
			"git",
			[
				"log",
				`--since=${date} 00:00:00`,
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
		console.log(`   reviewed_at: ${candidate.reviewed_at}  status: ${candidate.status}`);
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
