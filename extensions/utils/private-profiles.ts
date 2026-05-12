import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface WorktreeRepoMatchProfile {
	registeredNames?: string[];
	rootBasenames?: string[];
	pathIncludes?: string[];
	pathRegexes?: string[];
	remoteIncludes?: string[];
}

export interface WorktreeRepoGateProfile {
	requireParentPanel?: boolean;
	hotfixRequiresExplicitBase?: boolean;
	hotfixHint?: string;
}

export interface WorktreeBootstrapDomainProfile {
	name: string;
	label?: string;
	marker: string;
	markers?: string[];
	command: string;
	cwd?: string;
}

export interface WorktreeBootstrapOrchestratorProfile {
	enabled?: boolean;
	agent?: string;
	allowProjectAgent?: boolean;
}

export interface WorktreeBootstrapProfile {
	enabled?: boolean;
	defaultDomains?: string[];
	implementationPromptRegex?: string;
	exploratoryPromptRegex?: string;
	domainPromptRules?: Array<{ domain: string; regex: string }>;
	domains?: WorktreeBootstrapDomainProfile[];
	orchestrator?: WorktreeBootstrapOrchestratorProfile;
}

export interface WorktreeRepoProfile {
	name: string;
	displayName?: string;
	match?: WorktreeRepoMatchProfile;
	rootDir?: string;
	baseBranch?: string;
	productionBranch?: string;
	branchPrefix?: string;
	setupScript?: string;
	autoOpenInGhostty?: boolean;
	ghosttyDirection?: "right" | "left" | "down" | "up" | "tab";
	namingScheme?: "pokemon" | "city" | "none";
	gate?: WorktreeRepoGateProfile;
	bootstrap?: WorktreeBootstrapProfile;
}

export interface ArtifactWorktreeRootProfile {
	repo: string;
	path: string;
}

export interface ArtifactConductorCwdMappingProfile {
	dirRegex: string;
	cwdTemplate: string;
}

export interface ArtifactBrowserProfile {
	worktreeRoots?: ArtifactWorktreeRootProfile[];
	workspacePiDirTemplates?: string[];
	piSessionDirTemplates?: string[];
	conductorProjectDirTemplates?: string[];
	conductorCwdMappings?: ArtifactConductorCwdMappingProfile[];
	defaultRepo?: string;
}

export interface PreflightCheckProfile {
	name: string;
	command: string;
	cwd?: string;
	timeoutMs?: number;
	triggerRegexes?: string[];
	triggerIncludes?: string[];
}

export interface PreflightProfile {
	match?: WorktreeRepoMatchProfile;
	checks?: PreflightCheckProfile[];
	baseBranchCandidates?: string[];
}

export interface ConductorProfile {
	dbPath?: string;
	projectRoot?: string;
	projectDirTemplates?: string[];
	workspaceDirIncludes?: string[];
}

export interface RetroProfile {
	reportDir?: string;
	uploadScript?: string;
}

export interface PileeRuntimeProfile {
	worktree?: {
		repos?: WorktreeRepoProfile[];
	};
	artifactBrowser?: ArtifactBrowserProfile;
	preflight?: PreflightProfile;
	conductor?: ConductorProfile;
	retro?: RetroProfile;
}

function safeReadDir(dir: string): string[] {
	try { return readdirSync(dir); } catch { return []; }
}

function isDirectory(path: string): boolean {
	try { return statSync(path).isDirectory(); } catch { return false; }
}

function settingsPackageLocalRoots(): string[] {
	const settingsPath = join(homedir(), ".pi", "agent", "settings.json");
	if (!existsSync(settingsPath)) return [];
	try {
		const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as { packages?: Array<string | { source?: string }> };
		const settingsDir = dirname(settingsPath);
		return (settings.packages ?? [])
			.map((entry) => typeof entry === "string" ? entry : entry.source ?? "")
			.filter((source) => source.startsWith("/") || source.startsWith("./") || source.startsWith("../") || source.startsWith("~"))
			.map((source) => expandProfileTemplate(source, { settingsDir }))
			.map((source) => source.startsWith(".") ? resolve(settingsDir, source) : source)
			.filter(isDirectory);
	} catch { return []; }
}

function gitPackageRoots(): string[] {
	const gitRoot = join(homedir(), ".pi", "agent", "git");
	const roots: string[] = [];
	for (const host of safeReadDir(gitRoot)) {
		const hostDir = join(gitRoot, host);
		if (!isDirectory(hostDir)) continue;
		for (const owner of safeReadDir(hostDir)) {
			const ownerDir = join(hostDir, owner);
			if (!isDirectory(ownerDir)) continue;
			for (const repo of safeReadDir(ownerDir)) {
				const repoDir = join(ownerDir, repo);
				if (isDirectory(repoDir)) roots.push(repoDir);
			}
		}
	}
	return roots;
}

function profileDirsFromRoot(root: string): string[] {
	return [join(root, "pi", "profiles"), join(root, "profiles")].filter(isDirectory);
}

function projectProfileDirs(cwd?: string): string[] {
	if (!cwd) return [];
	const dirs: string[] = [];
	let current = resolve(cwd);
	for (;;) {
		const profileDir = join(current, ".pi", "profiles");
		if (isDirectory(profileDir)) dirs.push(profileDir);
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return dirs;
}

export function profileFiles(cwd?: string): string[] {
	const dirs = [
		join(homedir(), ".pi", "agent", "profiles"),
		...settingsPackageLocalRoots().flatMap(profileDirsFromRoot),
		...gitPackageRoots().flatMap(profileDirsFromRoot),
		...projectProfileDirs(cwd),
	].filter(isDirectory);
	const seen = new Set<string>();
	const files: string[] = [];
	for (const dir of dirs) {
		for (const file of safeReadDir(dir).filter((name) => name.endsWith(".json")).sort()) {
			const path = join(dir, file);
			try {
				const real = resolve(path);
				if (seen.has(real)) continue;
				seen.add(real);
				files.push(real);
			} catch {}
		}
	}
	return files;
}

export function loadPileeRuntimeProfiles(cwd?: string): PileeRuntimeProfile[] {
	const profiles: PileeRuntimeProfile[] = [];
	for (const file of profileFiles(cwd)) {
		try {
			const parsed = JSON.parse(readFileSync(file, "utf8")) as PileeRuntimeProfile;
			profiles.push(parsed);
		} catch {}
	}
	return profiles;
}

export function loadWorktreeRepoProfiles(cwd?: string): WorktreeRepoProfile[] {
	return loadPileeRuntimeProfiles(cwd).flatMap((profile) => profile.worktree?.repos ?? []);
}

export function loadArtifactBrowserProfiles(cwd?: string): ArtifactBrowserProfile[] {
	return loadPileeRuntimeProfiles(cwd).map((profile) => profile.artifactBrowser).filter((profile): profile is ArtifactBrowserProfile => Boolean(profile));
}

export function loadPreflightProfiles(cwd?: string): PreflightProfile[] {
	return loadPileeRuntimeProfiles(cwd).map((profile) => profile.preflight).filter((profile): profile is PreflightProfile => Boolean(profile));
}

export function loadConductorProfiles(cwd?: string): ConductorProfile[] {
	return loadPileeRuntimeProfiles(cwd).map((profile) => profile.conductor).filter((profile): profile is ConductorProfile => Boolean(profile));
}

export function loadRetroProfiles(cwd?: string): RetroProfile[] {
	return loadPileeRuntimeProfiles(cwd).map((profile) => profile.retro).filter((profile): profile is RetroProfile => Boolean(profile));
}

export function expandProfileTemplate(value: string, vars: Record<string, string | undefined> = {}): string {
	const baseVars: Record<string, string> = {
		home: homedir(),
		user: userInfo().username,
		...Object.fromEntries(Object.entries(vars).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
	};
	let expanded = value.replace(/\{([A-Za-z0-9_]+)\}/g, (match, key: string) => baseVars[key] ?? match);
	if (expanded === "~") expanded = homedir();
	else if (expanded.startsWith("~/")) expanded = join(homedir(), expanded.slice(2));
	return expanded;
}
