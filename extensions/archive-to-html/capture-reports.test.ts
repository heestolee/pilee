import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

test("/show-report lists archived compare reports and previews their assets", async () => {
	const home = mkdtempSync(join(tmpdir(), "archive-capture-reports-"));
	const previousHome = process.env.HOME;
	process.env.HOME = home;
	const reportDir = join(home, "Documents", "agent-history", "capture-reports", "2026-11-16_coral-finch_취소-요청-화면-확인");
	mkdirSync(join(reportDir, "assets"), { recursive: true });
	writeFileSync(join(reportDir, "assets", "after.png"), PNG);
	writeFileSync(join(reportDir, "index.html"), '<!doctype html><html><head><meta name="capture-report" content="compare-report/v1"></head><body><img src="assets/after.png" alt="after"></body></html>');
	writeFileSync(join(reportDir, "report.json"), JSON.stringify({ kind: "compare-report", title: "취소 요청 화면 확인", workspace: "coral-finch", ticket: "COM-1", createdAt: "2026-11-16T09:00:00.000Z", updatedAt: "2026-11-16T09:20:00.000Z" }));

	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	const shutdown: Array<() => void> = [];
	const opened: string[] = [];
	const pi = {
		registerCommand: (name: string, options: { handler: (args: string, ctx: unknown) => Promise<void> }) => commands.set(name, options),
		on: (event: string, handler: () => void) => { if (event === "session_shutdown") shutdown.push(handler); },
		exec: async (_command: string, args: string[]) => { opened.push(args[0]); return { code: 0, stdout: "", stderr: "" }; },
	};

	try {
		const { default: register } = await import("./index.ts");
		register(pi as never);
		await commands.get("show-report")!.handler("--browser", { cwd: home, hasUI: true, ui: { notify: () => {} } });
		assert.equal(opened.length, 1);

		const browser = await (await fetch(opened[0])).text();
		assert.match(browser, /취소 요청 화면 확인/);
		assert.match(browser, /비교 보고서/);
		assert.match(browser, /COM-1/);

		const preview = await (await fetch(`${new URL(opened[0]).origin}/preview?path=${encodeURIComponent(join(reportDir, "index.html"))}`)).text();
		assert.match(preview, /data:image\/png;base64,/);
	} finally {
		for (const handler of shutdown) handler();
		process.env.HOME = previousHome;
		rmSync(home, { recursive: true, force: true });
	}
});
