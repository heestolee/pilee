import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	acquireRepoStatusLease,
	isRepoStatusPaused,
	readRepoStatusCache,
	REPO_STATUS_CACHE_MAX_AGE_MS,
	REPO_STATUS_LEASE_TTL_MS,
	waitForRepoStatusCache,
	withRepoStatusPaused,
	writeRepoStatusCache,
} from "./repo-status-coordination.ts";

async function withIsolatedState(fn: (cwd: string) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "pilee-repo-status-"));
	const cwd = join(root, "repo");
	const previous = process.env.PILEE_REPO_STATUS_STATE_DIR;
	process.env.PILEE_REPO_STATUS_STATE_DIR = join(root, "state");
	try {
		await fn(cwd);
	} finally {
		if (previous === undefined) delete process.env.PILEE_REPO_STATUS_STATE_DIR;
		else process.env.PILEE_REPO_STATUS_STATE_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
}

test("repo status cache is read only while fresh", async () => {
	await withIsolatedState(async (cwd) => {
		await writeRepoStatusCache(cwd, { code: 0, stdout: "# branch.head main\n", stderr: "" }, 1_000);

		assert.deepEqual(await readRepoStatusCache(cwd, REPO_STATUS_CACHE_MAX_AGE_MS, 1_500), {
			code: 0,
			stdout: "# branch.head main\n",
			stderr: "",
		});
		assert.equal(await readRepoStatusCache(cwd, REPO_STATUS_CACHE_MAX_AGE_MS, 1_000 + REPO_STATUS_CACHE_MAX_AGE_MS + 1), null);
	});
});

test("repo status lease allows one active owner per cwd", async () => {
	await withIsolatedState(async (cwd) => {
		const first = await acquireRepoStatusLease(cwd, REPO_STATUS_LEASE_TTL_MS, 1_000);
		assert.ok(first);
		assert.equal(await acquireRepoStatusLease(cwd, REPO_STATUS_LEASE_TTL_MS, 1_500), null);

		await first.release();
		const second = await acquireRepoStatusLease(cwd, REPO_STATUS_LEASE_TTL_MS, 1_600);
		assert.ok(second);
		await second.release();
	});
});

test("stale lease can be taken over without old owner deleting the new lease", async () => {
	await withIsolatedState(async (cwd) => {
		const oldLease = await acquireRepoStatusLease(cwd, REPO_STATUS_LEASE_TTL_MS, 1_000);
		assert.ok(oldLease);

		const newLease = await acquireRepoStatusLease(cwd, REPO_STATUS_LEASE_TTL_MS, 1_000 + REPO_STATUS_LEASE_TTL_MS + 1);
		assert.ok(newLease);

		await oldLease.release();
		assert.equal(await acquireRepoStatusLease(cwd, REPO_STATUS_LEASE_TTL_MS, 1_000 + REPO_STATUS_LEASE_TTL_MS + 2), null);

		await newLease.release();
		const afterRelease = await acquireRepoStatusLease(cwd, REPO_STATUS_LEASE_TTL_MS, 1_000 + REPO_STATUS_LEASE_TTL_MS + 3);
		assert.ok(afterRelease);
		await afterRelease.release();
	});
});

test("waitForRepoStatusCache observes cache written by another owner", async () => {
	await withIsolatedState(async (cwd) => {
		setTimeout(() => {
			void writeRepoStatusCache(cwd, { code: 0, stdout: "# branch.head feature\n", stderr: "" });
		}, 20);

		const cached = await waitForRepoStatusCache(cwd, { timeoutMs: 500, intervalMs: 10 });
		assert.deepEqual(cached, { code: 0, stdout: "# branch.head feature\n", stderr: "" });
	});
});

test("repo status pause marker is scoped and released", async () => {
	await withIsolatedState(async (cwd) => {
		assert.equal(await isRepoStatusPaused(cwd), false);
		await withRepoStatusPaused(cwd, async () => {
			assert.equal(await isRepoStatusPaused(cwd), true);
		}, { reason: "test" });
		assert.equal(await isRepoStatusPaused(cwd), false);
	});
});
