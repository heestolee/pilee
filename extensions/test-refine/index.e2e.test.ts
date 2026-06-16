import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import registerTestRefine from "./index.ts";

interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

function run(command: string, args: string[], cwd: string): ExecResult {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	if (result.error) throw result.error;
	return {
		code: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

function git(repo: string, args: string[]): ExecResult {
	const result = run("git", args, repo);
	if (result.code !== 0) {
		throw new Error(`git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
	}
	return result;
}

function createFixtureRepo(): string {
	const repo = realpathSync(mkdtempSync(join(tmpdir(), "pilee-test-refine-e2e-")));
	git(repo, ["init", "-q"]);
	git(repo, ["config", "user.name", "Test Refine E2E"]);
	git(repo, ["config", "user.email", "test-refine-e2e@example.invalid"]);

	writeFileSync(join(repo, "dropdown.tsx"), "export function label() { return 'closed'; }\n");
	writeFileSync(join(repo, "dropdown.test.tsx"), "import { label } from './dropdown';\nconsole.log(label());\n");
	git(repo, ["add", "."]);
	git(repo, ["commit", "-q", "-m", "initial"]);

	writeFileSync(join(repo, "dropdown.test.tsx"), "import { label } from './dropdown';\nconsole.log(label(), 'opened');\n");
	git(repo, ["add", "dropdown.test.tsx"]);
	writeFileSync(join(repo, "dropdown.tsx"), "export function label() { return 'opened'; }\n");

	return repo;
}

test("/test-refine e2e snapshots a real staged git diff and sends one follow-up prompt", async () => {
	const repo = createFixtureRepo();
	try {
		let registered: { name: string; handler: (args: string, ctx: any) => Promise<void> } | undefined;
		const notifications: Array<{ message: string; level: string }> = [];
		const messages: Array<{ message: any; options: any }> = [];
		const fakePi = {
			registerCommand(name: string, options: { handler: (args: string, ctx: any) => Promise<void> }) {
				registered = { name, handler: options.handler };
			},
			exec(command: string, args: string[], options?: { cwd?: string }) {
				return Promise.resolve(run(command, args, options?.cwd ?? repo));
			},
			sendMessage(message: any, options: any) {
				messages.push({ message, options });
			},
		} as any;

		registerTestRefine(fakePi);
		assert.equal(registered?.name, "test-refine");

		await registered!.handler("--staged dropdown.test.tsx", {
			cwd: repo,
			ui: {
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
			},
		});

		assert.equal(notifications.length, 1);
		assert.equal(notifications[0].level, "info");
		assert.match(notifications[0].message, /Test Refine/);

		assert.equal(messages.length, 1);
		assert.equal(messages[0].options.deliverAs, "followUp");
		assert.equal(messages[0].options.triggerTurn, true);
		assert.equal(messages[0].message.customType, "pilee-test-refine-command");
		assert.equal(messages[0].message.display, false);

		const snapshot = messages[0].message.details.snapshot;
		assert.equal(snapshot.root, repo);
		assert.deepEqual(snapshot.changedFiles, ["dropdown.test.tsx"]);
		assert.deepEqual(snapshot.stagedFiles, ["dropdown.test.tsx"]);
		assert.deepEqual(snapshot.testLikeFiles, ["dropdown.test.tsx"]);
		assert.match(snapshot.status, /dropdown\.test\.tsx/);
		assert.match(snapshot.status, /dropdown\.tsx/);

		const prompt = messages[0].message.content;
		assert.match(prompt, /\/test-refine --staged dropdown\.test\.tsx/);
		assert.match(prompt, /Explicit target paths from arguments:\n- dropdown\.test\.tsx/);
		assert.match(prompt, /Changed files:\n- dropdown\.test\.tsx/);
		assert.match(prompt, /Staged files:\n- dropdown\.test\.tsx/);
		assert.match(prompt, /Test-like changed\/staged files:\n- dropdown\.test\.tsx/);
		assert.match(prompt, /test-boundary-refactor/);
		assert.match(prompt, /references\/test-refine-runbook\.md/);
	} finally {
		rmSync(repo, { recursive: true, force: true });
	}
});
