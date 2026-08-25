import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConventionLensProfiles, loadPrReviewProfiles, loadPrShipProfiles, loadWorkflowGuardProfiles } from "./private-profiles.ts";

test("pr review profiles can be provided by a trusted project profile", async () => {
	const root = await mkdtemp(join(tmpdir(), "private-profiles-pr-review-"));
	try {
		await mkdir(join(root, ".pi", "profiles"), { recursive: true });
		await writeFile(join(root, ".pi", "profiles", "review.json"), JSON.stringify({
			prReview: {
				corpora: [{ id: "team-reviews", repositories: ["acme/repo"], corpusDir: "{home}/.pi/agent/state/pr-review/corpora/team" }],
			},
		}));
		const profiles = loadPrReviewProfiles(root);
		assert.ok(profiles.some((profile) => profile.corpora?.some((corpus) => corpus.id === "team-reviews")));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("pr-ship external-write profiles ignore project self-declaration", async () => {
	const root = await mkdtemp(join(tmpdir(), "private-profiles-pr-ship-"));
	try {
		const agentDir = join(root, "agent");
		const activePackageRoot = join(root, "active-package");
		const projectRoot = join(root, "project");
		await mkdir(join(agentDir, "profiles"), { recursive: true });
		await mkdir(join(activePackageRoot, "pi", "profiles"), { recursive: true });
		await mkdir(join(projectRoot, ".pi", "profiles"), { recursive: true });

		await writeFile(join(activePackageRoot, "pi", "profiles", "private.json"), JSON.stringify({
			prShip: {
				externalWritePolicies: [{ allowedReviewerLogins: ["TrustedAutomation"] }],
			},
		}));
		await writeFile(join(projectRoot, ".pi", "profiles", "self-declared.json"), JSON.stringify({
			prShip: {
				externalWritePolicies: [{ allowedReviewerLogins: ["HumanReviewer"] }],
			},
		}));

		const profiles = loadPrShipProfiles({ agentDir, activePackageRoots: [activePackageRoot] });
		assert.deepEqual(
			profiles.flatMap((profile) => profile.externalWritePolicies ?? []).flatMap((policy) => policy.allowedReviewerLogins ?? []),
			["TrustedAutomation"],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

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

test("convention lens automatic-repair profiles ignore project self-declaration", async () => {
	const root = await mkdtemp(join(tmpdir(), "private-profiles-convention-lens-"));
	try {
		const agentDir = join(root, "agent");
		const activePackageRoot = join(root, "active-package");
		const projectRoot = join(root, "project");
		await mkdir(join(agentDir, "profiles"), { recursive: true });
		await mkdir(join(activePackageRoot, "pi", "profiles"), { recursive: true });
		await mkdir(join(projectRoot, ".pi", "profiles"), { recursive: true });
		await writeFile(join(activePackageRoot, "pi", "profiles", "private.json"), JSON.stringify({
			conventionLens: {
				id: "trusted-lens",
				mode: "shadow",
				packs: [{ id: "trusted", kind: "markdown-cards", rootDir: "/tmp/trusted", authority: "personal-precedent" }],
			},
		}));
		await writeFile(join(projectRoot, ".pi", "profiles", "self-declared.json"), JSON.stringify({
			conventionLens: {
				id: "self-declared-repair",
				mode: "repair",
				packs: [{ id: "untrusted", kind: "markdown-cards", rootDir: "/tmp/untrusted", authority: "team-convention" }],
			},
		}));

		const profiles = loadConventionLensProfiles({ agentDir, activePackageRoots: [activePackageRoot] });
		assert.deepEqual(profiles.map((profile) => [profile.id, profile.mode]), [["trusted-lens", "shadow"]]);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
