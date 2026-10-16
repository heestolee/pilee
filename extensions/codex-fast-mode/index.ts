import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isRecord, loadFastConfiguration, saveFastConfiguration, type CodexFastModeState, type FastConfiguration } from "./state.ts";

export { isCodexFastModeEnabled, loadCodexFastModeState, saveCodexFastModeState } from "./state.ts";
export type { CodexFastModeState } from "./state.ts";

export const SUPPORTED_CODEX_PROVIDER = "openai-codex";
export const SUPPORTED_MODEL_IDS = ["gpt-5.4", "gpt-5.5"] as const;
export const SUPPORTED_MODEL_LABEL = SUPPORTED_MODEL_IDS.join(" or ");

const FAST_MODEL_IDS = [...SUPPORTED_MODEL_IDS, "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra"];

type CodexModelLike = { provider?: string; id?: string };

export function isFastSupportedModel(modelId: string | undefined): boolean {
	return SUPPORTED_MODEL_IDS.some((id) => id === modelId);
}

export function shouldUseCodexFastMode(provider: string | undefined, modelId: string | undefined): boolean {
	return provider === SUPPORTED_CODEX_PROVIDER && isFastSupportedModel(modelId);
}

export function applyCodexFastPayload(payload: unknown, model: CodexModelLike, state: CodexFastModeState): unknown {
	if (!isRecord(payload)) return payload;
	if (!state.enabled) return payload;
	if (!shouldUseCodexFastMode(model.provider, model.id)) return payload;

	const text = isRecord(payload.text) ? payload.text : {};
	const nextPayload: Record<string, unknown> = {
		...payload,
		text: {
			...text,
			verbosity: "low",
		},
	};

	if (state.priority) {
		nextPayload.service_tier = "priority";
	}

	return nextPayload;
}

function supportsTier(model: CodexModelLike, state: FastConfiguration): boolean {
	if (state.mode === "ultrafast") return model.provider === "openai" && model.id === "gpt-5.6-sol";
	if (state.mode !== "fast" || !state.priority) return false;
	return state.legacyOnly
		? shouldUseCodexFastMode(model.provider, model.id)
		: model.provider === SUPPORTED_CODEX_PROVIDER && FAST_MODEL_IDS.includes(model.id ?? "");
}

export function applyFastConfiguration(payload: unknown, model: CodexModelLike, state: FastConfiguration): unknown {
	if (!isRecord(payload) || state.mode === "off") return payload;
	const next = state.mode === "fast"
		? applyCodexFastPayload(payload, model, { enabled: true, priority: false })
		: payload;
	if (!isRecord(next) || !supportsTier(model, state)) return next;
	return { ...next, service_tier: state.mode === "fast" ? "priority" : "ultrafast" };
}

export function isFastConfigurationActive(model: CodexModelLike, state: FastConfiguration): boolean {
	return supportsTier(model, state) || (state.mode === "fast" && shouldUseCodexFastMode(model.provider, model.id));
}

export function fastModeStatus(model: CodexModelLike, state: FastConfiguration): string {
	const label = state.mode === "off" ? "OFF" : state.mode === "fast" ? "Fast" : "Ultrafast";
	const active = isFastConfigurationActive(model, state);
	return `${label} · ${active ? "활성" : "비활성"}; priority: ${state.priority ? "ON" : "OFF"} (${model.provider ?? "?"}/${model.id ?? "모델 없음"})`;
}

const ACTIONS = ["on", "off", "priority-on", "priority-off", "status"] as const;

export default function codexFastMode(pi: ExtensionAPI) {
	let configuration: FastConfiguration | undefined;
	let loadedCwd: string | undefined;
	let writes: Promise<void> = Promise.resolve();

	function current(ctx: ExtensionContext): FastConfiguration {
		if (!configuration || loadedCwd !== ctx.cwd) {
			configuration = loadFastConfiguration(ctx.cwd);
			loadedCwd = ctx.cwd;
		}
		return configuration;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus("fast-priority", configuration?.mode === "off" ? undefined
			: configuration ? fastModeStatus(ctx.model ?? {}, configuration) : "Fast · 비활성(설정 오류)");
	}

	function warning(ctx: ExtensionContext, error: unknown): void {
		if (ctx.hasUI) ctx.ui.notify(`Codex Fast 설정 처리 실패: ${error instanceof Error ? error.message : String(error)}`, "warning");
	}

	function command(action: string, ctx: ExtensionContext): Promise<void> {
		// Queue the transition too, not just its write: concurrent bare toggles must
		// observe the preceding mode and cannot collapse into the same value.
		writes = writes.catch(() => undefined).then(() => {
			const state = current(ctx);
			if (action === "status") {
				if (ctx.hasUI) ctx.ui.notify(fastModeStatus(ctx.model ?? {}, state), "info");
				return;
			}
			const next = { ...state };
			if (action === "toggle-fast" || action === "toggle-ultrafast") {
				const mode = action === "toggle-fast" ? "fast" : "ultrafast";
				next.mode = state.mode === mode ? "off" : mode;
				// Entering the external Fast control opts into its original exact list.
				if (state.source === "legacy" && next.mode !== "off") next.priority = true;
				next.legacyOnly = false;
			} else if (action === "on" || action === "off") {
				next.mode = action === "on" ? "fast" : "off";
			} else {
				next.priority = action === "priority-on";
			}
			saveFastConfiguration(next);
			configuration = { ...next, source: "settings" };
			updateStatus(ctx);
			if (ctx.hasUI) ctx.ui.notify(fastModeStatus(ctx.model ?? {}, next), "info");
		});
		return writes.catch((error) => warning(ctx, error));
	}

	pi.registerFlag("fast", { description: "Fast 모드로 시작", type: "boolean", default: false });
	pi.registerFlag("ultrafast", { description: "Ultrafast 모드로 시작", type: "boolean", default: false });
	pi.registerCommand("codex-fast", {
		description: "Fast 토글 또는 기존 on/off/priority/status 제어",
		getArgumentCompletions: (prefix) => {
			const values = ACTIONS.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
			return values.length ? values.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (!action || ACTIONS.some((value) => value === action)) return command(action || "toggle-fast", ctx);
			if (ctx.hasUI) ctx.ui.notify("사용법: /codex-fast [on|off|priority-on|priority-off|status] (인자 없음: 토글)", "info");
		},
	});
	pi.registerCommand("codex-ultrafast", {
		description: "Ultrafast 토글 (기존 지원 모델만 적용)",
		handler: async (args, ctx) => {
			if (!args.trim()) return command("toggle-ultrafast", ctx);
			if (ctx.hasUI) ctx.ui.notify("사용법: /codex-ultrafast (인자 없음: 토글)", "info");
		},
	});
	pi.on("session_start", (_event, ctx) => {
		configuration = undefined;
		try {
			const state = current(ctx);
			if (pi.getFlag("fast") === true) {
				configuration = { ...state, mode: "fast", legacyOnly: false, priority: state.source === "legacy" ? true : state.priority };
			}
			if (pi.getFlag("ultrafast") === true) {
				const selected = current(ctx);
				configuration = { ...selected, mode: "ultrafast", legacyOnly: false, priority: selected.source === "legacy" ? true : selected.priority };
			}
		} catch (error) { warning(ctx, error); }
		updateStatus(ctx);
	});
	pi.on("model_select", (_event, ctx) => updateStatus(ctx));
	pi.on("before_provider_request", (event, ctx) => {
		try {
			const next = applyFastConfiguration(event.payload, ctx.model ?? {}, current(ctx));
			return next === event.payload ? undefined : next;
		} catch (error) { warning(ctx, error); }
	});
}
