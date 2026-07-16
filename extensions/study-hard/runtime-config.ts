import { homedir } from "node:os";
import { join } from "node:path";
import { expandProfileTemplate, loadStudyHardProfiles } from "../utils/private-profiles.ts";

export interface StudyHardRuntimeConfig {
	syncScript: string;
	downloadDir: string;
}

export function resolveStudyHardRuntimeConfig(cwd?: string): StudyHardRuntimeConfig {
	const profile = loadStudyHardProfiles(cwd).find((candidate) => candidate.syncScript || candidate.downloadDir);
	const syncScript = process.env.STUDY_HARD_SYNC_SCRIPT?.trim()
		|| (profile?.syncScript ? expandProfileTemplate(profile.syncScript) : "");
	const downloadDir = process.env.STUDY_HARD_DOWNLOAD_DIR?.trim()
		|| (profile?.downloadDir ? expandProfileTemplate(profile.downloadDir) : join(homedir(), "Downloads"));
	return { syncScript, downloadDir };
}
