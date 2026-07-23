import assert from "node:assert/strict";
import { test } from "node:test";
import {
	PROGRAMMATIC_SUBAGENT_HOOKS,
	PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT,
	PROGRAMMATIC_SUBAGENT_LINEAGE_ENTRY,
	queueProgrammaticSubagentLineage,
	registerProgrammaticSubagentLauncher,
	restoreProgrammaticSubagentLineageEntry,
	type ProgrammaticSubagentHooks,
	type ProgrammaticSubagentLaunchRequest,
} from "./programmatic.ts";

function createEventHarness() {
	const listeners = new Map<string, Array<(payload: unknown) => void>>();
	const pi = {
		events: {
			on(name: string, listener: (payload: unknown) => void) {
				const current = listeners.get(name) ?? [];
				current.push(listener);
				listeners.set(name, current);
			},
			emit(name: string, payload: unknown) {
				for (const listener of listeners.get(name) ?? []) listener(payload);
			},
		},
	} as any;
	return { pi };
}

test("programmatic launcher는 기존 execute에 main-context run을 전달하고 callback으로 완료한다", async () => {
	const { pi } = createEventHarness();
	const events: string[] = [];
	let command = "";
	let resolveCompleted!: () => void;
	const completed = new Promise<void>((resolve) => { resolveCompleted = resolve; });
	registerProgrammaticSubagentLauncher(pi, () => ({ cwd: "/tmp/main-session" } as any), async (_id, params) => {
		command = String(params.command);
		const hooks = params[PROGRAMMATIC_SUBAGENT_HOOKS] as ProgrammaticSubagentHooks;
		hooks.onStarted({ requestId: hooks.requestId, runId: 17, agent: "study-hard-worker", sessionFile: "/tmp/subagent-17.jsonl" });
		await hooks.onCompleted({ requestId: hooks.requestId, runId: 17, agent: "study-hard-worker", sessionFile: "/tmp/subagent-17.jsonl", status: "done", output: "ok" });
		return { details: { launches: [{ runId: 17 }] } };
	});

	const request: ProgrammaticSubagentLaunchRequest = {
		kind: "programmatic-subagent-launch",
		requestId: "study-hard:Q001",
		agent: "study-hard-worker",
		task: "질문 artifact를 생성해",
		contextMode: "main",
		claim: () => events.push("claimed"),
		onStarted: ({ runId }) => events.push(`started:${runId}`),
		onCompleted: ({ runId, status }) => {
			events.push(`completed:${runId}:${status}`);
			resolveCompleted();
		},
		onRejected: (error) => events.push(`rejected:${error}`),
	};
	pi.events.emit(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, request);
	await completed;

	assert.equal(command, "subagent run study-hard-worker --main -- 질문 artifact를 생성해");
	assert.deepEqual(events, ["claimed", "started:17", "completed:17:done"]);
});

test("programmatic lineage는 durable entry와 nextTurn을 함께 사용한다", () => {
	const entries: Array<{ customType: string; data: unknown }> = [];
	const messages: Array<{ message: unknown; options: unknown }> = [];
	const pi = {
		appendEntry(customType: string, data: unknown) { entries.push({ customType, data }); },
		sendMessage(message: unknown, options: unknown) { messages.push({ message, options }); },
	} as any;
	const message = {
		customType: "subagent-tool",
		content: "[subagent:study-hard-worker#17] completed",
		display: true,
		details: { runId: 17, status: "done" },
	};

	queueProgrammaticSubagentLineage(pi, message);

	assert.deepEqual(entries, [{ customType: PROGRAMMATIC_SUBAGENT_LINEAGE_ENTRY, data: { message } }]);
	assert.equal((messages[0]?.message as any).customType, message.customType);
	assert.equal((messages[0]?.message as any).details.runId, 17);
	assert.match((messages[0]?.message as any).content, /Subagent lineage context — do not answer/);
	assert.match((messages[0]?.message as any).content, /study-hard-worker#17/);
	assert.deepEqual(messages[0]?.options, { deliverAs: "nextTurn", triggerTurn: false });
	assert.deepEqual(
		restoreProgrammaticSubagentLineageEntry({ type: "custom", customType: entries[0]!.customType, timestamp: "2026-07-24T00:00:00.000Z", data: entries[0]!.data }),
		{ type: "custom_message", timestamp: "2026-07-24T00:00:00.000Z", ...message },
	);
	assert.equal(restoreProgrammaticSubagentLineageEntry({ type: "custom", customType: "other", data: { message } }), undefined);
});

test("programmatic launcher는 같은 run continuation과 활성 context 부재를 명시한다", async () => {
	const { pi } = createEventHarness();
	const commands: string[] = [];
	let currentContext: any = { cwd: "/tmp/main-session" };
	registerProgrammaticSubagentLauncher(pi, () => currentContext, async (_id, params) => {
		commands.push(String(params.command));
		return { isError: true, content: [{ type: "text", text: "continue rejected" }], details: { launches: [] } };
	});

	const rejected: string[] = [];
	const request = (continueRunId?: number): ProgrammaticSubagentLaunchRequest => ({
		kind: "programmatic-subagent-launch",
		requestId: `request-${continueRunId ?? "new"}`,
		agent: "study-hard-worker",
		task: "최신 state로 다시 제안해",
		contextMode: "main",
		continueRunId,
		claim: () => {},
		onStarted: () => {},
		onCompleted: () => {},
		onRejected: (error) => rejected.push(error),
	});

	pi.events.emit(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, request(17));
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(commands[0], "subagent continue 17 --main -- 최신 state로 다시 제안해");
	assert.equal(rejected[0], "continue rejected");

	currentContext = null;
	pi.events.emit(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, request());
	assert.match(rejected[1] ?? "", /활성 메인 session context/);
});
