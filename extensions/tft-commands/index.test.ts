import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { DefaultResourceLoader, SettingsManager } from "@mariozechner/pi-coding-agent";

// Use Pi's actual loader, including its host-module aliases, instead of a separate Jiti instance.
const home = mkdtempSync(join(tmpdir(), "pilee-tft-command-"));
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
const loader = new DefaultResourceLoader({
	cwd: home,
	agentDir: process.env.PI_CODING_AGENT_DIR,
	settingsManager: SettingsManager.create(home, process.env.PI_CODING_AGENT_DIR),
	additionalExtensionPaths: [fileURLToPath(new URL("./index.ts", import.meta.url))],
	noSkills: true,
	noThemes: true,
	noPromptTemplates: true,
	noContextFiles: true,
});
await loader.reload();
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []);
const extension = loaded.extensions.find((item) => item.commands.has("decide"))!;
const messages: Array<{ content: string; details: { command: string } }> = [];
loaded.runtime.sendMessage = (message: any) => { messages.push(message); };
const ctx = { cwd: home, sessionManager: {}, ui: { notify() {} } };
after(async () => {
	for (const handler of extension.handlers.get("session_shutdown") ?? []) {
		await handler({ type: "session_shutdown" } as any, ctx as any);
	}
	rmSync(home, { recursive: true, force: true });
});

for (const command of ["frame", "decide", "verify"] as const) {
	test(`/${command} 주입에 구현 중 대화 결정과 저장 계약이 포함된다`, async () => {
		// given: 실제 Pi가 등록한 command와 canonical pilee 스킬을 사용한다.
		messages.length = 0;

		// when
		await extension.commands.get(command)!.handler("", ctx as any);

		// then
		assert.equal(messages.length, 1);
		const prompt = messages[0].content;
		assert.match(prompt, /구현 중 추가 결정은 현재 대화에서 처리한다/);
		assert.match(prompt, /질문 전에 기존 canonical의 `decision_queue`에 stable ID/);
		assert.match(prompt, /침묵·취소·모호한 답은 승인이 아니며/);
		assert.match(prompt, /명시 답변 후 같은 ID로 `frame.json.decisions\[\]`/);
		assert.match(prompt, /verify 조건, linked Task, `work_context refresh`/);
		assert.match(prompt, /다른 미결정과 다른 task blocker는 보존/);
		assert.match(prompt, /Frame이 없으면 기존 `.pi\/decisions`/);
		assert.match(prompt, /명시 `\/decide` 또는 사용자가 웹뷰 비교를 요청한 경로는 유지/);
		assert.match(prompt, /state 저장을 이유로 Studio update\/finish·창 재오픈을 호출하지 않는다/);
	});
}

test("명시 /decide는 대화 기본값 변경 뒤에도 Decide 스킬로 전달된다", async () => {
	// given
	messages.length = 0;

	// when
	await extension.commands.get("decide")!.handler("저장 방식 비교", ctx as any);

	// then
	assert.equal(messages.length, 1);
	assert.equal(messages[0].details.command, "decide");
	assert.match(messages[0].content, /BEGIN INLINED PILEE SKILL: decide/);
	assert.match(messages[0].content, /사용자가 명시 `\/decide`를 호출하거나 웹뷰 비교를 요청한 경우/);
	assert.match(messages[0].content, /같은 work unit의 `tab=decide`를 사용한다/);
	assert.match(messages[0].content, /명시 `\/decide`·웹뷰 요청으로 Studio를 선택했다면 해당 탭의 `ask`로 묻는다/);
});
