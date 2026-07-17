import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildStudyLearningAgentArgs, DEFAULT_STUDY_LEARNING_AGENT_TIMEOUT_MS, parseStudyLearningAgentJson, runIsolatedStudyLearningAgent, sanitizedStudyLearningAgentEnv } from "./learning-agents.ts";

test("학습 agent 기본 timeout은 Tutor·Editor·Coach 모두 10분이다", () => {
	assert.equal(DEFAULT_STUDY_LEARNING_AGENT_TIMEOUT_MS, 600_000);
});

test("학습 agent 실행은 도구·extension·skill·session을 모두 차단한다", () => {
	const args = buildStudyLearningAgentArgs({
		role: "tutor",
		prompt: "질문에 답해줘",
		cwd: "/tmp/study-hard",
		model: "openai-codex/gpt-5.6-luna",
		thinking: "high",
		imagePaths: ["/tmp/question-one.png", "/tmp/question-two.jpg"],
	}, "/tmp/tutor-prompt.md");

	assert.deepEqual(args.slice(0, 8), ["--mode", "json", "-p", "--no-session", "--no-tools", "--no-extensions", "--no-skills", "--no-context-files"]);
	assert.ok(args.includes("openai-codex/gpt-5.6-luna"));
	assert.ok(args.includes("--thinking"));
	assert.ok(args.includes("/tmp/tutor-prompt.md"));
	assert.deepEqual(args.slice(-3), ["@/tmp/question-one.png", "@/tmp/question-two.jpg", "Run the Study Hard tutor task from the system prompt."]);
	assert.doesNotMatch(args.join(" "), /study_hard_board/);
});

test("학습 agent 환경에서는 Notion·Slack·Study Hard capability 비밀을 제거한다", () => {
	const env = sanitizedStudyLearningAgentEnv({
		PATH: "/usr/bin",
		OPENAI_API_KEY: "model-auth",
		NOTION_TOKEN: "notion-secret",
		SLACK_TOKEN: "slack-secret",
		STUDY_HARD_CAPABILITY_TOKEN: "local-secret",
		THIRD_PARTY_PROXY_URL: "proxy-secret",
	});

	assert.equal(env.PATH, "/usr/bin");
	assert.equal(env.OPENAI_API_KEY, "model-auth");
	assert.equal(env.NOTION_TOKEN, undefined);
	assert.equal(env.SLACK_TOKEN, undefined);
	assert.equal(env.STUDY_HARD_CAPABILITY_TOKEN, undefined);
	assert.equal(env.THIRD_PARTY_PROXY_URL, undefined);
});

test("Editor와 Coach의 JSON 응답은 raw 또는 fenced 객체만 허용한다", () => {
	assert.deepEqual(parseStudyLearningAgentJson('{"feedback":"좋아요"}'), { feedback: "좋아요" });
	assert.deepEqual(parseStudyLearningAgentJson('```json\n{"feedback":"복습해요"}\n```'), { feedback: "복습해요" });
	assert.throws(() => parseStudyLearningAgentJson("설명만 반환"), /유효한 JSON 객체/);
});

test("격리 runner는 JSONL 최종·stream fallback·빈 응답 진단·timeout·abort를 처리한다", async () => {
	const fixtureDir = mkdtempSync(join(tmpdir(), "study-hard-fake-pi-"));
	const executable = join(fixtureDir, "fake-pi.mjs");
	const pidFile = join(fixtureDir, "pid");
	writeFileSync(executable, `#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nconst mode = process.env.FAKE_PI_MODE || "success";\nif (process.env.FAKE_PI_PID_FILE) writeFileSync(process.env.FAKE_PI_PID_FILE, String(process.pid));\nif (mode === "success") {\n  console.log(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "격리 답변" }] } }));\n} else if (mode === "update-only") {\n  console.log(JSON.stringify({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "스트리밍 복구 답변" }] }, assistantMessageEvent: { type: "text_delta", delta: "스트리밍 복구 답변" } }));\n} else if (mode === "agent-end") {\n  console.log(JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "agent_end 복구 답변" }] }] }));\n} else if (mode === "empty") {\n  console.log(JSON.stringify({ type: "session", version: 3 }));\n  console.log(JSON.stringify({ type: "agent_start" }));\n  console.log(JSON.stringify({ type: "agent_end", messages: [] }));\n} else if (mode === "fail") {\n  console.error("fake failure");\n  process.exit(7);\n} else {\n  process.on("SIGTERM", () => {});\n  setInterval(() => {}, 1000);\n}\n`, "utf-8");
	chmodSync(executable, 0o755);
	const originalExecutable = process.env.STUDY_HARD_PI_EXECUTABLE;
	const originalMode = process.env.FAKE_PI_MODE;
	const originalPidFile = process.env.FAKE_PI_PID_FILE;
	const beforeAgentDirs = new Set(readdirSync(tmpdir()).filter((name) => name.startsWith("study-hard-agent-")));
	const waitForPid = async () => {
		for (let attempt = 0; attempt < 100 && !existsSync(pidFile); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
		assert.equal(existsSync(pidFile), true);
		return Number(readFileSync(pidFile, "utf-8"));
	};
	const processExists = (pid: number) => {
		try { process.kill(pid, 0); return true; } catch { return false; }
	};
	try {
		process.env.STUDY_HARD_PI_EXECUTABLE = executable;
		process.env.FAKE_PI_PID_FILE = pidFile;
		process.env.FAKE_PI_MODE = "success";
		assert.equal(await runIsolatedStudyLearningAgent({ role: "tutor", prompt: "정상", cwd: fixtureDir, timeoutMs: 1_000 }), "격리 답변");

		process.env.FAKE_PI_MODE = "update-only";
		assert.equal(await runIsolatedStudyLearningAgent({ role: "editor", prompt: "message_end 누락", cwd: fixtureDir, timeoutMs: 1_000 }), "스트리밍 복구 답변");

		process.env.FAKE_PI_MODE = "agent-end";
		assert.equal(await runIsolatedStudyLearningAgent({ role: "editor", prompt: "agent_end fallback", cwd: fixtureDir, timeoutMs: 1_000 }), "agent_end 복구 답변");

		process.env.FAKE_PI_MODE = "empty";
		await assert.rejects(
			() => runIsolatedStudyLearningAgent({ role: "editor", prompt: "민감한 원문", cwd: fixtureDir, timeoutMs: 1_000 }),
			/Study Hard Editor agent가 최종 답변을 반환하지 않았습니다\. \(stdout=\d+B, events=session×1,agent_start×1,agent_end×1, invalidJsonLines=0\)/,
		);

		process.env.FAKE_PI_MODE = "fail";
		assert.rejects(() => runIsolatedStudyLearningAgent({ role: "tutor", prompt: "실패", cwd: fixtureDir, timeoutMs: 1_000 }), /종료 코드 7.*fake failure/);

		rmSync(pidFile, { force: true });
		process.env.FAKE_PI_MODE = "hang";
		const timeoutRun = runIsolatedStudyLearningAgent({ role: "editor", prompt: "timeout", cwd: fixtureDir, timeoutMs: 20, killGraceMs: 20 });
		const timeoutAssertion = assert.rejects(timeoutRun, /20ms를 초과/);
		const timeoutPid = await waitForPid();
		await timeoutAssertion;
		await new Promise((resolve) => setTimeout(resolve, 60));
		assert.equal(processExists(timeoutPid), false);

		rmSync(pidFile, { force: true });
		const controller = new AbortController();
		const abortRun = runIsolatedStudyLearningAgent({ role: "coach", prompt: "abort", cwd: fixtureDir, signal: controller.signal, timeoutMs: 1_000, killGraceMs: 20 });
		const abortAssertion = assert.rejects(abortRun, /취소/);
		const abortPid = await waitForPid();
		controller.abort();
		await abortAssertion;
		await new Promise((resolve) => setTimeout(resolve, 60));
		assert.equal(processExists(abortPid), false);
		const afterAgentDirs = readdirSync(tmpdir()).filter((name) => name.startsWith("study-hard-agent-") && !beforeAgentDirs.has(name));
		assert.deepEqual(afterAgentDirs, []);
	} finally {
		if (originalExecutable === undefined) delete process.env.STUDY_HARD_PI_EXECUTABLE; else process.env.STUDY_HARD_PI_EXECUTABLE = originalExecutable;
		if (originalMode === undefined) delete process.env.FAKE_PI_MODE; else process.env.FAKE_PI_MODE = originalMode;
		if (originalPidFile === undefined) delete process.env.FAKE_PI_PID_FILE; else process.env.FAKE_PI_PID_FILE = originalPidFile;
		rmSync(fixtureDir, { recursive: true, force: true });
	}
});
