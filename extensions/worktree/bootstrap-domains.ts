import type { WorktreeBootstrapDomainProfile, WorktreeRepoProfile } from "../utils/private-profiles.ts";
import { WORKSPACE_ACTIVATION_READY_ENTRY_TYPE } from "../utils/workspace-activation-contract.ts";

export const POST_CREATE_BOOTSTRAP_ENTRY_TYPE = "workspace-post-create-bootstrap";

export interface BootstrapDomainMeta {
	branch?: string;
	ticket?: string;
	note?: string;
}

export interface BootstrapSessionEntry {
	type?: string;
	customType?: string;
	data?: unknown;
}

export interface PostCreateBootstrapRequest {
	activationId: string;
	domains: string[];
}

function regexTest(pattern: string, value: string): boolean {
	try { return new RegExp(pattern, "i").test(value); } catch { return false; }
}

export function bootstrapDomainProfiles(profile: WorktreeRepoProfile): WorktreeBootstrapDomainProfile[] {
	return profile.bootstrap?.domains ?? [];
}

export function orderedBootstrapDomains(profile: WorktreeRepoProfile, domains: Iterable<string>): string[] {
	const requested = new Set(domains);
	return bootstrapDomainProfiles(profile).map((domain) => domain.name).filter((name) => requested.has(name));
}

export function getBootstrapDomains(
	profile: WorktreeRepoProfile,
	prompt: string,
	meta: BootstrapDomainMeta | null,
	changedPaths: string[] = [],
): string[] {
	const bootstrap = profile.bootstrap;
	const domainProfiles = bootstrapDomainProfiles(profile);
	if (!bootstrap?.enabled || domainProfiles.length === 0) return [];
	const text = `${prompt}\n${meta?.branch ?? ""}\n${meta?.ticket ?? ""}\n${meta?.note ?? ""}`.toLowerCase();
	const matched = new Set<string>();
	for (const rule of bootstrap.domainPromptRules ?? []) {
		if (regexTest(rule.regex, text)) matched.add(rule.domain);
	}
	for (const rule of bootstrap.changedPathRules ?? []) {
		if (changedPaths.some((path) => regexTest(rule.regex, path))) matched.add(rule.domain);
	}
	const hasRoot = domainProfiles.some((domain) => domain.name === "root");
	if (matched.size > 0 && hasRoot) matched.add("root");
	const selected = matched.size > 0 ? matched : new Set(bootstrap.defaultDomains ?? domainProfiles.map((domain) => domain.name));
	return orderedBootstrapDomains(profile, selected);
}

export function pendingPostCreateActivationId(entries: BootstrapSessionEntry[]): string | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.type !== "custom" || entry.customType !== WORKSPACE_ACTIVATION_READY_ENTRY_TYPE) continue;
		const data = entry.data as { activationId?: unknown; workspaceAction?: unknown } | undefined;
		if (data?.workspaceAction !== "create-worktree" || typeof data.activationId !== "string" || !data.activationId) return null;
		const consumed = entries.slice(index + 1).some((candidate) => {
			if (candidate.type !== "custom" || candidate.customType !== POST_CREATE_BOOTSTRAP_ENTRY_TYPE) return false;
			return (candidate.data as { activationId?: unknown } | undefined)?.activationId === data.activationId;
		});
		return consumed ? null : data.activationId;
	}
	return null;
}

export function getPostCreateBootstrapRequest(
	profile: WorktreeRepoProfile,
	entries: BootstrapSessionEntry[],
): PostCreateBootstrapRequest | null {
	const activationId = pendingPostCreateActivationId(entries);
	if (!activationId) return null;
	const domains = orderedBootstrapDomains(profile, profile.bootstrap?.onCreateDomains ?? []);
	return domains.length > 0 ? { activationId, domains } : null;
}
