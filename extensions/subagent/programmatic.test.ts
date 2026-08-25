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
				return () => {
					listeners.set(
						name,
						(listeners.get(name) ?? []).filter((candidate) => candidate !== listener),
					);
				};
			},
			emit(name: string, payload: unknown) {
				for (const listener of listeners.get(name) ?? []) listener(payload);
			},
		},
	} as any;
	return {
		pi,
		listenerCount: (name: string) => listeners.get(name)?.length ?? 0,
	};
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
		claim: () => {
			events.push("claimed");
			return true;
		},
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

test("programmatic launcher disposer는 reload 전 listener를 해제해 재등록 후 한 번만 실행한다", async () => {
	const { pi, listenerCount } = createEventHarness();
	let executeCount = 0;
	const execute = async () => {
		executeCount += 1;
		return { details: { launches: [{ runId: 18 }] } };
	};
	const register = () =>
		registerProgrammaticSubagentLauncher(pi, () => ({ cwd: "/tmp/main-session" }) as any, execute);

	const disposePrevious = register();
	assert.equal(listenerCount(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT), 1);
	disposePrevious();
	assert.equal(listenerCount(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT), 0);
	register();

	let claimCount = 0;
	pi.events.emit(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, {
		kind: "programmatic-subagent-launch",
		requestId: "study-hard:Q074",
		agent: "study-hard-worker",
		task: "질문 artifact를 생성해",
		contextMode: "main",
		claim: () => {
			claimCount += 1;
			return claimCount === 1;
		},
		onStarted: () => {},
		onCompleted: () => {},
		onRejected: () => {},
	} satisfies ProgrammaticSubagentLaunchRequest);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(listenerCount(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT), 1);
	assert.equal(claimCount, 1);
	assert.equal(executeCount, 1);
});

test("programmatic launcher 재등록은 이전 listener를 session shutdown 없이 교체한다", async () => {
	const { pi, listenerCount } = createEventHarness();
	let oldExecuteCount = 0;
	let newExecuteCount = 0;
	registerProgrammaticSubagentLauncher(pi, () => ({ cwd: "/tmp/main-session" }) as any, async () => {
		oldExecuteCount += 1;
		return { details: { launches: [{ runId: 21 }] } };
	});
	registerProgrammaticSubagentLauncher(pi, () => ({ cwd: "/tmp/main-session" }) as any, async () => {
		newExecuteCount += 1;
		return { details: { launches: [{ runId: 22 }] } };
	});
	let claimed = false;
	pi.events.emit(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, {
		kind: "programmatic-subagent-launch",
		requestId: "reload-safe-request",
		agent: "study-hard-worker",
		task: "한 번만 실행해",
		contextMode: "isolated",
		claim: () => {
			if (claimed) return false;
			claimed = true;
			return true;
		},
		onStarted: () => {},
		onCompleted: () => {},
		onRejected: () => {},
	} satisfies ProgrammaticSubagentLaunchRequest);
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(listenerCount(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT), 1);
	assert.equal(oldExecuteCount, 0);
	assert.equal(newExecuteCount, 1);
});

test("programmatic launcher는 실행 중인 같은 requestId를 다시 launch하지 않는다", async () => {
	const { pi } = createEventHarness();
	let executeCount = 0;
	registerProgrammaticSubagentLauncher(pi, () => ({ cwd: "/tmp/main-session" }) as any, async () => {
		executeCount += 1;
		return { details: { launches: [{ runId: 23 }] } };
	});
	const makeRequest = (): ProgrammaticSubagentLaunchRequest => ({
		kind: "programmatic-subagent-launch",
		requestId: "same-orchestration",
		agent: "study-hard-worker",
		task: "중복 실행하지 마",
		contextMode: "isolated",
		claim: () => true,
		onStarted: () => {},
		onCompleted: () => {},
		onRejected: () => {},
	});
	pi.events.emit(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, makeRequest());
	pi.events.emit(PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, makeRequest());
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(executeCount, 1);
});

test("programmatic lineage는 durable entry만 남기고 LLM context에 주입하지 않는다", () => {
	const entries: Array<{ customType: string; data: unknown }> = [];
	const pi = {
		appendEntry(customType: string, data: unknown) { entries.push({ customType, data }); },
	} as any;
	const message = {
		customType: "subagent-tool",
		content: "[subagent:study-hard-worker#17] completed",
		display: true,
		details: { runId: 17, status: "done" },
	};

	queueProgrammaticSubagentLineage(pi, message);

	assert.deepEqual(entries, [{ customType: PROGRAMMATIC_SUBAGENT_LINEAGE_ENTRY, data: { message } }]);
	assert.deepEqual(
		restoreProgrammaticSubagentLineageEntry({ type: "custom", customType: entries[0]!.customType, timestamp: "2026-07-24T00:00:00.000Z", data: entries[0]!.data }),
		{ type: "custom_message", timestamp: "2026-07-24T00:00:00.000Z", ...message },
	);
	assert.equal(restoreProgrammaticSubagentLineageEntry({ type: "custom", customType: "other", data: { message } }), undefined);
});

test("programmatic lineage는 background completion 시 stale runtime entry만 건너뛴다", () => {
	const message = { customType: "subagent-tool", content: "completed", display: true };
	assert.doesNotThrow(() => queueProgrammaticSubagentLineage({
		appendEntry() { throw new Error("This extension ctx is stale after session replacement or reload."); },
	} as any, message));
	assert.throws(() => queueProgrammaticSubagentLineage({
		appendEntry() { throw new Error("disk write failed"); },
	} as any, message), /disk write failed/);
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
		claim: () => true,
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
