import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

type WorktreeMeta = {
	name?: string;
	branch?: string;
	ticket?: string;
	note?: string;
};

type WorktreeHit = {
	root: string;
	meta: WorktreeMeta;
};

export type FrameIdentityMode = "worktree" | "planning-ticket" | "planning-session";

export type FrameIdentity = {
	mode: FrameIdentityMode;
	key: string;
	displayTitle: string;
	storageDir: string;
	cwd: string;
	reason: string;
	ticket?: string;
	sessionTitle?: string;
	sessionFile?: string;
	worktreePath?: string;
	worktreeName?: string;
	branch?: string;
};

const TICKET_RE = /\b[A-Z][A-Z0-9]+-\d+\b/;
const PLANNING_ROOT = join(homedir(), ".pi", "agent", "frame-planning");

function hashText(text: string): string {
	return createHash("sha1").update(text).digest("hex").slice(0, 10);
}

function safeSlug(text: string): string {
	return text
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "untitled";
}

function readJson<T>(path: string): T | null {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

function findWorktree(cwd: string): WorktreeHit | null {
	let current = resolve(cwd);
	while (true) {
		const metaPath = join(current, ".pi", "worktree-meta.json");
		const meta = readJson<WorktreeMeta>(metaPath);
		if (meta) return { root: current, meta };
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

function meaningfulTitle(title: string | undefined): string | undefined {
	const trimmed = title?.trim();
	if (!trimmed) return undefined;
	if (/^\(?untitled\)?$/i.test(trimmed)) return undefined;
	return trimmed;
}

function firstTicket(...texts: Array<string | undefined>): string | undefined {
	for (const text of texts) {
		const match = text?.match(TICKET_RE);
		if (match) return match[0];
	}
	return undefined;
}

function shortLabel(text: string | undefined, fallback: string): string {
	const trimmed = text?.trim().replace(/\s+/g, " ");
	if (!trimmed) return fallback;
	return trimmed.length > 56 ? `${trimmed.slice(0, 55)}…` : trimmed;
}

export function buildFrameIdentity(ctx: ExtensionCommandContext, args: string): FrameIdentity {
	const cwd = resolve(ctx.cwd);
	const sessionFile = ctx.sessionManager.getSessionFile?.();
	const sessionTitle = meaningfulTitle(ctx.sessionManager.getSessionName?.());
	const worktree = findWorktree(cwd);

	if (worktree) {
		const name = worktree.meta.name || basename(worktree.root);
		const ticket = worktree.meta.ticket || firstTicket(name, worktree.meta.branch, worktree.meta.note, args, sessionTitle);
		const key = `worktree:${hashText(worktree.root)}`;
		return {
			mode: "worktree",
			key,
			displayTitle: `Frame · ${name}${ticket ? ` · ${ticket}` : ""}`,
			storageDir: join(worktree.root, ".pi"),
			cwd,
			reason: "현재 cwd 또는 상위 디렉토리에서 .pi/worktree-meta.json을 찾음",
			ticket,
			sessionTitle,
			sessionFile,
			worktreePath: worktree.root,
			worktreeName: name,
			branch: worktree.meta.branch,
		};
	}

	const ticket = firstTicket(args, sessionTitle, cwd);
	if (ticket) {
		const key = `planning:ticket:${ticket}`;
		return {
			mode: "planning-ticket",
			key,
			displayTitle: `Planning · ${ticket}${sessionTitle ? ` · ${shortLabel(sessionTitle, "")}` : ""}`,
			storageDir: join(PLANNING_ROOT, safeSlug(key)),
			cwd,
			reason: "worktree 밖 planning 세션에서 티켓을 찾음",
			ticket,
			sessionTitle,
			sessionFile,
		};
	}

	const sessionSeed = sessionFile || `${cwd}:${process.pid}`;
	const key = `planning:session:${hashText(sessionSeed)}`;
	const label = shortLabel(sessionTitle || args, "Home planning");
	return {
		mode: "planning-session",
		key,
		displayTitle: `Planning · ${label}`,
		storageDir: join(PLANNING_ROOT, safeSlug(key)),
		cwd,
		reason: "worktree와 티켓이 없어 session title/session file을 planning identity로 사용",
		sessionTitle,
		sessionFile,
	};
}

export function formatFrameIdentityHint(identity: FrameIdentity): string {
	return [
		"## Frame identity hint",
		"",
		`- mode: ${identity.mode}`,
		`- key: ${identity.key}`,
		`- display title: ${identity.displayTitle}`,
		`- storage dir: ${identity.storageDir}`,
		`- reason: ${identity.reason}`,
		identity.ticket ? `- ticket: ${identity.ticket}` : undefined,
		identity.worktreeName ? `- worktree: ${identity.worktreeName}` : undefined,
		identity.worktreePath ? `- worktree path: ${identity.worktreePath}` : undefined,
		identity.branch ? `- branch: ${identity.branch}` : undefined,
		identity.sessionTitle ? `- session title: ${identity.sessionTitle}` : undefined,
		identity.sessionFile ? `- session file: ${identity.sessionFile}` : undefined,
		"",
		"Identity rules:",
		"- worktree가 있으면 worktree-bound frame으로 저장한다.",
		"- worktree가 없고 티켓이 있으면 ticket-bound planning frame으로 다룬다.",
		"- worktree와 티켓이 없으면 하단 session title을 display label로 쓰되, 내부 key는 session file hash를 사용한다.",
		"- 홈 디렉토리 자체(`/Users/...`)를 frame identity로 쓰지 않는다.",
		"- 나중에 worktree가 생기면 planning frame을 해당 worktree의 `.pi/frame.json`으로 승격할 수 있게 한다.",
	]
		.filter((line): line is string => line !== undefined)
		.join("\n");
}
