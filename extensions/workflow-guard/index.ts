import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { formatWorkContextCard, gateWorkContext, loadOrDeriveWorkContext, type WorkContextCard, type WorkContextGateResult } from "../utils/work-context.ts";

type Intent = "answer" | "investigate" | "implement" | "hotfix" | "verify_report" | "audit" | "ship" | "knowledge" | "status_note" | "unknown";
type WorkflowWeight = "none" | "light" | "standard" | "full";

interface GuardState {
	prompt: string;
	intent: Intent;
	weight: WorkflowWeight;
	explicitHeavy: boolean;
	explicitMutation: boolean;
	explicitSingleCommit: boolean;
	explicitCommitPushOnly: boolean;
	explicitPrAction: boolean;
	auditRequired: boolean;
	sqlReview: boolean;
	summary: string;
	continuationCue: boolean;
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
const lightPushDoneBySession = new Map<string, boolean>();
const packageResolveFailuresBySession = new Map<string, { count: number; packages: string[] }>();
const validationFailuresBySession = new Map<string, Map<string, { count: number; commands: string[] }>>();

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
	lightPushDoneBySession.delete(key);
	packageResolveFailuresBySession.delete(key);
	validationFailuresBySession.delete(key);
	if (guardBySession.size <= MAX_GUARD_STATES) return;
	const oldest = [...guardBySession.entries()].sort((a, b) => Date.parse(a[1].createdAt) - Date.parse(b[1].createdAt))[0];
	if (oldest) {
		guardBySession.delete(oldest[0]);
		lightPushDoneBySession.delete(oldest[0]);
		packageResolveFailuresBySession.delete(oldest[0]);
		validationFailuresBySession.delete(oldest[0]);
	}
}

function normalizeText(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function hasAny(text: string, patterns: RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(text));
}

function isStatusNotePrompt(prompt: string): boolean {
	const trimmed = prompt.trim();
	if (!trimmed) return false;
	return trimmed.startsWith("[dependency-bootstrap]")
		|| trimmed.startsWith("## Worktree cwd binding")
		|| trimmed.startsWith("Workflow guard for this turn:")
		|| trimmed.startsWith("WORKTREE DEPENDENCY BOOTSTRAP:");
}

function isContinuationCue(normalized: string): boolean {
	return /^(계속|계속해|이어가|이어서|진행|진행해|다음|다음으로|continue|proceed|go on|next)$/.test(normalized);
}

function isSqlReviewPrompt(prompt: string, normalized: string): boolean {
	const sqlMutationSignal = /(?:^|\n)\s*(?:START\s+TRANSACTION\s*;|UPDATE\s+[`\w.]+|INSERT\s+INTO\s+[`\w.]+|DELETE\s+FROM\s+[`\w.]+|COMMIT\s*;)/iu.test(prompt);
	if (!sqlMutationSignal) return false;
	return hasAny(normalized, [
		/그대로.*(?:돼|되나|하면|실행)/,
		/(?:이거|sql|쿼리).*(?:맞아|맞나|검토|봐줘|확인|실행|복구)/,
		/(?:복구|원복|테스트\s*데이터|테스트\s*상태|verify[- ]?report).*(?:돼|되나|맞아|확인)/,
		/(?:run|execute|review|check|ok|safe).*(?:sql|query|transaction)/,
	]);
}

function classifyPrompt(prompt: string, sessionFile?: string): GuardState {
	const normalized = normalizeText(prompt);
	const statusNote = isStatusNotePrompt(prompt);
	const continuationCue = !statusNote && isContinuationCue(normalized);
	const explicitHeavy = !statusNote && hasAny(normalized, [
		/verify[- ]?report|검증\s*리포트|캡처\s*리포트|full\s*report/,
		/stress[- ]?interview|fan[- ]?out|subagent|worker|병렬|전체\s*검증|풀\s*검증/,
		/다중\s*(role|viewport|계정|권한)|before[- ]?after|회귀\s*검증|e2e/,
	]);
	const auditRequired = !statusNote && hasAny(normalized, [
		/(이미|전에|기존|고친|해결|대응|미대응|남은|remaining|fixed|unfixed).*(구분|분리|확인|정리|audit|오디트)/,
		/(불편|friction|느렸|느림|느린|오버헤드|과했|과한|늘어지|지연|판단실수|스트레스).*(대응|해결|남은|미대응|분석|정리|뒤져|찾아|조사)/,
		/(작업|워크플로|플로우).*(늘어지|지연|과했|과한|판단실수|스트레스)/,
		/(already fixed|still missing|remaining gap|fixed vs)/,
	]);
	const sqlReview = !statusNote && isSqlReviewPrompt(prompt, normalized);
	const verifyReport = explicitHeavy && hasAny(normalized, [/verify[- ]?report|검증\s*리포트|캡처\s*리포트/]);
	const knowledge = !statusNote && hasAny(normalized, [/ember|knowledge|불씨|지식|stale|freshness/]);
	const explicitPrAction = !statusNote && hasAny(normalized, [/\bpr\b|pull request|create-pr|pr\s*(생성|만들|올려|확인|체크)|리뷰\s*요청/]);
	const ship = !statusNote && hasAny(normalized, [/\bpr\b|pull request|commit|push|merge|ship|릴리즈|커밋|푸시/]);
	const hotfix = !statusNote && hasAny(normalized, [/hotfix|핫픽스|간단|문구|오타|copy|카피|one[- ]?line|한\s*줄|작은|small|quick|빨리|이거\s*하나/]);
	const noMutation = hasAny(normalized, [/수정하지|고치지|변경하지|건드리지|커밋하지|푸시하지|하지\s*마|하지마|no\s*(edit|change|commit|push)|do\s*not\s*(edit|change|commit|push)/]);
	const implementationDirective = !statusNote && !sqlReview && !noMutation && hasAny(normalized, [
		/구현|수정|고쳐|고치|바꿔|변경|추가|삭제|반영|적용|패치|생성|작성|만들|개선|보강|수습|처리|대응|자동화|고도화/,
		/implement|fix|change|add|remove|update|create|improve|harden|patch|apply|wire/,
		/작업\s*(?:해|해줘|해봐|하자|진행)/,
		/진행\s*(?:해|해줘|해봐|하자)/,
	]);
	const implement = implementationDirective;
	const readOnlyShipSignal = hasAny(normalized, [/확인|상태|왜|원인|알려|조회|봐줘|보여|status|check|view/]);
	const explicitCommitPushOnly = ship && !implement && !noMutation && !readOnlyShipSignal && hasAny(normalized, [
		/커밋\s*[\/]?\s*푸시/,
		/커밋푸시/,
		/커밋.*푸시/,
		/푸시.*커밋/,
		/commit\s*(?:and|&|\/)?\s*push/,
		/push\s*(?:and|&|\/)?\s*commit/,
		/(?:그냥|걍)?\s*푸시(?:해|해줘|하자|만)?/,
		/\bpush\b\s*(?:it|this|해|해줘|하자|please|now)/,
	]);
	const investigate = !statusNote && !implementationDirective && hasAny(normalized, [/확인|봐줘|살펴|분석|조사|찾아|왜|원인|검토|audit|오디트|알아봐/]);
	const answerOnly = !statusNote && hasAny(normalized, [/설명|알려줘|어떻게|무슨\s*뜻|질문|궁금|정리해줘/]) && !implement && !ship;

	let intent: Intent = "unknown";
	if (statusNote) intent = "status_note";
	else if (sqlReview) intent = "investigate";
	else if (auditRequired && !implementationDirective) intent = "audit";
	else if (verifyReport) intent = "verify_report";
	else if (knowledge && implement) intent = "knowledge";
	else if (hotfix && implement) intent = "hotfix";
	else if (explicitCommitPushOnly) intent = "ship";
	else if (ship && implement) intent = "ship";
	else if (implement) intent = "implement";
	else if (investigate) intent = "investigate";
	else if (answerOnly) intent = "answer";
	else if (knowledge) intent = "knowledge";

	let weight: WorkflowWeight = "none";
	if (sqlReview) weight = "none";
	else if (intent === "verify_report" || explicitHeavy) weight = "full";
	else if (intent === "hotfix" || (intent === "ship" && explicitCommitPushOnly)) weight = "light";
	else if (intent === "implement" || intent === "ship" || intent === "knowledge") weight = "standard";
	else if (intent === "investigate" || intent === "audit" || intent === "answer") weight = "none";

	const explicitMutation = !statusNote && !noMutation && (implementationDirective || ship || explicitCommitPushOnly || hasAny(normalized, [/작업해|진행해|만들어|적용해|개선해|보강해|커밋|푸시/]));
	const explicitSingleCommit = hasAny(normalized, [/단일\s*커밋|한\s*커밋|one\s*commit|single\s*commit|squash/]);

	const summary = [
		`intent=${intent}`,
		`weight=${weight}`,
		continuationCue ? "continuation=latest-intent" : null,
		auditRequired ? "audit=required" : null,
		sqlReview ? "sqlReview=detected" : null,
		explicitHeavy && !sqlReview ? "heavy=explicit" : null,
		!explicitMutation ? "mutation=not-requested" : null,
	].filter(Boolean).join(" · ");

	return { prompt, intent, weight, explicitHeavy, explicitMutation, explicitSingleCommit, explicitCommitPushOnly, explicitPrAction, auditRequired, sqlReview, summary, continuationCue, createdAt: new Date().toISOString(), sessionFile };
}

function fastPaceBudgetSeconds(state: GuardState): number | undefined {
	if (state.intent === "status_note") return undefined;
	if (state.intent === "answer" || state.intent === "investigate" || state.intent === "audit" || state.weight === "light") return 30;
	if (state.weight === "standard") return 60;
	if (state.weight === "full") return 120;
	return undefined;
}

function buildSystemPrompt(state: GuardState): string {
	const lines = [
		"Workflow guard for this turn:",
		`- Auto-classification: ${state.summary}.`,
		"- Treat this as a guardrail generated from the user request, not as optional style advice.",
		"- If the classification seems wrong, ask one short clarifying question before mutating files or starting heavy workflow.",
	];

	if (state.intent !== "status_note") {
		lines.push(
			"- Validation command fan-out discipline is a soft nudge/checklist, not a hard block by itself: before running lint/test/type-check/build/bootstrap, state the expected file/package/app fan-out in one line and prefer direct executables with explicit paths when narrowing matters.",
			"- Do not assume `pnpm <script> -- <path>` narrows the script. If a wrapper script might contain fixed globs or ignore args, inspect package.json or use a direct command such as `pnpm exec eslint <file>` / `pnpm vitest run <file>`. If you still use the wrapper, mention the uncertainty and expected fan-out.",
			"- Whole app/repo/workspace validation or wildcard package builds require a one-line reason tied to the current diff. Dependency/bootstrap recovery gets one narrow package-level attempt; after a second missing package/module signal, stop and report BLOCKED or ask before broad workspace build.",
			"- Search/history fan-out discipline: before the first investigative search/history command (`git log -S`, `git grep`, `rg`, `find`, `gh search`, `vcc_recall`), estimate ref/path/history/output fan-out. If the user gave anchors such as a symbol, file, URL, PR, commit, or branch, start with an anchored narrow lookup; broad repo/all-history/all-branch search is a soft fallback only after anchored lookup misses, and should be preceded by a one-line reason.",
		);
		if (state.weight === "standard" || state.weight === "full") {
			lines.push(
				"- Long-running session control: label phase transitions (discovery → implementation → mechanical validation → commit → UI/manual verification → PR/push). At 30 minutes report current phase/completed/remaining/blockers; at 60 minutes ask whether to continue or cut a partial handoff/commit.",
				"- Validation loop gate: if the same lint/test/type-check/codegen/build family fails twice, stop silent retrying and report cause, attempted fix, and next options before running broader recovery.",
				"- Commit-complete stop-line: when commit(s) are created, report the save point before starting UI/manual verification, PR, push, or extra status checks unless the user already requested that next phase.",
			);
		}
	}

	const paceSeconds = fastPaceBudgetSeconds(state);
	if (paceSeconds) {
		lines.push(
			`- FAST RESPONSE PACE: after each tool result, use a ${paceSeconds}-second decision budget. Choose one of: next narrow tool call, interim conclusion, scope-gate question, or final report. Do not silently spend minutes deciding the next step.`,
			"- Silence breaker: if the next step is broad/long, a command may take more than ~30 seconds, or the previous command aborted/timed out/returned no usable evidence, state a short Korean progress/strategy-reset line before the next tool call instead of waiting for the user to ask what is happening.",
			"- Tool exploration discipline: do not call broad tool list/schema/full-content discovery (`mcp list`, broad `describe`, `get_mcp_content`, raw transcript/context mining) unless the user explicitly asks about tools, a direct call fails from schema uncertainty, or the current evidence cannot identify the required tool.",
		);
	}

	if (state.auditRequired && state.explicitMutation && state.intent !== "audit") {
		lines.push(
			"- WORKFLOW FRICTION IMPLEMENTATION PATH: the user asked to inspect examples and improve the workflow, not to stop at a read-only audit.",
			"- Use collected evidence to patch guard rules/tests/docs; do not ask for another implementation confirmation just because the prompt contains 조사/뒤져/사례 수집.",
		);
	}

	if (state.sqlReview) {
		lines.push(
			"- SQL REVIEW SOFT GATE: the prompt includes a concrete mutating SQL/transaction review request.",
			"- If the answer depends on current row/table state, run a read-only DB SELECT with the project-approved DB tool before concluding.",
			"- If DB access is unavailable or environment is unclear, say that the SQL cannot be confirmed from current row state yet; do not answer with speculative 가능성 language as if it were verified.",
			"- Keep this as a reminder, not a hard block: syntax-only or conceptual SQL questions may be answered without DB lookup when current row state is irrelevant.",
		);
	}
	if (state.intent === "status_note") {
		lines.push(
			"- HARD STATUS NOTE PATH: the latest prompt is an environment/readiness/context-binding note, not a user task directive.",
			"- Do not resume older implementation, validation, PR, or worktree threads because of this note.",
			"- Do not call tools for this turn unless the user adds a real request; at most acknowledge the status in one short Korean sentence.",
			"- Dependency/bootstrap READY, worktree cwd binding, workflow guard, and compaction notes describe state only; they do not override the latest explicit user intent.",
		);
	}
	if (state.continuationCue) {
		lines.push(
			"- CONTINUATION CUE PATH: the latest prompt is a short continuation cue, not a new topic.",
			"- Continue the latest non-status user intent from the current conversation/Current Conversation Contract.",
			"- Do not continue from dependency/bootstrap READY, worktree cwd binding, workflow guard, or other status notes.",
			"- Do not answer with an options/menu question just because the cue is short; take the next concrete verification/implementation step when the prior intent is clear.",
			"- If the prior intent is verification and tools are available, run one next narrow verification instead of only describing what could be checked.",
			"- Ask a clarifying question only if the latest non-status intent is genuinely ambiguous.",
		);
	}
	if (state.intent === "answer" || state.intent === "investigate") {
		lines.push(
			"- HARD PATH: this turn is read-only by default. Do not edit/write files, create worktrees, install dependencies, commit, or push unless the user explicitly turns the request into implementation.",
			"- Investigation scope lock: first inspect only the scope explicitly named in the user's latest request. Do not chase adjacent work status, diffs, commits, worktrees, or recovery/implementation state unless that directly answers the named question.",
			"- Scope expansion gate: when the next check would substantially widen scope (for example crash/log → worktree progress, symptom check → fix, dev/preview → production, or source evidence → unrelated session history), stop and ask the user before continuing.",
			"- No-result handoff: if the current scope does not answer the question, report exactly what you checked and what you could not find, then offer 1–3 concrete next search directions and ask which one to inspect.",
			"- Progress heartbeat: for quick lookup/triage, use the silence breaker when the first route stalls or broadens; for genuinely long investigations, send a short Korean progress update at least every 3 minutes explaining what you are checking and why it is taking time.",
		);
	}
	if (state.intent === "audit") {
		lines.push(
			"- HARD AUDIT PATH: before saying an issue is still unresolved, map friction → response evidence → current state → remaining gap. Use the injected audit snapshot or workflow_guard(action=audit).",
			"- Do not classify an item as 미대응 just because it appeared in an old friction session; first check whether a later commit/history entry already addressed it.",
		);
	}
	if (state.weight === "light") {
		lines.push(
			"- HARD LIGHT PATH: default to scope lock → focused change → nearest validation → atomic commit → push. Do not start worker fan-out, stress interview, capture-heavy verify report, or deep session/context mining unless the user explicitly asks or a new risk axis appears.",
			"- Light PR/ship path: use `GIT_OPTIONAL_LOCKS=0 git status --short --branch`, current diff, recent commits, and the user's explicit intent. Do not run full transcript/session extraction just to fill templates.",
			"- For tiny copy/label hotfixes with explicit paths, prefer `auto_commit action=quick` over a heavy commit_plan roundtrip when using auto_commit.",
			"- If a commit tool reports `committed_not_pushed` or `push: skipped` and the user did not explicitly ask to hold push, immediately run `git push` before the final response.",
		);
		if (!state.explicitPrAction) {
			lines.push(
				"- HARD LIGHT PUSH TERMINAL PATH: when a light task reaches a successful push, stop tool use immediately. Do not run extra `git status`, `git log`, `gh pr view`, `work_context`, or PR/branch checks unless the user explicitly asked for PR/status work or push failed.",
				"- Final response after successful push must be one short Korean line like `완료: <sha> <message>`.",
			);
		}
		if (state.explicitCommitPushOnly) {
			lines.push(
				"- The latest user request explicitly asks to commit/push existing work. Obey that request; do not reinterpret it as a broader implementation, PR audit, or verification task.",
			);
		}
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
	if (state.explicitMutation && state.intent !== "status_note") return undefined;
	if (state.intent !== "answer" && state.intent !== "investigate" && state.intent !== "status_note") return undefined;
	return [
		`workflow_guard blocked ${toolName}: current request was classified as ${state.intent} (${state.summary}).`,
		state.intent === "status_note" ? "This prompt is a status note, not a user task directive." : "This path is read-only by default.",
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

function isGitPushCommand(command: string): boolean {
	return /(^|[;&|]\s*)git\s+push\b/.test(command.replace(/\s+/g, " "));
}

function validationWrapperBypass(command: string): boolean {
	return /WORKFLOW_GUARD_ALLOW_WRAPPER_FANOUT=1|workflow-guard:allow-wrapper-fanout|workflow_guard:allow_wrapper_fanout/.test(command);
}

function broadBootstrapBypass(command: string): boolean {
	return /WORKFLOW_GUARD_ALLOW_BROAD_BOOTSTRAP=1|workflow-guard:allow-broad-bootstrap|workflow_guard:allow_broad_bootstrap/.test(command);
}

function hasPathLikeArgAfterDoubleDash(command: string): boolean {
	const after = command.split(/\s--\s/u).slice(1).join(" -- ");
	return after.split(/\s+/u).filter(Boolean).some((arg) => !arg.startsWith("-") || /[/.]/u.test(arg));
}

function isTargetedValidationWrapperCommand(command: string): boolean {
	const compact = command.replace(/\s+/g, " ").trim();
	if (!/\bpnpm\b/.test(compact) || !/\s--\s+\S/.test(compact) || !hasPathLikeArgAfterDoubleDash(compact)) return false;
	return /(?:^|[;&|]\s*)pnpm\s+(?:--filter|-F)\s+\S+\s+(?:\S*?(?:test|lint|type-?check|build|migration)\S*)\s+--\s+\S/.test(compact)
		|| /(?:^|[;&|]\s*)pnpm\s+(?:\S*?(?:test|lint|type-?check|build|migration)\S*)\s+--\s+\S/.test(compact);
}

function isBroadWildcardWorkspaceBuildCommand(command: string): boolean {
	const compact = command.replace(/['"]/g, "").replace(/\s+/g, " ").trim();
	return /(?:^|[;&|]\s*)(?:pnpm\s+)?turbo\s+build\b/.test(compact)
		&& /--filter(?:=|\s+)@?[^\s]*\*/.test(compact);
}

function validationWrapperNudgeNote(command: string): string {
	return [
		"",
		"[workflow_guard] validationWrapperFanoutNudge: true",
		"- 검증 wrapper 명령이 path 인자와 함께 실행됐습니다. 이것은 hard block이 아니라 soft nudge입니다.",
		"- package.json script가 `-- <path>`를 실제로 전달하는지 확인했거나, 직접 executable을 쓰는 것이 더 안전합니다.",
		`- Command: ${command}`,
		"- 다음 검증 전에는 `예상 fan-out: <파일/패키지/앱 범위>`를 한 줄로 먼저 적고, 필요하면 `pnpm exec eslint <file>` / `pnpm vitest run <file>`처럼 fan-out이 명시적인 명령을 우선하세요.",
	].join("\n");
}

function notifyValidationWrapperNudge(ctx: any): void {
	try {
		ctx?.ui?.notify?.("검증 wrapper fan-out 확인: hard block은 아니지만 package.json 인자 전달 근거 또는 direct executable을 우선하세요.", "warning");
	} catch {
		// UI notification is best-effort; the tool result annotation still carries the nudge.
	}
}

function broadBootstrapBlockReason(command: string, failures: { count: number; packages: string[] } | undefined): string {
	const packages = failures?.packages.length ? failures.packages.join(", ") : "unknown package";
	return [
		"workflow_guard blocked broad workspace bootstrap/build after package resolve failure.",
		`Observed package/module resolve failures: ${packages}.`,
		`Command: ${command}`,
		"Use one narrow package-level recovery, or stop and report BLOCKED/ask before wildcard workspace build.",
		"If this broad build is explicitly required, retry with WORKFLOW_GUARD_ALLOW_BROAD_BOOTSTRAP=1 and state the reason.",
	].join("\n");
}

function packageResolveFailurePackages(text: string): string[] {
	const packages = new Set<string>();
	const patterns = [
		/Failed to resolve entry for package ["']([^"']+)["']/g,
		/Cannot find module ["']([^"']+)["']/g,
	];
	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			const pkg = match[1];
			if (pkg?.startsWith("@")) packages.add(pkg.split("/").slice(0, 2).join("/"));
			else if (pkg) packages.add(pkg);
		}
	}
	return [...packages];
}

function packageResolveFailureNote(sessionRecord: { count: number; packages: string[] }): string {
	const packages = sessionRecord.packages.length ? sessionRecord.packages.join(", ") : "unknown package";
	const severity = sessionRecord.count >= 2 ? "scopeGateRequired" : "narrowRecoveryOnly";
	const next = sessionRecord.count >= 2
		? "Second package/module resolve failure observed. Stop broad recovery; report BLOCKED or ask before workspace-wide build/bootstrap."
		: "One narrow package-level recovery is allowed. Do not run wildcard workspace build/bootstrap as the next step.";
	return [
		"",
		`[workflow_guard] validationBootstrapScopeGate: ${severity}`,
		`- Package/module resolve failure count in this turn: ${sessionRecord.count} (${packages}).`,
		`- ${next}`,
		"- If you continue, state the exact package/file fan-out before the next validation/bootstrap command.",
	].join("\n");
}

function validationCommandKind(command: string): string | undefined {
	const compact = command.replace(/\s+/g, " ").trim();
	if (!compact) return undefined;
	if (/\b(codegen|generate-?schema|graphql-codegen|merge-graphql-schema)\b/u.test(compact)) return "codegen";
	if (/\b(type-?check|tsc)\b/u.test(compact)) return "type-check";
	if (/\b(lint|eslint|biome)\b/u.test(compact)) return "lint";
	if (/\b(test|vitest|jest|playwright)\b/u.test(compact)) return "test";
	if (/\b(build|turbo\s+build)\b/u.test(compact)) return "build";
	return undefined;
}

function recordValidationFailure(session: string, kind: string, command: string): { count: number; commands: string[] } {
	const byKind = validationFailuresBySession.get(session) ?? new Map<string, { count: number; commands: string[] }>();
	const current = byKind.get(kind) ?? { count: 0, commands: [] };
	const next = { count: current.count + 1, commands: [...current.commands, command].slice(-3) };
	byKind.set(kind, next);
	validationFailuresBySession.set(session, byKind);
	return next;
}

function validationLoopFailureNote(kind: string, record: { count: number; commands: string[] }): string | undefined {
	if (record.count < 2) return undefined;
	return [
		"",
		"[workflow_guard] validationLoopGate: scopeGateRequired",
		`- Same validation family failed ${record.count} times in this turn: ${kind}.`,
		"- Stop silent retrying. Report the cause you found, what you already changed, and 1–3 next options before running broader recovery or another retry.",
		`- Last command: ${record.commands.at(-1) ?? "unknown"}`,
	].join("\n");
}

function commitCompleteStopLineNote(state: GuardState | undefined, event: any): string | undefined {
	if (!state || state.intent === "status_note" || state.weight === "none") return undefined;
	const bashCommit = event.toolName === "bash" && toolResultSucceeded(event) && isGitCommitCommand(toolResultCommand(event)) && !isGitPushCommand(toolResultCommand(event));
	const autoCommitDone = event.toolName === "auto_commit"
		&& Array.isArray(event.details?.commits)
		&& event.details.commits.length > 0
		&& event.details?.completion !== "committed_not_pushed"
		&& event.details?.pushed !== false;
	if (!bashCommit && !autoCommitDone) return undefined;
	return [
		"",
		"[workflow_guard] commitCompleteStopLine: true",
		"- Commit save point created. Report this phase boundary before starting UI/manual verification, PR, push, or extra status/log checks unless the user already requested that next phase.",
	].join("\n");
}

function toolResultSucceeded(event: any): boolean {
	if (event.isError) return false;
	const code = event.details?.code ?? event.details?.exitCode ?? event.details?.statusCode;
	if (typeof code === "number") return code === 0;
	const text = (event.content ?? []).map((item: any) => String(item?.text ?? "")).join("\n");
	if (/Command exited with code\s+[1-9]/u.test(text)) return false;
	return true;
}

function toolResultCommand(event: any): string {
	return String(event.input?.command ?? event.details?.command ?? event.toolCall?.input?.command ?? "");
}

function autoCommitPushed(details: any): boolean {
	return details?.completion === "committed_and_pushed" || details?.pushed === true || details?.push?.status === "pushed";
}

function shouldStopAfterPush(state: GuardState): boolean {
	return state.weight === "light" && !state.explicitPrAction;
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

function statusNoteToolBlockReason(state: GuardState, toolName: string): string {
	return [
		`workflow_guard blocked ${toolName}: current prompt is a status note (${state.summary}).`,
		"Status/readiness/context-binding notes must not trigger old implementation or validation work.",
		"Wait for an explicit user request, or answer with a short acknowledgement only.",
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
		"Slice commit-or-explain guard:",
		`- Current slice ${card.currentSlice.id}: ${card.currentSlice.title}`,
		"- Treat a verified slice as a commit candidate, not as something to batch until the whole implementation is done.",
		"- When the slice's nearest validation passes, inspect git status/diff, call work_context action=commit_plan to write an explicit auto_commit JSON plan, then call auto_commit action=apply after reviewing the plan.",
		"- Pending migration execution, UI capture, or final verify-report is a ship-readiness caveat, not a valid reason by itself to leave a verified code slice uncommitted.",
		"- Before a final response with dirty diff: either commit the verified slice, or explicitly record the concrete reason in work_context checkpoint. Do not surprise the user at the end with a large uncommitted diff.",
		"- This is not an auto-stage permission: auto_commit must still use explicit JSON plans or explicit quick paths.",
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

function fastPaceToolResultNote(state: GuardState, event: any): string | undefined {
	const seconds = fastPaceBudgetSeconds(state);
	if (!seconds) return undefined;
	if (event.toolName === "auto_commit" || event.toolName === "tui_ask" || event.toolName === "frame_studio") return undefined;
	if (event.toolName === "bash" && isGitPushCommand(toolResultCommand(event))) return undefined;
	return [
		"",
		"[workflow_guard] fastPaceRequired: true",
		`- After this tool result, use a ${seconds}-second decision budget.`,
		"- Choose one: next narrow tool call, interim conclusion, scope-gate question, or final report.",
		"- If the previous command stalled/aborted/no-result or the next step is broad/long, state a short Korean progress/strategy-reset line before the next tool call.",
		"- Avoid silent tool/schema/context exploration. If evidence is enough, report now; if not, state the exact remaining gap.",
	].join("\n");
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

		if (state.intent === "status_note" && event.toolName !== "workflow_guard") {
			return { block: true, reason: statusNoteToolBlockReason(state, event.toolName) };
		}

		if (lightPushDoneBySession.get(sessionKey(ctx)) && event.toolName !== "workflow_guard") {
			const command = event.toolName === "bash" ? String(event.input?.command ?? "") : "";
			const isExplicitBypass = event.toolName === "bash" && /WORKFLOW_GUARD_ALLOW_POST_PUSH_CHECK=1/.test(command);
			if (!isExplicitBypass) {
				return {
					block: true,
					reason: [
						"workflow_guard blocked extra tool use: light task already reached successful push.",
						"Report completion now in one short Korean line. Do not run extra status/log/PR/work_context checks unless the user asks a new question.",
					].join("\n"),
				};
			}
		}

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
			if (isTargetedValidationWrapperCommand(command) && !validationWrapperBypass(command)) {
				notifyValidationWrapperNudge(ctx);
			}
			if (isBroadWildcardWorkspaceBuildCommand(command) && !broadBootstrapBypass(command)) {
				const failures = packageResolveFailuresBySession.get(sessionKey(ctx));
				if (failures?.count) return { block: true, reason: broadBootstrapBlockReason(command, failures) };
				if (state.weight === "light" && !state.explicitHeavy) return { block: true, reason: heavyToolBlockReason(state, "broad wildcard workspace build") };
			}
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

	pi.on("tool_result", async (event, ctx) => {
		const state = ctx ? guardBySession.get(sessionKey(ctx)) : undefined;
		if (ctx && state) {
			const command = toolResultCommand(event);
			const pushed = event.toolName === "bash"
				? isGitPushCommand(command) && toolResultSucceeded(event)
				: event.toolName === "auto_commit" && autoCommitPushed(event.details);
			if (shouldStopAfterPush(state) && pushed) {
				lightPushDoneBySession.set(sessionKey(ctx), true);
				const note = [
					"",
					"[workflow_guard] terminalActionRequired: true",
					"- Light task reached successful push.",
					"- Stop tool use now. Do not run extra `git status`, `git log`, `gh pr view`, `work_context`, or PR/branch checks.",
					"- Final response must be one short Korean completion line, e.g. `완료: <sha> <message>`.",
				].join("\n");
				return appendWorkflowGuardResult(event, note, { terminalActionRequired: true, sourceTool: event.toolName });
			}
		}

		const bashCommand = ctx && state && event.toolName === "bash" ? toolResultCommand(event) : "";
		const validationWrapperNudge = bashCommand && isTargetedValidationWrapperCommand(bashCommand) && !validationWrapperBypass(bashCommand)
			? validationWrapperNudgeNote(bashCommand)
			: undefined;
		let packageResolveNote: string | undefined;
		let validationLoopNote: string | undefined;
		if (ctx && state && event.toolName === "bash" && !toolResultSucceeded(event)) {
			const command = bashCommand;
			const output = (event.content ?? []).map((item: any) => String(item?.text ?? "")).join("\n");
			const packages = packageResolveFailurePackages(output);
			if (packages.length) {
				const key = sessionKey(ctx);
				const current = packageResolveFailuresBySession.get(key) ?? { count: 0, packages: [] };
				const nextPackages = [...new Set([...current.packages, ...packages])];
				const nextRecord = { count: current.count + 1, packages: nextPackages };
				packageResolveFailuresBySession.set(key, nextRecord);
				packageResolveNote = packageResolveFailureNote(nextRecord);
			}
			const validationKind = validationCommandKind(command);
			if (validationKind) {
				const record = recordValidationFailure(sessionKey(ctx), validationKind, command);
				validationLoopNote = validationLoopFailureNote(validationKind, record);
			}
		}

		const continuityNote = actionContinuityNote(event.toolName, event.details);
		const commitStopLineNote = commitCompleteStopLineNote(state, event);
		const paceNote = state ? fastPaceToolResultNote(state, event) : undefined;
		const note = [continuityNote, validationWrapperNudge, packageResolveNote, validationLoopNote, commitStopLineNote, paceNote].filter(Boolean).join("\n");
		if (!note) return undefined;
		return appendWorkflowGuardResult(event, note, {
			nextActionRequired: Boolean(continuityNote),
			validationWrapperFanoutNudge: Boolean(validationWrapperNudge),
			validationBootstrapScopeGate: Boolean(packageResolveNote),
			validationLoopGate: Boolean(validationLoopNote),
			commitCompleteStopLine: Boolean(commitStopLineNote),
			fastPaceRequired: Boolean(paceNote),
			sourceTool: event.toolName,
		});
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
