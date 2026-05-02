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
		pageId: "3549d270074a8052a308e2144b4f5e77",
		codeBlockId: "3549d270-074a-805a-ad68-c2a3618a5ba1",
		dateBlockId: "3549d270-074a-8053-a459-c0171f4b57c2",
		dbId: "3549d270-074a-8005-a8c3-d97328c22cfb",
		backupDbId: "3549d270-074a-8037-b451-e4f0c76177eb",
		filePath: join(process.cwd(), "docs/pilee-history.md"),
	},
	"db-write-log": {
		pageId: "3549d270074a80cb8c61f20cd85eb022",
		codeBlockId: "3549d270-074a-81a2-946f-fbbfe3e43a06",
		dateBlockId: "3549d270-074a-81fe-9f17-cd7389067236",
		dbId: "3549d270-074a-81a5-93ac-ef4a3b8646dd",
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

async function addDbEntry(dbId, title, description) {
	const pageData = {
		parent: { database_id: dbId },
		properties: { "이름": { title: [{ text: { content: title } }] } },
	};
	if (description) {
		pageData.children = [
			{
				object: "block",
				type: "paragraph",
				paragraph: {
					rich_text: [{ type: "text", text: { content: description } }],
				},
			},
		];
	}
	await notionRequest("POST", "/pages", pageData);
}

async function main() {
	const args = process.argv.slice(2);
	const target = args[0];

	if (!target || !PAGES[target]) {
		console.error(`Usage: node scripts/sync-notion-log.mjs <pilee-history|db-write-log> <summary> [--desc "..."] [--date YYYY-MM-DD] [--backup true]`);
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

	const content = readFileSync(page.filePath, "utf8");

	const flags = {};
	const positional = [];
	for (let i = 1; i < args.length; i++) {
		if (args[i].startsWith("--") && i + 1 < args.length) {
			flags[args[i].slice(2)] = args[i + 1];
			i++;
		} else {
			positional.push(args[i]);
		}
	}
	const titleSummary = positional.join(" ");
	const description = flags.desc || "";

	const now = new Date();
	if (!flags.date) {
		flags.date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	}
	const datePrefix = flags.date.replace(/-/g, "");
	const entryTitle = `${datePrefix} ${titleSummary}`;

	console.log(`Syncing ${target} to Notion...`);

	await updateCodeBlock(page.codeBlockId, content);
	console.log("  ✓ Code block updated");

	await updateDateBlock(page.dateBlockId);
	console.log("  ✓ Date updated");

	if (titleSummary) {
		await addDbEntry(page.dbId, entryTitle, description);
		console.log(`  ✓ Why DB entry added: ${entryTitle}`);
	}

	if (flags.backup && page.backupDbId) {
		const backupTitle = `${datePrefix} snapshot`;
		const backupChunks = chunkText(content);
		await notionRequest("POST", "/pages", {
			parent: { database_id: page.backupDbId },
			properties: { "이름": { title: [{ text: { content: backupTitle } }] } },
			children: [{
				object: "block",
				type: "code",
				code: {
					rich_text: backupChunks.map((c) => ({ type: "text", text: { content: c } })),
					language: "markdown",
				},
			}],
		});
		console.log(`  ✓ Backup entry added: ${backupTitle}`);
	}

	console.log("Done!");
}

main().catch((e) => {
	console.error(e.message);
	process.exit(1);
});
