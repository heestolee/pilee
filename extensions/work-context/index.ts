import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
	formatWorkContextCard,
	gateWorkContext,
	loadOrDeriveWorkContext,
	refreshWorkContext,
	saveWorkContext,
	type WorkContextCard,
	type WorkContextMode,
	type WorkContextSlice,
} from "../utils/work-context.ts";
import { buildSliceCommitPlan, sliceCommitPlanFileName } from "./slice-commit-plan.ts";

const sliceSchema = Type.Object({
	id: Type.String({ description: "Slice id, e.g. S1 or SLICE-1" }),
	title: Type.String({ description: "Current slice title" }),
	scope: Type.Optional(Type.Array(Type.String(), { description: "Paths/prefixes/globs this slice may touch" })),
	acceptance: Type.Optional(Type.Array(Type.String(), { description: "Done-when checks for this slice" })),
	status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed"), Type.Literal("blocked")])),
});

function toolText(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function sessionFile(ctx: { sessionManager?: { getSessionFile?: () => string | undefined } }) {
	return ctx.sessionManager?.getSessionFile?.();
}

async function gitOutput(pi: ExtensionAPI, cwd: string, args: string[]): Promise<string> {
	const result = await pi.exec("git", args, { cwd });
	if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr?.trim() || result.stdout?.trim() || "unknown"}`);
	return result.stdout ?? "";
}

function writeJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function mergeSlice(card: WorkContextCard, params: { sliceId?: string; slice?: Partial<WorkContextSlice> }): WorkContextCard {
	let selected: WorkContextSlice | undefined;
	if (params.sliceId) selected = card.slices.find((slice) => slice.id === params.sliceId);
	if (!selected && params.slice?.id) selected = card.slices.find((slice) => slice.id === params.slice?.id);
	if (!selected && params.slice) {
		selected = {
			id: params.slice.id || "S-current",
			title: params.slice.title || "현재 slice",
			scope: params.slice.scope ?? [],
			acceptance: params.slice.acceptance ?? [],
			status: params.slice.status ?? "in_progress",
		};
	}
	if (!selected) throw new Error(`slice not found: ${params.sliceId ?? params.slice?.id ?? "(missing)"}`);
	const next = { ...selected, ...params.slice, status: params.slice?.status ?? selected.status ?? "in_progress" } as WorkContextSlice;
	const exists = card.slices.some((slice) => slice.id === next.id);
	return {
		...card,
		currentSlice: next,
		slices: exists ? card.slices.map((slice) => slice.id === next.id ? next : slice) : [...card.slices, next],
	};
}

export default function workContextExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "work_context",
		label: "Work Context",
		description: "Inspect or update the work-unit scoped Working Context Card. Use it to keep large context as a compact current-slice contract instead of carrying raw transcripts.",
		promptSnippet: "Use work_context status/refresh before implementation in a framed worktree; use set_slice/checkpoint when moving between implementation slices.",
		promptGuidelines: [
			"Working Context Card is the compact context carried each turn: goal, current slice, must keep/not, open questions, verify focus, and artifact refs.",
			"Do not paste full transcripts into the card. Keep raw history in transcriptRef/archive and store only actionable current context.",
			"Before editing a standard/full framed work, make sure currentSlice is selected and not blocked by open questions.",
			"When a slice is complete and nearest validation passed, use action=commit_plan to create an explicit auto_commit JSON plan, then call auto_commit apply after reviewing it.",
		],
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("status"),
				Type.Literal("refresh"),
				Type.Literal("set_slice"),
				Type.Literal("checkpoint"),
				Type.Literal("gate_check"),
				Type.Literal("commit_plan"),
			]),
			mode: Type.Optional(Type.Union([Type.Literal("light"), Type.Literal("standard"), Type.Literal("full"), Type.Literal("unknown")])),
			goal: Type.Optional(Type.String()),
			sliceId: Type.Optional(Type.String()),
			slice: Type.Optional(sliceSchema),
			mustKeep: Type.Optional(Type.Array(Type.String())),
			mustNot: Type.Optional(Type.Array(Type.String())),
			verifyFocus: Type.Optional(Type.Array(Type.String())),
			note: Type.Optional(Type.String()),
			lastValidation: Type.Optional(Type.String()),
			commitMessage: Type.Optional(Type.String({ description: "Commit message for action=commit_plan. Defaults to feat: <current slice title>." })),
			includeOutsideScope: Type.Optional(Type.Boolean({ description: "For action=commit_plan, include files outside current slice scope. Defaults to false; outside files are left as leftovers." })),
			paths: Type.Optional(Type.Array(Type.String(), { description: "Paths to check against current slice scope" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const sf = sessionFile(ctx);
			if (params.action === "status") {
				const card = loadOrDeriveWorkContext(ctx.cwd, sf);
				if (!card) return toolText("Working Context Card가 아직 없습니다. /frame 후 work_context refresh를 사용하거나 현재 작업 slice를 set_slice로 고정하세요.", { card: null });
				return toolText(formatWorkContextCard(card), { card, contextPath: card.identity.contextPath, tasksPath: card.identity.tasksPath });
			}

			if (params.action === "refresh") {
				const patch: Partial<WorkContextCard> = {};
				if (params.mode) patch.mode = params.mode as WorkContextMode;
				if (params.goal !== undefined) patch.goal = params.goal;
				if (params.mustKeep) patch.mustKeep = params.mustKeep;
				if (params.mustNot) patch.mustNot = params.mustNot;
				if (params.verifyFocus) patch.verifyFocus = params.verifyFocus;
				const card = refreshWorkContext(ctx.cwd, sf, patch);
				return toolText(`Working Context Card를 갱신했습니다.\n\n${formatWorkContextCard(card)}`, { card, contextPath: card.identity.contextPath, tasksPath: card.identity.tasksPath });
			}

			let card = loadOrDeriveWorkContext(ctx.cwd, sf) ?? refreshWorkContext(ctx.cwd, sf);
			if (params.action === "set_slice") {
				card = mergeSlice(card, { sliceId: params.sliceId, slice: params.slice as Partial<WorkContextSlice> | undefined });
				saveWorkContext(card);
				return toolText(`currentSlice를 고정했습니다.\n\n${formatWorkContextCard(card)}`, { card, contextPath: card.identity.contextPath });
			}

			if (params.action === "checkpoint") {
				card = {
					...card,
					lastKnownState: {
						...card.lastKnownState,
						lastValidation: params.lastValidation ?? card.lastKnownState.lastValidation,
					},
					notes: params.note ? [...(card.notes ?? []), `${new Date().toISOString()} ${params.note}`] : card.notes,
				};
				saveWorkContext(card);
				return toolText(`checkpoint를 기록했습니다.\n\n${formatWorkContextCard(card)}`, { card, contextPath: card.identity.contextPath });
			}

			if (params.action === "gate_check") {
				const result = gateWorkContext(card, { action: "status", paths: params.paths, requireSlice: true });
				const status = result.level === "pass" ? "PASS" : result.level.toUpperCase();
				return toolText([`work-context gate: ${status}`, ...result.reasons.map((reason) => `- ${reason}`), "", formatWorkContextCard(card)].filter(Boolean).join("\n"), { ...result, card });
			}

			if (params.action === "commit_plan") {
				if (!card.currentSlice) throw new Error("commit_plan requires currentSlice. Use work_context set_slice first.");
				const root = card.identity.root || ctx.cwd;
				const [statusText, head] = await Promise.all([
					gitOutput(pi, root, ["status", "--porcelain"]),
					gitOutput(pi, root, ["rev-parse", "HEAD"]).then((value) => value.trim()),
				]);
				const output = buildSliceCommitPlan({
					card,
					statusLines: statusText.split(/\r?\n/u),
					expectedHead: head,
					message: params.commitMessage,
					includeOutsideScope: params.includeOutsideScope,
				});
				const planPath = join(card.identity.root || card.identity.cwd, ".pi", "auto-commit", sliceCommitPlanFileName(card));
				writeJson(planPath, output.plan);
				const skipped = output.skipped.length ? `\n\nLeft as uncommitted leftovers outside current slice:\n${output.skipped.map((path) => `- ${path}`).join("\n")}` : "";
				return toolText([
					`auto_commit plan을 생성했습니다: ${planPath}`,
					`message: ${output.message}`,
					"paths:",
					...output.included.map((path) => `- ${path}`),
					"",
					"다음 단계: plan을 검토한 뒤 auto_commit action=apply planPath=<위 경로>를 호출하세요.",
					skipped,
				].filter(Boolean).join("\n"), { planPath, plan: output.plan, included: output.included, outsideScope: output.outsideScope, skipped: output.skipped, card });
			}

			throw new Error(`Unsupported work_context action: ${params.action}`);
		},
	});
}
