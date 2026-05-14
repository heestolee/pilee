import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const CUSTOM_TYPE_HANDOFF = "continue-clean-handoff";
const HANDOFF_DIR = join(getAgentDir(), "continue-clean");
const MAX_RECENT_USER_PROMPTS = 10;
const MAX_RECENT_ASSISTANT_NOTES = 3;
const MAX_PROMPT_CHARS = 900;
const MAX_ASSISTANT_CHARS = 1200;
const MAX_GIT_STATUS_CHARS = 4000;

type ContinueCleanArgs = {
	help: boolean;
	noStart: boolean;
	note: string;
};

type RecentTurn = {
	role: "user" | "assistant";
	text: string;
	timestamp?: string;
};

type GitSnapshot = {
	root: string;
	status: string;
} | null;

type FrameSnapshot = {
	path: string;
	goal?: string;
	successCriteria?: string[];
} | null;

type HandoffInput = {
	createdAt: string;
	cwd: string;
	sourceSessionFile: string | null;
	sourceSessionName?: string;
	archiveCommand?: string;
	note?: string;
	git: GitSnapshot;
	frame: FrameSnapshot;
	recentUserPrompts: RecentTurn[];
	recentAssistantNotes: RecentTurn[];
};

function tokenize(args: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;
	for (const char of args) {
		if ((char === '"' || char === "'") && !quote) {
			quote = char;
			continue;
		}
		if (quote === char) {
			quote = null;
			continue;
		}
		if (/\s/.test(char) && !quote) {
			if (current) tokens.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	if (current) tokens.push(current);
	return tokens;
}

export function parseContinueCleanArgs(args: string): ContinueCleanArgs {
	const tokens = tokenize(args);
	const noteParts: string[] = [];
	let help = false;
	let noStart = false;
	for (const token of tokens) {
		if (token === "--help" || token === "-h") help = true;
		else if (token === "--no-start" || token === "--draft") noStart = true;
		else noteParts.push(token);
	}
	return { help, noStart, note: noteParts.join(" ").trim() };
}

function truncate(text: string, maxChars: number): string {
	return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function stripSyntheticBlocks(text: string): string {
	return text
		.replace(/\n?Workflow guard for this turn:[\s\S]*$/u, "")
		.replace(/\n?<!-- pilee-user-facing-language-policy -->[\s\S]*?<\/user-facing-language-policy>/gu, "")
		.trim();
}

function normalizeTurnText(text: string, maxChars: number): string {
	return truncate(
		stripSyntheticBlocks(text)
			.replace(/```[\s\S]*?```/g, "[code block]")
			.replace(/\s+/g, " ")
			.trim(),
		maxChars,
	);
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => {
		if (!part || typeof part !== "object") return "";
		const value = part as Record<string, unknown>;
		if (typeof value.text === "string") return value.text;
		if (typeof value.content === "string") return value.content;
		return "";
	}).filter(Boolean).join("\n");
}

function turnFromEntry(entry: unknown): RecentTurn | null {
	if (!entry || typeof entry !== "object") return null;
	const value = entry as Record<string, any>;
	const role = value.message?.role ?? value.role;
	if (role !== "user" && role !== "assistant") return null;
	const raw = textFromContent(value.message?.content ?? value.content);
	const text = normalizeTurnText(raw, role === "user" ? MAX_PROMPT_CHARS : MAX_ASSISTANT_CHARS);
	if (!text || /^\/continue-clean\b/.test(text)) return null;
	return { role, text, timestamp: typeof value.timestamp === "string" ? value.timestamp : undefined };
}

function recentTurns(entries: unknown[], role: "user" | "assistant", limit: number): RecentTurn[] {
	const turns: RecentTurn[] = [];
	for (const entry of entries) {
		const turn = turnFromEntry(entry);
		if (turn?.role === role) turns.push(turn);
	}
	return turns.slice(-limit);
}

function quoteCommandArg(value: string): string {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function readGitSnapshot(pi: ExtensionAPI, cwd: string): Promise<GitSnapshot> {
	try {
		const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
		if (rootResult.code !== 0) return null;
		const root = (rootResult.stdout ?? "").trim();
		if (!root) return null;
		const statusResult = await pi.exec("git", ["status", "--short", "--branch"], { cwd: root });
		const status = statusResult.code === 0 ? (statusResult.stdout ?? "").trim() : `git status failed: ${statusResult.stderr ?? "unknown error"}`;
		return { root, status: truncate(status || "(clean)", MAX_GIT_STATUS_CHARS) };
	} catch {
		return null;
	}
}

function readFrameSnapshot(cwd: string): FrameSnapshot {
	const framePath = join(cwd, ".pi", "frame.json");
	if (!existsSync(framePath)) return null;
	try {
		const frame = JSON.parse(readFileSync(framePath, "utf8"));
		const criteria = Array.isArray(frame.success_criteria)
			? frame.success_criteria.map((item: any) => {
				const id = item?.id ? `${item.id}: ` : "";
				return `${id}${item?.statement ?? item}`.trim();
			}).filter(Boolean).slice(0, 8)
			: [];
		return {
			path: framePath,
			goal: typeof frame.goal === "string" ? truncate(frame.goal.trim(), 800) : undefined,
			successCriteria: criteria,
		};
	} catch {
		return { path: framePath };
	}
}

function listLines(items: string[], fallback = "- (none)"): string[] {
	return items.length ? items.map((item) => `- ${item}`) : [fallback];
}

function formatTurnList(turns: RecentTurn[], fallback: string): string[] {
	if (turns.length === 0) return [fallback];
	return turns.map((turn, index) => `${index + 1}. ${turn.timestamp ? `[${turn.timestamp}] ` : ""}${turn.text}`);
}

export function buildCleanHandoff(input: HandoffInput): string {
	const lines: string[] = [];
	lines.push("# Clean Handoff");
	lines.push("");
	lines.push("> compact 대신 깨끗한 새 세션으로 이어가기 위한 최소 작업 계약서입니다. 원본 전문은 필요할 때만 `/archive`로 엽니다.");
	lines.push("");
	lines.push("## Source");
	lines.push(`- createdAt: ${input.createdAt}`);
	lines.push(`- cwd: \`${input.cwd}\``);
	if (input.sourceSessionName) lines.push(`- source title: ${input.sourceSessionName}`);
	if (input.sourceSessionFile) lines.push(`- source session: \`${input.sourceSessionFile}\``);
	if (input.archiveCommand) lines.push(`- reopen source: \`${input.archiveCommand}\``);
	if (input.note) lines.push(`- user note: ${input.note}`);
	lines.push("");

	if (input.frame) {
		lines.push("## Canonical frame");
		lines.push(`- frame: \`${input.frame.path}\``);
		if (input.frame.goal) lines.push(`- goal: ${input.frame.goal}`);
		if (input.frame.successCriteria?.length) {
			lines.push("- success criteria:");
			for (const item of input.frame.successCriteria) lines.push(`  - ${item}`);
		}
		lines.push("");
	}

	lines.push("## Git snapshot");
	if (input.git) {
		lines.push(`- repo: \`${input.git.root}\``);
		lines.push("```text");
		lines.push(input.git.status || "(clean)");
		lines.push("```");
	} else {
		lines.push("- git repo: not detected");
	}
	lines.push("");

	lines.push("## Recent user requests");
	lines.push(...formatTurnList(input.recentUserPrompts, "- (최근 user 요청을 찾지 못함)"));
	lines.push("");

	lines.push("## Recent assistant state hints");
	lines.push(...formatTurnList(input.recentAssistantNotes, "- (최근 assistant 요약을 찾지 못함)"));
	lines.push("");

	lines.push("## Continuation contract");
	lines.push(...listLines([
		"이 handoff를 새 세션의 현재 truth 시작점으로 삼는다.",
		"오래된 원본 transcript는 기본 맥락으로 복사하지 않는다.",
		"불확실한 세부 맥락이 필요할 때만 source session을 `/archive`로 열어 확인한다.",
		"먼저 목표/남은 작업/검증 초점을 짧게 재정리한 뒤, 바로 실행 가능한 다음 행동으로 이어간다.",
	]));
	return `${lines.join("\n").trimEnd()}\n`;
}

function writeHandoffArtifact(content: string): string | null {
	try {
		mkdirSync(HANDOFF_DIR, { recursive: true });
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const path = join(HANDOFF_DIR, `${stamp}.md`);
		writeFileSync(path, content);
		return path;
	} catch {
		return null;
	}
}

function buildContinuationPrompt(note: string): string {
	return [
		"Clean handoff를 기준으로 이 작업을 이어가줘.",
		"- 먼저 현재 목표/남은 작업/검증 초점을 3줄 이하로 재정리해줘.",
		"- 바로 실행 가능한 다음 행동이 명확하면 진행하고, 불확실하면 한 가지 질문만 해줘.",
		note ? `- 사용자 메모: ${note}` : undefined,
	].filter((line): line is string => Boolean(line)).join("\n");
}

function helpText(): string {
	return [
		"/continue-clean [--no-start] [note]",
		"",
		"현재 세션을 전문 복사하지 않고 clean handoff 카드만 새 세션에 주입한 뒤 이어갑니다.",
		"--no-start: 새 세션으로 전환하되 continuation prompt는 입력창에만 채웁니다.",
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("continue-clean", {
		description: "현재 세션의 최소 handoff만 새 세션에 주입해 깨끗하게 이어가기. Usage: /continue-clean [--no-start] [note]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parsed = parseContinueCleanArgs(args);
			if (parsed.help) {
				ctx.ui.notify(helpText(), "info");
				return;
			}

			const sourceSessionFile = ctx.sessionManager.getSessionFile() ?? null;
			const sourceSessionName = ctx.sessionManager.getSessionName?.();
			const entries = ctx.sessionManager.getEntries();
			const createdAt = new Date().toISOString();
			const archiveCommand = sourceSessionFile ? `/archive ${quoteCommandArg(sourceSessionFile)}` : undefined;
			const git = await readGitSnapshot(pi, ctx.cwd);
			const frame = readFrameSnapshot(ctx.cwd);
			const handoff = buildCleanHandoff({
				createdAt,
				cwd: ctx.cwd,
				sourceSessionFile,
				sourceSessionName,
				archiveCommand,
				note: parsed.note,
				git,
				frame,
				recentUserPrompts: recentTurns(entries, "user", MAX_RECENT_USER_PROMPTS),
				recentAssistantNotes: recentTurns(entries, "assistant", MAX_RECENT_ASSISTANT_NOTES),
			});
			const handoffPath = writeHandoffArtifact(handoff);
			const sessionName = `Clean continue${sourceSessionName ? ` · ${sourceSessionName}` : ""}`;
			const prompt = buildContinuationPrompt(parsed.note);

			ctx.ui.notify("clean handoff를 만들고 새 세션으로 전환합니다.", "info");
			const result = await ctx.newSession({
				parentSession: sourceSessionFile ?? undefined,
				setup: async (session) => {
					session.appendSessionInfo(sessionName);
					session.appendCustomMessageEntry(CUSTOM_TYPE_HANDOFF, handoff, true, {
						createdAt,
						sourceSessionFile,
						handoffPath,
						archiveCommand,
					});
				},
				withSession: async (nextCtx) => {
					const newSessionFile = nextCtx.sessionManager.getSessionFile();
					const detail = handoffPath ? ` · handoff ${handoffPath}` : "";
					nextCtx.ui.notify(`clean session 준비됨${detail}`, "info");
					if (parsed.noStart) {
						nextCtx.ui.setEditorText(prompt);
						nextCtx.ui.notify("continuation prompt를 입력창에 채웠습니다.", "info");
						return;
					}
					await nextCtx.sendUserMessage(prompt, { deliverAs: "followUp" });
					if (newSessionFile) nextCtx.ui.notify(`새 세션: ${newSessionFile}`, "info");
				},
			});
			if (result.cancelled) ctx.ui.notify("continue-clean 전환이 취소되었습니다.", "warning");
		},
	});
}
