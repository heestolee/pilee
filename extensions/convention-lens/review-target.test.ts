import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { captureConventionLensBaseline, selectConventionLensReviewTarget, type ConventionLensExec } from "./review-target.ts";

const execFileAsync = promisify(execFile);

const pi: ConventionLensExec = {
	async exec(command, args, options) {
		try {
			const result = await execFileAsync(command, args, { cwd: options.cwd, encoding: "utf8" });
			return { stdout: result.stdout, stderr: result.stderr, code: 0 };
		} catch (error: any) {
			return { stdout: error.stdout ?? "", stderr: error.stderr ?? error.message, code: error.code ?? 1 };
		}
	},
};

async function git(root: string, ...args: string[]) {
	await execFileAsync("git", args, { cwd: root });
}

async function withRepo(run: (root: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "convention-lens-target-"));
	try {
		await git(root, "init", "-q");
		await git(root, "config", "user.name", "Test");
		await git(root, "config", "user.email", "test@example.com");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src/a.ts"), "export const value = 1;\n");
		await git(root, "add", ".");
		await git(root, "commit", "-qm", "base");
		await run(root);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test("변경이 없으면 review target이 없다", async () => {
	await withRepo(async (root) => {
		const baseline = await captureConventionLensBaseline(pi, root, 1);
		assert.equal(await selectConventionLensReviewTarget(pi, root, baseline), undefined);
	});
});

test("이번 run의 working diff만 stable evidence target으로 만든다", async () => {
	await withRepo(async (root) => {
		const baseline = await captureConventionLensBaseline(pi, root, 1);
		await writeFile(join(root, "src/a.ts"), "export const value = 2;\n");
		const target = await selectConventionLensReviewTarget(pi, root, baseline);
		assert.equal(target?.kind, "working-diff");
		assert.deepEqual(target?.paths, ["src/a.ts"]);
		assert.equal(target?.bundle.stats.additions, 1);
		assert.ok(target?.bundle.lines.some((line) => line.id === "D000006" || line.kind === "addition"));
	});
});

test("기존 dirty file이 그대로면 제외하고 이번 run에서 다시 바뀌면 포함한다", async () => {
	await withRepo(async (root) => {
		await writeFile(join(root, "src/a.ts"), "export const value = 2;\n");
		const baseline = await captureConventionLensBaseline(pi, root, 1);
		assert.equal(await selectConventionLensReviewTarget(pi, root, baseline), undefined);
		await writeFile(join(root, "src/a.ts"), "export const value = 3;\n");
		assert.deepEqual((await selectConventionLensReviewTarget(pi, root, baseline))?.paths, ["src/a.ts"]);
	});
});

test("같은 run에서 commit된 변경도 same-run target으로 보존한다", async () => {
	await withRepo(async (root) => {
		const baseline = await captureConventionLensBaseline(pi, root, 1);
		await writeFile(join(root, "src/a.ts"), "export const value = 4;\n");
		await git(root, "add", "src/a.ts");
		await git(root, "commit", "-qm", "change");
		const target = await selectConventionLensReviewTarget(pi, root, baseline);
		assert.equal(target?.kind, "same-run-commits");
		assert.deepEqual(target?.paths, ["src/a.ts"]);
	});
});

test("새 untracked text file도 unified diff evidence로 포함한다", async () => {
	await withRepo(async (root) => {
		const baseline = await captureConventionLensBaseline(pi, root, 1);
		await writeFile(join(root, "src/new.ts"), "export const created = true;\n");
		const target = await selectConventionLensReviewTarget(pi, root, baseline);
		assert.deepEqual(target?.paths, ["src/new.ts"]);
		assert.equal(target?.bundle.files[0]?.status, "added");
	});
});
