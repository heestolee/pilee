import type { BeforeAgentStartEvent } from "@mariozechner/pi-coding-agent";
import { activeAgentContinuationScope, latestAgentRequest, readAgentStartInput } from "../utils/agent-start-input.ts";
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

export function dependencyBootstrapPrompt(event: BeforeAgentStartEvent, entries: readonly unknown[]): string | undefined {
	const input = readAgentStartInput(event);
	if (input.kind === "status" || input.kind === "unknown" || input.scope) return undefined;
	const shortCue = input.kind === "user" && /^(?:계속해?|이어가|이어서|진행해?|다음(?:으로)?|continue|proceed|go on|next)$/i.test(input.request?.trim() ?? "");
	if ((input.kind === "continuation" || shortCue) && activeAgentContinuationScope(entries)) return undefined;
	if (input.kind === "user") return input.request;
	if (input.kind === "command") {
		const request = input.request?.replace(/^\/\S+\s*/, "") ?? "";
		return ["ship", "pr-ship", "ci-ship", "verify"].includes(input.command ?? "") ? `검증 ${request}` : request;
	}
	const request = input.request ?? latestAgentRequest(entries);
	return /^pilee-frame(?:-v2)?-worktree-fork-continuation$/.test(input.customType ?? "")
		? `구현 시작 ${request ?? ""}` : request;
}

export function isImplementationStartPrompt(prompt: string, profile?: WorktreeRepoProfile): boolean {
	const text = prompt.trim();
	if (!text || text.startsWith("/")) return false;
	const exploratoryPattern = profile?.bootstrap?.exploratoryPromptRegex ?? "(확인해볼래|조사|분석|왜|어떤|궁금|찾아|알려|정리해|봐봐|look into|investigate|analy[sz]e|explain|why)";
	const implementationPattern = profile?.bootstrap?.implementationPromptRegex ?? "(구현|수정|작업|진행|이어서|마무리|고쳐|반영|검증|lint|test|커밋|푸시|pr|해줘|implement|fix|edit|change|continue|work on|verify|commit|push)";
	if (regexTest(exploratoryPattern, text)) return regexTest(implementationPattern, text);
	return regexTest(implementationPattern, text);
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
