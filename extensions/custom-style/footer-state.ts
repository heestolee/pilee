import { isFastConfigurationActive } from "../codex-fast-mode/index.ts";
import { loadFastConfiguration } from "../codex-fast-mode/state.ts";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { subscribeRepoStatusInvalidation } from "../utils/repo-status-events.ts";
import { createRepoStatusTracker, type RepoStatusSnapshot } from "../utils/repo-status.ts";
import { type RuntimeInfo, readRuntimeInfo } from "./runtime.ts";

const FOOTER_STATE_REFRESH_INTERVAL_MS = 3000;

export function isCodexFastModeEnabled(cwd = process.cwd()): boolean {
	try { return loadFastConfiguration(cwd).mode !== "off"; } catch { return false; }
}

export function shouldUseCodexFastBadge(provider: string | undefined, isFastModeEnabled: boolean, modelId?: string, cwd = process.cwd()): boolean {
	if (!isFastModeEnabled) return false;
	try { return isFastConfigurationActive({ provider, id: modelId }, loadFastConfiguration(cwd)); } catch { return false; }
}

export interface FooterState {
	repoStatus: RepoStatusSnapshot;
	isCodexFastModeEnabled: boolean;
	repoName: string | null;
	runtime: RuntimeInfo | undefined;
}

export interface FooterStateManager {
	getState(): FooterState;
	dispose(): void;
}

async function getRepoName(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const result = await pi.exec("git", ["remote", "get-url", "origin"], { cwd });
	if (result.code !== 0 || !result.stdout?.trim()) return null;
	const url = result.stdout.trim();
	const match = url.match(/\/([^/]+?)(?:\.git)?$/);
	return match?.[1] ?? null;
}

export function createFooterStateManager(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	requestRender: () => void,
	onBranchChange: (listener: () => void) => () => void,
): FooterStateManager {
	let disposed = false;
	let repoName: string | null = null;
	let isCodexFastModeEnabled = false;
	let runtime: RuntimeInfo | undefined;
	const cwd = ctx.sessionManager.getCwd();
	const repoStatusTracker = createRepoStatusTracker(pi, cwd);

	const refreshCodexFastModeState = () => {
		if (disposed) return;
		const next = shouldUseCodexFastBadge(ctx.model?.provider, true, ctx.model?.id, cwd);
		if (next !== isCodexFastModeEnabled) {
			isCodexFastModeEnabled = next;
			requestRender();
		}
	};

	const refreshProjectState = async () => {
		if (disposed) return;
		const [nextRepoName, nextRuntime] = await Promise.all([getRepoName(pi, cwd), readRuntimeInfo(cwd)]);
		if (disposed) return;
		repoName = nextRepoName;
		runtime = nextRuntime;
		requestRender();
	};

	const unsubscribeRepoStatus = repoStatusTracker.subscribe(() => {
		if (!disposed) requestRender();
	});

	void refreshProjectState();
	refreshCodexFastModeState();

	const stateTimer = setInterval(() => {
		refreshCodexFastModeState();
	}, FOOTER_STATE_REFRESH_INTERVAL_MS);

	const unsubscribeBranch = onBranchChange(() => {
		refreshCodexFastModeState();
		repoStatusTracker.refreshNow();
		void refreshProjectState();
	});

	const unsubscribeRepoStatusInvalidation = subscribeRepoStatusInvalidation(() => {
		repoStatusTracker.resetPrStatus();
	});

	return {
		getState(): FooterState {
			return {
				repoStatus: repoStatusTracker.getSnapshot(),
				isCodexFastModeEnabled,
				repoName,
				runtime,
			};
		},
		dispose() {
			disposed = true;
			unsubscribeBranch();
			unsubscribeRepoStatusInvalidation();
			unsubscribeRepoStatus();
			repoStatusTracker.dispose();
			clearInterval(stateTimer);
		},
	};
}
