import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const PR_REVIEW_CORPUS_SCHEMA_VERSION = 1;

export type CorpusCaseKind = "strong" | "partial" | "counterexample";
export type CorpusLane = "supporting" | "contrasting" | "cross-repo";

export interface CorpusEvent {
	schemaVersion: 1;
	id: string;
	repo: string;
	prNumber?: number;
	prTitle?: string;
	prUrl?: string;
	prAuthor?: string;
	reviewer?: string;
	date?: string;
	kind?: string;
	state?: string;
	path?: string;
	line?: string | number;
	url?: string;
	excerpt?: string;
	isEmpty: boolean;
	isTrivial: boolean;
	annotationStatus: "human-source";
}

export interface CorpusCase {
	schemaVersion: 1;
	id: string;
	repo: string;
	kind: CorpusCaseKind;
	lane: "supporting" | "contrasting";
	label: string;
	summary: string;
	url: string;
	urls: string[];
	annotationStatus: "machine-draft";
}

export interface CorpusManifest {
	schemaVersion: 1;
	id: string;
	createdAt: number;
	eventCount: number;
	meaningfulEventCount: number;
	caseCount: number;
	eventsSha256: string;
	casesSha256: string;
	source: {
		events: string;
		casebook?: string;
	};
}

export interface CorpusSearchConfig {
	id: string;
	corpusDir: string;
	repositories?: string[];
}

export interface CorpusSearchHit {
	id: string;
	source: "event" | "case";
	repo: string;
	lane: CorpusLane;
	label: string;
	url?: string;
	excerpt: string;
	path?: string;
	reviewer?: string;
	date?: string;
	annotationStatus: "human-source" | "machine-draft";
	matchedTerms: string[];
	score: number;
}

export interface CorpusSearchResult {
	corpusId: string;
	query: string;
	supporting: CorpusSearchHit[];
	contrasting: CorpusSearchHit[];
	crossRepo: CorpusSearchHit[];
	coverage: {
		events: number;
		cases: number;
		ftsCandidates: number;
	};
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function stableId(prefix: string, value: string): string {
	return `${prefix}-${sha256(value).slice(0, 20)}`;
}

function writeJsonl(path: string, values: unknown[]): string {
	const text = values.map((value) => JSON.stringify(value)).join("\n") + (values.length ? "\n" : "");
	writeFileSync(path, text, "utf8");
	return text;
}

function normalizeEvent(raw: Record<string, unknown>): CorpusEvent {
	const url = String(raw.url || raw.pr_url || "");
	const identity = url || [raw.repo, raw.pr_number, raw.reviewer, raw.date, raw.kind, raw.excerpt].join(":");
	return {
		schemaVersion: 1,
		id: stableId("event", identity),
		repo: String(raw.repo || "unknown"),
		prNumber: Number.isFinite(Number(raw.pr_number)) ? Number(raw.pr_number) : undefined,
		prTitle: typeof raw.pr_title === "string" ? raw.pr_title : undefined,
		prUrl: typeof raw.pr_url === "string" ? raw.pr_url : undefined,
		prAuthor: typeof raw.pr_author === "string" ? raw.pr_author : undefined,
		reviewer: typeof raw.reviewer === "string" ? raw.reviewer : undefined,
		date: typeof raw.date === "string" ? raw.date : undefined,
		kind: typeof raw.kind === "string" ? raw.kind : undefined,
		state: typeof raw.state === "string" ? raw.state : undefined,
		path: typeof raw.path === "string" ? raw.path : undefined,
		line: typeof raw.line === "string" || typeof raw.line === "number" ? raw.line : undefined,
		url: url || undefined,
		excerpt: typeof raw.excerpt === "string" ? raw.excerpt : undefined,
		isEmpty: raw.is_empty === true || raw.isEmpty === true,
		isTrivial: raw.is_trivial === true || raw.isTrivial === true,
		annotationStatus: "human-source",
	};
}

function stripMarkdown(value: string): string {
	return value
		.replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
		.replace(/[*_`>#]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function githubUrls(value: string): string[] {
	return [...value.matchAll(/\((https:\/\/github\.com\/[^)\s]+)\)/g)].map((match) => match[1]!);
}

function preferredReviewUrl(urls: string[]): string | undefined {
	return urls.find((url) => /#(?:discussion_|pullrequestreview-|issuecomment-)/.test(url)) ?? urls[0];
}

function caseFromText(repo: string, kind: CorpusCaseKind, label: string, text: string): CorpusCase | undefined {
	const urls = [...new Set(githubUrls(text))];
	const url = preferredReviewUrl(urls);
	if (!url) return undefined;
	const summary = stripMarkdown(text.replace(/^\|?|\|?$/g, "").replace(/\|/g, " · "));
	return {
		schemaVersion: 1,
		id: stableId("case", `${repo}:${kind}:${url}:${summary}`),
		repo: repo.toLowerCase(),
		kind,
		lane: kind === "counterexample" ? "contrasting" : "supporting",
		label: stripMarkdown(label) || `${repo} ${kind}`,
		summary,
		url,
		urls,
		annotationStatus: "machine-draft",
	};
}

export function parseCasebook(markdown: string): CorpusCase[] {
	const lines = markdown.split(/\r?\n/);
	const cases: CorpusCase[] = [];
	let repo = "unknown";
	let kind: CorpusCaseKind | undefined;
	let headingBuffer: { repo: string; kind: CorpusCaseKind; label: string; lines: string[] } | undefined;
	const flushHeading = () => {
		if (!headingBuffer) return;
		const value = caseFromText(headingBuffer.repo, headingBuffer.kind, headingBuffer.label, [headingBuffer.label, ...headingBuffer.lines].join("\n"));
		if (value) cases.push(value);
		headingBuffer = undefined;
	};

	for (const line of lines) {
		const repoHeading = line.match(/^## (Product|Frontend|Backend)\s*$/i);
		if (repoHeading) {
			flushHeading();
			repo = repoHeading[1]!.toLowerCase();
			kind = undefined;
			continue;
		}
		if (/^## \d+\. 강한 메타 리뷰 사례/.test(line)) {
			flushHeading();
			kind = "strong";
			continue;
		}
		if (/^## \d+\. 부분적 메타 리뷰 사례/.test(line)) {
			flushHeading();
			kind = "partial";
			continue;
		}
		if (/^## \d+\. 시스템화하면 과한 반례/.test(line)) {
			flushHeading();
			kind = "counterexample";
			continue;
		}
		if (line.startsWith("## ")) {
			flushHeading();
			kind = undefined;
			continue;
		}
		if (kind === "counterexample" && line.startsWith("### ")) {
			flushHeading();
			headingBuffer = { repo, kind, label: line.replace(/^###\s+/, ""), lines: [] };
			continue;
		}
		if (headingBuffer) {
			headingBuffer.lines.push(line);
			continue;
		}
		if (!kind || !line.startsWith("|") || /^\|[-:| ]+\|$/.test(line) || !line.includes("https://github.com/")) continue;
		const firstCell = line.split("|")[1] ?? `${repo} ${kind}`;
		const value = caseFromText(repo, kind, firstCell, line);
		if (value) cases.push(value);
	}
	flushHeading();
	return [...new Map(cases.map((value) => [value.id, value])).values()];
}

function createIndex(indexPath: string, events: CorpusEvent[], cases: CorpusCase[]): void {
	if (existsSync(indexPath)) rmSync(indexPath);
	const db = new DatabaseSync(indexPath);
	try {
		db.exec(`
			PRAGMA journal_mode = WAL;
			CREATE TABLE events (id TEXT PRIMARY KEY, json TEXT NOT NULL);
			CREATE TABLE cases (id TEXT PRIMARY KEY, json TEXT NOT NULL);
			CREATE VIRTUAL TABLE event_fts USING fts5(id UNINDEXED, repo, title, path, excerpt, reviewer, tokenize='unicode61');
			CREATE VIRTUAL TABLE case_fts USING fts5(id UNINDEXED, repo, label, summary, kind UNINDEXED, lane UNINDEXED, tokenize='unicode61');
		`);
		const insertEvent = db.prepare("INSERT INTO events(id, json) VALUES (?, ?)");
		const insertEventFts = db.prepare("INSERT INTO event_fts(id, repo, title, path, excerpt, reviewer) VALUES (?, ?, ?, ?, ?, ?)");
		const insertCase = db.prepare("INSERT INTO cases(id, json) VALUES (?, ?)");
		const insertCaseFts = db.prepare("INSERT INTO case_fts(id, repo, label, summary, kind, lane) VALUES (?, ?, ?, ?, ?, ?)");
		db.exec("BEGIN");
		for (const event of events) {
			insertEvent.run(event.id, JSON.stringify(event));
			if (!event.isEmpty && !event.isTrivial) insertEventFts.run(event.id, event.repo, event.prTitle ?? "", event.path ?? "", event.excerpt ?? "", event.reviewer ?? "");
		}
		for (const item of cases) {
			insertCase.run(item.id, JSON.stringify(item));
			insertCaseFts.run(item.id, item.repo, item.label, item.summary, item.kind, item.lane);
		}
		db.exec("COMMIT");
	} catch (error) {
		try { db.exec("ROLLBACK"); } catch {}
		throw error;
	} finally {
		db.close();
	}
}

export function importPrReviewCorpus(options: {
	id: string;
	eventsPath: string;
	casebookPath?: string;
	outputDir: string;
	now?: number;
}): CorpusManifest {
	const raw = JSON.parse(readFileSync(options.eventsPath, "utf8"));
	if (!Array.isArray(raw)) throw new Error("review events input must be a JSON array");
	const events = raw.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object").map(normalizeEvent);
	const cases = options.casebookPath ? parseCasebook(readFileSync(options.casebookPath, "utf8")) : [];
	mkdirSync(options.outputDir, { recursive: true });
	const eventsText = writeJsonl(join(options.outputDir, "events.jsonl"), events);
	const casesText = writeJsonl(join(options.outputDir, "cases.jsonl"), cases);
	const manifest: CorpusManifest = {
		schemaVersion: 1,
		id: options.id,
		createdAt: options.now ?? Date.now(),
		eventCount: events.length,
		meaningfulEventCount: events.filter((event) => !event.isEmpty && !event.isTrivial).length,
		caseCount: cases.length,
		eventsSha256: sha256(eventsText),
		casesSha256: sha256(casesText),
		source: { events: options.eventsPath, casebook: options.casebookPath },
	};
	writeFileSync(join(options.outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	createIndex(join(options.outputDir, "index.sqlite"), events, cases);
	return manifest;
}

function tokenize(value: string): string[] {
	return [...new Set(value.toLowerCase().split(/[^\p{L}\p{N}._/-]+/u).map((value) => value.trim()).filter((value) => value.length >= 2))];
}

function ftsQuery(terms: string[]): string {
	return terms.slice(0, 12).map((term) => `"${term.replaceAll('"', '""')}"`).join(" OR ");
}

function repositoryAlias(repository: string): string {
	return repository.split("/").at(-1)?.toLowerCase() || repository.toLowerCase();
}

function searchRows(db: DatabaseSync, table: "event_fts" | "case_fts", query: string, limit: number): Array<{ id: string; rank: number }> {
	return db.prepare(`SELECT id, rank FROM ${table} WHERE ${table} MATCH ? ORDER BY rank LIMIT ?`).all(query, limit) as Array<{ id: string; rank: number }>;
}

function matchedTerms(text: string, terms: string[]): string[] {
	const lower = text.toLowerCase();
	return terms.filter((term) => lower.includes(term));
}

export function searchPrReviewCorpus(
	config: CorpusSearchConfig,
	input: { repository: string; query: string; paths?: string[]; limit?: number },
): CorpusSearchResult {
	const manifestPath = join(config.corpusDir, "manifest.json");
	const indexPath = join(config.corpusDir, "index.sqlite");
	if (!existsSync(manifestPath) || !existsSync(indexPath)) throw new Error(`PR review corpus is not ready: ${config.corpusDir}`);
	if (config.repositories?.length && !config.repositories.map((value) => value.toLowerCase()).includes(input.repository.toLowerCase())) {
		throw new Error(`corpus ${config.id} does not support ${input.repository}`);
	}
	const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CorpusManifest;
	const terms = tokenize([input.query, ...(input.paths ?? [])].join(" "));
	if (!terms.length) throw new Error("corpus search query has no searchable terms");
	const query = ftsQuery(terms);
	const targetRepo = repositoryAlias(input.repository);
	const db = new DatabaseSync(indexPath, { readOnly: true });
	try {
		const eventRows = searchRows(db, "event_fts", query, 40);
		const caseRows = searchRows(db, "case_fts", query, 30);
		const loadEvent = db.prepare("SELECT json FROM events WHERE id = ?");
		const loadCase = db.prepare("SELECT json FROM cases WHERE id = ?");
		const events = eventRows.map((row) => ({ row, value: JSON.parse(String((loadEvent.get(row.id) as { json: string }).json)) as CorpusEvent }));
		const cases = caseRows.map((row) => ({ row, value: JSON.parse(String((loadCase.get(row.id) as { json: string }).json)) as CorpusCase }));
		const score = (rank: number, repo: string, text: string, path?: string) => {
			const repoBoost = repo.toLowerCase() === targetRepo ? 10 : 0;
			const pathBoost = (input.paths ?? []).some((candidate) => path && (path.includes(candidate) || candidate.includes(path))) ? 4 : 0;
			return -rank + repoBoost + pathBoost + matchedTerms(text, terms).length;
		};
		const supporting: CorpusSearchHit[] = [
			...events.map(({ row, value }) => {
				const text = `${value.prTitle ?? ""} ${value.path ?? ""} ${value.excerpt ?? ""}`;
				return {
					id: value.id,
					source: "event" as const,
					repo: value.repo,
					lane: value.repo.toLowerCase() === targetRepo ? "supporting" as const : "cross-repo" as const,
					label: `${value.repo} #${value.prNumber ?? "?"} · ${value.reviewer ?? "human reviewer"}`,
					url: value.url || value.prUrl,
					excerpt: value.excerpt ?? "",
					path: value.path,
					reviewer: value.reviewer,
					date: value.date,
					annotationStatus: value.annotationStatus,
					matchedTerms: matchedTerms(text, terms),
					score: score(row.rank, value.repo, text, value.path),
				};
			}),
			...cases.filter(({ value }) => value.lane === "supporting").map(({ row, value }) => ({
				id: value.id,
				source: "case" as const,
				repo: value.repo,
				lane: value.repo.toLowerCase() === targetRepo ? "supporting" as const : "cross-repo" as const,
				label: value.label,
				url: value.url,
				excerpt: value.summary,
				annotationStatus: value.annotationStatus,
				matchedTerms: matchedTerms(`${value.label} ${value.summary}`, terms),
				score: score(row.rank, value.repo, `${value.label} ${value.summary}`),
			})),
		].sort((left, right) => right.score - left.score);
		const contrasting: CorpusSearchHit[] = cases
			.filter(({ value }) => value.lane === "contrasting")
			.map(({ row, value }) => ({
				id: value.id,
				source: "case" as const,
				repo: value.repo,
				lane: "contrasting" as const,
				label: value.label,
				url: value.url,
				excerpt: value.summary,
				annotationStatus: value.annotationStatus,
				matchedTerms: matchedTerms(`${value.label} ${value.summary}`, terms),
				score: score(row.rank, value.repo, `${value.label} ${value.summary}`),
			}))
			.sort((left, right) => right.score - left.score);
		const limit = Math.max(1, Math.min(10, input.limit ?? 6));
		return {
			corpusId: config.id,
			query: input.query,
			supporting: supporting.filter((hit) => hit.lane === "supporting").slice(0, Math.min(3, limit)),
			contrasting: contrasting.slice(0, Math.min(2, limit)),
			crossRepo: supporting.filter((hit) => hit.lane === "cross-repo").slice(0, 1),
			coverage: { events: manifest.meaningfulEventCount, cases: manifest.caseCount, ftsCandidates: eventRows.length + caseRows.length },
		};
	} finally {
		db.close();
	}
}

export function describeCorpus(config: CorpusSearchConfig): string {
	const manifest = JSON.parse(readFileSync(join(config.corpusDir, "manifest.json"), "utf8")) as CorpusManifest;
	return `${config.id} · ${manifest.meaningfulEventCount}/${manifest.eventCount} meaningful events · ${manifest.caseCount} cases · ${basename(config.corpusDir)}`;
}
