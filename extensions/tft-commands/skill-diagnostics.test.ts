import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DefaultResourceLoader, SettingsManager } from "@mariozechner/pi-coding-agent";
import { installExpectedSkillCollisionFilter } from "./skill-diagnostics.ts";

function fixture(t: TestContext) {
	const root = mkdtempSync(join(tmpdir(), "pilee-skill-diagnostics-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	const bundle = join(root, "pilee");
	mkdirSync(cwd, { recursive: true });
	mkdirSync(agentDir, { recursive: true });
	function skill(directory: string, name: string, description = "Fixture workflow") {
		const path = join(directory, name, "SKILL.md");
		mkdirSync(join(directory, name), { recursive: true });
		writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n---\n# Workflow\n`);
		return path;
	}
	function loader(extraPaths: string[] = []) {
		return new DefaultResourceLoader({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir),
			additionalSkillPaths: [join(bundle, "skills"), ...extraPaths], noExtensions: true, noThemes: true, noPromptTemplates: true, noContextFiles: true });
	}
	function install() {
		const release = installExpectedSkillCollisionFilter(DefaultResourceLoader.prototype, bundle);
		t.after(release);
		return release;
	}
	return { cwd, agentDir, bundle, root, skill, loader, install };
}

test("project overrides stay selected while the five expected pilee collisions disappear", async (t) => {
	// Given: the same five duplicates reported when entering a project worktree.
	const f = fixture(t);
	for (const name of ["frame", "decide", "verify", "tft-guidelines", "start-local-dev"]) {
		f.skill(join(f.cwd, ".agents", "skills"), name);
		f.skill(join(f.bundle, "skills"), name);
	}
	const loader = f.loader();
	await loader.reload();
	const before = loader.getSkills();
	assert.equal(before.diagnostics.filter((d) => d.type === "collision").length, 5);

	// When: the TFT extension installs its diagnostic policy.
	f.install();
	const after = loader.getSkills();

	// Then: no warning remains, without replacing skills or mutating raw diagnostics.
	assert.deepEqual(after.diagnostics, []);
	assert.strictEqual(after.skills, before.skills);
	for (const name of ["frame", "decide", "verify", "tft-guidelines", "start-local-dev"]) {
		assert.equal(after.skills.find((skill) => skill.name === name)?.filePath, join(f.cwd, ".agents", "skills", name, "SKILL.md"));
	}
	assert.equal(before.diagnostics.length, 5);
});

test("unrelated names, third-party duplicates, and invalid skills remain diagnosed", async (t) => {
	// Given: an expected override mixed with three actionable diagnostic cases.
	const f = fixture(t);
	for (const name of ["frame", "other-workflow"]) {
		f.skill(join(f.cwd, ".pi", "skills"), name);
		f.skill(join(f.bundle, "skills"), name);
	}
	const thirdParty = join(f.root, "another-package", "skills");
	f.skill(thirdParty, "frame");
	f.skill(join(f.cwd, ".pi", "skills"), "invalid", "");
	const loader = f.loader([thirdParty]);
	await loader.reload();
	const before = loader.getSkills();
	assert.equal(before.diagnostics.length, 4);

	// When: only the known project-over-pilee policy is installed.
	f.install();
	const after = loader.getSkills();

	// Then: unexpected collisions and malformed skill warnings are preserved.
	assert.equal(after.diagnostics.length, 3);
	assert.ok(after.diagnostics.some((d) => d.collision?.name === "other-workflow"));
	assert.ok(after.diagnostics.some((d) => d.collision?.loserPath.startsWith(thirdParty)));
	assert.ok(after.diagnostics.some((d) => d.type !== "collision"));
});

test("a user skill shadowing pilee is not silently treated as a project override", async (t) => {
	// Given: a user-level skill wins instead of a project-level skill.
	const f = fixture(t);
	f.skill(join(f.agentDir, "skills"), "frame");
	f.skill(join(f.bundle, "skills"), "frame");
	const loader = f.loader();
	await loader.reload();

	// When: expected project duplicates are filtered.
	f.install();

	// Then: this different collision is still visible.
	assert.equal(loader.getSkills().diagnostics.filter((d) => d.type === "collision").length, 1);
});

test("reload registrations compose and releasing the last owner restores diagnostics", async (t) => {
	// Given: overlapping old/new extension registrations during a session replacement.
	const f = fixture(t);
	f.skill(join(f.cwd, ".pi", "skills"), "frame");
	f.skill(join(f.bundle, "skills"), "frame");
	const loader = f.loader();
	await loader.reload();
	const releaseOld = f.install();
	const releaseNew = f.install();

	// When: the old runtime shuts down and resources are reloaded.
	releaseOld();
	releaseOld();
	await loader.reload();

	// Then: the live owner keeps filtering; unloading all owners restores the original behavior.
	assert.deepEqual(loader.getSkills().diagnostics, []);
	releaseNew();
	assert.equal(loader.getSkills().diagnostics.length, 1);
	f.install();
	assert.deepEqual(loader.getSkills().diagnostics, []);
});
