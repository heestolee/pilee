import assert from "node:assert/strict";
import { test } from "node:test";
import registerTestRefine, { buildTestRefinePrompt, type TestRefineGitSnapshot } from "./index.ts";

const snapshot: TestRefineGitSnapshot = {
	root: "/repo",
	status: "## feature/test-refine\n M src/dropdown.test.tsx\n M src/dropdown.tsx",
	changedFiles: ["src/dropdown.test.tsx", "src/dropdown.tsx"],
	stagedFiles: [],
	testLikeFiles: ["src/dropdown.test.tsx"],
};

test("buildTestRefinePrompt routes /test-refine through the differently named skill", () => {
	const prompt = buildTestRefinePrompt("--apply src/dropdown.test.tsx", "/repo", snapshot);

	assert.match(prompt, /\/test-refine --apply src\/dropdown\.test\.tsx/);
	assert.match(prompt, /test-boundary-refactor/);
	assert.match(prompt, /skill name is intentionally different/);
	assert.match(prompt, /behavior tests assert user-visible behavior/);
	assert.match(prompt, /references\/test-refine-runbook\.md/);
	assert.match(prompt, /src\/dropdown\.test\.tsx/);
});

test("buildTestRefinePrompt keeps changed and staged test-like files visible", () => {
	const prompt = buildTestRefinePrompt("", "/repo", {
		...snapshot,
		changedFiles: ["src/a.ts"],
		stagedFiles: ["src/a.spec.ts"],
		testLikeFiles: ["src/a.spec.ts"],
	});

	assert.match(prompt, /Changed files:\n- src\/a\.ts/);
	assert.match(prompt, /Staged files:\n- src\/a\.spec\.ts/);
	assert.match(prompt, /Test-like changed\/staged files:\n- src\/a\.spec\.ts/);
});

test("extension registers /test-refine command and help stays user-facing", async () => {
	let registered: { name: string; description: string; handler: (args: string, ctx: any) => Promise<void> } | undefined;
	const notifications: Array<{ message: string; level: string }> = [];
	const fakePi = {
		registerCommand(name: string, options: { description: string; handler: (args: string, ctx: any) => Promise<void> }) {
			registered = { name, ...options };
		},
	} as any;

	registerTestRefine(fakePi);

	assert.equal(registered?.name, "test-refine");
	assert.match(registered?.description ?? "", /mock\/fixture\/assertion/);

	await registered!.handler("help", {
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
	});

	assert.equal(notifications[0]?.level, "info");
	assert.match(notifications[0]?.message ?? "", /\/test-refine --apply/);
	assert.match(notifications[0]?.message ?? "", /기능 테스트는 유저 행동만/);
});
