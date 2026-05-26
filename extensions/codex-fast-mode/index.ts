import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { streamSimpleOpenAICodexResponses } from "@mariozechner/pi-ai";
import type { ExtensionAPI, Model } from "@mariozechner/pi-coding-agent";

const DEFAULT_STATE_FILE = join(homedir(), ".pi", "agent", "state", "codex-fast-mode.json");
export const SUPPORTED_CODEX_PROVIDER = "openai-codex";
export const SUPPORTED_MODEL_IDS = ["gpt-5.4", "gpt-5.5"] as const;
export const SUPPORTED_MODEL_LABEL = SUPPORTED_MODEL_IDS.join(" or ");

export type CodexFastModeState = {
	enabled: boolean;
	priority: boolean;
};

type CodexModelLike = {
	provider?: string;
	id?: string;
};

function getStateFile(): string {
	return process.env.PILEE_CODEX_FAST_STATE_FILE || DEFAULT_STATE_FILE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isFastSupportedModel(modelId: string | undefined): boolean {
	return SUPPORTED_MODEL_IDS.includes(modelId as (typeof SUPPORTED_MODEL_IDS)[number]);
}

export function loadCodexFastModeState(): CodexFastModeState {
	try {
		const parsed = JSON.parse(readFileSync(getStateFile(), "utf8"));
		if (isRecord(parsed) && typeof parsed.enabled === "boolean") {
			return { enabled: parsed.enabled, priority: parsed.priority === true };
		}
	} catch {
		// Missing/corrupt state defaults to priority tier off.
	}
	return { enabled: false, priority: false };
}

export function isCodexFastModeEnabled(): boolean {
	return loadCodexFastModeState().enabled;
}

export function saveCodexFastModeState(state: CodexFastModeState): void {
	const stateFile = getStateFile();
	mkdirSync(dirname(stateFile), { recursive: true });
	writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

function parseCommandArg(args: string): "on" | "off" | "priority-on" | "priority-off" | "status" | "help" {
	const arg = args.trim().toLowerCase();
	if (arg === "on" || arg === "off" || arg === "status" || arg === "priority-on" || arg === "priority-off") return arg;
	return arg ? "help" : "status";
}

export default function codexFastMode(pi: ExtensionAPI) {
	pi.registerProvider(SUPPORTED_CODEX_PROVIDER, {
		api: "openai-codex-responses",
		streamSimple(model, context, options) {
			return streamSimpleOpenAICodexResponses(model as Model, context, {
				...options,
				onPayload: async (payload, innerModel) => {
					const upstreamPayload =
						typeof options?.onPayload === "function"
							? ((await options.onPayload(payload, innerModel)) ?? payload)
							: payload;

					return applyCodexFastPayload(upstreamPayload, innerModel, loadCodexFastModeState());
				},
			});
		},
	});

	pi.registerCommand("codex-fast", {
		description: `Toggle Codex Fast Mode for ${SUPPORTED_CODEX_PROVIDER}/${SUPPORTED_MODEL_LABEL}`,
		getArgumentCompletions: (prefix) => {
			const options = ["on", "off", "priority-on", "priority-off", "status"];
			const filtered = options.filter((option) => option.startsWith(prefix.trim().toLowerCase()));
			return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const action = parseCommandArg(args);

			if (action === "help") {
				if (ctx.hasUI) ctx.ui.notify("Usage: /codex-fast [on|off|priority-on|priority-off|status]", "info");
				return;
			}

			if (action === "status") {
				if (ctx.hasUI) {
					const state = loadCodexFastModeState();
					ctx.ui.notify(
						`Codex Fast Mode: ${state.enabled ? "ON" : "OFF"}; priority tier: ${state.priority ? "ON" : "OFF"} (${SUPPORTED_CODEX_PROVIDER}/${SUPPORTED_MODEL_LABEL})`,
						"info",
					);
				}
				return;
			}

			const currentState = loadCodexFastModeState();
			const nextState = {
				enabled: action === "on" ? true : action === "off" ? false : currentState.enabled,
				priority: action === "priority-on" ? true : action === "priority-off" ? false : currentState.priority,
			};
			saveCodexFastModeState(nextState);

			if (ctx.hasUI) {
				ctx.ui.notify(
					`Codex Fast Mode ${nextState.enabled ? "enabled" : "disabled"}; priority tier ${nextState.priority ? "enabled" : "disabled"} (${SUPPORTED_CODEX_PROVIDER}/${SUPPORTED_MODEL_LABEL})`,
					"info",
				);
			}
		},
	});
}
