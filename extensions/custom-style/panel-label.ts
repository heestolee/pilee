import { getForkPanelLabel as resolveForkPanelLabel } from "../utils/fork-panel-identity.ts";

export function getForkPanelLabel(env: Record<string, string | undefined> = process.env, sessionFile?: string | null): string {
	return resolveForkPanelLabel({ env, sessionFile });
}
