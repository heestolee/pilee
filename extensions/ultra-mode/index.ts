import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_STATE_FILE = join(homedir(), ".pi", "agent", "state", "ultra-mode.json");
export const ULTRA_PROVIDER = "openai-codex";
export const ULTRA_MODEL_IDS = ["gpt-5.6-sol", "gpt-5.6-terra"] as const;
export const ULTRA_MODEL_LABEL = ULTRA_MODEL_IDS.join(" or ");

export type UltraModeState = {
	enabled: boolean;
};

type ModelLike = {
	provider?: string;
	id?: string;
};

function getStateFile(): string {
	return process.env.PILEE_ULTRA_MODE_STATE_FILE || DEFAULT_STATE_FILE;
}

export function loadUltraModeState(): UltraModeState {
	try {
		const parsed = JSON.parse(readFileSync(getStateFile(), "utf8"));
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && typeof parsed.enabled === "boolean") {
			return { enabled: parsed.enabled };
		}
	} catch {
		// Missing/corrupt state keeps the personal mode opt-in.
	}
	return { enabled: false };
}

export function saveUltraModeState(state: UltraModeState): void {
	const stateFile = getStateFile();
	mkdirSync(dirname(stateFile), { recursive: true });
	writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function isUltraSupportedModel(model: ModelLike | null | undefined): boolean {
	return model?.provider === ULTRA_PROVIDER
		&& ULTRA_MODEL_IDS.includes(model.id as (typeof ULTRA_MODEL_IDS)[number]);
}

export function resolveUltraMode(model: ModelLike | null | undefined, state = loadUltraModeState()): boolean {
	return state.enabled && isUltraSupportedModel(model);
}

function parseCommandArg(args: string): "on" | "off" | "status" | "help" {
	const arg = args.trim().toLowerCase();
	if (arg === "on" || arg === "off" || arg === "status") return arg;
	return arg ? "help" : "status";
}

export default function ultraMode(pi: ExtensionAPI) {
	pi.registerCommand("ultra", {
		description: `pilee-owned Ultra mode 제어 (${ULTRA_PROVIDER}/${ULTRA_MODEL_LABEL})`,
		getArgumentCompletions: (prefix) => {
			const options = ["on", "off", "status"];
			const filtered = options.filter((option) => option.startsWith(prefix.trim().toLowerCase()));
			return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const action = parseCommandArg(args);
			if (action === "help") {
				if (ctx.hasUI) ctx.ui.notify("사용법: /ultra [on|off|status]", "info");
				return;
			}

			if (action === "status") {
				if (ctx.hasUI) {
					const state = loadUltraModeState();
					const supported = isUltraSupportedModel(ctx.model);
					ctx.ui.notify(
						`pilee Ultra: ${state.enabled ? "ON" : "OFF"}; current model: ${supported ? "supported" : "unsupported"} (${ctx.model?.provider ?? "no-provider"}/${ctx.model?.id ?? "no-model"})`,
						"info",
					);
				}
				return;
			}

			const enabled = action === "on";
			saveUltraModeState({ enabled });
			const supported = isUltraSupportedModel(ctx.model);
			if (enabled && supported) pi.setThinkingLevel("max");

			if (ctx.hasUI) {
				const suffix = enabled && !supported
					? ` 현재 모델은 미지원이며 ${ULTRA_PROVIDER}/${ULTRA_MODEL_LABEL}에서 활성화됩니다.`
					: enabled
						? " API reasoning은 Max로 설정되고 proactive delegation이 활성화됩니다."
						: " 기존 worker opt-in 정책으로 돌아갑니다.";
				ctx.ui.notify(`pilee Ultra를 ${enabled ? "켰습니다." : "껐습니다."}${suffix}`, "info");
			}
		},
	});
}
