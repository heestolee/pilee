import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "retro-config.json");

function loadToken() {
	if (process.env.NOTION_API_KEY) return process.env.NOTION_API_KEY;
	if (existsSync(CONFIG_PATH)) {
		try {
			return JSON.parse(readFileSync(CONFIG_PATH, "utf8")).notionToken ?? "";
		} catch {}
	}
	return "";
}

const NOTION_TOKEN = loadToken();
const NOTION_API = "https://api.notion.com/v1";

const PAGES = {
	"pilee-history": {
		codeBlockId: "3549d270-074a-805a-ad68-c2a3618a5ba1",
		dateBlockId: "3549d270-074a-8053-a459-c0171f4b57c2",
		whyDbId: "3549d270-074a-8005-a8c3-d97328c22cfb",
		backupDbId: "3549d270-074a-8037-b451-e4f0c76177eb",
		filePath: join(process.cwd(), "docs/pilee-history.md"),
	},
	"db-write-log": {
		codeBlockId: "3549d270-074a-81a2-946f-fbbfe3e43a06",
		dateBlockId: "3549d270-074a-81fe-9f17-cd7389067236",
		whyDbId: "3549d270-074a-81a5-93ac-ef4a3b8646dd",
		filePath: join(process.cwd(), "docs/db-write-log.local.md"),
	},
};

async function notionRequest(method, path, body) {
	const res = await fetch(`${NOTION_API}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${NOTION_TOKEN}`,
			"Notion-Version": "2022-06-28",
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Notion API ${res.status}: ${text.slice(0, 200)}`);
	}
	return res.json();
}

function chunkText(text, maxLen = 2000) {
	const chunks = [];
	for (let i = 0; i < text.length; i += maxLen) {
		chunks.push(text.slice(i, i + maxLen));
	}
	return chunks.length > 0 ? chunks : [""];
}

function markdownToBlocks(text) {
	const blocks = [];
	const lines = text.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line.startsWith("## ")) {
			blocks.push({ object: "block", type: "heading_2", heading_2: { rich_text: parseInline(line.slice(3)) } });
			i++;
		} else if (line.startsWith("### ")) {
			blocks.push({ object: "block", type: "heading_3", heading_3: { rich_text: parseInline(line.slice(4)) } });
			i++;
		} else if (/^[-*] /.test(line)) {
			blocks.push({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: parseInline(line.slice(2)) } });
			i++;
		} else if (/^\d+\. /.test(line)) {
			const content = line.replace(/^\d+\.\s*/, "");
			blocks.push({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: parseInline(content) } });
			i++;
		} else if (line.startsWith("> ")) {
			blocks.push({ object: "block", type: "quote", quote: { rich_text: parseInline(line.slice(2)) } });
			i++;
		} else if (line.startsWith("---")) {
			blocks.push({ object: "block", type: "divider", divider: {} });
			i++;
		} else if (line.trim() === "") {
			i++;
		} else {
			let para = line;
			while (i + 1 < lines.length && lines[i + 1].trim() !== "" && !/^(##|###|[-*] |\d+\. |> |---)/.test(lines[i + 1])) {
				i++;
				para += "\n" + lines[i];
			}
			const chunks = chunkText(para);
			for (const chunk of chunks) {
				blocks.push({ object: "block", type: "paragraph", paragraph: { rich_text: parseInline(chunk) } });
			}
			i++;
		}
	}
	return blocks.length > 0 ? blocks : [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: " " } }] } }];
}

function parseInline(text) {
	const result = [];
	const regex = /(\*\*(.+?)\*\*|`(.+?)`)/g;
	let lastIndex = 0;
	let match;
	while ((match = regex.exec(text)) !== null) {
		if (match.index > lastIndex) {
			result.push({ type: "text", text: { content: text.slice(lastIndex, match.index) } });
		}
		if (match[2]) {
			result.push({ type: "text", text: { content: match[2] }, annotations: { bold: true } });
		} else if (match[3]) {
			result.push({ type: "text", text: { content: match[3] }, annotations: { code: true } });
		}
		lastIndex = regex.lastIndex;
	}
	if (lastIndex < text.length) {
		result.push({ type: "text", text: { content: text.slice(lastIndex) } });
	}
	return result.length > 0 ? result : [{ type: "text", text: { content: text } }];
}

function readStdin() {
	return new Promise((resolve) => {
		if (process.stdin.isTTY) { resolve(""); return; }
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => { data += chunk; });
		process.stdin.on("end", () => resolve(data.trim()));
	});
}

async function updateCodeBlock(blockId, content) {
	const chunks = chunkText(content);
	await notionRequest("PATCH", `/blocks/${blockId}`, {
		code: {
			rich_text: chunks.map((c) => ({ type: "text", text: { content: c } })),
			language: "markdown",
		},
	});
}

async function updateDateBlock(blockId) {
	const now = new Date();
	const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
	await notionRequest("PATCH", `/blocks/${blockId}`, {
		paragraph: {
			rich_text: [{ type: "text", text: { content: `최신화: ${dateStr}` } }],
		},
	});
}

async function findWhyPage(dbId, datePrefix) {
	const result = await notionRequest("POST", `/databases/${dbId}/query`, {
		filter: {
			property: "이름",
			title: { starts_with: datePrefix },
		},
	});
	return result.results?.[0] ?? null;
}

async function appendToPage(pageId, narrative) {
	const divider = { object: "block", type: "divider", divider: {} };
	const blocks = markdownToBlocks(narrative);
	await notionRequest("PATCH", `/blocks/${pageId}/children`, {
		children: [divider, ...blocks],
	});
}

async function createWhyPage(dbId, datePrefix, title, narrative) {
	const pageTitle = title ? `${datePrefix} ${title}` : datePrefix;
	const blocks = narrative ? markdownToBlocks(narrative) : [];
	await notionRequest("POST", "/pages", {
		parent: { database_id: dbId },
		properties: { "이름": { title: [{ text: { content: pageTitle } }] } },
		children: blocks,
	});
	return pageTitle;
}

async function createBackup(backupDbId, datePrefix, content) {
	const chunks = chunkText(content);
	await notionRequest("POST", "/pages", {
		parent: { database_id: backupDbId },
		properties: { "이름": { title: [{ text: { content: `${datePrefix} snapshot` } }] } },
		children: [{
			object: "block",
			type: "code",
			code: {
				rich_text: chunks.map((c) => ({ type: "text", text: { content: c } })),
				language: "markdown",
			},
		}],
	});
}

async function main() {
	const args = process.argv.slice(2);
	const target = args[0];

	if (!target || !PAGES[target]) {
		console.error("Usage:");
		console.error("  echo '서사 내용' | node scripts/sync-notion-log.mjs <target> [title] [--date YYYY-MM-DD] [--backup]");
		console.error("  node scripts/sync-notion-log.mjs <target> [title] --desc '서사 내용' [--date YYYY-MM-DD] [--backup]");
		console.error("Targets: pilee-history, db-write-log");
		process.exit(1);
	}

	if (!NOTION_TOKEN) {
		console.error("No Notion token found");
		process.exit(1);
	}

	const page = PAGES[target];

	if (!existsSync(page.filePath)) {
		console.error(`File not found: ${page.filePath}`);
		process.exit(1);
	}

	const flags = {};
	const positional = [];
	for (let i = 1; i < args.length; i++) {
		if (args[i] === "--backup") {
			flags.backup = true;
		} else if (args[i].startsWith("--") && i + 1 < args.length) {
			flags[args[i].slice(2)] = args[i + 1];
			i++;
		} else {
			positional.push(args[i]);
		}
	}

	const title = positional.join(" ");
	const now = new Date();
	if (!flags.date) {
		flags.date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	}
	const datePrefix = flags.date.replace(/-/g, "");

	const narrative = flags.desc || (await readStdin()) || "";
	const content = readFileSync(page.filePath, "utf8");

	console.log(`Syncing ${target} to Notion...`);

	await updateCodeBlock(page.codeBlockId, content);
	console.log("  ✓ Code block updated");

	await updateDateBlock(page.dateBlockId);
	console.log("  ✓ Date updated");

	if (narrative || title) {
		const existing = await findWhyPage(page.whyDbId, datePrefix);
		if (existing) {
			if (narrative) {
				const header = title ? `\n## ${title}\n\n` : "\n---\n\n";
				await appendToPage(existing.id, header + narrative);
				console.log(`  ✓ Appended to existing why page: ${datePrefix}`);
			}
		} else {
			const pageTitle = await createWhyPage(page.whyDbId, datePrefix, title, narrative);
			console.log(`  ✓ Created why page: ${pageTitle}`);
		}
	}

	if (flags.backup && page.backupDbId) {
		await createBackup(page.backupDbId, datePrefix, content);
		console.log(`  ✓ Backup created: ${datePrefix} snapshot`);
	}

	console.log("Done!");
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
