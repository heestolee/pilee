import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadWorkflowGuardProfiles } from "./private-profiles.ts";

test("workflow guard trust profiles load only from global and active package roots", async () => {
	const root = await mkdtemp(join(tmpdir(), "private-profiles-workflow-guard-"));
	try {
		const agentDir = join(root, "agent");
		const activePackageRoot = join(root, "active-package");
		const projectRoot = join(root, "project");
		await mkdir(join(agentDir, "profiles"), { recursive: true });
		await mkdir(join(activePackageRoot, "pi", "profiles"), { recursive: true });
		await mkdir(join(projectRoot, ".pi", "profiles"), { recursive: true });

		await writeFile(join(agentDir, "profiles", "global.json"), JSON.stringify({
			workflowGuard: { trustedInternalPullRequestRepositories: ["global/repo"] },
		}));
		await writeFile(join(activePackageRoot, "pi", "profiles", "private.json"), JSON.stringify({
			workflowGuard: { trustedInternalPullRequestRepositories: ["active/repo"] },
		}));
		await writeFile(join(projectRoot, ".pi", "profiles", "project.json"), JSON.stringify({
			workflowGuard: { trustedInternalPullRequestRepositories: ["project/self-declared"] },
		}));

		const profiles = loadWorkflowGuardProfiles({ agentDir, activePackageRoots: [activePackageRoot] });
		assert.deepEqual(
			profiles.flatMap((profile) => profile.trustedInternalPullRequestRepositories ?? []).sort(),
			["active/repo", "global/repo"],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
