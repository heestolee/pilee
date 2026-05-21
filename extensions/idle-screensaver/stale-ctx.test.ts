import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	__hasLatestScreensaverContextForTesting,
	__isStaleExtensionContextErrorForTesting,
	__resetIdleScreensaverStateForTesting,
	__runScheduledScreensaverForTesting,
	__setIdleScreensaverConfigForTesting,
	__setIdleScreensaverRefsForTesting,
} from "./index.ts";

const STALE_MESSAGE = "This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.reload().";

test.afterEach(() => {
	__resetIdleScreensaverStateForTesting();
});

test("idle screensaver recognizes Pi stale extension context errors", () => {
	assert.equal(__isStaleExtensionContextErrorForTesting(new Error(STALE_MESSAGE)), true);
	assert.equal(__isStaleExtensionContextErrorForTesting(new Error("ordinary failure")), false);
});

test("scheduled screensaver swallows stale ctx.hasUI and drops the captured context", async () => {
	const staleCtx = {
		get hasUI() {
			throw new Error(STALE_MESSAGE);
		},
	} as any;
	__setIdleScreensaverRefsForTesting(staleCtx);

	await assert.doesNotReject(() => __runScheduledScreensaverForTesting());
	assert.equal(__hasLatestScreensaverContextForTesting(), false);
});

test("scheduled screensaver swallows stale ctx during overlay creation", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pilee-screensaver-stale-ctx-"));
	try {
		const staleCtx = {
			hasUI: true,
			sessionManager: {
				getCwd: () => cwd,
				getEntries: () => [],
				getSessionFile: () => join(cwd, "session.jsonl"),
			},
			ui: {
				custom: async () => { throw new Error(STALE_MESSAGE); },
				onTerminalInput: () => () => {},
			},
		} as any;
		const pi = { getSessionName: () => "stale ctx smoke" } as any;
		__setIdleScreensaverRefsForTesting(staleCtx, pi);
		__setIdleScreensaverConfigForTesting({ showSprite: false, showWorktreeMeta: false });

		await assert.doesNotReject(() => __runScheduledScreensaverForTesting());
		assert.equal(__hasLatestScreensaverContextForTesting(), false);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
