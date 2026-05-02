import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "retro-config.json");
const NOTION_TOKEN = (() => {
	if (process.env.NOTION_API_KEY) return process.env.NOTION_API_KEY;
	if (existsSync(CONFIG_PATH)) {
		try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")).notionToken ?? ""; } catch {}
	}
	return "";
})();
const DB_ID = "3549d270-074a-81a5-93ac-ef4a3b8646dd";

async function notion(method, path, body) {
	const res = await fetch(`https://api.notion.com/v1${path}`, {
		method,
		headers: { Authorization: `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28", "Content-Type": "application/json" },
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 300)}`);
	return res.json();
}

function formatDate(d) {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateCompact(d) {
	return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function queryEntries(startDate, endDate) {
	const result = await notion("POST", `/databases/${DB_ID}/query`, {
		filter: {
			and: [
				{ property: "날짜", date: { on_or_after: startDate } },
				{ property: "날짜", date: { on_or_before: endDate } },
				{ or: [
					{ property: "구분", select: { is_empty: true } },
					{ property: "구분", select: { equals: "일간" } },
				]},
			],
		},
		sorts: [{ property: "날짜", direction: "ascending" }],
	});
	return result.results;
}

async function getPageContent(pageId) {
	const result = await notion("GET", `/blocks/${pageId}/children?page_size=100`);
	const lines = [];
	for (const block of result.results) {
		const t = block.type;
		if (t === "paragraph" || t === "heading_2" || t === "heading_3" || t === "bulleted_list_item") {
			const richText = block[t]?.rich_text ?? [];
			const text = richText.map(r => r.plain_text).join("");
			if (t === "heading_2") lines.push(`\n## ${text}`);
			else if (t === "heading_3") lines.push(`\n### ${text}`);
			else if (t === "bulleted_list_item") lines.push(`- ${text}`);
			else if (text) lines.push(text);
		} else if (t === "code") {
			const code = block[t]?.rich_text?.map(r => r.plain_text).join("") ?? "";
			const lang = block[t]?.language ?? "";
			lines.push(`\`\`\`${lang}\n${code}\n\`\`\``);
		}
	}
	return lines.join("\n");
}

function extractProps(page) {
	const props = page.properties;
	const title = props["이름"]?.title?.map(r => r.plain_text).join("") ?? "";
	const date = props["날짜"]?.date?.start ?? "";
	const service = props["서비스"]?.select?.name ?? "";
	const skill = props["스킬"]?.select?.name ?? "";
	const type = props["유형"]?.select?.name ?? "";
	const table = props["대상 테이블"]?.rich_text?.map(r => r.plain_text).join("") ?? "";
	const status = props["상태"]?.select?.name ?? "";
	return { title, date, service, skill, type, table, status, id: page.id };
}

function buildSummary(entries, period, startDate, endDate) {
	const lines = [];
	lines.push(`${period} DB 작업 회고 (${startDate} ~ ${endDate})`);
	lines.push("");
	lines.push(`총 ${entries.length}건의 DB 작업 수행.`);
	lines.push("");

	const byService = {};
	const byType = {};
	const tables = new Set();
	let incidents = 0;

	for (const e of entries) {
		if (e.service) byService[e.service] = (byService[e.service] || 0) + 1;
		if (e.type) byType[e.type] = (byType[e.type] || 0) + 1;
		if (e.table) e.table.split(",").forEach(t => tables.add(t.trim()));
		if (e.status === "장애") incidents++;
	}

	lines.push("📊 통계");
	if (Object.keys(byService).length > 0) {
		lines.push(`- 서비스별: ${Object.entries(byService).map(([k, v]) => `${k}(${v}건)`).join(", ")}`);
	}
	if (Object.keys(byType).length > 0) {
		lines.push(`- 유형별: ${Object.entries(byType).map(([k, v]) => `${k}(${v}건)`).join(", ")}`);
	}
	if (tables.size > 0) {
		lines.push(`- 관련 테이블: ${[...tables].join(", ")}`);
	}
	if (incidents > 0) {
		lines.push(`- ⚠️ 장애: ${incidents}건`);
	}

	lines.push("");
	lines.push("📋 작업 목록");
	for (const e of entries) {
		const statusMark = e.status === "장애" ? " ⚠️" : "";
		const typeBadge = e.type ? `[${e.type}]` : "";
		lines.push(`- ${e.date} ${typeBadge} ${e.title}${statusMark}`);
	}

	return lines.join("\n");
}

async function buildDetailedReview(entries) {
	const sections = [];
	for (const e of entries) {
		const content = await getPageContent(e.id);
		sections.push(`--- ${e.date} ${e.title} ---\n${content}`);
	}
	return sections.join("\n\n");
}

function rt(text) {
	const chunks = [];
	for (let i = 0; i < text.length; i += 2000) chunks.push({ type: "text", text: { content: text.slice(i, i + 2000) } });
	return chunks.length > 0 ? chunks : [{ type: "text", text: { content: "" } }];
}

async function createReviewEntry(title, period, summary, detail) {
	const children = [
		{ object: "block", type: "paragraph", paragraph: { rich_text: rt(summary) } },
	];
	if (detail) {
		children.push({ object: "block", type: "divider", divider: {} });
		children.push({ object: "block", type: "heading_2", heading_2: { rich_text: [{ type: "text", text: { content: "상세 내용" } }] } });

		const detailChunks = detail.split("\n---");
		for (const chunk of detailChunks) {
			const trimmed = chunk.trim();
			if (!trimmed) continue;
			const codeBlocks = trimmed.split(/```(\w*)\n/);
			for (let i = 0; i < codeBlocks.length; i++) {
				const part = codeBlocks[i].trim();
				if (!part) continue;
				if (i > 0 && i % 2 === 0) {
					const lang = codeBlocks[i - 1] || "plain text";
					const code = part.replace(/```$/, "").trim();
					if (code) {
						const codeChunks = [];
						for (let j = 0; j < code.length; j += 2000) codeChunks.push({ type: "text", text: { content: code.slice(j, j + 2000) } });
						children.push({ object: "block", type: "code", code: { rich_text: codeChunks, language: lang === "sql" ? "sql" : "plain text" } });
					}
				} else {
					children.push({ object: "block", type: "paragraph", paragraph: { rich_text: rt(part.slice(0, 2000)) } });
				}
			}
		}
	}

	const now = new Date();
	await notion("POST", "/pages", {
		parent: { database_id: DB_ID },
		properties: {
			"이름": { title: [{ text: { content: title } }] },
			"날짜": { date: { start: formatDate(now) } },
			"구분": { select: { name: period } },
		},
		children: children.slice(0, 100),
	});
}

async function main() {
	const mode = process.argv[2];
	if (!mode || !["weekly", "monthly"].includes(mode)) {
		console.error("Usage: node scripts/db-review.mjs <weekly|monthly>");
		process.exit(1);
	}

	const now = new Date();
	let startDate, endDate, title, period;

	if (mode === "weekly") {
		const end = new Date(now);
		const start = new Date(now);
		start.setDate(end.getDate() - 6);
		startDate = formatDate(start);
		endDate = formatDate(end);
		title = `${formatDateCompact(end)} 주간 DB 회고 (${startDate} ~ ${endDate})`;
		period = "주간";
	} else {
		const year = now.getFullYear();
		const month = now.getMonth();
		const start = new Date(year, month, 1);
		const end = new Date(year, month + 1, 0);
		startDate = formatDate(start);
		endDate = formatDate(end);
		const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
		title = `${formatDateCompact(end)} 월간 DB 회고 (${monthStr})`;
		period = "월간";
	}

	console.log(`${period} 회고 생성: ${startDate} ~ ${endDate}`);

	const pages = await queryEntries(startDate, endDate);
	const entries = pages.map(extractProps);

	if (entries.length === 0) {
		console.log("해당 기간에 DB 작업 기록이 없습니다.");
		return;
	}

	console.log(`  ${entries.length}건 발견`);

	const summary = buildSummary(entries, period, startDate, endDate);
	console.log(`\n${summary}\n`);

	console.log("상세 내용 수집 중...");
	const detail = await buildDetailedReview(entries);

	await createReviewEntry(title, period, summary, detail);
	console.log(`\n✓ Notion에 ${period} 회고 생성 완료: ${title}`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
