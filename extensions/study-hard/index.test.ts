import assert from "node:assert/strict";
import { test } from "node:test";
import studyHard, { buildStudyHardPrompt, parseStudyHardArgs } from "./index.ts";
import { stopStudyHardStudios } from "./studio.ts";

test("parseStudyHardArgs extracts the first URL and keeps extra hints", () => {
	const parsed = parseStudyHardArgs("https://reactnative.dev/architecture/xplat-implementation React Native 새 아키텍처") as any;
	assert.equal(parsed.url, "https://reactnative.dev/architecture/xplat-implementation");
	assert.equal(parsed.hints, "React Native 새 아키텍처");
	assert.match(parsed.commandLine, /\/study-hard https:\/\/reactnative\.dev\/architecture\/xplat-implementation/);
});

test("parseStudyHardArgs returns help or a URL error", () => {
	assert.deepEqual(parseStudyHardArgs("help"), { help: true });
	const parsed = parseStudyHardArgs("react native architecture") as any;
	assert.match(parsed.error, /URL을 찾지 못했습니다/);
});

test("buildStudyHardPrompt keeps learning loop and Notion sync contracts visible", () => {
	const parsed = parseStudyHardArgs("https://example.com/article") as any;
	const prompt = buildStudyHardPrompt({ ...parsed, syncScriptExists: true }, "/tmp/repo");
	assert.match(prompt, /fetch_content/);
	assert.match(prompt, /첫 설명은 질문보다 먼저/);
	assert.match(prompt, /학습 진행은 혼합형/);
	assert.match(prompt, /origin: learner/);
	assert.match(prompt, /scope: session/);
	assert.match(prompt, /scope: node/);
	assert.match(prompt, /scope: coach/);
	assert.match(prompt, /격리 Tutor가 최대 3개 병렬/);
	assert.match(prompt, /같은 Pi transcript에 기록/);
	assert.match(prompt, /canonical 학습 대화의 UI/);
	assert.match(prompt, /내부 Tutor\/Editor\/Coach prompt와 patch JSON은 Pi transcript에 노출하지 않습니다/);
	assert.match(prompt, /processingStatus/);
	assert.match(prompt, /edges.*hierarchy 전용/);
	assert.match(prompt, /runtime\/data flow.*flows/);
	assert.match(prompt, /noteDocument/);
	assert.match(prompt, /lineNumberMode/);
	assert.match(prompt, /조상→현재→다음 자식 경로만 강조/);
	assert.match(prompt, /recommendedNodeId/);
	assert.match(prompt, /expectedRevision/);
	assert.match(prompt, /references\/code block/);
	assert.match(prompt, /Notion 저장 계약/);
	assert.match(prompt, /sectionHashes/);
	assert.match(prompt, /새 shadow를 먼저 완성·검증/);
	assert.match(prompt, /study_hard_board/);
	assert.match(prompt, /계층 지도/);
	assert.match(prompt, /activeSurface/);
	assert.match(prompt, /attachments/);
	assert.match(prompt, /hierarchy nodes\/edges/);
	assert.match(prompt, /runtime flows/);
	assert.match(prompt, /python3 "/);
});

test("extension registers /study-hard and sends one hidden follow-up prompt", async () => {
	let registered: { name: string; description: string; handler: (args: string, ctx: any) => Promise<void> } | undefined;
	const notifications: Array<{ message: string; level: string }> = [];
	const messages: Array<{ message: any; options: any }> = [];
	const tools: string[] = [];
	const events: string[] = [];
	const fakePi = {
		registerCommand(name: string, options: { description: string; handler: (args: string, ctx: any) => Promise<void> }) {
			registered = { name, ...options };
		},
		registerTool(tool: { name: string }) {
			tools.push(tool.name);
		},
		on(event: string, _handler: unknown) {
			events.push(event);
		},
		sendMessage(message: any, options: any) {
			messages.push({ message, options });
		},
		exec() {
			throw new Error("browser fallback should not run without UI");
		},
	} as any;

	studyHard(fakePi);
	assert.equal(registered?.name, "study-hard");
	assert.match(registered?.description ?? "", /코드·PR·아티클·영상/);
	assert.match(registered?.description ?? "", /적응형 학습 모드/);
	assert.deepEqual(tools, ["study_hard_board"]);
	assert.deepEqual(events, ["session_shutdown"]);

	try {
		await registered!.handler("https://reactnative.dev/architecture/xplat-implementation", {
		cwd: "/tmp/repo",
			hasUI: false,
			ui: {
				notify(message: string, level: string) {
					notifications.push({ message, level });
				},
			},
		});
	} finally {
		stopStudyHardStudios();
	}

	assert.equal(notifications.length, 1);
	assert.equal(notifications[0]?.level, "info");
	assert.equal(messages.length, 1);
	assert.equal(messages[0]?.options.deliverAs, "followUp");
	assert.equal(messages[0]?.options.triggerTurn, true);
	assert.equal(messages[0]?.message.customType, "heestolee.study-hard");
	assert.equal(messages[0]?.message.display, false);
	assert.match(messages[0]?.message.content, /https:\/\/reactnative\.dev\/architecture\/xplat-implementation/);
	assert.match(messages[0]?.message.content, /Study Hard Studio runId: /);
	assert.match(messages[0]?.message.content, /nodes, edges, recommendedNodeId/);
	assert.match(messages[0]?.message.content, /subtree 단위 자동배치/);
	assert.match(messages[0]?.message.content, /noteDocument/);
	assert.ok(messages[0]?.message.details.boardRunId);
	assert.ok(messages[0]?.message.details.boardStatePath);
});
