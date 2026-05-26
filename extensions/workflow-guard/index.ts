import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { formatWorkContextCard, gateWorkContext, loadOrDeriveWorkContext, type WorkContextCard, type WorkContextGateResult } from "../utils/work-context.ts";

type Intent = "answer" | "investigate" | "implement" | "hotfix" | "verify_report" | "audit" | "ship" | "knowledge" | "unknown";
type WorkflowWeight = "none" | "light" | "standard" | "full";

interface GuardState {
	prompt: string;
	intent: Intent;
	weight: WorkflowWeight;
	explicitHeavy: boolean;
	explicitMutation: boolean;
	explicitSingleCommit: boolean;
	auditRequired: boolean;
	summary: string;
	createdAt: string;
	sessionFile?: string;
}

interface StagedDiffSummary {
	files: string[];
	fileCount: number;
	added: number;
	deleted: number;
	areas: string[];
	binaryFiles: number;
	large: boolean;
	reason: string;
}

interface AuditEntry {
	date: string;
	title: string;
	text: string;
	score: number;
}

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = dirname(dirname(EXTENSION_DIR));
const HISTORY_FILE = join(PACKAGE_ROOT, "docs", "pilee-history.md");
const MAX_GUARD_STATES = 80;

const guardBySession = new Map<string, GuardState>();

const workflowGuardToolSchema = Type.Object({
	action: Type.Union([
		Type.Literal("status"),
		Type.Literal("classify"),
		Type.Literal("audit"),
	], { description: "Workflow guard action." }),
	prompt: Type.Optional(Type.String({ description: "Prompt/request text to classify or audit. Defaults to the current turn prompt when available." })),
	topic: Type.Optional(Type.String({ description: "Audit topic or friction summary." })),
	targets: Type.Optional(Type.Array(Type.String(), { description: "Optional target names, paths, commits, or worktree labels to search in recent history." })),
	sinceDays: Type.Optional(Type.Number({ description: "How many days of local pilee history to scan for audit evidence. Default 14." })),
});

function sessionKey(ctx: { cwd: string; sessionManager?: { getSessionFile?: () => string | undefined } }): string {
	return ctx.sessionManager?.getSessionFile?.() || ctx.cwd;
}

function rememberGuardState(key: string, state: GuardState) {
	guardBySession.set(key, state);
	if (guardBySession.size <= MAX_GUARD_STATES) return;
	const oldest = [...guardBySession.entries()].sort((a, b) => Date.parse(a[1].createdAt) - Date.parse(b[1].createdAt))[0];
	if (oldest) guardBySession.delete(oldest[0]);
}

function normalizeText(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAny(text: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(text));
}

function classifyPrompt(prompt: string, sessionFile?: string): GuardState {
	const normalized = normalizeText(prompt);
	const explicitHeavy = hasAny(normalized, [
		/verify[- ]?report|검증\s*리포트|캡처\s*리포트|full\s*report/,
		/stress[- ]?interview|fan[- ]?out|subagent|worker|병렬|전체\s*검증|풀\s*검증/,
		/다중\s*(role|viewport|계정|권한)|before[- ]?after|회귀\s*검증|e2e/,
	]);
	const auditRequired = hasAny(normalized, [
		/(이미|전에|기존|고친|해결|대응|미대응|남은|remaining|fixed|unfixed).*(구분|분리|확인|정리|audit|오디트)/,
		/(불편|friction|느렸|느림|느린|오버헤드|과했|과한|늘어지|지연|판단실수|스트레스).*(대응|해결|남은|미대응|분석|정리|뒤져|찾아|조사)/,
		/(작업|워크플로|플로우).*(늘어지|지연|과했|과한|판단실수|스트레스)/,
		/(already fixed|still missing|remaining gap|fixed vs)/,
	]);
	const verifyReport = explicitHeavy && hasAny(normalized, [/verify[- ]?report|검증\s*리포트|캡처\s*리포트/]);
	const knowledge = hasAny(normalized, [/ember|knowledge|불씨|지식|stale|freshness/]);
	const ship = hasAny(normalized, [/\bpr\b|pull request|commit|push|merge|ship|릴리즈/]);
	const hotfix = hasAny(normalized, [/hotfix|핫픽스|간단|문구|오타|copy|카피|one[- ]?line|한\s*줄|작은|small|quick|빨리|이거\s*하나/]);
	const noMutation = hasAny(normalized, [/수정하지|고치지|변경하지|건드리지|커밋하지|푸시하지|하지\s*마|하지마|no\s*(edit|change|commit|push)|do\s*not\s*(edit|change|commit|push)/]);
	const implement = !noMutation && hasAny(normalized, [/구현|수정|고쳐|고치|바꿔|변경|추가|삭제|반영|패치|생성|작성|만들|implement|fix|change|add|remove|update|create/]);
	const investigate = hasAny(normalized, [/확인|봐줘|살펴|분석|조사|찾아|왜|원인|검토|audit|오디트|알아봐/]);
	const answerOnly = hasAny(normalized, [/설명|알려줘|어떻게|무슨\s*뜻|질문|궁금|정리해줘/]) && !implement && !ship;

	let intent: Intent = "unknown";
	if (auditRequired) intent = "audit";
	else if (verifyReport) intent = "verify_report";
	else if (knowledge && implement) intent = "knowledge";
	else if (hotfix && implement) intent = "hotfix";
	else if (ship && implement) intent = "ship";
	else if (implement) intent = "implement";
	else if (investigate) intent = "investigate";
	else if (answerOnly) intent = "answer";
	else if (knowledge) intent = "knowledge";

	let weight: WorkflowWeight = "none";
	if (intent === "verify_report" || explicitHeavy) weight = "full";
	else if (intent === "hotfix") weight = "light";
	else if (intent === "implement" || intent === "ship" || intent === "knowledge") weight = "standard";
	else if (intent === "investigate" || intent === "audit" || intent === "answer") weight = "none";

	const explicitMutation = !noMutation && (implement || ship || hasAny(normalized, [/작업해|진행해|만들어|적용해|커밋|푸시/]));
	const explicitSingleCommit = hasAny(normalized, [/단일\s*커밋|한\s*커밋|one\s*commit|single\s*commit|squash/]);

	const summary = [
		`intent=${intent}`,
		`weight=${weight}`,
		auditRequired ? "audit=required" : null,
		explicitHeavy ? "heavy=explicit" : null,
		!explicitMutation ? "mutation=not-requested" : null,
	].filter(Boolean).join(" · ");

	return { prompt, intent, weight, explicitHeavy, explicitMutation, explicitSingleCommit, auditRequired, summary, createdAt: new Date().toISOString(), sessionFile };
}

function buildSystemPrompt(state: GuardState): string {
	const lines = [
		"Workflow guard for this turn:",
		`- Auto-classification: ${state.summary}.`,
		"- Treat this as a guardrail generated from the user request, not as optional style advice.",
		"- If the classification seems wrong, ask one short clarifying question before mutating files or starting heavy workflow.",
	];

	if (state.intent === "answer" || state.intent === "investigate") {
		lines.push(
			"- HARD PATH: this turn is read-only by default. Do not edit/write files, create worktrees, install dependencies, commit, or push unless the user explicitly turns the request into implementation.",
			"- Investigation discipline: if checking will take more than 2–3 minutes or multiple files/tools, give a short progress update before continuing.",
			"- Scope discipline: do not widen from the user-named environment/scope (for example dev/preview → production, symptom check → fix) without asking first.",
		);
	}
	if (state.auditRequired) {
		lines.push(
			"- HARD AUDIT PATH: before saying an issue is still unresolved, map friction → response evidence → current state → remaining gap. Use the injected audit snapshot or workflow_guard(action=audit).",
			"- Do not classify an item as 미대응 just because it appeared in an old friction session; first check whether a later commit/history entry already addressed it.",
		);
	}
	if (state.weight === "light") {
		lines.push(
			"- HARD LIGHT PATH: default to scope lock → focused change → nearest validation → atomic commit → push/PR status check. Do not start worker fan-out, stress interview, capture-heavy verify report, or deep session/context mining unless the user explicitly asks or a new risk axis appears.",
			"- Light PR/ship path: use `GIT_OPTIONAL_LOCKS=0 git status --short --branch`, current diff, recent commits, and the user's explicit intent. Do not run full transcript/session extraction just to fill templates.",
			"- For tiny copy/label hotfixes with explicit paths, prefer `auto_commit action=quick` over a heavy commit_plan roundtrip when using auto_commit.",
			"- If a commit tool reports `committed_not_pushed` or `push: skipped` and the user did not explicitly ask to hold push, immediately run `git push` before the final response.",
		);
	}
	if (state.explicitMutation) {
		lines.push(
			"- Product judgment discipline: separate 'code can do this' from 'the product requirement is satisfied'; verify the actual consumer path before concluding.",
			"- User-proposed procedure discipline: when the user proposes a concrete dev/test procedure, first honor that purpose; do not expand it into production best-practice unless asked.",
			"- SQL/runbook discipline: scale backup/rollback/DELETE plans to the actual risk and row count; do not add defensive ceremony that was not requested without explaining why.",
			"- Worker discipline: worker/subagent orchestration is opt-in for standard work unless parallel ownership, readiness diagnosis, or explicit user request justifies it.",
		);
	}
	lines.push(
		"- HARD COMMIT PATH: large staged diffs must be split into reviewable commits unless the user explicitly requested a single commit/squash.",
		"- After any TUI/TFT choice returns, continue to the selected next action; do not stop at a choice summary.",
	);
	return lines.join("\n");
}

function mutationBlockReason(state: GuardState, toolName: string): string | undefined {
	if (state.intent !== "answer" && state.intent !== "investigate") return undefined;
	return [
		`workflow_guard blocked ${toolName}: current request was classified as ${state.intent} (${state.summary}).`,
		"This path is read-only by default.",
		"Ask the user to confirm implementation, or explain why this mutation is required before retrying.",
	].join("\n");
}

function isTempPath(path: string): boolean {
	return path.startsWith("/tmp/") || path.startsWith("/private/tmp/") || path.includes("/var/folders/");
}

function isMutatingBash(command: string): boolean {
	const compact = command.replace(/\s+/g, " ").trim();
	return /(^|[;&|]\s*)git\s+(commit|push|worktree\s+add|reset\s+--hard|clean\s+-)/.test(compact)
		|| /(^|[;&|]\s*)(npm|pnpm|yarn)\s+(install|add|remove|update)\b/.test(compact)
		|| /(^|[;&|]\s*)rm\s+-rf\b/.test(compact)
		|| />\s*[^\s]+/.test(compact) && /(^|[;&|]\s*)(cat|echo|printf)\b/.test(compact);
}

function isGitCommitCommand(command: string): boolean {
	return /(^|[;&|]\s*)git\s+commit\b/.test(command.replace(/\s+/g, " "));
}

function isExplicitCommitBypass(command: string): boolean {
	return /WORKFLOW_GUARD_ALLOW_LARGE_COMMIT=1|workflow-guard:allow-large-commit|workflow_guard:allow_large_commit/.test(command);
}

function areaForPath(path: string): string {
	const parts = path.split("/").filter(Boolean);
	if (parts.length <= 1) return parts[0] || path;
	if (["extensions", "skills", "docs"].includes(parts[0])) return `${parts[0]}/${parts[1]}`;
	return parts[0];
}

async function stagedDiffSummary(pi: ExtensionAPI, cwd: string): Promise<StagedDiffSummary | null> {
	const filesResult = await pi.exec("git", ["diff", "--cached", "--name-only"], { cwd });
	if (filesResult.code !== 0) return null;
	const files = (filesResult.stdout ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
	if (files.length === 0) return { files, fileCount: 0, added: 0, deleted: 0, areas: [], binaryFiles: 0, large: false, reason: "no staged files" };

	const numstatResult = await pi.exec("git", ["diff", "--cached", "--numstat"], { cwd });
	let added = 0;
	let deleted = 0;
	let binaryFiles = 0;
	if (numstatResult.code === 0) {
		for (const line of (numstatResult.stdout ?? "").split("\n")) {
			const [a, d] = line.split("\t");
			if (!a && !d) continue;
			if (a === "-" || d === "-") {
				binaryFiles++;
				continue;
			}
			added += Number.parseInt(a || "0", 10) || 0;
			deleted += Number.parseInt(d || "0", 10) || 0;
		}
	}
	const areas = [...new Set(files.map(areaForPath))].sort();
	const total = added + deleted;
	const large = files.length > 8 || total > 700 || (areas.length > 3 && files.length > 4);
	const reason = large
		? `staged diff is large: ${files.length} files, +${added}/-${deleted}, ${areas.length} areas`
		: `staged diff is small: ${files.length} files, +${added}/-${deleted}, ${areas.length} areas`;
	return { files, fileCount: files.length, added, deleted, areas, binaryFiles, large, reason };
}

function formatLargeCommitBlock(summary: StagedDiffSummary): string {
	const sampleFiles = summary.files.slice(0, 12).map((file) => `- ${file}`).join("\n");
	return [
		"workflow_guard blocked git commit: staged diff is too large or mixed for one reviewable commit.",
		`- ${summary.reason}`,
		`- areas: ${summary.areas.join(", ") || "n/a"}`,
		"",
		"Split by logical concern, or get explicit user approval for one commit/squash before retrying.",
		"Staged sample:",
		sampleFiles,
	].join("\n");
}

function heavyToolBlockReason(state: GuardState, toolName: string): string {
	return [
		`workflow_guard blocked ${toolName}: current request is light (${state.summary}).`,
		"Use scope lock → focused change → nearest validation first.",
		"Start worker fan-out, capture-heavy report, or deep session/context mining only after explicit user request or a newly discovered risk axis.",
	].join("\n");
}

function isDeepContextPath(path: string): boolean {
	return /(?:^|\/)\.context\/work\/.+\.md$/u.test(path)
		|| /(?:^|\/)\.pi\/agent\/sessions\/.+\.jsonl$/u.test(path)
		|| /(?:^|\/)frame-studio\/transcripts\/.+\.json$/u.test(path);
}

function isDeepContextMiningCommand(command: string): boolean {
	const compact = command.replace(/\s+/g, " ");
	if (!/\.context\/work|\.pi\/agent\/sessions|frame-studio\/transcripts/.test(compact)) return false;
	return /(^|[;&|]\s*)(find|rg|grep|cat|sed|awk|python|python3|node)\b/.test(compact);
}

function formatWorkContextBlock(result: WorkContextGateResult, toolName: string): string {
	return [
		`workflow_guard blocked ${toolName}: Working Context Card gate failed.`,
		...result.reasons.map((reason) => `- ${reason}`),
		"",
		"Set or refresh the current slice with work_context before retrying, or explicitly update the card if scope changed.",
		result.card ? formatWorkContextCard(result.card) : "",
	].filter(Boolean).join("\n");
}

function workContextSection(card?: WorkContextCard): string {
	if (!card) return "";
	return [
		"",
		"Compact work context for this turn:",
		formatWorkContextCard(card),
		"- Rule: carry this compact card in working memory; reopen transcript/frame/archive only when needed. Do not treat old raw transcript as current truth.",
	].join("\n");
}

function sliceCommitRhythmSection(state: GuardState, card?: WorkContextCard): string {
	if (!card?.currentSlice) return "";
	if (!state.explicitMutation || (state.weight !== "standard" && state.weight !== "full")) return "";
	return [
		"",
		"Soft slice commit rhythm:",
		`- Current slice ${card.currentSlice.id}: ${card.currentSlice.title}`,
		"- Treat a verified slice as a commit candidate, not as something to batch until the whole implementation is done.",
		"- When the slice's nearest validation passes, inspect git status/diff, call work_context action=commit_plan to write an explicit auto_commit JSON plan, then call auto_commit action=apply after reviewing the plan.",
		"- If you intentionally defer the slice commit, record the reason in work_context checkpoint. Do not surprise the user at the end with a large uncommitted diff.",
		"- This is a soft rhythm, not a hard block: continue only when a commit would be premature because the current slice is incomplete or validation is still missing.",
	].join("\n");
}

function keywordTokens(text: string): string[] {
	const normalized = text
		.replace(/[`*_#[\](){}.,:;!?"']/g, " ")
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);
	const stop = new Set(["the", "and", "for", "with", "this", "that", "from", "what", "when", "where", "which", "already", "fixed", "remaining", "확인", "정리", "분석", "대응", "미대응", "해결", "있는", "없는", "그냥", "이전", "최근"]);
	const tokens = normalized.filter((token) => token.length >= 3 && !stop.has(token.toLowerCase()));
	return [...new Set(tokens)].slice(0, 24);
}

function parseHistoryEntries(history: string): AuditEntry[] {
	const lines = history.split("\n");
	const entries: AuditEntry[] = [];
	let currentDate = "unknown";
	let current: AuditEntry | null = null;
	for (const line of lines) {
		const dateMatch = line.match(/^##\s+(\d{4}-\d{2}-\d{2})/);
		if (dateMatch) currentDate = dateMatch[1];
		const entryMatch = line.match(/^####\s+\d+\.\s+(.+)$/);
		if (entryMatch) {
			if (current) entries.push(current);
			current = { date: currentDate, title: entryMatch[1].trim(), text: line, score: 0 };
			continue;
		}
		if (current && (/^[-*]\s+/.test(line) || /^\s{2,}[-*]\s+/.test(line))) {
			current.text += `\n${line}`;
		}
	}
	if (current) entries.push(current);
	return entries;
}

function withinSinceDays(date: string, sinceDays: number): boolean {
	const ts = Date.parse(`${date}T00:00:00Z`);
	if (!Number.isFinite(ts)) return true;
	return ts >= Date.now() - sinceDays * 24 * 60 * 60 * 1000;
}

function buildAuditSnapshot(params: { prompt: string; topic?: string; targets?: string[]; sinceDays?: number }): { text: string; details: Record<string, unknown> } {
	const sinceDays = Number.isFinite(params.sinceDays) && params.sinceDays! > 0 ? Math.min(params.sinceDays!, 120) : 14;
	const queryText = [params.prompt, params.topic, ...(params.targets ?? [])].filter(Boolean).join(" ");
	const keywords = keywordTokens(queryText);
	if (!existsSync(HISTORY_FILE)) {
		return {
			text: "workflow_guard audit snapshot: local pilee-history.md was not found. Use git log/current code evidence before classifying remaining gaps.",
			details: { sinceDays, keywords, historyFile: HISTORY_FILE, found: false },
		};
	}

	const entries = parseHistoryEntries(readFileSync(HISTORY_FILE, "utf8"))
		.filter((entry) => withinSinceDays(entry.date, sinceDays));
	for (const entry of entries) {
		const haystack = normalizeText(`${entry.title}\n${entry.text}`);
		entry.score = keywords.reduce((score, keyword) => score + (haystack.includes(keyword.toLowerCase()) ? 1 : 0), 0);
	}
	const matched = entries.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || b.date.localeCompare(a.date)).slice(0, 12);
	const recent = entries.slice(-12).reverse();
	const selected = matched.length > 0 ? matched : recent.slice(0, 8);
	const fingerprint = createHash("sha1").update(selected.map((entry) => `${entry.date}:${entry.title}`).join("\n")).digest("hex").slice(0, 12);

	const lines = [
		"workflow_guard audit snapshot",
		`- query keywords: ${keywords.join(", ") || "(none)"}`,
		`- scanned: ${entries.length} pilee-history entries within ${sinceDays} days`,
		`- matched: ${matched.length}`,
		`- snapshot: ${fingerprint}`,
		"",
		"Audit rule:",
		"- Treat matched response/history entries as evidence that an issue may already be addressed.",
		"- Before saying 미대응/remaining gap, verify current code/runtime state and explain why the response evidence is insufficient.",
		"- Output must map friction → response evidence → current state → remaining gap.",
		"",
		selected.length ? "Candidate response/history entries:" : "Candidate response/history entries: none",
		...selected.map((entry) => `- ${entry.date} · ${entry.title}${entry.score ? ` (score ${entry.score})` : ""}`),
	];
	return { text: lines.join("\n"), details: { sinceDays, keywords, matched: matched.length, scanned: entries.length, fingerprint, entries: selected.map(({ date, title, score }) => ({ date, title, score })) } };
}

function toolText(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function appendWorkflowGuardResult(event: any, text: string, extraDetails: Record<string, unknown>) {
	return {
		content: [...(event.content ?? []), { type: "text" as const, text }],
		details: { ...(event.details ?? {}), workflowGuard: { ...(event.details?.workflowGuard ?? {}), ...extraDetails } },
		isError: event.isError,
	};
}

function actionContinuityNote(kind: string, details: any): string | undefined {
	if (kind === "auto_commit") {
		const hasCommit = Array.isArray(details?.commits) && details.commits.length > 0;
		const pushIncomplete = details?.completion === "committed_not_pushed" || details?.pushed === false;
		if (!hasCommit || !pushIncomplete) return undefined;
		const pushStatus = details?.push?.status ?? "skipped";
		return [
			"",
			"[workflow_guard] nextActionRequired: true",
			`- auto_commit created commit(s) but push is not complete: ${pushStatus}.`,
			"- Unless the user explicitly asked to hold push, run `git push` or resolve the push failure now before reporting completion.",
		].join("\n");
	}
	if (kind === "tui_ask") {
		if (details?.status !== "submitted") return undefined;
		const choice = details.selectedOptions?.length ? details.selectedOptions.join(", ") : details.text || "submitted";
		return [
			"",
			"[workflow_guard] nextActionRequired: true",
			`- User selection: ${choice}`,
			"- Continue to the selected next action now. Do not end with only a choice summary.",
		].join("\n");
	}
	if (kind === "frame_studio") {
		const answer = details?.answer;
		if (answer?.status !== "answered") return undefined;
		const choice = answer.selectedOptions?.length ? answer.selectedOptions.join(", ") : answer.text || "answered";
		return [
			"",
			"[workflow_guard] nextActionRequired: true",
			`- TFT Studio selection: ${choice}`,
			"- Continue to the selected next action now. Persist required stage output when the stage contract asks for it.",
		].join("\n");
	}
	return undefined;
}

export default function workflowGuard(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event, ctx) => {
		const key = sessionKey(ctx);
		const sessionFile = ctx.sessionManager?.getSessionFile?.();
		const state = classifyPrompt(event.prompt, sessionFile);
		rememberGuardState(key, state);
		const audit = state.auditRequired ? buildAuditSnapshot({ prompt: event.prompt }) : undefined;
		const card = loadOrDeriveWorkContext(ctx.cwd, sessionFile);
		const guardPrompt = `${buildSystemPrompt(state)}${workContextSection(card)}${sliceCommitRhythmSection(state, card)}`;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${guardPrompt}`,
			message: {
				customType: "workflow_guard",
				content: audit ? `${guardPrompt}\n\n${audit.text}` : guardPrompt,
				display: false,
				details: { state, audit: audit?.details, workContext: card ? { path: card.identity.contextPath, currentSlice: card.currentSlice?.id, mode: card.mode } : undefined },
			},
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		const state = guardBySession.get(sessionKey(ctx));
		if (!state) return undefined;
		const card = loadOrDeriveWorkContext(ctx.cwd, ctx.sessionManager?.getSessionFile?.());

		if ((event.toolName === "edit" || event.toolName === "write") && !isTempPath(String(event.input?.path ?? ""))) {
			const reason = mutationBlockReason(state, event.toolName);
			if (reason) return { block: true, reason };
			if (state.explicitMutation && card && (state.weight === "standard" || state.weight === "full")) {
				const result = gateWorkContext(card, { action: "mutate", paths: [String(event.input?.path ?? "")], requireSlice: true });
				if (result.level === "block") return { block: true, reason: formatWorkContextBlock(result, event.toolName) };
			}
		}

		if ((event.toolName === "worktree_create" || event.toolName === "worktree_fork") && !state.explicitMutation) {
			const reason = mutationBlockReason(state, event.toolName);
			if (reason) return { block: true, reason };
		}

		if (event.toolName === "read" && state.weight === "light" && !state.explicitHeavy && !state.auditRequired) {
			const path = String(event.input?.path ?? "");
			if (isDeepContextPath(path)) return { block: true, reason: heavyToolBlockReason(state, "deep context read") };
		}

		if (event.toolName === "bash") {
			const command = String(event.input?.command ?? "");
			if (state.weight === "light" && !state.explicitHeavy && !state.auditRequired && isDeepContextMiningCommand(command)) {
				return { block: true, reason: heavyToolBlockReason(state, "deep context mining") };
			}
			if (isMutatingBash(command)) {
				const reason = mutationBlockReason(state, "bash mutation");
				if (reason) return { block: true, reason };
			}
			if (isGitCommitCommand(command) && !state.explicitSingleCommit && !isExplicitCommitBypass(command)) {
				const summary = await stagedDiffSummary(pi, ctx.cwd);
				if (summary?.large) return { block: true, reason: formatLargeCommitBlock(summary) };
				if (card && summary?.files.length && !/WORK_CONTEXT_ALLOW_SCOPE=1|work-context:allow-scope/.test(command)) {
					const result = gateWorkContext(card, { action: "commit", paths: summary.files, requireSlice: state.weight === "standard" || state.weight === "full" });
					if (result.level === "block") return { block: true, reason: formatWorkContextBlock(result, "git commit") };
				}
			}
		}

		if (state.weight === "light" && !state.explicitHeavy) {
			if (event.toolName === "verify_report_live" && String(event.input?.action ?? "") === "start") {
				return { block: true, reason: heavyToolBlockReason(state, "verify_report_live") };
			}
			if (event.toolName === "subagent") {
				const command = String(event.input?.command ?? "");
				if (/\bsubagent\s+(run|batch|chain)\b/.test(command)) {
					return { block: true, reason: heavyToolBlockReason(state, "subagent fan-out") };
				}
			}
		}
		return undefined;
	});

	pi.on("tool_result", async (event) => {
		if (event.toolName !== "tui_ask" && event.toolName !== "frame_studio" && event.toolName !== "auto_commit") return undefined;
		const note = actionContinuityNote(event.toolName, event.details);
		if (!note) return undefined;
		return appendWorkflowGuardResult(event, note, { nextActionRequired: true, sourceTool: event.toolName });
	});

	pi.registerTool({
		name: "workflow_guard",
		label: "Workflow Guard",
		description: "Inspect the current enforced workflow classification or build a fixed-vs-remaining audit snapshot. Use for request intent, light/hotfix path, and already-fixed-vs-unfixed audits.",
		promptSnippet: "Use workflow_guard when the request is about workflow friction, already-fixed vs remaining gaps, or when you need to inspect the current request classification.",
		promptGuidelines: [
			"For fixed-vs-unfixed audits, use action=audit and map friction → response evidence → current state → remaining gap.",
			"For small hotfixes, respect the light path unless new risk axes appear; do not deep-scan transcripts/context just to satisfy a template.",
			"If the user reports workflow drag, search for repeated judgment-drift patterns and translate them into guard rules.",
			"Do not treat this tool as permission to mutate files during an answer/investigation-only turn.",
		],
		parameters: workflowGuardToolSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const key = sessionKey(ctx);
			const current = guardBySession.get(key);
			if (params.action === "status") {
				return toolText(current ? `Current workflow guard: ${current.summary}` : "No workflow guard state recorded for this session yet.", { state: current ?? null });
			}
			if (params.action === "classify") {
				const state = classifyPrompt(String(params.prompt ?? current?.prompt ?? ""), ctx.sessionManager?.getSessionFile?.());
				return toolText(`Classification: ${state.summary}`, { state });
			}
			if (params.action === "audit") {
				const prompt = String(params.prompt ?? params.topic ?? current?.prompt ?? "");
				const audit = buildAuditSnapshot({ prompt, topic: params.topic, targets: params.targets, sinceDays: params.sinceDays });
				return toolText(audit.text, audit.details);
			}
			throw new Error(`Unsupported workflow_guard action: ${params.action}`);
		},
	});
}
