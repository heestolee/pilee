import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "retro-config.json");

function loadRetroConfig(): { token: string; dbId: string } {
	// Env vars first
	if (process.env.NOTION_API_KEY && process.env.NOTION_DB_ID) {
		return { token: process.env.NOTION_API_KEY, dbId: process.env.NOTION_DB_ID };
	}
	// Config file fallback
	if (existsSync(CONFIG_PATH)) {
		try {
			const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
			return { token: cfg.notionToken ?? "", dbId: cfg.notionDbId ?? "" };
		} catch {}
	}
	return { token: "", dbId: "" };
}

const RETRO_CONFIG = loadRetroConfig();
const NOTION_TOKEN = RETRO_CONFIG.token;
const NOTION_DB = RETRO_CONFIG.dbId;
const NOTION_API = "https://api.notion.com/v1";
const REPORT_DIR = join(homedir(), ".claude", "script", "reports");

async function notionRequest(method: string, path: string, body?: unknown): Promise<any> {
	const response = await fetch(`${NOTION_API}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${NOTION_TOKEN}`,
			"Notion-Version": "2022-06-28",
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!response.ok) return null;
	return response.json();
}

async function findPage(date: string, category: string): Promise<{ id: string; title: string } | null> {
	const result = await notionRequest("POST", `/databases/${NOTION_DB}/query`, {
		filter: {
			and: [
				{ property: "Date", date: { equals: date } },
				{ property: "구분", select: { equals: category } },
			],
		},
	});
	if (!result?.results?.length) return null;
	const page = result.results[0];
	const props = page.properties ?? {};
	let title = "";
	for (const v of Object.values(props) as any[]) {
		if (v?.type === "title" && v.title?.[0]) {
			title = v.title[0].plain_text;
			break;
		}
	}
	return { id: page.id, title };
}

async function fetchPageContent(pageId: string): Promise<string> {
	const blocks: string[] = [];
	let cursor: string | null = null;
	while (true) {
		let path = `/blocks/${pageId}/children?page_size=100`;
		if (cursor) path += `&start_cursor=${cursor}`;
		const result = await notionRequest("GET", path);
		if (!result) break;
		for (const b of result.results ?? []) {
			const btype = b.type ?? "";
			const content = b[btype] ?? {};
			const richText = content.rich_text ?? [];
			const text = richText.map((r: any) => r.plain_text ?? "").join("");
			if (btype === "heading_1") blocks.push(`# ${text}`);
			else if (btype === "heading_2") blocks.push(`## ${text}`);
			else if (btype === "heading_3") blocks.push(`### ${text}`);
			else if (btype === "paragraph" && text) blocks.push(text);
			else if (btype === "bulleted_list_item") blocks.push(`- ${text}`);
			else if (btype === "numbered_list_item") blocks.push(`1. ${text}`);
			else if (btype === "quote") blocks.push(`> ${text}`);
			else if (btype === "code") blocks.push("```\n" + text + "\n```");
			else if (btype === "divider") blocks.push("---");
			else if (btype === "callout") {
				const icon = content.icon?.emoji ?? "💡";
				blocks.push(`${icon} ${text}`);
			} else if (btype === "child_page") {
				blocks.push(`[child page: ${content.title ?? ""}]`);
			} else if (text) blocks.push(text);
		}
		if (!result.has_more) break;
		cursor = result.next_cursor;
		if (!cursor) break;
	}
	return blocks.join("\n\n");
}

function resolveDate(arg: string): { date: string; category: string; label: string } | null {
	const trimmed = arg.trim();

	// YYYY-MM-wN → 주간 (N째주 월요일 기준)
	const weeklyMatch = trimmed.match(/^(\d{4})-(\d{1,2})-w(\d)$/i);
	if (weeklyMatch) {
		const [, y, m, w] = weeklyMatch;
		const year = Number(y);
		const month = Number(m) - 1;
		const weekNum = Number(w);
		// 해당 월 첫 번째 월요일 찾기
		const firstOfMonth = new Date(year, month, 1);
		let firstMonday = 1 + ((8 - firstOfMonth.getDay()) % 7);
		if (firstMonday > 7) firstMonday -= 7;
		const mondayDate = firstMonday + (weekNum - 1) * 7;
		const monday = new Date(year, month, mondayDate);
		const saturday = new Date(year, month, mondayDate + 5);
		return {
			date: saturday.toISOString().slice(0, 10),
			category: "주간회고",
			label: `${Number(m)}월 ${weekNum}째주`,
		};
	}

	// YYYY-MM → 월간
	if (/^\d{4}-\d{1,2}$/.test(trimmed)) {
		const parts = trimmed.split("-");
		const y = Number(parts[0]);
		const m = Number(parts[1]);
		const lastDay = new Date(y, m, 0);
		return {
			date: lastDay.toISOString().slice(0, 10),
			category: "월간회고",
			label: `${y}년 ${m}월`,
		};
	}

	// YYYY-MM-DD → 일간
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return { date: trimmed, category: "일간회고", label: trimmed };
	}

	// growth 키워드 + 날짜 조합
	const growthMatch = trimmed.match(/^(growth|dev-growth|개발성장)\s+(.+)$/i);
	if (growthMatch) {
		const inner = resolveDate(growthMatch[2]);
		if (inner) return { date: inner.date, category: "개발성장", label: `${inner.label} 개발성장` };
	}
	// growth 단독 → 어제
	if (/^(growth|dev-growth|개발성장)$/i.test(trimmed)) {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		return { date: yesterday.toISOString().slice(0, 10), category: "개발성장", label: "개발성장" };
	}

	// Empty → 어제 일간
	if (!trimmed) {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		return {
			date: yesterday.toISOString().slice(0, 10),
			category: "일간회고",
			label: yesterday.toISOString().slice(0, 10),
		};
	}

	return null;
}

export default function (pi: ExtensionAPI) {
	let activeRetro: { pageId: string; title: string; content: string; date: string; category: string } | null = null;

	pi.registerCommand("retro", {
		description: "회고 불러와서 대화하며 다듬기 (args: [date|monthly|weekly|save|view])",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parts = args.trim().split(/\s+/);
			const sub = parts[0] ?? "";

			// /retro save — 다듬은 내용 Notion에 반영
			if (sub === "save") {
				if (!activeRetro) {
					ctx.ui.notify("활성 회고가 없어요. /retro [날짜]로 먼저 불러오세요.", "warning");
					return;
				}
				ctx.ui.notify("다듬은 회고를 Notion에 저장하려면 이 세션에서 수정된 내용을 정리해서 말씀해주세요. 그러면 제가 Notion에 반영합니다.", "info");
				return;
			}

			// /retro view — 그냥 보기
			const viewMode = sub === "view";
			const dateArg = viewMode ? (parts[1] ?? "") : sub;

			const resolved = resolveDate(dateArg);
			if (!resolved) {
				ctx.ui.notify(
					"사용법:\n  /retro — 어제 일간 회고\n  /retro 2026-04-30 — 특정 날짜\n  /retro monthly — 월간 회고\n  /retro weekly — 주간 회고\n  /retro 2026-04 — 4월 월간\n  /retro growth 2026-04-30 — 개발성장\n  /retro save — Notion 반영\n  /retro view [날짜] — 보기만",
					"info",
				);
				return;
			}

			ctx.ui.notify(`📋 ${resolved.label} 회고 가져오는 중...`, "info");

			// 1. Try local cache first
			let content = "";
			const cacheMap: Record<string, string> = {
				"일간회고": "daily-retrospective",
				"주간회고": "weekly-retrospective",
				"월간회고": "monthly-retrospective",
				"개발성장": "dev-growth-report",
			};
			const cacheDir = join(REPORT_DIR, cacheMap[resolved.category] ?? "");
			const cacheFiles = [
				join(cacheDir, `${resolved.date}.md`),
			];
			for (const cf of cacheFiles) {
				if (existsSync(cf)) {
					content = readFileSync(cf, "utf8");
					break;
				}
			}

			// 2. If no cache, fetch from Notion
			if (!content) {
				const page = await findPage(resolved.date, resolved.category);
				if (!page) {
					ctx.ui.notify(`${resolved.label} (${resolved.category}) 회고를 찾지 못했어요.`, "warning");
					return;
				}
				content = await fetchPageContent(page.id);
				activeRetro = { pageId: page.id, title: page.title, content, date: resolved.date, category: resolved.category };
			} else {
				// Find page ID for save later
				const page = await findPage(resolved.date, resolved.category);
				activeRetro = {
					pageId: page?.id ?? "",
					title: page?.title ?? `${resolved.label} 회고`,
					content,
					date: resolved.date,
					category: resolved.category,
				};
			}

			if (viewMode) {
				// Just show, don't start conversation
				pi.sendUserMessage(`[회고 보기: ${activeRetro.title}]\n\n${content.slice(0, 3000)}${content.length > 3000 ? "\n\n... (truncated)" : ""}`, { deliverAs: "followUp" });
				return;
			}

			// Start conversation mode
			const prompt = `아래는 "${activeRetro.title}" 회고 내용이에요. 이걸 읽고 같이 다듬을 준비 해주세요.

---

${content}

---

회고를 읽었어요. 어떤 부분부터 얘기해볼까요?

참고:
- 특정 섹션에 대해 의견을 주시면 다시 작성해드릴게요
- "이 부분은 사실과 달라" 같은 교정도 환영
- 새로운 인사이트나 빠진 내용 추가도 가능
- 다듬기가 끝나면 /retro save로 Notion에 반영할 수 있어요`;

			pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});
}
