import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { after, test } from "node:test";
import { setGlimpseOpenForTests } from "../utils/glimpse.ts";
import type { LearningCompanionManifest } from "../learning-companion/state.ts";
import { PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT, type ProgrammaticSubagentLaunchRequest } from "../subagent/programmatic.ts";
import { captureUnifiedDiff } from "../pr-review/evidence.ts";
import { enrichReviewSourceDeclarations } from "../pr-review/declarations.ts";
import { createPrReviewRun, markChunkInspected, saveMetaReviewSubmission } from "../pr-review/run.ts";
import { applyStudyHardWorkerResult, attachStudyHardLearningCompanion, buildStudyHardStudioHtml, buildStudyNoteExportHtml, checkpointStudyHardLearning, createInitialBoardState, layoutStudyGraph, loadPersistedStudyHardState, markStudyHardWorkerFailed, markStudyHardWorkerStarted, mergeBoardState, openExistingStudyHardStudio, proposeStudyHardLearningChange, recordStudyHardLearningEvent, registerStudyHardBoardTool, resolveStudyNoteBlockVisual, respondStudyHardQuestion, routeStudyHardQuestion, startStudyHardStudio, stopStudyHardStudios, updateStudyHardStudio } from "./studio.ts";

const originalStateDir = process.env.STUDY_HARD_STATE_DIR;
const testStateDir = mkdtempSync(join(tmpdir(), "study-hard-state-"));
process.env.STUDY_HARD_STATE_DIR = testStateDir;

function authorizedHeaders(handle: { capabilityToken: string }): Record<string, string> {
	return { "Content-Type": "application/json", "X-Study-Hard-Capability": handle.capabilityToken };
}

function testPngData(_label: string): Buffer {
	return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
}

async function waitForStudyState(handle: { url: string }, predicate: (state: any) => boolean, timeoutMs = 2_000): Promise<any> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const state = await fetch(new URL("/state", handle.url)).then((response) => response.json());
		if (predicate(state)) return state;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Study Hard state condition was not met within ${timeoutMs}ms`);
}

function routeStudyQuestionToWorker(handle: any, questionId: string, reason = "테스트에서 worker 경로를 명시적으로 선택"): void {
	routeStudyHardQuestion(handle.state.runId, handle.state.revision, questionId, "worker", reason);
}

function writeStudyHardWorkerResult(
	state: any,
	question: any,
	baseNoteDocument: any,
	proposedNoteDocument: any,
	feedback: string,
	summary = "worker test result",
	attachmentImports: any[] = [],
): string {
	writeFileSync(question.workerResultPath, JSON.stringify({
		schemaVersion: 1,
		kind: "study-hard-worker-result",
		runId: state.runId,
		questionId: question.id,
		orchestrationId: question.orchestrationId,
		baseRevision: state.revision,
		baseNoteDocument,
		proposedNoteDocument,
		attachmentImports,
		feedback,
		summary,
	}));
	return question.workerResultPath;
}

function createStudyHardBoardHarness() {
	let tool: any;
	const pi = {
		registerTool(candidate: any) { tool = candidate; },
		sendMessage() {},
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	registerStudyHardBoardTool(pi);
	return {
		execute(params: Record<string, unknown>, ctx: any = { hasUI: false, cwd: "/tmp/study-hard" }) {
			return tool.execute("study-hard-test", params, new AbortController().signal, () => {}, ctx);
		},
	};
}

after(() => {
	stopStudyHardStudios();
	rmSync(testStateDir, { recursive: true, force: true });
	if (originalStateDir === undefined) delete process.env.STUDY_HARD_STATE_DIR;
	else process.env.STUDY_HARD_STATE_DIR = originalStateDir;
});

test("createInitialBoardState creates React Flow-ready concept graph data", () => {
	const state = createInitialBoardState({ url: "https://reactnative.dev/architecture/xplat-implementation", runId: "rn-xplat" });
	assert.equal(state.runId, "rn-xplat");
	assert.equal(state.url, "https://reactnative.dev/architecture/xplat-implementation");
	assert.ok(state.nodes.length >= 3);
	assert.ok(state.edges.length >= 2);
	assert.equal(state.selectedNodeId, "source");
	assert.equal(state.recommendedNodeId, "goal");
	assert.equal(state.sourceKind, "mixed");
	assert.equal(state.learningPhase, "map");
	assert.equal(state.coachRole, "mentor");
	assert.equal(state.schemaVersion, 1);
	assert.equal(state.revision, 0);
	assert.equal(state.layoutMode, "auto");
	assert.equal(state.viewMode, "hybrid");
	assert.equal(state.activeSurface, "note");
	assert.deepEqual(state.flows, []);
	assert.equal(state.noteDocument.sections[0]?.id, "overview");
	assert.deepEqual(state.attachments, []);
	assert.match(state.mermaid, /flowchart TD/);
});

test("mergeBoardState normalizes graph, question, and status patches", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "example" });
	const next = mergeBoardState(current, {
		goals: ["개념 지도 이해"],
		quickMap: "JS API에서 platform implementation으로 흐른다.",
		sourceKind: "code",
		learningPhase: "trace",
		coachRole: "lead",
		viewMode: "memo",
		recommendedNodeId: "native",
		nodes: [{ id: "js", label: "JS API", status: "understood", type: "concept", references: [{ kind: "code", label: "JS entry", path: "src/api.ts", symbol: "run", url: "javascript:alert(1)" }, { kind: "link", label: "Docs", url: "https://example.com/docs" }], x: 10, y: 20 }, { id: "native", label: "Native", status: "confused", detail: "플랫폼별 구현", parentId: "js" }],
		edges: [{ source: "js", target: "native", label: "calls" }],
		questions: [{ id: "Q001", question: "왜 interface가 필요한가?", answer: "차이를 숨기기 위해", status: "answered", targetNodeId: "js" }],
		attachments: [{ id: "a1", nodeId: "js", name: "diagram.png", mimeType: "image/png", path: "/tmp/diagram.png" }],
		selectedNodeId: "js",
		currentQuestionId: "Q001",
		followups: ["Fabric 연결 복습"],
	});

	assert.deepEqual(next.goals, ["개념 지도 이해"]);
	assert.equal(next.sourceKind, "code");
	assert.equal(next.learningPhase, "trace");
	assert.equal(next.coachRole, "lead");
	assert.equal(next.viewMode, "memo");
	assert.equal(next.recommendedNodeId, "native");
	assert.equal(next.nodes[0]?.status, "understood");
	assert.equal(next.nodes[0]?.type, "concept");
	assert.equal(next.nodes[0]?.references?.[0]?.path, "src/api.ts");
	assert.equal(next.nodes[0]?.references?.[0]?.url, undefined);
	assert.equal(next.nodes[0]?.references?.[1]?.url, "https://example.com/docs");
	assert.equal(next.nodes[1]?.status, "confused");
	assert.equal(next.nodes[1]?.detail, "플랫폼별 구현");
	assert.equal(next.edges[0]?.id, "js-native-0");
	assert.equal(next.questions[0]?.origin, "coach");
	assert.equal(next.questions[0]?.scope, "node");
	assert.equal(next.questions[0]?.userAnswer, "차이를 숨기기 위해");
	assert.equal(next.questions[0]?.targetNodeId, "js");
	assert.equal(next.attachments[0]?.nodeId, "js");
	assert.equal(next.selectedNodeId, "js");
	assert.equal(next.currentQuestionId, "Q001");
	assert.ok(next.updatedAt >= current.updatedAt);
});

test("mergeBoardState normalizes flow and annotated note blocks with stable semantic ids", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "v1-contract" });
	const next = mergeBoardState(current, {
		flows: [{
			id: "after",
			title: "After",
			variant: "after",
			actors: [{ id: "web", label: "WebView" }, { id: "native", label: "Native" }],
			steps: [{ id: "request", order: 1, from: "web", to: "native", action: "request", payload: "{ eventId }" }],
		}],
		noteDocument: {
			title: "학습 노트",
			sections: [{
				id: "code-reading",
				kind: "node",
				subjectId: "source",
				title: "코드 읽기",
				blocks: [{
					id: "request-code",
					type: "code",
					code: {
						language: "typescript",
						code: "const eventId = createId();\nawait clickXIntegration(eventId);",
						lineNumberMode: "source",
						startLine: 12,
						annotations: [{ line: 12, kind: "reason", text: "요청과 응답을 연결한다." }],
					},
				}],
			}],
		},
	});
	assert.equal(next.flows[0]?.steps[0]?.payload, "{ eventId }");
	assert.equal(next.noteDocument.sections[0]?.blocks[0]?.code?.startLine, 12);
	assert.equal(next.noteDocument.sections[0]?.blocks[0]?.code?.annotations?.[0]?.text, "요청과 응답을 연결한다.");
	assert.equal(next.revision, 1);
	assert.throws(() => mergeBoardState(next, {
		noteDocument: { title: "bad", sections: [{ id: "bad", kind: "node", title: "bad", blocks: [{ id: "bad-code", type: "code", code: { code: "one line", annotations: [{ line: 9, text: "outside" }] } }] }] },
	}), /outside 1-1/);
});

test("mergeBoardState normalizes table note blocks without losing cell values", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "table-contract" });
	const next = mergeBoardState(current, {
		noteDocument: { title: "Table note", sections: [{ id: "events", kind: "overview", title: "이벤트", blocks: [{
			id: "event-table",
			type: "table",
			columns: ["#", "이벤트", "등급"],
			rows: [[1, "신규 예약", "A"], [2, "리뷰 작성", "B"]],
		}] }] },
	});
	assert.deepEqual(next.noteDocument.sections[0]?.blocks[0]?.columns, ["#", "이벤트", "등급"]);
	assert.deepEqual(next.noteDocument.sections[0]?.blocks[0]?.rows, [["1", "신규 예약", "A"], ["2", "리뷰 작성", "B"]]);
	assert.throws(() => mergeBoardState(next, {
		noteDocument: { title: "Invalid", sections: [{ id: "events", kind: "overview", title: "이벤트", blocks: [{ id: "missing", type: "table", rows: [] }] }] },
	}), /table note block requires columns and rows/);
});

test("mergeBoardState preserves TFT visual specs as stable learning-note blocks", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "visual-contract" });
	const visual = {
		kind: "architecture-flow",
		title: "저장 경로",
		lanes: ["Frame", "Study Hard", "Export"],
		nodes: [{ id: "frame", lane: "Frame", title: "TFT visual" }, { id: "note", lane: "Study Hard", title: "visual block" }],
		edges: [{ from: "frame", to: "note", label: "원본 spec 보존" }],
	};
	const next = mergeBoardState(current, {
		noteDocument: { title: "Visual note", sections: [{ id: "visuals", kind: "flow", title: "시각화", blocks: [{ id: "architecture", type: "visual", title: "저장 경로", body: "같은 spec을 모든 표면에서 사용한다.", visual }] }] },
	});
	assert.deepEqual(next.noteDocument.sections[0]?.blocks[0]?.visual, visual);
	assert.throws(() => mergeBoardState(next, {
		noteDocument: { title: "Invalid", sections: [{ id: "visuals", kind: "flow", title: "시각화", blocks: [{ id: "missing", type: "visual" }] }] },
	}), /visual note block requires a visual spec/);
});

test("understanding blocks recover lightweight answer disclosures across legacy visual and Notion round-trip shapes", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "understanding-disclosure-migration" });
	const next = mergeBoardState(current, {
		noteDocument: { title: "SEO 학습 노트", sections: [{ id: "frame-v2-understanding", kind: "reflection", title: "이해 확인", blocks: [
			{
				id: "canonical-identity-question",
				type: "visual",
				title: "지역이 달라지면 canonical identity도 달라지는 이유",
				body: "region은 landing content의 지역 범위를 바꾸므로 서로 다른 canonical identity입니다.",
				visual: {
					title: "지역은 콘텐츠 identity 축입니다",
					presentation: { container: "details", defaultOpen: false, summary: "1. 서울과 부산은 왜 서로 다른 canonical identity인가?" },
					lanes: [{ id: "seoul", title: "서울" }],
					nodes: [{ id: "seoul-url", lane: "seoul", label: "region=seoul" }],
				},
			},
			{ id: "understanding-prompt", type: "callout", tone: "question", title: "먼저 내 말로 답한 뒤 펼쳐서 확인하기", body: "질문을 먼저 읽어보세요." },
			{ id: "notion-round-trip-question", type: "callout", tone: "question", title: "hreflang query가 같아야 하는 이유는 무엇인가?", body: "같은 콘텐츠 identity의 번역 관계이기 때문입니다." },
			{ id: "notion-round-trip-summary", type: "callout", tone: "question", title: "복습 요약", body: "질문이 아닌 안내는 펼쳐 둡니다." },
		] }] },
	});
	const [legacyVisual, prompt, importedQuestion, summary] = next.noteDocument.sections[0]?.blocks || [];
	assert.equal(legacyVisual?.type, "callout");
	assert.equal(legacyVisual?.tone, "question");
	assert.equal(legacyVisual?.title, "1. 서울과 부산은 왜 서로 다른 canonical identity인가?");
	assert.equal(legacyVisual?.presentation?.container, "details");
	assert.equal(legacyVisual?.presentation?.defaultOpen, false);
	assert.equal(legacyVisual?.visual, undefined);
	assert.equal(prompt?.presentation, undefined);
	assert.deepEqual(importedQuestion?.presentation, { container: "details", defaultOpen: false });
	assert.equal(summary?.presentation, undefined);
});

test("image note blocks preserve attachment and remote sources for board and export", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "image-contract" });
	const next = mergeBoardState(current, {
		noteDocument: { title: "Image note", sections: [{ id: "images", kind: "overview", title: "이미지", blocks: [
			{ id: "attachment-image", type: "image", image: { attachmentId: "img-1", alt: "첨부 구조도", caption: "경계 확인" } },
			{ id: "remote-image", type: "image", image: { url: "https://example.com/diagram.png", alt: "원문 구조도", caption: "원문 이미지" } },
		] }] },
	});
	assert.deepEqual(next.noteDocument.sections[0]?.blocks[0]?.image, { attachmentId: "img-1", url: undefined, path: undefined, mimeType: undefined, alt: "첨부 구조도", caption: "경계 확인" });
	assert.equal(next.noteDocument.sections[0]?.blocks[1]?.image?.url, "https://example.com/diagram.png");
	const exportHtml = buildStudyNoteExportHtml(next);
	assert.match(exportHtml, /https:\/\/example\.com\/diagram\.png/);
	assert.match(exportHtml, /원문 이미지/);
	const boardHtml = buildStudyHardStudioHtml();
	assert.match(boardHtml, /function noteImageHtml/);
	assert.match(boardHtml, /attachmentId/);
	assert.throws(() => mergeBoardState(next, {
		noteDocument: { title: "Invalid", sections: [{ id: "images", kind: "overview", title: "이미지", blocks: [{ id: "missing", type: "image", image: {} }] }] },
	}), /image note block requires attachmentId, url, or path/);
});

test("visual-ref derives one lane from the canonical visual spec without copying it", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "visual-ref-contract" });
	const visual = {
		kind: "architecture-flow",
		title: "Schema Diff",
		lanes: [{ id: "before", title: "Phase 1" }, { id: "after", title: "Phase 2" }],
		nodes: [
			{ id: "before-table", lane: "before", title: "현재" },
			{ id: "after-table", lane: "after", title: "확장" },
		],
		edges: [{ source: "before-table", target: "after-table", label: "확장" }],
	};
	const next = mergeBoardState(current, {
		noteDocument: { title: "Visual ref", sections: [{ id: "visuals", kind: "flow", title: "시각화", blocks: [
			{ id: "schema-diff", type: "visual", visual },
			{ id: "phase-two", type: "visual-ref", title: "Phase 2 · 컬럼 변화", body: "확장 구조만 자세히 봅니다.", visualRef: { sourceBlockId: "schema-diff", laneId: "after" } },
		] }] },
	});
	const reference = next.noteDocument.sections[0]?.blocks[1];
	assert.deepEqual(reference?.visualRef, { sourceBlockId: "schema-diff", laneId: "after" });
	assert.equal(reference?.visual, undefined);
	const derived = resolveStudyNoteBlockVisual(next.noteDocument, reference!);
	assert.deepEqual(derived?.lanes, [{ id: "after", title: "Phase 2" }]);
	assert.deepEqual((derived?.nodes as any[]).map((node) => node.id), ["after-table"]);
	assert.deepEqual(derived?.edges, []);
	assert.equal(derived?.title, "Phase 2 · 컬럼 변화");
	assert.equal(derived?.subtitle, "확장 구조만 자세히 봅니다.");
	assert.throws(() => mergeBoardState(next, {
		noteDocument: { title: "Invalid", sections: [{ id: "visuals", kind: "flow", title: "시각화", blocks: [
			{ id: "schema-diff", type: "visual", visual },
			{ id: "bad-ref", type: "visual-ref", visualRef: { sourceBlockId: "schema-diff", laneId: "missing" } },
		] }] },
	}), /visual-ref lane not found/);
});

test("mergeBoardState clears a stale flow step when switching variants", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "flow-clear" });
	current.flows = [
		{ id: "before", title: "Before", variant: "before", actors: [{ id: "a", label: "A" }, { id: "b", label: "B" }], steps: [{ id: "old", order: 1, from: "a", to: "b", action: "old" }] },
		{ id: "after", title: "After", variant: "after", actors: [{ id: "a", label: "A" }, { id: "b", label: "B" }], steps: [{ id: "new", order: 1, from: "a", to: "b", action: "new" }] },
	];
	current.selectedFlowId = "before";
	current.selectedFlowStepId = "old";
	const next = mergeBoardState(current, { selectedFlowId: "after", selectedFlowStepId: null });
	assert.equal(next.selectedFlowId, "after");
	assert.equal(next.selectedFlowStepId, undefined);
});

test("mergeBoardState keeps question scope and target immutable across agent feedback updates", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "question-scope" });
	current.questions = [{ id: "Q001", question: "전체 구조는?", origin: "learner", scope: "session", status: "open", targetNodeId: "source", workerResultPath: "/safe/Q001.json" }];
	const next = mergeBoardState(current, {
		questions: [{ id: "Q001", question: "전체 구조는?", origin: "coach", feedback: "세 가지 흐름입니다.", status: "answered", targetNodeId: "goal", workerResultPath: "/tmp/forged.json" }],
	});
	assert.deepEqual(
		{ origin: next.questions[0]?.origin, scope: next.questions[0]?.scope, targetNodeId: next.questions[0]?.targetNodeId, workerResultPath: next.questions[0]?.workerResultPath },
		{ origin: "learner", scope: "session", targetNodeId: "source", workerResultPath: "/safe/Q001.json" },
	);
});

test("generic board patch는 owner 질문의 누락·identity·canonical 순서·유일성을 보존한다", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "question-owner-guard" });
	current.questions = [
		{
			id: "Q001",
			question: "전체 경로를 검증해줘",
			origin: "learner",
			scope: "session",
			status: "open",
			createdAt: 100,
			processingStatus: "running",
			execution: { mode: "worker", phase: "worker-running", routedAt: 100, updatedAt: 110 },
			orchestrationId: "worker-owner-1",
			workerResultPath: "/safe/Q001.json",
			workerRunId: 17,
		},
		{
			id: "Q002",
			question: "두 번째 경로도 검증해줘",
			origin: "learner",
			scope: "session",
			status: "open",
			createdAt: 101,
			processingStatus: "running",
			execution: { mode: "worker", phase: "worker-running", routedAt: 101, updatedAt: 111 },
			orchestrationId: "worker-owner-2",
			workerResultPath: "/safe/Q002.json",
			workerRunId: 18,
		},
	];
	const protectedQuestions = structuredClone(current.questions);
	const forgedSecond = { id: "Q002", question: "두 번째 질문 바꿔치기", origin: "learner", scope: "session", status: "answered", feedback: "forged", processingStatus: "applied" };
	const patched = mergeBoardState(current, {
		questions: [
			forgedSecond,
			{
				id: "Q001",
				question: "첫 질문 바꿔치기",
				origin: "learner",
				scope: "note-block",
				targetNodeId: "forged-node",
				targetNoteBlockId: "forged-block",
				attachmentIds: ["forged-attachment"],
				createdAt: 999,
				status: "answered",
				feedback: "generic patch 답변",
				processingStatus: "applied",
				execution: { mode: "direct", phase: "answered", routedAt: 100, updatedAt: 120, completedAt: 120 },
				orchestrationId: "pi-forged",
				workerResultPath: "/tmp/forged.json",
			},
			{ ...forgedSecond, question: "duplicate Q002" },
			{ id: "Q003", question: "코치 질문", origin: "coach", scope: "session", status: "open" },
		],
	});
	assert.deepEqual(patched.questions.map((question) => question.id), ["Q001", "Q002", "Q003"]);
	assert.deepEqual(patched.questions.slice(0, 2), protectedQuestions);

	const omitted = mergeBoardState(current, {
		questions: [{ id: "Q003", question: "코치 질문", origin: "coach", scope: "session", status: "open" }],
	});
	assert.deepEqual(omitted.questions.map((question) => question.id), ["Q001", "Q002", "Q003"]);
	assert.deepEqual(omitted.questions.slice(0, 2), protectedQuestions);
});

test("mergeBoardState는 학습 코치 scope와 비동기 처리 상태를 보존한다", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "coach-question-state" });
	current.questions = [{ id: "Q001", question: "다음에 뭘 공부할까?", origin: "learner", scope: "coach", status: "open", processingStatus: "failed", orchestrationId: "coach-run-1", processingError: "과거 오류", processingErrorStage: "editor" }];
	const queued = mergeBoardState(current, {
		questions: [{ id: "Q001", question: "다음에 뭘 공부할까?", origin: "learner", scope: "coach", status: "open", processingStatus: "queued", orchestrationId: "coach-run-1", processingError: "" }],
	});
	const answered = mergeBoardState(queued, {
		questions: [{ id: "Q001", question: "다음에 뭘 공부할까?", origin: "coach", scope: "session", status: "answered", feedback: "Bridge보다 lifecycle을 먼저 보세요." }],
	});

	assert.equal(answered.questions[0]?.origin, "learner");
	assert.equal(answered.questions[0]?.scope, "coach");
	assert.equal(answered.questions[0]?.processingStatus, "queued");
	assert.equal(answered.questions[0]?.orchestrationId, "coach-run-1");
	assert.equal(answered.questions[0]?.processingError, undefined);
	assert.equal(answered.questions[0]?.processingErrorStage, undefined);
});

test("mergeBoardState preserves existing memo positions and places new nodes near their parent", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "stable-position" });
	current.nodes = [
		{ id: "root", label: "Root", type: "root", x: 100, y: 200, positionLocked: true },
		{ id: "child", label: "Child", parentId: "root", x: 400, y: 200 },
	];
	current.edges = [{ source: "root", target: "child" }];
	const next = mergeBoardState(current, {
		nodes: [
			{ id: "root", label: "Root updated", type: "root" },
			{ id: "child", label: "Child updated", parentId: "root" },
			{ id: "new-child", label: "New child", parentId: "root" },
		],
		edges: [{ source: "root", target: "child" }, { source: "root", target: "new-child" }],
	});
	assert.deepEqual({ x: next.nodes[0]?.x, y: next.nodes[0]?.y, locked: next.nodes[0]?.positionLocked }, { x: 100, y: 200, locked: true });
	assert.deepEqual({ x: next.nodes[1]?.x, y: next.nodes[1]?.y }, { x: 400, y: 200 });
	assert.equal(next.nodes[2]?.x, 124);
	assert.equal(next.nodes[2]?.y, 342);
});

test("layoutStudyGraph builds non-overlapping subtree regions instead of trusting manual coordinates", () => {
	const nodes = [
		{ id: "root", label: "Root", type: "root" as const, x: 9999, y: 9999 },
		{ id: "problem", label: "Problem", parentId: "root", type: "risk" as const },
		{ id: "cause", label: "Cause", parentId: "problem", type: "concept" as const },
		{ id: "solution", label: "Solution", parentId: "root", type: "decision" as const },
	];
	const laidOut = layoutStudyGraph(nodes, [
		{ source: "root", target: "problem" },
		{ source: "problem", target: "cause" },
		{ source: "root", target: "solution" },
	]);
	assert.equal(laidOut.find((node) => node.id === "root")?.x, 146);
	assert.deepEqual({ x: laidOut.find((node) => node.id === "problem")?.x, y: laidOut.find((node) => node.id === "problem")?.y }, { x: 0, y: 204 });
	assert.deepEqual({ x: laidOut.find((node) => node.id === "cause")?.x, y: laidOut.find((node) => node.id === "cause")?.y }, { x: 0, y: 408 });
	assert.deepEqual({ x: laidOut.find((node) => node.id === "solution")?.x, y: laidOut.find((node) => node.id === "solution")?.y }, { x: 292, y: 204 });
});

test("buildStudyHardStudioHtml keeps the learning note geometry stable under the question drawer overlay", () => {
	const html = buildStudyHardStudioHtml();
	assert.doesNotMatch(html, /reactflow@11/);
	assert.match(html, /mermaid@11/);
	assert.match(html, /data-surface="note" class="active"/);
	assert.match(html, /Before \/ After/);
	assert.match(html, /생각 보드/);
	assert.match(html, /id="thoughtBoard"/);
	assert.match(html, /노트 블록에서 나눈 질문과 worker 반영 결과/);
	assert.match(html, /data-thought-filter="all"/);
	assert.match(html, /data-thought-filter="unresolved"/);
	assert.match(html, /data-thought-filter="applied"/);
	assert.match(html, /data-thought-filter="failed"/);
	assert.match(html, /function thoughtQuestions/);
	assert.match(html, /q\.scope==='note-block'/);
	assert.match(html, /function thoughtGroups/);
	assert.match(html, /title:'과거 노트 블록'/);
	assert.match(html, /function thoughtQuestionCardHtml/);
	assert.match(html, /function memoSummaryText/);
	assert.match(html, /function legacyQuestionText/);
	assert.match(html, /function memoQuestionText/);
	assert.match(html, /question=memoQuestionText\(q\)/);
	assert.match(html, /esc\(legacyQuestionText\(q\.question\)\)/);
	assert.match(html, /resultSummary/);
	assert.match(html, /thoughtMemoGrid/);
	assert.match(html, /minmax\(min\(320px,100%\),360px\)/);
	assert.match(html, /thoughtMemoSummary/);
	assert.match(html, /thoughtMemoFull conversationMarkdown/);
	assert.match(html, /expandedThoughtQuestionIds=new Set\(\)/);
	assert.match(html, /data-toggle-thought-question/);
	assert.match(html, /aria-expanded/);
	assert.match(html, /답변 펼치기 ▼/);
	assert.match(html, /답변 접기 ▲/);
	assert.match(html, /renderConversationAnswer\(q\.feedback\)/);
	assert.match(html, /\.thoughtMemo\.expanded \{ grid-column:span 2/);
	assert.match(html, /\.thoughtMemo\.expanded \{ grid-column:span 1/);
	assert.match(html, /event\.target\.closest\('a,button,summary,details'\)/);
	assert.match(html, /event\.key!==['"]Enter['"]&&event\.key!==['"] ['"]/);
	assert.match(html, /대화 보기/);
	assert.doesNotMatch(html, /전체 답변 보기/);
	assert.doesNotMatch(html, /class="thoughtResult/);
	const compactThoughtSource = html.match(/function compactThoughtText\(value,maxLength\)\{[^}]+\}/)?.[0];
	const memoSummaryBody = /function memoSummaryText\(q\)\{([\s\S]*?)\}\n    function legacyQuestionText/.exec(html)?.[1];
	const legacyQuestionBody = /function legacyQuestionText\(value,maxLength\)\{([\s\S]*?)\}\n    function memoQuestionText/.exec(html)?.[1];
	assert.ok(compactThoughtSource && memoSummaryBody && legacyQuestionBody);
	const memoSummaryText = new Function(`${compactThoughtSource}; return function memoSummaryText(q){${memoSummaryBody}};`)() as (question: { resultSummary?: string; feedback?: string }) => string;
	const legacyQuestionText = new Function(`${compactThoughtSource}; return function legacyQuestionText(value,maxLength){${legacyQuestionBody}};`)() as (value: string, maxLength?: number) => string;
	const legacySummary = memoSummaryText({ feedback: "[heestolee.study-hard.transcript]\n📖 Study Hard Tutor 답변 · context\n\n질문: 왜 분리해?\n\n답변:\n## 결론\n- source와 inbox를 분리합니다.\n```text\nraw flow\n```\nhttps://example.com/private" });
	assert.match(legacySummary, /결론 source와 inbox를 분리합니다/);
	assert.doesNotMatch(legacySummary, /heestolee|Study Hard|질문:|```|https?:/);
	assert.equal(legacyQuestionText("[heestolee.study-hard.transcript] 📖 Study Hard Tutor 답변 · 학습 노트 질문: 화살표를 더 이해되게 연결할 방법이 있을까? 답변: 네, lane을 줄입니다."), "화살표를 더 이해되게 연결할 방법이 있을까?");
	assert.equal(legacyQuestionText("세 가지 방식을 비교해줘 ( [heestolee.study-hard.transcript] 질문: 이전 질문 답변: 이전 답변"), "세 가지 방식을 비교해줘");
	assert.equal(legacyQuestionText("일반 질문은 그대로 유지해줘", 180), "일반 질문은 그대로 유지해줘");
	assert.doesNotMatch(legacyQuestionText("[heestolee.study-hard.transcript] 질문: 실제 질문 답변: 실제 답변"), /heestolee|답변:/);
	const toggleThoughtBody = /function toggleThoughtQuestion\(questionId\)\{([\s\S]*?)\}\n    function bindThoughtBoard/.exec(html)?.[1];
	assert.ok(toggleThoughtBody);
	const toggleHarness = new Function(`var expandedThoughtQuestionIds=new Set(),renders=0; function renderMap(){renders+=1;} var document={querySelectorAll:function(){return[];}}; function setTimeout(callback){callback();} function toggleThoughtQuestion(questionId){${toggleThoughtBody}} return {toggle:toggleThoughtQuestion,expanded:expandedThoughtQuestionIds,renders:function(){return renders;}};`)() as { toggle(id: string): void; expanded: Set<string>; renders(): number };
	toggleHarness.toggle("Q-expand");
	assert.equal(toggleHarness.expanded.has("Q-expand"), true);
	assert.equal(toggleHarness.renders(), 1);
	toggleHarness.toggle("Q-expand");
	assert.equal(toggleHarness.expanded.has("Q-expand"), false);
	assert.equal(toggleHarness.renders(), 2);
	const thoughtCategorySource = html.match(/function thoughtQuestionCategory\(q\)\{[^}]+\}/)?.[0];
	assert.ok(thoughtCategorySource);
	const thoughtQuestionCategory = new Function(`${thoughtCategorySource}; return thoughtQuestionCategory;`)() as (question: { processingStatus?: string }) => string;
	assert.equal(thoughtQuestionCategory({ processingStatus: "queued" }), "unresolved");
	assert.equal(thoughtQuestionCategory({ processingStatus: "applied" }), "applied");
	assert.equal(thoughtQuestionCategory({ processingStatus: "failed" }), "failed");
	assert.equal(thoughtQuestionCategory({ processingStatus: "conflict" }), "failed");
	assert.match(html, /function bindNoteThoughtBadges/);
	assert.match(html, /if\(!count\|\|seen\.has\(blockId\)\)return/);
	assert.match(html, /data-open-thought-block/);
	assert.match(html, /function openThoughtBlock/);
	assert.match(html, /function openNoteBlockFromThought/);
	assert.match(html, /function thoughtFocusElement/);
	assert.match(html, /element\.dataset\[key\]===id/);
	assert.doesNotMatch(html, /focusThoughtElement\('\[data-/);
	assert.match(html, /surface==='map'\)\{closeDrawer\('detailDrawer'\)/);
	assert.match(html, /data-open-thought-question/);
	assert.match(html, /data-conversation-question/);
	assert.match(html, /thoughtNoteFocus/);
	assert.match(html, /id="htmlExportButton"/);
	assert.match(html, /id="notionExportButton"/);
	assert.match(html, /id="historyButton"/);
	assert.match(html, /id="historyDrawer"/);
	assert.match(html, /id="historyPreviewOverlay"/);
	assert.match(html, /id="historyPreviewFrame"/);
	assert.match(html, /id="historyRestoreConfirm"/);
	assert.match(html, /id="historyRestoreCancel"/);
	assert.match(html, /id="historyRestoreAccept"/);
	assert.match(html, /function workContractHtml/);
	assert.match(html, /data-work-contract-body/);
	assert.match(html, /fetch\('\/work-contract'/);
	assert.match(html, /workContractHtml\(\)\+'<div class="noteHeader"/);
	assert.doesNotMatch(html, /<details[^>]+workContract[^>]+open/);
	assert.match(html, /htmlExportButton[\s\S]*surfaceTabs/);
	assert.doesNotMatch(html, /AI가 정리한 개념 카드와 직접 만든 Scratch 메모/);
	assert.match(html, /전체 실행 흐름을 요약 비교/);
	assert.match(html, /학습 코치/);
	assert.match(html, /학습 내용이 아니라 학습 방향을 묻는 곳/);
	assert.match(html, /⌥↵ 또는 ⌘↵로 Pi에 질문/);
	assert.match(html, /processingStage/);
	assert.match(html, /study-hard-worker 배정 대기 중/);
	assert.match(html, /충돌 감지 · 최신 노트로 재조정 중/);
	assert.match(html, /Worker로 다시 시도/);
	assert.match(html, /Pi에 질문하기/);
	assert.match(html, /activeQuestionProcessing/);
	const activeQuestionProcessingSource = /function activeQuestionProcessing\(items\)\{[^}]+\}/.exec(html)?.[0];
	assert.ok(activeQuestionProcessingSource);
	const activeQuestionProcessing = new Function(`return (${activeQuestionProcessingSource})`)() as (items: Array<{ id: string; processingStatus: string }>) => { id: string } | null;
	assert.equal(activeQuestionProcessing([{ id: "old-failure", processingStatus: "failed" }, { id: "latest-success", processingStatus: "applied" }]), null);
	assert.equal(activeQuestionProcessing([{ id: "old-success", processingStatus: "applied" }, { id: "latest-failure", processingStatus: "failed" }])?.id, "latest-failure");
	const questionStateAfterSubmitBody = /function questionStateAfterSubmit\(current,result\)\{([\s\S]*?)\}\n    function activeQuestionProcessing/.exec(html)?.[1];
	assert.ok(questionStateAfterSubmitBody);
	const questionStateAfterSubmit = new Function(`return (function questionStateAfterSubmit(current,result){${questionStateAfterSubmitBody}})`)() as (current: any, result: any) => any;
	const mergingState = { currentQuestionId: "Q015", questions: [{ id: "Q015", processingStatus: "merging" }] };
	assert.equal(questionStateAfterSubmit(mergingState, { question: { id: "Q015", processingStatus: "queued" } }), mergingState);
	assert.deepEqual(questionStateAfterSubmit({ questions: [] }, { question: { id: "Q016", processingStatus: "queued" } }), { currentQuestionId: "Q016", questions: [{ id: "Q016", processingStatus: "queued" }] });
	assert.match(html, /\.then\(function\(result\)\{\s*if\(!answering\)\{state=questionStateAfterSubmit\(state,result\)/);
	assert.match(html, /composerState/);
	assert.match(html, /conversationCard/);
	assert.match(html, /#detailDrawer #conversation \{ flex:0 0 560px; height:560px; min-height:560px; display:flex; flex-direction:column; \}/);
	assert.match(html, /#detailDrawer #conversation > \.conversationCard \{ flex:1; min-height:0; display:flex; flex-direction:column; margin-bottom:0; \}/);
	assert.match(html, /#detailDrawer #conversation \.thread \{ flex:1; min-height:180px; max-height:none; \}/);
	assert.match(html, /scrollThreadToBottom/);
	assert.match(html, /isQuestionSubmitShortcut/);
	assert.match(html, /event\.altKey/);
	assert.match(html, /event\.metaKey/);
	assert.match(html, /⌥↵ 또는 ⌘↵로 Pi에 질문/);
	assert.match(html, /questionDrafts\[draftKey\]='';\s*input\.value='';\s*status\.innerHTML/);
	assert.match(html, /function companionHtml/);
	assert.match(html, /작업과 함께 쌓인 학습 기록/);
	assert.match(html, /작업 반영 제안/);
	assert.doesNotMatch(html, /esc\(q\.feedback\|\|pendingText\)\+processingStageHtml\(q\)/);
	assert.match(html, /학습 방향 반영 완료/);
	assert.match(html, /답변을 바탕으로 학습 방향을 정리하고 있어요/);
	assert.match(html, /questionDrafts/);
	assert.match(html, /coachDrafts/);
	assert.match(html, /answering\?'\/coach\/answer':'\/coach'/);
	assert.match(html, /post\('\/questions\/retry'/);
	assert.doesNotMatch(html, /학습 현황 · 읽기 전용/);
	assert.match(html, /X-Study-Hard-Capability/);
	assert.match(buildStudyHardStudioHtml("capability-test"), /capability-test/);
	assert.match(buildStudyHardStudioHtml("capability-test", true), /nativeVisualCapture=true/);
	assert.match(html, /nativeVisualCapture=false/);
	assert.match(html, /post\('\/export\/html'/);
	assert.match(html, /post\('\/export\/notion'/);
	assert.match(html, /svgToPngDataUrl/);
	assert.match(html, /collectNotionDiagramAssets/);
	assert.match(html, /data-note-visual/);
	assert.match(html, /\/note-visual\//);
	assert.match(html, /captureVisualFrame/);
	assert.match(html, /captureTftVisualPng/);
	assert.match(html, /Downloads 저장됨/);
	assert.doesNotMatch(html, /link\.download/);
	assert.match(html, /post\('\/history\/restore'/);
	assert.match(html, /function openHistoryPreview/);
	assert.match(html, /function requestHistoryRestore/);
	assert.match(html, /function resolveHistoryRestore/);
	assert.match(html, /data-history-revision/);
	assert.match(html, /historyPreviewFrame/);
	assert.match(html, /historyPreviewClose'[\s\S]*closeHistoryPreview/);
	assert.match(html, /historyRestoreCancel'[\s\S]*resolveHistoryRestore\(false\)/);
	assert.match(html, /historyRestoreAccept'[\s\S]*resolveHistoryRestore\(true\)/);
	assert.match(html, /if\(!accepted\)return;button\.disabled=true/);
	assert.match(html, /frame\.src='about:blank'/);
	assert.doesNotMatch(html, /window\.open\('\/history/);
	assert.doesNotMatch(html, /window\.confirm/);
	assert.match(html, /\/history\//);
	assert.match(html, /sequenceDiagram/);
	assert.match(html, /renderNoteMermaidDiagrams/);
	assert.match(html, /function isOverviewMermaidSource/);
	assert.match(html, /target\.classList\.toggle\('fitOverview',isOverviewMermaidSource\(source\)\)/);
	const overviewClassifierSource = html.match(/function isOverviewMermaidSource\(source\)\{[^}]+\}/)?.[0];
	assert.ok(overviewClassifierSource);
	const isOverviewMermaidSource = new Function(`${overviewClassifierSource}; return isOverviewMermaidSource;`)() as (source: string) => boolean;
	assert.equal(isOverviewMermaidSource("erDiagram\n  A ||--o{ B : relation"), true);
	assert.equal(isOverviewMermaidSource("flowchart LR\n  A --> B"), false);
	assert.equal(isOverviewMermaidSource("sequenceDiagram\n  A->>B: relation"), false);
	assert.match(html, /noteDiagramCanvas\.fitOverview svg \{ width:100% !important; height:clamp\(360px,72vh,760px\) !important; max-height:760px; \}/);
	assert.match(html, /#detailContent \.noteDiagramCanvas\.fitOverview svg \{ height:clamp\(300px,58vh,560px\) !important; max-height:560px; \}/);
	assert.match(html, /mermaidCompare \{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
	assert.match(html, /mermaidComparePanel \.noteDiagramCanvas \{ min-height:210px; max-height:380px/);
	assert.match(html, /function noteSectionBlocksHtml/);
	assert.match(html, /function noteListHtml/);
	assert.match(html, /function noteTableHtml/);
	assert.match(html, /b\.type==='table'/);
	assert.match(html, /\.noteTableWrap \{ overflow-x:auto/);
	assert.match(html, /function effectiveNoteHeadingLevel/);
	assert.match(html, /function calloutToneMeta/);
	assert.match(html, /\.noteDepth2 \{ margin-left:52px; \}/);
	assert.match(html, /mermaidComparisonSide\(beforeLabel\)==='before'/);
	assert.match(html, /왼쪽 현재 구조에서 오른쪽 제안 구조로 비교하세요/);
	assert.match(html, /data-mermaid-source/);
	assert.match(html, /data-inline-flow/);
	assert.match(html, /sequenceSource\(flow\)/);
	assert.doesNotMatch(html, /function boardCards/);
	assert.doesNotMatch(html, /post\('\/memo'/);
	assert.match(html, /color-scheme:light/);
	assert.match(html, /--bg:#f6f1e7/);
	assert.match(html, /\.codeLine\.annotated/);
	assert.match(html, /annotated\.has\(number\)/);
	assert.match(html, /lineNumberMode/);
	assert.match(html, /annotations/);
	assert.match(html, /drawer right/);
	assert.match(html, /--drawer-width:min\(430px,max\(360px,34vw\),calc\(100vw - 32px\)\)/);
	assert.match(html, /\.noteDocument \{ max-width:1120px/);
	assert.doesNotMatch(html, /#workspace\.rightDrawerOpen #noteSurface \.noteBody/);
	assert.doesNotMatch(html, /#workspace\.rightDrawerOpen #noteSurface \.noteDocument/);
	assert.doesNotMatch(html, /\.noteBody \{[^}]*transition:padding-right/);
	assert.match(html, /#workspace\.rightDrawerOpen #reviewSurface \.reviewBody/);
	assert.match(html, /id==='detailDrawer'[\s\S]*statusDrawer'[\s\S]*historyDrawer'/);
	assert.doesNotMatch(html, /max-width:860px/);
	assert.match(html, /\/workspace/);
	assert.match(html, /\/answer/);
	assert.doesNotMatch(html, /onNodeDragStop/);
	assert.match(html, /safeUrl/);
	assert.match(html, /EventSource\('\/events'\)/);
	assert.match(html, /clipboardImageFiles/);
	assert.match(html, /이미지는 입력창에 ⌘V로 붙여넣기/);
	assert.match(html, /questionDraftAttachments/);
	assert.match(html, /attachmentIds:pendingAttachments/);
	assert.match(html, /post\('\/attachments\/remove'/);
	assert.doesNotMatch(html, /grid-template-columns:\s*288px minmax\(640px,1fr\) 440px/);
});

test("buildStudyHardStudioHtml inline browser script parses", () => {
	const html = buildStudyHardStudioHtml();
	const inlineScripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
	assert.ok(inlineScripts.length > 0);
	for (const script of inlineScripts) {
		new Function(script);
	}
});

test("Study Hard conversation answers render safe GFM markdown while learner messages stay plain", () => {
	const html = buildStudyHardStudioHtml();
	assert.match(html, /marked@15\/marked\.min\.js/);
	assert.match(html, /function sanitizeConversationMarkdown/);
	assert.match(html, /function renderConversationMarkdown/);
	assert.match(html, /function renderConversationAnswer/);
	assert.match(html, /breaks:true,gfm:true/);
	assert.match(html, /script,iframe,object,embed,form,style,link,meta,base,img,svg/);
	assert.match(html, /new Set\(\['p','br','strong','em','del','code','pre','blockquote','ul','ol','li','h1','h2','h3','h4','h5','h6','table','thead','tbody','tr','th','td','a','hr'\]\)/);
	assert.match(html, /noopener noreferrer/);
	assert.match(html, /class="bubble coach markdownBubble"/);
	assert.match(html, /class="conversationMarkdown"/);
	assert.match(html, /과거 처리 로그/);
	assert.match(html, /\.conversationMarkdown table \{[^}]*overflow-x:auto/);
	assert.match(html, /\.conversationMarkdown pre \{[^}]*overflow:auto/);
	assert.doesNotMatch(html, /esc\(q\.feedback\)/);
	const safeUrlBody = /function safeUrl\(v\)\{([\s\S]*?)\}function safeMarkdownHref/.exec(html)?.[1];
	const safeMarkdownHrefBody = /function safeMarkdownHref\(value\)\{([^}]+)\}/.exec(html)?.[1];
	assert.ok(safeUrlBody && safeMarkdownHrefBody);
	const safeMarkdownHref = new Function(`function safeUrl(v){${safeUrlBody}}; return function safeMarkdownHref(value){${safeMarkdownHrefBody}};`)() as (value: string) => string;
	assert.equal(safeMarkdownHref("https://example.com/docs"), "https://example.com/docs");
	assert.equal(safeMarkdownHref("javascript:alert(1)"), "");
	assert.equal(safeMarkdownHref("data:text/html,bad"), "");
});

test("Study Hard window uses the shared Glimpse host adapter", async () => {
	let openCalls = 0;
	let openedHtml = "";
	setGlimpseOpenForTests(((html: string, options: Record<string, unknown>) => {
		openCalls += 1;
		openedHtml = html;
		assert.equal(options.width, 1220);
		return { on() {}, show() {}, close() {} } as any;
	}) as any);
	const fakePi = { exec() { throw new Error("browser fallback must not run"); }, sendMessage() {} } as any;
	try {
		await startStudyHardStudio(fakePi, { hasUI: true, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/shared-glimpse", runId: "shared-glimpse" });
		assert.equal(openCalls, 1);
		assert.match(openedHtml, /Study Hard Studio 열기/);
	} finally {
		setGlimpseOpenForTests(undefined);
		stopStudyHardStudios();
	}
});

test("Study Hard checks for Frame and exposes the complete plan as a lazy read-only contract", async () => {
	const root = mkdtempSync(join(tmpdir(), "study-hard-frame-contract-"));
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, "frame.json"), JSON.stringify({
		version: 1,
		identity: { key: "worktree:frame-contract", displayTitle: "Frame · 알림 시스템" },
		goal: "파트너 알림 작업 기획",
		success_criteria: [{ id: "SC-1", statement: "알림이 도착한다", evidence_locator: "UI" }],
		implementation_plan: { status: "ready", slices: [{ id: "S1", goal: "알림 저장" }] },
		provenance: { canonicalHash: "frame-contract-hash" },
	}, null, 2));
	writeFileSync(join(piDir, "frame.md"), "# Frame · 알림 시스템\n\n## 목표\n\n파트너 알림 작업 기획\n\n| ID | 성공 기준 |\n|---|---|\n| SC-1 | 알림이 도착한다 |\n");
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const downloadDir = join(root, "Downloads");
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: root } as any, { url: "https://example.com/frame-contract", runId: "frame-contract", downloadDir });
	try {
		const state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		assert.equal(state.workContract.title, "Frame · 알림 시스템");
		assert.equal(state.workContract.hash, "frame-contract-hash");
		assert.equal(state.noteDocument.sections.some((section: any) => section.id === "work-contract"), false, "Frame must not be copied into noteDocument");
		const response = await fetch(new URL("/work-contract", handle.url));
		assert.equal(response.status, 200);
		const contractHtml = await response.text();
		assert.match(contractHtml, /<h1>Frame · 알림 시스템<\/h1>/);
		assert.match(contractHtml, /<table>/);
		assert.match(contractHtml, /SC-1/);
		const exportResponse = await fetch(new URL("/export/html", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: "{}" });
		assert.equal(exportResponse.status, 200);
		const exportResult = await exportResponse.json() as any;
		const exportedHtml = readFileSync(exportResult.path, "utf8");
		assert.match(exportedHtml, /<details class="workContract">/);
		assert.match(exportedHtml, /작업 기획 전체 보기/);
		assert.match(exportedHtml, /알림이 도착한다/);
	} finally {
		stopStudyHardStudios();
		rmSync(root, { recursive: true, force: true });
	}

	const noFrameRoot = mkdtempSync(join(tmpdir(), "study-hard-no-frame-"));
	const noFrameHandle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: noFrameRoot } as any, { url: "https://example.com/no-frame", runId: "no-frame-contract" });
	try {
		const state = await fetch(new URL("/state", noFrameHandle.url)).then((response) => response.json() as Promise<any>);
		assert.equal(state.workContract, undefined);
		assert.equal((await fetch(new URL("/work-contract", noFrameHandle.url))).status, 404);
	} finally {
		stopStudyHardStudios();
		rmSync(noFrameRoot, { recursive: true, force: true });
	}
});

test("buildStudyNoteExportHtml creates a standalone learning note with Mermaid and references", () => {
	const state = createInitialBoardState({ url: "https://example.com/source", runId: "note-export" });
	state.revision = 7;
	state.noteDocument = {
		title: "RN 학습 노트",
		sections: [{
			id: "overview",
			kind: "overview",
			title: "핵심 구조",
			blocks: [
				{ id: "structure", type: "heading", level: 2, text: "구조" },
				{ id: "before", type: "heading", level: 3, text: "Before" },
				{ id: "mental-model", type: "callout", tone: "question", title: "한 문장", body: "공통 core와 platform edge를 분리한다." },
				{ id: "nested-list", type: "list", items: ["상위", "\t하위", "  같은 하위"] },
				{ id: "event-table", type: "table", columns: ["#", "이벤트", "등급"], rows: [["1", "신규 예약", "A"]] },
				{ id: "code", type: "code", code: { language: "text", code: "JS -> Native", lineNumberMode: "relative" } },
				{ id: "diagram", type: "code", code: { language: "mermaid", code: "flowchart LR\n  JS --> Native" } },
				{ id: "refs", type: "reference-list", references: [{ kind: "link", label: "공식 문서", url: "https://reactnative.dev/architecture/xplat-implementation" }] },
			],
		}],
	};
	const html = buildStudyNoteExportHtml(state);
	assert.match(html, /RN 학습 노트/);
	assert.match(html, /revision 7/);
	assert.match(html, /class="mermaid"/);
	assert.match(html, /flowchart LR/);
	assert.match(html, /공식 문서/);
	assert.match(html, /mermaid@11/);
	assert.match(html, /class="noteDepth2"/);
	assert.match(html, /<ul><li>상위<ul><li>하위<\/li><li>같은 하위<\/li><\/ul><\/li><\/ul>/);
	assert.match(html, /<table class="noteTable">/);
	assert.match(html, /<th>이벤트<\/th>/);
	assert.match(html, /<td>신규 예약<\/td>/);
	assert.match(html, /<em>Line numbering: relative, start 1<\/em>/);
	assert.match(html, /class="callout question"/);
	assert.match(html, /aria-label="질문">❓<\/span>/);
	assert.doesNotMatch(html, /htmlExportButton/);
});

test("Study Hard renders understanding answers as collapsed callout disclosures without architecture visuals", () => {
	const state = createInitialBoardState({ url: "https://example.com/source", runId: "answer-disclosure-export" });
	state.noteDocument = { title: "Understanding check", sections: [{ id: "understanding-check", kind: "reflection", title: "이해 확인", blocks: [{
		id: "answer-disclosure",
		type: "callout",
		tone: "question",
		title: "region이 달라지면 왜 canonical identity도 달라지는가? <script>alert(1)</script>?",
		body: "landing content의 지역 범위와 결과 목록이 함께 달라지기 때문입니다. <img src=x onerror=alert(1)>",
		presentation: { container: "details", defaultOpen: false },
	}] }] };
	const collapsedHtml = buildStudyNoteExportHtml(state);
	assert.match(collapsedHtml, /<details class="answerDisclosure">/);
	assert.match(collapsedHtml, /내 답과 비교하기 · 펼쳐서 확인/);
	assert.match(collapsedHtml, /landing content의 지역 범위/);
	assert.match(collapsedHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
	assert.match(collapsedHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
	assert.doesNotMatch(collapsedHtml, /<script>alert\(1\)<\/script>/);
	assert.doesNotMatch(collapsedHtml, /class="visualFrame"/);
	assert.doesNotMatch(collapsedHtml, /Architecture flow/);

	state.noteDocument.sections[0].blocks[0].presentation!.defaultOpen = true;
	assert.match(buildStudyNoteExportHtml(state), /<details class="answerDisclosure" open>/);

	const boardHtml = buildStudyHardStudioHtml();
	assert.match(boardHtml, /function noteCalloutHtml/);
	assert.match(boardHtml, /noteAnswerDisclosure/);
	assert.match(boardHtml, /내 답과 비교하기 · 펼쳐서 확인/);
});

test("buildStudyNoteExportHtml preserves an interactive TFT visual, PNG fallback, and source spec", () => {
	const state = createInitialBoardState({ url: "https://example.com/source", runId: "visual-export" });
	const visual = {
		kind: "architecture-flow",
		title: "Frame에서 저장까지",
		lanes: ["Frame", "Study Hard", "Export"],
		nodes: [{ id: "frame", lane: "Frame", title: "TFT visual" }, { id: "note", lane: "Study Hard", title: "학습 노트" }],
		edges: [{ from: "frame", to: "note", label: "spec" }],
	};
	state.noteDocument = { title: "Visual export", sections: [{ id: "visuals", kind: "flow", title: "시각화", blocks: [{ id: "visual-1", type: "visual", title: "Frame에서 저장까지", body: "사용자가 다듬은 구조", visual }] }] };
	const pngPath = join(testStateDir, "visual-fallback.png");
	writeFileSync(pngPath, Buffer.from("visual-png"));
	const html = buildStudyNoteExportHtml(state, [{ blockId: "visual-1", fileName: "visual-1.png", mimeType: "image/png", path: pngPath, sha256: "test" }] as any);
	assert.match(html, /class="visualFrame"/);
	assert.doesNotMatch(html, /<details class="visualStudyDisclosure"/);
	assert.match(html, /PNG fallback 보기/);
	assert.match(html, /data:image\/png;base64/);
	assert.match(html, /원본 visual spec 보기/);
	assert.match(html, /architecture-flow/);
	const source = /<iframe[^>]+src="data:text\/html;base64,([^"]+)"/.exec(html)?.[1];
	assert.ok(source);
	const embedHtml = Buffer.from(source, "base64").toString("utf-8");
	assert.match(embedHtml, /tft-visual-only/);
	assert.match(embedHtml, /captureTftVisualPng/);
	assert.match(embedHtml, /Frame에서 저장까지/);
	assert.ok(Buffer.byteLength(embedHtml) < 400_000, "dedicated Frame visuals should not duplicate the ELK bundle");
	for (const script of [...embedHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1])) new Function(script);
});

test("Study Hard renders presentation.container=details visuals as an opt-in disclosure in the board and HTML export", () => {
	const state = createInitialBoardState({ url: "https://example.com/source", runId: "visual-details-export" });
	const visual = {
		kind: "data-model-migration-map",
		title: "기존 Admin 알림 데이터 구조",
		entities: [{ name: "admin_notification", columns: [{ name: "id", primaryKey: true }] }],
		presentation: { container: "details", defaultOpen: false, summary: "기존 Admin 알림 레퍼런스" },
	};
	state.noteDocument = { title: "Visual details export", sections: [{ id: "visuals", kind: "flow", title: "시각화", blocks: [{ id: "visual-details", type: "visual", title: "Admin 알림", body: "Partner 설계 비교용", visual }] }] };
	const collapsedHtml = buildStudyNoteExportHtml(state);
	assert.match(collapsedHtml, /<details class="visualStudyDisclosure">/);
	assert.match(collapsedHtml, /<span>기존 Admin 알림 레퍼런스<\/span><small>비교·확인용 · 펼쳐서 보기<\/small>/);
	assert.match(collapsedHtml, /class="visualFrame"/);

	visual.presentation.defaultOpen = true;
	const openHtml = buildStudyNoteExportHtml(state);
	assert.match(openHtml, /<details class="visualStudyDisclosure" open>/);

	const boardHtml = buildStudyHardStudioHtml();
	assert.match(boardHtml, /function noteVisualPresentation/);
	assert.match(boardHtml, /noteVisualDisclosure/);
	assert.match(boardHtml, /String\(p\.container\|\|''\)\.toLowerCase\(\)===\x27details\x27/);
	assert.match(boardHtml, /a,button,summary/);
});

test("export routes write HTML to Downloads and pass rendered diagrams to Notion sync", async () => {
	const fakeSyncScript = join(testStateDir, "fake-study-hard-sync.py");
	writeFileSync(fakeSyncScript, "import json\nprint(json.dumps({'pageId':'page-1','pageUrl':'https://notion.so/page1','sessionId':'session-1','sectionHashes':{'#document':'hash-1'},'htmlDividerId':'html-divider','htmlHeadingId':'html-heading','htmlBlockId':'html-file','htmlHash':'html-hash','htmlFileName':'study-hard.html'}))\n", "utf-8");
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const runId = "export-routes";
	const downloadDir = join(testStateDir, "Downloads");
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/export", runId, syncScript: fakeSyncScript, downloadDir });
	try {
		updateStudyHardStudio(runId, {
			noteDocument: { title: "Export Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "Exported body" }, { id: "event-table", type: "table", columns: ["#", "이벤트"], rows: [["1", "신규 예약"]] }, { id: "diagram", type: "code", code: { language: "mermaid", code: "flowchart LR\nA --> B" } }] }] },
			questions: [{ id: "Q001", origin: "learner", scope: "session", question: "왜?", feedback: "이유", status: "answered" }],
		});
		let response = await fetch(new URL("/export/notion", handle.url), { method: "POST" });
		assert.equal(response.status, 403);
		response = await fetch(new URL("/export/notion", handle.url), { method: "POST", headers: { ...authorizedHeaders(handle), Origin: "https://malicious.example" } });
		assert.equal(response.status, 403);
		response = await fetch(new URL("/export/html", handle.url), { method: "POST", headers: authorizedHeaders(handle) });
		assert.equal(response.status, 200);
		const htmlResult = await response.json() as any;
		assert.equal(htmlResult.revision, 1);
		assert.equal(htmlResult.path, join(downloadDir, htmlResult.fileName));
		assert.equal(htmlResult.url, undefined);
		assert.equal(existsSync(htmlResult.path), true);
		assert.match(readFileSync(htmlResult.path, "utf-8"), /Exported body/);
		response = await fetch(new URL("/exports/notion-sync.json", handle.url));
		assert.equal(response.status, 400);

		const pngDataUrl = `data:image/png;base64,${Buffer.from("rendered-png").toString("base64")}`;
		response = await fetch(new URL("/export/notion", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ diagramAssets: [{ blockId: "diagram", mimeType: "image/png", dataUrl: pngDataUrl }] }) });
		assert.equal(response.status, 200);
		const notionResult = await response.json() as any;
		assert.equal(notionResult.pageUrl, "https://notion.so/page1");
		assert.equal(notionResult.syncedRevision, 1);
		assert.equal(notionResult.staleAfterSync, false);
		const state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.notionSync.pageId, "page-1");
		assert.match(state.notionSync.calendarDate, /^\d{4}-\d{2}-\d{2}$/);
		assert.equal(state.notionSync.lastSyncedRevision, 1);
		assert.equal(state.notionSync.sectionHashes["#document"], "hash-1");
		assert.equal(state.notionSync.htmlBlockId, "html-file");
		const syncInput = JSON.parse(readFileSync(join(testStateDir, `${runId}-exports`, "notion-sync.json"), "utf-8"));
		assert.equal(syncInput.qa[0].id, "Q001");
		assert.equal(syncInput.date, state.notionSync.calendarDate);
		assert.equal(syncInput.sourceUrl, "https://example.com/export");
		assert.deepEqual(syncInput.noteDocument.sections[0].blocks[1], { id: "event-table", type: "table", columns: ["#", "이벤트"], rows: [["1", "신규 예약"]], ordered: false });
		assert.equal(syncInput.diagramAssets[0].blockId, "diagram");
		assert.equal(readFileSync(syncInput.diagramAssets[0].path, "utf-8"), "rendered-png");
		assert.equal(syncInput.htmlAsset.mimeType, "text/html");
		assert.equal(existsSync(syncInput.htmlAsset.path), true);
		assert.match(readFileSync(syncInput.htmlAsset.path, "utf-8"), /Exported body/);
	} finally {
		stopStudyHardStudios();
	}
});

test("Notion conflict stays unsaved until section choices are submitted", async () => {
	const fakeSyncScript = join(testStateDir, "fake-conflict-study-hard-sync.py");
	writeFileSync(fakeSyncScript, `import json,sys\np=json.load(open(sys.argv[2]))\nr=p.get('conflictResolution') or {}\nif not r:\n print(json.dumps({'status':'conflict','pageId':'page-1','pageUrl':'https://notion.so/page1','conflicts':[{'sectionId':'overview','title':'Overview','currentPreview':'Notion edit','desiredPreview':'Study Hard edit','currentNoteBlocks':[{'id':'notion-p','type':'paragraph','text':'Notion edit\\n두 번째 줄'},{'id':'notion-image-1','type':'image','image':{'url':'https://example.com/notion-image.png','alt':'Notion 추가 이미지','caption':'직접 추가한 구조도'}}],'desiredNoteBlocks':[{'id':'lead','type':'paragraph','text':'Study Hard edit'}],'unmanagedBlockIds':['1']}]}))\nelse:\n modes={k:(v if isinstance(v,str) else v.get('choice')) for k,v in r.items()}\n print(json.dumps({'status':'synced','pageId':'page-1','pageUrl':'https://notion.so/page1','sessionId':'session-1','sectionHashes':{'overview':'current-hash'},'sectionSourceHashes':{'overview':'source-hash'},'sectionBlockIds':{'overview':'block-1'},'sectionHeadingIds':{'overview':'heading-1'},'sectionModes':modes}))\n`, "utf-8");
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/notion-conflict", runId: "notion-conflict", syncScript: fakeSyncScript });
	try {
		updateStudyHardStudio(handle.state.runId, { noteDocument: { title: "Conflict Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "Study Hard edit" }] }] } });
		let response = await fetch(new URL("/export/notion", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: "{}" });
		assert.equal(response.status, 200);
		let result = await response.json() as any;
		assert.equal(result.status, "conflict");
		assert.equal(result.conflicts[0].sectionId, "overview");
		assert.deepEqual(result.conflicts[0].blockDiff.map((row: any) => row.status), ["changed", "removed"]);
		let state = await fetch(new URL("/state", handle.url)).then((item) => item.json() as Promise<any>);
		assert.equal(state.notionSync, undefined);

		response = await fetch(new URL("/export/notion", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ conflictResolution: { overview: { choice: "manual", blocks: [{ id: "manual-callout", type: "callout", tone: "success", title: "직접 정리", body: "블록 형태를 유지한 병합" }] }, ignored: "invalid" } }) });
		assert.equal(response.status, 200);
		result = await response.json() as any;
		assert.equal(result.status, "synced");
		state = await fetch(new URL("/state", handle.url)).then((item) => item.json() as Promise<any>);
		assert.equal(state.notionSync.sectionModes.overview, "manual");
		assert.equal(state.notionSync.sectionBlockIds.overview, "block-1");
		const syncInput = JSON.parse(readFileSync(join(testStateDir, "notion-conflict-exports", "notion-sync.json"), "utf-8"));
		assert.equal(syncInput.conflictResolution.overview.choice, "manual");
		assert.deepEqual(syncInput.conflictResolution.overview.blocks[0], { id: "manual-callout", type: "callout", title: "직접 정리", body: "블록 형태를 유지한 병합", tone: "success", ordered: false });
		const html = buildStudyHardStudioHtml();
		assert.match(html, /Notion 변경 충돌 해소/);
		assert.match(html, /requestNotionConflict/);
		assert.match(html, /모두 Study Hard 적용/);
		assert.match(html, /모두 직접 정리/);
		assert.match(html, /notionConflictDialog \{ width:94vw/);
		assert.doesNotMatch(html, /1500px/);
		assert.match(html, /resize:both/);
		assert.match(html, /function mergePreviewHtml/);
		assert.match(html, /function blockDiffHtml/);
		assert.match(html, /blockDiffSide removed/);
		assert.match(html, /blockDiffSide added/);
		assert.match(html, /자동 병합 초안/);
		assert.match(html, /현재 block 사용/);
		assert.match(html, /변경 block 사용/);
		assert.match(html, /notionConflictBlockChoices/);
		assert.match(html, /data-block-action="delete"/);
		assert.match(html, /notionConflictPreviewBody/);
		assert.match(html, /현재 Notion에만 추가된 block/);
		assert.match(html, /이미지 .*개 포함/);
		assert.match(html, /function mergeBlockEditorHtml/);
		assert.match(html, /data-manual-base="left"/);
		assert.match(html, /Notion에서 .* 가져옴/);
	} finally {
		stopStudyHardStudios();
	}
});

test("Notion-only section changes are imported into the canonical Study Hard note", async () => {
	const fakeSyncScript = join(testStateDir, "fake-import-study-hard-sync.py");
	writeFileSync(fakeSyncScript, `import json\nprint(json.dumps({'status':'synced','pageId':'page-import','pageUrl':'https://notion.so/import','sessionId':'session-import','sectionHashes':{'overview':'notion-hash'},'sectionSourceHashes':{'overview':'source-hash'},'sectionBlockIds':{'overview':'block-1'},'sectionModes':{'overview':'notion'},'importedSections':[{'sectionId':'overview','title':'Overview','source':'notion','blocks':[{'id':'notion-callout','type':'callout','tone':'info','title':'Notion 정리','body':'양방향으로 가져온 내용'}]}],'importedAttachments':[{'id':'notion-image-1','name':'image.png','mimeType':'image/png','path':'/tmp/image.png','note':'Notion 이미지'}]}))\n`, "utf-8");
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/notion-import", runId: "notion-import", syncScript: fakeSyncScript });
	try {
		updateStudyHardStudio(handle.state.runId, { noteDocument: { title: "Import Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "old", type: "paragraph", text: "old" }] }] } });
		const response = await fetch(new URL("/export/notion", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: "{}" });
		assert.equal(response.status, 200);
		const state = await fetch(new URL("/state", handle.url)).then((item) => item.json() as Promise<any>);
		assert.deepEqual(state.noteDocument.sections[0].blocks[0], { id: "notion-callout", type: "callout", title: "Notion 정리", body: "양방향으로 가져온 내용", tone: "info", ordered: false });
		assert.equal(state.attachments.some((item: any) => item.id === "notion-image-1"), true);
		assert.equal(state.notionSync.sectionModes.overview, "notion");
		assert.equal(state.notionSync.lastSyncedRevision, state.revision);
		const syncInput = JSON.parse(readFileSync(join(testStateDir, "notion-import-exports", "notion-sync.json"), "utf-8"));
		assert.match(readFileSync(syncInput.htmlAsset.path, "utf-8"), /양방향으로 가져온 내용/);
	} finally {
		stopStudyHardStudios();
	}
});

test("Notion sync failure preserves sanitized Python stderr and exit code", async () => {
	const fakeSyncScript = join(testStateDir, "fake-failing-study-hard-sync.py");
	writeFileSync(fakeSyncScript, "import sys\nsys.stderr.write('ERROR: Notion API 400: {\\\"code\\\":\\\"validation_error\\\",\\\"message\\\":\\\"file upload rejected ntn_SUPERSECRET\\\"}\\n')\nraise SystemExit(7)\n", "utf-8");
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/notion-error", runId: "notion-error-detail", syncScript: fakeSyncScript });
	const originalConsoleError = console.error;
	const logs: string[] = [];
	console.error = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
	try {
		const response = await fetch(new URL("/export/notion", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: "{}" });
		assert.equal(response.status, 500);
		const result = await response.json() as any;
		assert.match(result.error, /Notion 동기화 실패 \(exit 7\)/);
		assert.match(result.error, /Notion API 400/);
		assert.match(result.error, /validation_error/);
		assert.match(result.error, /ntn_\[REDACTED\]/);
		assert.doesNotMatch(result.error, /SUPERSECRET/);
		assert.match(logs.join("\n"), /study-hard:notion-sync/);
	} finally {
		console.error = originalConsoleError;
		stopStudyHardStudios();
	}
});

test("visual export routes use native snapshots for HTML fallback and Notion assets", async () => {
	const fakeOpen = (() => {
		return (_html: string, _options: Record<string, unknown>) => {
			const listeners = new Map<string, Array<(data?: any) => void>>();
			const emit = (event: string, data?: unknown) => {
				for (const listener of listeners.get(event) || []) listener(data);
			};
			const window = {
				on(event: string, handler: (data?: any) => void) {
					const current = listeners.get(event) || [];
					current.push(handler);
					listeners.set(event, current);
				},
				close() {},
				_write(message: Record<string, unknown>) {
					if (message.type === "resize") {
						queueMicrotask(() => emit("message", { type: "tft-visual-ready", width: message.width, height: message.height }));
						return;
					}
					if (message.type !== "snapshot") return;
					queueMicrotask(() => emit("message", {
						type: "snapshot",
						requestId: message.requestId,
						width: 900,
						height: 620,
						pixelWidth: 1800,
						pixelHeight: 1240,
						dataUrl: `data:image/png;base64,${Buffer.from("native-visual-png").toString("base64")}`,
					}));
				},
			};
			queueMicrotask(() => emit("message", { type: "tft-visual-ready", width: 900, height: 620 }));
			return window;
		};
	})();
	setGlimpseOpenForTests(fakeOpen as any);
	const fakeSyncScript = join(testStateDir, "fake-visual-sync.py");
	writeFileSync(fakeSyncScript, "import json\nprint(json.dumps({'pageId':'visual-page','pageUrl':'https://notion.so/visual','sessionId':'visual-session','sectionHashes':{'#document':'visual-hash'}}))\n", "utf-8");
	const downloadDir = join(testStateDir, "VisualDownloads");
	const runId = "visual-export-routes";
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/visual-export", runId, syncScript: fakeSyncScript, downloadDir });
	try {
		updateStudyHardStudio(runId, {
			noteDocument: { title: "Visual Export", sections: [{ id: "visuals", kind: "flow", title: "시각화", blocks: [
				{ id: "schema-diff", type: "visual", title: "Schema Diff", visual: { kind: "architecture-flow", title: "Schema Diff", lanes: [{ id: "before", title: "Phase 1" }, { id: "after", title: "Phase 2" }], nodes: [{ id: "before-table", lane: "before", title: "현재 컬럼" }, { id: "after-table", lane: "after", title: "확장 컬럼" }], edges: [{ source: "before-table", target: "after-table", label: "확장" }] } },
				{ id: "phase-two", type: "visual-ref", title: "Phase 2 · 컬럼 변화 시각표", body: "Schema Diff의 확장 구조만 파생합니다.", visualRef: { sourceBlockId: "schema-diff", laneId: "after" } },
				{ id: "phase-two-description", type: "callout", tone: "info", title: "변경 내용", body: "신규 · 값 확장 · 재사용 · 유지" },
			] }] },
		});
		assert.equal(handle.state.noteDocument.sections[0]?.blocks[1]?.type, "visual-ref");
		assert.equal(handle.state.noteDocument.sections[0]?.blocks[1]?.visual, undefined);
		const headers = authorizedHeaders(handle);
		let response = await fetch(new URL("/state", handle.url));
		const browserState = await response.json() as any;
		assert.equal(browserState.noteDocument.sections[0].blocks[1].type, "visual");
		assert.equal(browserState.noteDocument.sections[0].blocks[1].visualRef, undefined);
		assert.deepEqual(browserState.noteDocument.sections[0].blocks[1].visual.nodes.map((node: any) => node.id), ["after-table"]);
		response = await fetch(new URL("/note-visual/phase-two", handle.url));
		const phaseTwoHtml = await response.text();
		assert.match(phaseTwoHtml, /after-table|확장 컬럼/);
		assert.doesNotMatch(phaseTwoHtml, /before-table|현재 컬럼/);
		response = await fetch(new URL("/export/html", handle.url), { method: "POST", headers, body: "{}" });
		assert.equal(response.status, 200);
		const htmlResult = await response.json() as any;
		const exported = readFileSync(htmlResult.path, "utf-8");
		assert.match(exported, /PNG fallback 보기/);
		assert.match(exported, /Phase 2 · 컬럼 변화 시각표/);
		assert.match(exported, /파생 visual spec 보기/);
		assert.match(exported, /data:image\/png;base64/);
		response = await fetch(new URL("/export/notion", handle.url), { method: "POST", headers, body: "{}" });
		assert.equal(response.status, 200);
		const syncInput = JSON.parse(readFileSync(join(testStateDir, `${runId}-exports`, "notion-sync.json"), "utf-8"));
		assert.deepEqual(syncInput.diagramAssets.map((asset: any) => asset.blockId), ["schema-diff", "phase-two"]);
		assert.ok(syncInput.diagramAssets.every((asset: any) => readFileSync(asset.path, "utf-8") === "native-visual-png"));
		const syncedRef = syncInput.noteDocument.sections[0].blocks[1];
		assert.equal(syncedRef.type, "visual");
		assert.equal(syncedRef.visualRef, undefined);
		assert.deepEqual(syncedRef.visual.nodes.map((node: any) => node.id), ["after-table"]);
		assert.equal(syncInput.noteDocument.sections[0].blocks[2].body, "신규 · 값 확장 · 재사용 · 유지");
	} finally {
		setGlimpseOpenForTests(undefined);
		stopStudyHardStudios();
	}
});

test("Notion sync reports the captured revision when the note changes in flight", async () => {
	const markerPath = join(testStateDir, "slow-sync-started");
	const fakeSyncScript = join(testStateDir, "slow-study-hard-sync.py");
	writeFileSync(fakeSyncScript, `import json\nimport time\nfrom pathlib import Path\nPath(${JSON.stringify(markerPath)}).write_text('started')\ntime.sleep(0.2)\nprint(json.dumps({'pageId':'page-race','pageUrl':'https://notion.so/race','sessionId':'session-race','sectionHashes':{'#learning-note':'hash-race'}}))\n`, "utf-8");
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const runId = "notion-sync-race";
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/notion-race", runId, syncScript: fakeSyncScript });
	try {
		updateStudyHardStudio(runId, { noteDocument: { title: "Revision 1", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "first" }] }] } });
		const request = fetch(new URL("/export/notion", handle.url), { method: "POST", headers: authorizedHeaders(handle) });
		for (let attempt = 0; attempt < 100 && !existsSync(markerPath); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
		assert.equal(existsSync(markerPath), true);
		updateStudyHardStudio(runId, { noteDocument: { title: "Revision 2", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "second" }] }] } });
		const response = await request;
		assert.equal(response.status, 200);
		const result = await response.json() as any;
		assert.equal(result.syncedRevision, 1);
		assert.equal(result.currentRevision, 2);
		assert.equal(result.staleAfterSync, true);
		const state = await fetch(new URL("/state", handle.url)).then((item) => item.json() as Promise<any>);
		assert.equal(state.noteDocument.title, "Revision 2");
		assert.equal(state.notionSync.lastSyncedRevision, 1);
	} finally {
		stopStudyHardStudios();
	}
});

test("note history snapshots semantic changes and restores note plus referenced flows only", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const runId = "note-history";
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/history", runId });
	try {
		updateStudyHardStudio(runId, {
			flows: [{ id: "old-flow", title: "Before A", variant: "before", actors: [{ id: "a", label: "A" }, { id: "b", label: "B" }], steps: [{ id: "old", order: 1, from: "a", to: "b", action: "old flow" }] }],
			noteDocument: { title: "Version A", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead-a", type: "paragraph", text: "설명 A" }, { id: "flow-a", type: "flow-ref", flowId: "old-flow" }] }] },
			questions: [{ id: "Q001", origin: "learner", scope: "session", question: "질문은 유지돼?", status: "answered", feedback: "유지돼" }],
			selectedFlowId: "old-flow",
		});
		let response = await fetch(new URL("/workspace", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ activeSurface: "map" }) });
		assert.equal(response.status, 200);
		updateStudyHardStudio(runId, {
			flows: [{ id: "new-flow", title: "After B", variant: "after", actors: [{ id: "a", label: "A" }, { id: "b", label: "B" }], steps: [{ id: "new", order: 1, from: "a", to: "b", action: "new flow" }] }],
			noteDocument: { title: "Version B", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead-b", type: "paragraph", text: "설명 B" }, { id: "flow-b", type: "flow-ref", flowId: "new-flow" }] }] },
			selectedFlowId: "new-flow",
		});

		response = await fetch(new URL("/history", handle.url));
		assert.equal(response.status, 200);
		const history = await response.json() as any;
		assert.equal(history.entries[0].current, true);
		assert.equal(history.entries[0].title, "Version B");
		const versionA = history.entries.find((entry: any) => entry.title === "Version A");
		assert.ok(versionA);
		response = await fetch(new URL(`/history/${encodeURIComponent(versionA.id)}/html`, handle.url));
		assert.equal(response.status, 200);
		assert.match(await response.text(), /설명 A/);

		response = await fetch(new URL("/history/restore", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ id: versionA.id }) });
		assert.equal(response.status, 200);
		const restored = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(restored.noteDocument.title, "Version A");
		assert.deepEqual(restored.flows.map((flow: any) => flow.id), ["old-flow"]);
		assert.equal(restored.flows[0].steps[0].action, "old flow");
		assert.equal(restored.selectedFlowId, "old-flow");
		assert.equal(restored.selectedFlowStepId, undefined);
		assert.equal(restored.questions[0].question, "질문은 유지돼?");
		assert.equal(restored.activeSurface, "map");
	} finally {
		stopStudyHardStudios();
	}
});

test("note history retains at most 50 semantic snapshots", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const runId = "note-history-retention";
	await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/history-retention", runId });
	try {
		for (let index = 0; index < 55; index += 1) {
			updateStudyHardStudio(runId, { noteDocument: { title: `Version ${index}`, sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: `설명 ${index}` }] }] } });
		}
		const files = readdirSync(join(testStateDir, `${runId}-history`)).filter((name) => name.endsWith(".json"));
		assert.equal(files.length, 50);
	} finally {
		stopStudyHardStudios();
	}
});

test("note history snapshot failure blocks the semantic update and rolls memory back", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const runId = "note-history-failure";
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/history-failure", runId });
	const previousTitle = handle.state.noteDocument.title;
	writeFileSync(join(testStateDir, `${runId}-history`), "blocked", "utf-8");
	assert.throws(() => updateStudyHardStudio(runId, { noteDocument: { title: "Must not persist", sections: [] } }), /EEXIST/);
	assert.equal(handle.state.noteDocument.title, previousTitle);
	assert.equal(loadPersistedStudyHardState(runId)?.noteDocument.title, previousTitle);
	stopStudyHardStudios();
});

test("start initial patch 검증이 실패하면 서버와 상태 파일을 만들지 않는다", async () => {
	const runId = "invalid-initial-patch";
	const board = createStudyHardBoardHarness();
	try {
		await assert.rejects(() => board.execute({
			action: "start",
			runId,
			url: "https://example.com/invalid-initial-patch",
			noteDocument: {
				title: "Invalid note",
				sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "bad-code", type: "code", code: { code: "one line", annotations: [{ line: 9, text: "outside" }] } }] }],
			},
		}), /outside 1-1/);
		assert.equal(existsSync(join(testStateDir, `${runId}.json`)), false);
		assert.throws(() => updateStudyHardStudio(runId, { summary: "leaked" }), /run을 찾을 수 없습니다/);
	} finally {
		stopStudyHardStudios();
	}
});

test("신규 Studio의 후속 window 준비가 실패하면 active handle과 신규 상태를 정리한다", async () => {
	const runId = "downstream-start-failure";
	const fakePi = { sendMessage() {}, exec() { throw new Error("browser fallback should not run"); } } as any;
	const failingContext = {
		cwd: "/tmp/study-hard",
		get hasUI() { throw new Error("window setup failed"); },
	} as any;
	try {
		await assert.rejects(
			() => startStudyHardStudio(fakePi, failingContext, { url: "https://example.com/downstream-failure", runId }),
			/window setup failed/,
		);
		assert.equal(existsSync(join(testStateDir, `${runId}.json`)), false);
		assert.throws(() => updateStudyHardStudio(runId, { summary: "leaked" }), /run을 찾을 수 없습니다/);
	} finally {
		stopStudyHardStudios();
	}
});

test("동일 runId를 재사용하며 정상 start→update→open 흐름을 유지한다", async () => {
	const runId = "tool-lifecycle";
	const board = createStudyHardBoardHarness();
	try {
		const started = await board.execute({ action: "start", runId, url: "https://example.com/tool-lifecycle", quickMap: "초기 지도" }) as any;
		assert.equal(started.details.action, "started");
		assert.equal(started.details.revision, 1);
		const initialState = await fetch(new URL("/state", started.details.url)).then((response) => response.json() as Promise<any>);
		assert.equal(initialState.quickMap, "초기 지도");

		const updated = await board.execute({ action: "update", runId, expectedRevision: 1, summary: "업데이트 완료" }) as any;
		assert.equal(updated.details.action, "updated");
		assert.equal(updated.details.revision, 2);
		assert.equal(updated.details.url, started.details.url);

		const opened = await board.execute({ action: "open", runId }) as any;
		assert.equal(opened.details.action, "opened");
		assert.equal(opened.details.revision, 2);
		assert.equal(opened.details.url, started.details.url);

		const reused = await board.execute({ action: "start", runId, url: "https://example.com/tool-lifecycle" }) as any;
		assert.equal(reused.details.revision, 2);
		assert.equal(reused.details.url, started.details.url);
	} finally {
		stopStudyHardStudios();
	}
});

test("persisted run resumes after shutdown and same-run start never overwrites content", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const context = { hasUI: false, cwd: "/tmp/study-hard" } as any;
	const runId = "persisted-resume";
	const handle = await startStudyHardStudio(fakePi, context, { url: "https://example.com/resume", runId });
	updateStudyHardStudio(runId, {
		activeSurface: "flow",
		flows: [{ id: "after", title: "After", variant: "after", actors: [{ id: "a", label: "A" }, { id: "b", label: "B" }], steps: [{ id: "s1", order: 1, from: "a", to: "b", action: "send" }] }],
		selectedFlowId: "after",
		selectedFlowStepId: "s1",
		selectedNoteBlockId: "mental-model",
		mapViewport: { x: 120, y: 80, zoom: 0.9 },
		noteDocument: { title: "Resume note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "mental-model", type: "callout", title: "Mental model", body: "ownership first" }] }] },
	});
	const savedRevision = handle.state.revision;
	assert.throws(() => updateStudyHardStudio(runId, { questions: [] }, savedRevision - 1), /stale Study Hard revision/);
	assert.equal(handle.state.revision, savedRevision);
	stopStudyHardStudios();
	const diskState = loadPersistedStudyHardState(runId);
	assert.equal(diskState?.activeSurface, "flow");
	assert.equal(diskState?.noteDocument.sections[0]?.blocks[0]?.id, "mental-model");
	const restored = await openExistingStudyHardStudio(fakePi, context, runId);
	assert.equal(restored.state.revision, savedRevision);
	assert.equal(restored.state.flows[0]?.id, "after");
	assert.equal(restored.state.selectedFlowStepId, "s1");
	assert.equal(restored.state.selectedNoteBlockId, "mental-model");
	assert.deepEqual(restored.state.mapViewport, { x: 120, y: 80, zoom: 0.9 });
	const sameRun = await startStudyHardStudio(fakePi, context, { url: "https://example.com/resume", runId });
	assert.equal(sameRun.url, restored.url);
	assert.equal(sameRun.state.revision, savedRevision);
	await assert.rejects(() => startStudyHardStudio(fakePi, context, { url: "https://example.com", runId: "../escape" }), /invalid Study Hard runId/);
	stopStudyHardStudios();
});

test("learning companion metadata, events, and checkpoints survive Study Hard reopen", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const context = { hasUI: false, cwd: "/tmp/study-hard" } as any;
	const runId = "learning-companion-lifecycle";
	const handle = await startStudyHardStudio(fakePi, context, { url: "https://example.com/companion", runId });
	const manifest: LearningCompanionManifest = {
		schemaVersion: 1,
		companionId: "learning-test",
		runId,
		status: "active",
		phase: "framed",
		frame: { path: "/tmp/work/.pi/frame.json", identityKey: "worktree:test", initialCanonicalHash: "hash-1", latestCanonicalHash: "hash-1" },
		studyHard: { statePath: join(testStateDir, `${runId}.json`) },
		origin: { kind: "frame-v2", manifestPath: "/tmp/frame-v2.json" },
		createdAt: 10,
		updatedAt: 10,
	};

	attachStudyHardLearningCompanion(manifest);
	assert.equal(handle.state.companion?.companionId, "learning-test");
	assert.equal(handle.state.companion?.events[0]?.kind, "frame_ready");
	const eventCount = handle.state.companion?.events.length;
	attachStudyHardLearningCompanion(manifest);
	assert.equal(handle.state.companion?.events.length, eventCount, "frame_ready must dedupe");
	recordStudyHardLearningEvent(runId, {
		kind: "slice_completed",
		summary: "S1 완료",
		source: "work-context",
		refs: { sliceId: "S1", commit: "abc123" },
		dedupeKey: "slice-completed:S1:abc123",
	}, "implementing");
	checkpointStudyHardLearning(runId, "slice-complete", { sliceId: "S1", commit: "abc123" });
	proposeStudyHardLearningChange(runId, {
		id: "proposal-verify-mobile",
		summary: "모바일 검증 보강",
		rationale: "학습 중 coverage gap 발견",
		target: "verification",
		proposedChange: "모바일 manual check 추가",
	});
	assert.equal(handle.state.companion?.phase, "implementing");
	assert.equal(handle.state.companion?.events.at(-1)?.refs?.commit, "abc123");
	assert.equal(handle.state.companion?.checkpoints.at(-1)?.kind, "slice-complete");
	assert.ok(handle.state.companion?.checkpoints.at(-1)?.noteHash);

	stopStudyHardStudios();
	const reopened = await openExistingStudyHardStudio(fakePi, context, runId);
	assert.equal(reopened.state.companion?.companionId, "learning-test");
	assert.equal(reopened.state.companion?.events.length, 2);
	assert.equal(reopened.state.companion?.checkpoints.length, 1);
	assert.equal(reopened.state.companion?.proposals[0]?.status, "proposed");
	const exported = buildStudyNoteExportHtml(reopened.state);
	assert.match(exported, /작업과 함께 쌓인 학습 기록/);
	assert.match(exported, /slice_completed/);
	assert.match(exported, /모바일 검증 보강/);
	assert.match(exported, /verification · proposed/);
	stopStudyHardStudios();
});

test("corrupt primary state falls back to the last good backup and root URLs remain canonical", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const context = { hasUI: false, cwd: "/tmp/study-hard" } as any;
	const runId = "backup-recovery";
	await startStudyHardStudio(fakePi, context, { url: "https://example.com", runId });
	updateStudyHardStudio(runId, { summary: "last good" });
	updateStudyHardStudio(runId, { summary: "newest" });
	stopStudyHardStudios();
	writeFileSync(join(testStateDir, `${runId}.json`), "{broken", "utf-8");
	const recovered = loadPersistedStudyHardState(runId);
	assert.equal(recovered?.url, "https://example.com/");
	assert.equal(recovered?.summary, "last good");
	const reopened = await startStudyHardStudio(fakePi, context, { url: "https://example.com", runId });
	assert.equal(reopened.state.summary, "last good");
	stopStudyHardStudios();
});

test("board view mode and dragged memo positions persist across AI node updates", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/board", runId: "board-preferences" });
	try {
		let response = await fetch(new URL("/view-mode", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ viewMode: "memo" }),
		});
		assert.equal(response.status, 200);
		response = await fetch(new URL("/position", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ nodeId: "goal", x: 910, y: 720 }),
		});
		assert.equal(response.status, 200);

		let state = await fetch(new URL("/state", handle.url)).then((res) => res.json() as Promise<any>);
		assert.equal(state.viewMode, "memo");
		assert.equal(state.layoutMode, "manual");
		assert.deepEqual({ x: state.nodes[1]?.x, y: state.nodes[1]?.y, locked: state.nodes[1]?.positionLocked }, { x: 910, y: 720, locked: true });

		updateStudyHardStudio("board-preferences", {
			nodes: [...state.nodes.map((node: any) => ({ ...node, label: `${node.label} updated` })), { id: "new-child", label: "New child", parentId: "goal", type: "concept" }],
			edges: [...state.edges, { source: "goal", target: "new-child" }],
		});
		state = await fetch(new URL("/state", handle.url)).then((res) => res.json() as Promise<any>);
		const goal = state.nodes.find((node: any) => node.id === "goal");
		const newChild = state.nodes.find((node: any) => node.id === "new-child");
		assert.deepEqual({ x: goal.x, y: goal.y, locked: goal.positionLocked }, { x: 910, y: 720, locked: true });
		assert.deepEqual({ x: newChild.x, y: newChild.y }, { x: 934, y: 862 });

		response = await fetch(new URL("/relayout", handle.url), { method: "POST", headers: authorizedHeaders(handle) });
		assert.equal(response.status, 200);
		state = await fetch(new URL("/state", handle.url)).then((res) => res.json() as Promise<any>);
		assert.equal(state.layoutMode, "auto");
		assert.equal(state.nodes.find((node: any) => node.id === "goal")?.positionLocked, false);
		assert.notEqual(state.nodes.find((node: any) => node.id === "goal")?.x, 910);
	} finally {
		stopStudyHardStudios();
	}
});

test("학습 코치 drawer는 내부 질문 ID 없이 Frame 반영과 작업 시작을 P0에 전달한다", async () => {
	const root = mkdtempSync(join(tmpdir(), "study-hard-transition-"));
	const messages: Array<{ message: any; options: any }> = [];
	const fakePi = {
		sendMessage(message: any, options: any) { messages.push({ message, options }); },
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	const html = buildStudyHardStudioHtml("transition-token");
	assert.match(html, /작업으로 이어가기/);
	assert.match(html, /data-work-transition="apply-frame"/);
	assert.match(html, /data-work-transition="start-work"/);
	assert.match(html, /내부 질문 ID를 입력할 필요가 없습니다/);
	assert.match(html, /workTransitionConfirm/);
	assert.match(html, /function requestWorkTransition/);
	assert.match(html, /function resolveWorkTransition/);
	assert.match(html, /workTransitionAccept/);
	assert.doesNotMatch(html, /window\.confirm/);
	assert.match(html, /post\('\/transition'/);

	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: root } as any, {
		url: "https://example.com/work-transition",
		runId: "work-transition-route",
		agentRunner: async () => { throw new Error("work transition must not start a learning agent"); },
	});
	let response = await fetch(new URL("/transition", handle.url), {
		method: "POST",
		headers: authorizedHeaders(handle),
		body: JSON.stringify({ intent: "unknown" }),
	});
	assert.equal(response.status, 400);

	response = await fetch(new URL("/transition", handle.url), {
		method: "POST",
		headers: authorizedHeaders(handle),
		body: JSON.stringify({ intent: "apply-frame" }),
	});
	assert.equal(response.status, 202);
	let result = await response.json() as any;
	assert.equal(result.frameExists, false);
	assert.equal(messages.length, 1);
	assert.equal(messages[0]?.message.customType, "heestolee.study-hard.work-transition");
	assert.equal(messages[0]?.message.details.intent, "apply-frame");
	assert.equal(messages[0]?.message.details.frameExists, false);
	assert.match(messages[0]?.message.content, /현재 run 전체 노트·결정·답변과 Frame을 대조/);
	assert.match(messages[0]?.message.content, /코드 구현은 시작하지 않습니다/);
	assert.equal(messages[0]?.options.triggerTurn, true);
	let state = await fetch(new URL("/state", handle.url)).then((item) => item.json() as Promise<any>);
	assert.equal(state.questions.length, 0);

	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "frame.json"), JSON.stringify({
		version: 1,
		identity: { displayTitle: "Transition Frame" },
		goal: "Study Hard에서 작업으로 전환",
		provenance: { canonicalHash: "transition-frame-hash" },
	}));
	response = await fetch(new URL("/transition", handle.url), {
		method: "POST",
		headers: authorizedHeaders(handle),
		body: JSON.stringify({ intent: "start-work" }),
	});
	assert.equal(response.status, 202);
	result = await response.json() as any;
	assert.equal(result.frameExists, true);
	assert.equal(result.frameTitle, "Transition Frame");
	assert.equal(messages.length, 2);
	assert.equal(messages[1]?.message.details.intent, "start-work");
	assert.equal(messages[1]?.message.details.frameExists, true);
	assert.match(messages[1]?.message.content, /버튼 클릭을 명시적 작업 시작 의도로 보고/);
	assert.match(messages[1]?.message.content, /Frame이 없거나 stale이면/);
	state = await fetch(new URL("/state", handle.url)).then((item) => item.json() as Promise<any>);
	assert.equal(state.questions.length, 0);
});

test("Glimpse node thread keeps learner questions and coach answers on the same node", async () => {
	const messages: Array<{ message: any; options: any }> = [];
	const lineageEntries: Array<{ customType: string; data: any }> = [];
	const fakePi = {
		appendEntry(customType: string, data: any) {
			lineageEntries.push({ customType, data });
		},
		sendMessage(message: any, options: any) {
			messages.push({ message, options });
		},
		exec() {
			throw new Error("no browser fallback in test");
		},
	} as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/article",
		runId: "route-smoke",
		agentRunner: async () => { throw new Error("queued questions must not start during this route test"); },
	});
	try {
		let response = await fetch(new URL("/select", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ nodeId: "goal" }),
		});
		assert.equal(response.status, 200);

		response = await fetch(new URL("/ask", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ nodeId: "missing", question: "지도 밖 질문" }),
		});
		assert.equal(response.status, 400);

		response = await fetch(new URL("/ask", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ scope: "node", nodeId: "goal", question: "이 노드가 전체 흐름에서 무슨 역할이야?" }),
		});
		assert.equal(response.status, 202);

		let state = await fetch(new URL("/state", handle.url)).then((res) => res.json() as Promise<any>);
		assert.equal(state.questions[0]?.origin, "learner");
		assert.equal(state.questions[0]?.scope, "node");
		assert.equal(state.questions[0]?.targetNodeId, "goal");

		updateStudyHardStudio("route-smoke", {
			questions: [
				...state.questions,
				{ id: "Q002", origin: "coach", scope: "node", question: "이 목표를 실제 예로 설명해볼래?", status: "open", targetNodeId: "goal" },
			],
			flows: [{ id: "after", title: "After", variant: "after", actors: [{ id: "web", label: "Web" }, { id: "native", label: "Native" }], steps: [{ id: "request", order: 1, from: "web", to: "native", action: "request" }] }],
			noteDocument: { title: "Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "mental-model", type: "callout", title: "Mental model", body: "ownership" }] }] },
			currentQuestionId: "Q002",
		});
		response = await fetch(new URL("/answer", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ questionId: "Q002", answer: "개념을 코드 경로와 연결해 설명한다." }),
		});
		assert.equal(response.status, 200);

		response = await fetch(new URL("/answer", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ questionId: "Q002", answer: "같은 답변을 다시 보낸다." }),
		});
		assert.equal(response.status, 400);

		response = await fetch(new URL("/ask", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ scope: "session", question: "이 자료 전체를 다른 bridge 설계에 어떻게 적용할까?" }),
		});
		assert.equal(response.status, 202);
		state = await fetch(new URL("/state", handle.url)).then((res) => res.json() as Promise<any>);
		assert.equal(state.selectedNodeId, "goal");

		response = await fetch(new URL("/ask", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ scope: "flow-step", flowId: "after", flowStepId: "request", question: "이 단계의 payload는 무엇이야?" }),
		});
		assert.equal(response.status, 202);
		response = await fetch(new URL("/ask", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ scope: "note-block", noteBlockId: "mental-model", question: "이 mental model을 다시 설명해줘." }),
		});
		assert.equal(response.status, 202);

		response = await fetch(new URL("/attachments", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ nodeId: "goal", name: "note.png", mimeType: "image/png", dataUrl: "data:image/png;base64,aGVsbG8=" }),
		});
		assert.equal(response.status, 200);
		response = await fetch(new URL("/attachments/%2e%2e%2fsecret", handle.url));
		assert.equal(response.status, 400);

		state = await fetch(new URL("/state", handle.url)).then((res) => res.json() as Promise<any>);
		assert.equal(state.selectedNodeId, "goal");
		assert.equal(state.questions[1]?.origin, "coach");
		assert.equal(state.questions[1]?.userAnswer, "개념을 코드 경로와 연결해 설명한다.");
		assert.equal(state.questions[1]?.status, "answered");
		assert.equal(state.questions[2]?.scope, "session");
		assert.equal(state.questions[2]?.targetNodeId, undefined);
		assert.equal(state.questions[3]?.scope, "flow-step");
		assert.equal(state.questions[3]?.targetFlowStepId, "request");
		assert.equal(state.questions[4]?.scope, "note-block");
		assert.equal(state.questions[4]?.targetNoteBlockId, "mental-model");
		assert.equal(state.attachments[0]?.nodeId, "goal");
		assert.equal(state.questions[0]?.processingStatus, "queued");
		assert.equal(state.questions[2]?.processingStatus, "queued");
		const transcriptMessages = messages.filter(({ message }) => message.customType === "heestolee.study-hard.transcript");
		assert.equal(transcriptMessages.length, 6);
		assert.deepEqual(transcriptMessages.map(({ message }) => message.details.eventKind), ["learner-question", "coach-question", "learner-answer", "learner-question", "learner-question", "learner-question"]);
		assert.ok(transcriptMessages.every(({ message, options }) => message.display === false && options.deliverAs === "nextTurn" && options.triggerTurn === false));
		assert.equal(lineageEntries.length, 6);
		assert.ok(lineageEntries.every(({ customType, data }) => customType === "study-hard-transcript-lineage" && data.display === true && data.details?.eventKey));
		assert.match(transcriptMessages[0]?.message.content, /Study Hard lineage context/);
		assert.match(transcriptMessages[0]?.message.content, /이 노드가 전체 흐름에서 무슨 역할이야/);
		const nodeAnswerMessage = messages.find(({ message }) => message.customType === "heestolee.study-hard.node-answer");
		assert.equal(nodeAnswerMessage?.message.display, false);
		assert.equal(nodeAnswerMessage?.options.deliverAs, "followUp");
		assert.equal(nodeAnswerMessage?.options.triggerTurn, true);
		assert.match(nodeAnswerMessage?.message.content, /Study Hard node answer/);
		assert.match(nodeAnswerMessage?.message.content, /개념을 코드 경로와 연결/);
	} finally {
		stopStudyHardStudios();
	}
});

test("event bus가 없는 legacy runtime도 의미 routing 뒤 P0 worker fallback을 유지한다", async () => {
	const messages: Array<{ message: any; options: any }> = [];
	let isolatedCalls = 0;
	const fakePi = {
		sendMessage(message: any, options: any) { messages.push({ message, options }); },
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/worker-dispatch",
		runId: "worker-dispatch",
		agentRunner: async () => { isolatedCalls += 1; throw new Error("learner input must not use isolated agentRunner"); },
	});
	try {
		updateStudyHardStudio(handle.state.runId, {
			flows: [{ id: "after", title: "After", variant: "after", actors: [{ id: "web", label: "Web" }, { id: "api", label: "API" }], steps: [{ id: "request", order: 1, from: "web", to: "api", action: "request" }] }],
			noteDocument: { title: "Worker Dispatch", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "mental-model", type: "paragraph", text: "현재 설명" }] }] },
		});
		for (const body of [
			{ scope: "node", nodeId: "goal", question: "노드 질문" },
			{ scope: "session", question: "전체 질문" },
			{ scope: "flow-step", flowId: "after", flowStepId: "request", question: "흐름 질문" },
			{ scope: "note-block", noteBlockId: "mental-model", question: "노트 질문" },
		]) {
			const response = await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify(body) });
			assert.equal(response.status, 202);
		}
		let state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		assert.equal(isolatedCalls, 0);
		assert.deepEqual(state.questions.map((question: any) => question.scope), ["node", "session", "flow-step", "note-block"]);
		assert.ok(state.questions.every((question: any) => question.processingStatus === "queued" && question.execution?.phase === "routing" && /^pi-/.test(question.orchestrationId) && question.workerResultPath));
		const routeRequests = messages.filter(({ message }) => message.customType === "heestolee.study-hard.question-route");
		assert.equal(routeRequests.length, 4);
		assert.ok(routeRequests.every(({ message, options }) => message.display === false && options.deliverAs === "followUp" && options.triggerTurn === true && /글자 수, 파일 수, 특정 단어/.test(message.content)));
		for (const question of state.questions) routeStudyQuestionToWorker(handle, question.id);
		state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		assert.ok(state.questions.every((question: any) => question.execution?.mode === "worker" && /^worker-/.test(question.orchestrationId)));
		const dispatches = messages.filter(({ message }) => message.customType === "heestolee.study-hard.learner-request");
		assert.equal(dispatches.length, 4);
		assert.ok(dispatches.every(({ message, options }) => message.display === false && options.deliverAs === "followUp" && options.triggerTurn === true));
		assert.ok(dispatches.every(({ message }) => /action="status"/.test(message.content) && /subagent run study-hard-worker --isolated/.test(message.content) && /action="worker_started"/.test(message.content) && /action="worker_failed"/.test(message.content) && /action="apply_worker_result"/.test(message.content)));

		const question = state.questions[0];
		markStudyHardWorkerStarted(handle.state.runId, state.revision, question.id);
		state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, state.noteDocument, "전용 worker가 P0 맥락으로 답했습니다.");
		const applied = applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 11);
		assert.equal(applied.status, "applied");
		state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		assert.equal(state.questions[0].workerRunId, 11);
		assert.equal(state.questions[0].feedback, "전용 worker가 P0 맥락으로 답했습니다.");
		const workerAnswer = messages.find(({ message }) => message.details?.eventKind === "worker-answer");
		assert.ok(workerAnswer);
		assert.equal(workerAnswer?.message.display, false);
		assert.equal(workerAnswer?.options.deliverAs, "nextTurn");
		assert.equal(workerAnswer?.options.triggerTurn, false);
	} finally {
		stopStudyHardStudios();
	}
});

test("learner 질문은 P0 의미 routing 뒤 programmatic worker로 적용되고 첫 충돌은 같은 run으로 rebase한다", async () => {
	const messages: Array<{ message: any; options: any }> = [];
	const requests: ProgrammaticSubagentLaunchRequest[] = [];
	let nextRunId = 40;
	const fakePi = {
		sendMessage(message: any, options: any) { messages.push({ message, options }); },
		events: {
			emit(name: string, payload: unknown) {
				assert.equal(name, PROGRAMMATIC_SUBAGENT_LAUNCH_EVENT);
				const request = payload as ProgrammaticSubagentLaunchRequest;
				requests.push(request);
				request.claim();
				const runId = request.continueRunId ?? ++nextRunId;
				request.onStarted({ requestId: request.requestId, runId, agent: request.agent, sessionFile: `/tmp/subagent-${runId}.jsonl` });
			},
		},
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/programmatic-worker",
		runId: "programmatic-worker",
	});
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Programmatic", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A0" }] }] },
		});
		for (const question of ["A를 첫 방식으로", "A를 둘째 방식으로"]) {
			const response = await fetch(new URL("/ask", handle.url), {
				method: "POST",
				headers: authorizedHeaders(handle),
				body: JSON.stringify({ scope: "session", question }),
			});
			assert.equal(response.status, 202);
		}

		let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(requests.length, 0);
		assert.deepEqual(state.questions.map((question: any) => question.execution?.phase), ["routing", "routing"]);
		for (const question of state.questions) routeStudyQuestionToWorker(handle, question.id);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(requests.length, 2);
		assert.deepEqual(state.questions.map((question: any) => question.processingStatus), ["running", "running"]);
		assert.deepEqual(state.questions.map((question: any) => question.workerRunId), [41, 42]);
		assert.ok(requests.every((request) => request.contextMode === "isolated" && request.agent === "study-hard-worker"));
		assert.match(requests[0]?.task || "", /statePath:/);
		assert.match(requests[0]?.task || "", /workerResultPath:/);
		assert.equal(messages.some(({ message }) => message.customType === "heestolee.study-hard.learner-request"), false);
		const routeRequests = messages.filter(({ message }) => message.customType === "heestolee.study-hard.question-route");
		assert.equal(routeRequests.length, 2);
		assert.ok(routeRequests.every(({ options }) => options?.triggerTurn === true));

		const base = structuredClone(state.noteDocument);
		const [first, second] = state.questions;
		const firstProposal = structuredClone(base); firstProposal.sections[0].blocks[0].text = "A-first";
		const secondProposal = structuredClone(base); secondProposal.sections[0].blocks[0].text = "A-second";
		writeStudyHardWorkerResult(state, first, base, firstProposal, "첫 변경");
		writeStudyHardWorkerResult(state, second, base, secondProposal, "둘째 변경");
		await requests[0]!.onCompleted({
			requestId: requests[0]!.requestId,
			runId: 41,
			agent: "study-hard-worker",
			status: "done",
			output: `[STUDY_HARD_WORKER_RESULT]\nartifactPath: ${first.workerResultPath}\nrunId: ${state.runId}\nquestionId: ${first.id}`,
		});
		await requests[1]!.onCompleted({
			requestId: requests[1]!.requestId,
			runId: 42,
			agent: "study-hard-worker",
			status: "done",
			output: `[STUDY_HARD_WORKER_RESULT]\nartifactPath: ${second.workerResultPath}\nrunId: ${state.runId}\nquestionId: ${second.id}`,
		});

		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(requests.length, 3);
		assert.equal(requests[2]?.continueRunId, 42);
		assert.match(requests[2]?.task || "", /# Study Hard worker rebase/);
		assert.equal(state.questions[0].processingStatus, "applied");
		assert.equal(state.questions[1].processingStatus, "running");
		assert.equal(state.questions[1].workerRebaseCount, 1);

		const rebasedBase = structuredClone(state.noteDocument);
		const rebasedProposal = structuredClone(rebasedBase);
		rebasedProposal.sections[0].blocks[0].text = "A-first + A-second";
		writeStudyHardWorkerResult(state, state.questions[1], rebasedBase, rebasedProposal, "두 변경을 최신 노트에서 조정");
		await requests[2]!.onCompleted({
			requestId: requests[2]!.requestId,
			runId: 42,
			agent: "study-hard-worker",
			status: "done",
			output: `[STUDY_HARD_WORKER_RESULT]\nartifactPath: ${state.questions[1].workerResultPath}\nrunId: ${state.runId}\nquestionId: ${state.questions[1].id}`,
		});

		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.noteDocument.sections[0].blocks[0].text, "A-first + A-second");
		assert.deepEqual(state.questions.map((question: any) => question.processingStatus), ["applied", "applied"]);
		const completionTranscripts = messages.filter(({ message }) => ["worker-answer", "note-merged"].includes(message.details?.eventKind));
		assert.ok(completionTranscripts.some(({ message }) => message.details?.eventKind === "worker-answer"));
		assert.ok(completionTranscripts.some(({ message }) => message.details?.eventKind === "note-merged"));
		assert.ok(completionTranscripts.every(({ message, options }) => message.display === false && options.deliverAs === "nextTurn" && options.triggerTurn === false));
	} finally {
		stopStudyHardStudios();
	}
});

test("note image block 질문은 명시 첨부가 없어도 block attachment를 worker에 전달한다", async () => {
	const requests: ProgrammaticSubagentLaunchRequest[] = [];
	const fakePi = {
		sendMessage() {},
		events: {
			emit(_name: string, payload: unknown) {
				const request = payload as ProgrammaticSubagentLaunchRequest;
				requests.push(request);
				request.claim();
			},
		},
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/implicit-image", runId: "implicit-image" });
	try {
		const imagePath = join(tmpdir(), `study-hard-implicit-${Date.now()}.png`);
		writeFileSync(imagePath, "image");
		updateStudyHardStudio(handle.state.runId, {
			attachments: [{ id: "image-attachment", name: "fabric.png", mimeType: "image/png", path: imagePath }],
			noteDocument: { title: "Image", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "fabric-image", type: "image", image: { attachmentId: "image-attachment", alt: "Fabric" } }] }] },
		});
		const response = await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "note-block", noteBlockId: "fabric-image", question: "왜 표시가 안돼?" }) });
		assert.equal(response.status, 202);
		const routedState = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		routeStudyQuestionToWorker(handle, routedState.questions[0].id);
		assert.equal(requests.length, 1);
		assert.match(requests[0]?.task || "", /fabric\.png/);
		assert.match(requests[0]?.task || "", new RegExp(imagePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		const imageResponse = await fetch(new URL("/attachment-files/image-attachment", handle.url), { headers: { "X-Study-Hard-Capability": handle.capabilityToken } });
		assert.equal(imageResponse.status, 200);
		assert.equal(await imageResponse.text(), "image");
		assert.match(buildStudyHardStudioHtml(), /\/attachment-files\//);
		unlinkSync(imagePath);
	} finally {
		stopStudyHardStudios();
	}
});

test("전용 worker는 이미지 경로를 받고 한 block을 여러 block으로 자유롭게 제안한다", async () => {
	const messages: Array<{ message: any; options: any }> = [];
	const fakePi = { sendMessage(message: any, options: any) { messages.push({ message, options }); }, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-image", runId: "worker-image" });
	try {
		updateStudyHardStudio(handle.state.runId, { noteDocument: { title: "Image Question", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "combined", type: "paragraph", text: "A와 B가 합쳐진 설명" }] }] } });
		let response = await fetch(new URL("/attachments", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "note-block", noteBlockId: "combined", name: "clipboard.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${Buffer.from("question-image").toString("base64")}` }) });
		const upload = await response.json() as any;
		response = await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "note-block", noteBlockId: "combined", question: "이미지를 보고 A와 B를 분리해줘", attachmentIds: [upload.attachment.id] }) });
		assert.equal(response.status, 202);
		let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		routeStudyQuestionToWorker(handle, state.questions[0].id);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		const request = messages.find(({ message }) => message.customType === "heestolee.study-hard.learner-request");
		assert.match(request?.message.content || "", /clipboard\.png/);
		assert.match(request?.message.content || "", new RegExp(upload.attachment.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		const baseNote = structuredClone(state.noteDocument);
		const splitNote = { title: "Image Question", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "panel-a", type: "paragraph", text: "A 독립 설명" }, { id: "panel-b", type: "paragraph", text: "B 독립 설명" }] }] };
		writeStudyHardWorkerResult(state, state.questions[0], baseNote, splitNote, "이미지를 반영해 A와 B를 독립 block으로 분리했습니다.");
		applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 12);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.deepEqual(state.noteDocument.sections[0].blocks.map((block: any) => block.id), ["panel-a", "panel-b"]);
		assert.equal(state.questions[0].processingStatus, "applied");
		assert.equal(state.questions[0].resultSummary, "worker test result");
		assert.deepEqual(state.questions[0].noteImpact, ["Overview"]);
		assert.equal(state.questions[0].appliedRevision, state.revision);
		assert.equal(messages.filter(({ message }) => message.details?.eventKind === "worker-answer").length, 1);
		assert.equal(messages.filter(({ message }) => message.details?.eventKind === "note-merged").length, 1);
		const completionTranscripts = messages.filter(({ message }) => ["worker-answer", "note-merged"].includes(message.details?.eventKind));
		assert.ok(completionTranscripts.every(({ message, options }) => message.display === false && options.deliverAs === "nextTurn" && options.triggerTurn === false));
	} finally {
		stopStudyHardStudios();
	}
});

test("worker attachment import는 신뢰된 note image를 asset으로 복사하고 attachmentId로 연결한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-attachment", runId: "worker-attachment" });
	const sourcePath = join(testStateDir, "worker-attachment-source.png");
	const imageData = testPngData("trusted-image");
	writeFileSync(sourcePath, imageData);
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Worker attachment", sections: [{ id: "consumer", kind: "overview", title: "Consumer", blocks: [{ id: "wireframe-page", type: "image", image: { path: sourcePath, alt: "페이지 wireframe" } }] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "note-block", noteBlockId: "wireframe-page", question: "표시되게 해" }) });
		let state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const question = state.questions[0];
		const proposed = structuredClone(state.noteDocument);
		proposed.sections[0].blocks[0].image = { attachmentId: "wireframe-page-asset", alt: "페이지 wireframe" };
		writeStudyHardWorkerResult(state, question, state.noteDocument, proposed, "이미지를 attachment로 등록했습니다.", "wireframe import", [{
			attachmentId: "wireframe-page-asset",
			sourcePath,
			targetNoteBlockId: "wireframe-page",
			name: "wireframe-page.png",
			mimeType: "image/png",
		}]);

		const applied = applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 61);
		assert.equal(applied.status, "applied");
		assert.ok(applied.changedPaths.includes("attachments.wireframe-page-asset"));
		state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		assert.equal(state.attachments.length, 1);
		assert.equal(state.attachments[0].id, "wireframe-page-asset");
		assert.equal(state.attachments[0].targetNoteBlockId, "wireframe-page");
		assert.notEqual(state.attachments[0].path, sourcePath);
		assert.deepEqual(readFileSync(state.attachments[0].path), imageData);
		assert.deepEqual(state.noteDocument.sections[0].blocks[0].image, {
			attachmentId: "wireframe-page-asset",
			mimeType: "image/png",
			alt: "페이지 wireframe",
		});
		const imageResponse = await fetch(new URL(state.attachments[0].url, handle.url), { headers: { "X-Study-Hard-Capability": handle.capabilityToken } });
		assert.equal(imageResponse.status, 200);
		assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), imageData);
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 61).status, "already-applied");
		assert.equal(handle.state.attachments.length, 1);
	} finally {
		try { unlinkSync(sourcePath); } catch {}
		stopStudyHardStudios();
	}
});

test("worker note의 새 attachmentId는 같은 block import manifest 없이는 거부한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-dangling-attachment", runId: "worker-dangling-attachment" });
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Dangling attachment", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "기존 설명" }] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "이미지를 추가해" }) });
		const state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const proposed = structuredClone(state.noteDocument);
		proposed.sections[0].blocks.push({ id: "new-image", type: "image", image: { attachmentId: "missing-import" } });
		writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, proposed, "이미지를 추가했습니다.");

		assert.throws(
			() => applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 62),
			/같은 block의 attachment import가 필요합니다/,
		);
		assert.equal(handle.state.noteDocument.sections[0].blocks.some((block) => block.id === "new-image"), false);
		assert.equal(handle.state.attachments.length, 0);
	} finally {
		stopStudyHardStudios();
	}
});

test("긴 공통 prefix의 worker attachmentId는 서로 다른 저장 경로를 사용한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-attachment-key", runId: "worker-attachment-key" });
	const sourcePath = join(testStateDir, "worker-attachment-key-source.png");
	writeFileSync(sourcePath, testPngData("shared"));
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Attachment key", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [
				{ id: "image-a", type: "image", image: { path: sourcePath } },
				{ id: "image-b", type: "image", image: { path: sourcePath } },
			] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "두 이미지를 등록해" }) });
		const state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const commonPrefix = "a".repeat(80);
		const firstId = `${commonPrefix}-one`;
		const secondId = `${commonPrefix}-two`;
		const proposed = structuredClone(state.noteDocument);
		proposed.sections[0].blocks[0].image = { attachmentId: firstId };
		proposed.sections[0].blocks[1].image = { attachmentId: secondId };
		writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, proposed, "두 이미지를 등록했습니다.", "long attachment ids", [
			{ attachmentId: firstId, sourcePath, targetNoteBlockId: "image-a", name: "shared.png", mimeType: "image/png" },
			{ attachmentId: secondId, sourcePath, targetNoteBlockId: "image-b", name: "shared.png", mimeType: "image/png" },
		]);

		assert.equal(applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 63).status, "applied");
		const attachments = handle.state.attachments.filter((attachment) => [firstId, secondId].includes(attachment.id));
		assert.equal(attachments.length, 2);
		assert.notEqual(attachments[0].path, attachments[1].path);
		assert.ok(attachments.every((attachment) => attachment.path && existsSync(attachment.path)));
	} finally {
		try { unlinkSync(sourcePath); } catch {}
		stopStudyHardStudios();
	}
});

test("attachment id-name 경계가 같아 보여도 서로 다른 저장 파일을 만든다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-attachment-boundary", runId: "worker-attachment-boundary" });
	const firstSourcePath = join(testStateDir, "worker-attachment-boundary-first.png");
	const secondSourcePath = join(testStateDir, "worker-attachment-boundary-second.png");
	const firstData = testPngData("boundary-first");
	const secondData = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfWQAAAAASUVORK5CYII=", "base64");
	writeFileSync(firstSourcePath, firstData);
	writeFileSync(secondSourcePath, secondData);
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Attachment boundary", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [
				{ id: "image-a", type: "image", image: { path: firstSourcePath } },
				{ id: "image-b", type: "image", image: { path: secondSourcePath } },
			] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "두 이미지를 저장해" }) });
		const state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const proposed = structuredClone(state.noteDocument);
		proposed.sections[0].blocks[0].image = { attachmentId: "a-b" };
		proposed.sections[0].blocks[1].image = { attachmentId: "a" };
		writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, proposed, "경계가 겹치는 두 이미지를 등록했습니다.", "attachment boundary", [
			{ attachmentId: "a-b", sourcePath: firstSourcePath, targetNoteBlockId: "image-a", name: "c.png", mimeType: "image/png" },
			{ attachmentId: "a", sourcePath: secondSourcePath, targetNoteBlockId: "image-b", name: "b-c.png", mimeType: "image/png" },
		]);

		assert.equal(applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 64).status, "applied");
		const firstAttachment = handle.state.attachments.find((attachment) => attachment.id === "a-b");
		const secondAttachment = handle.state.attachments.find((attachment) => attachment.id === "a");
		assert.ok(firstAttachment?.path);
		assert.ok(secondAttachment?.path);
		assert.notEqual(firstAttachment.path, secondAttachment.path);
		assert.deepEqual(readFileSync(firstAttachment.path), firstData);
		assert.deepEqual(readFileSync(secondAttachment.path), secondData);
	} finally {
		try { unlinkSync(firstSourcePath); } catch {}
		try { unlinkSync(secondSourcePath); } catch {}
		stopStudyHardStudios();
	}
});

test("긴 다중바이트 attachment id와 이름도 240바이트 이하 basename으로 저장한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-attachment-multibyte", runId: "worker-attachment-multibyte" });
	const sourcePath = join(testStateDir, "worker-attachment-multibyte.png");
	const imageData = testPngData("multibyte");
	const attachmentId = "첨부".repeat(30);
	const attachmentName = `${"와이어프레임".repeat(20)}.png`;
	writeFileSync(sourcePath, imageData);
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Multibyte attachment", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "image", type: "image", image: { path: sourcePath } }] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "긴 이름 이미지를 저장해" }) });
		const state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const proposed = structuredClone(state.noteDocument);
		proposed.sections[0].blocks[0].image = { attachmentId };
		writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, proposed, "긴 이름 이미지를 등록했습니다.", "multibyte attachment", [{
			attachmentId,
			sourcePath,
			targetNoteBlockId: "image",
			name: attachmentName,
			mimeType: "image/png",
		}]);

		assert.equal(applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 65).status, "applied");
		const attachment = handle.state.attachments.find((item) => item.id === attachmentId);
		assert.ok(attachment?.path);
		assert.ok(attachment.url);
		const storedBasename = basename(attachment.path);
		assert.ok(Buffer.byteLength(storedBasename, "utf8") <= 240);
		assert.match(storedBasename, /첨부/);
		assert.match(storedBasename, /와이어프레임/);
		assert.ok(storedBasename.endsWith(".png"));
		const imageResponse = await fetch(new URL(attachment.url, handle.url), { headers: { "X-Study-Hard-Capability": handle.capabilityToken } });
		assert.equal(imageResponse.status, 200);
		assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), imageData);
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 65).status, "already-applied");
		assert.equal(handle.state.attachments.find((item) => item.id === attachmentId)?.path, attachment.path);
	} finally {
		try { unlinkSync(sourcePath); } catch {}
		stopStudyHardStudios();
	}
});

test("worker attachment import는 현재 Board가 참조하지 않는 로컬 경로를 거부한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-attachment-reject", runId: "worker-attachment-reject" });
	const trustedPath = join(testStateDir, "worker-trusted.png");
	const forgedPath = join(testStateDir, "worker-forged.png");
	writeFileSync(trustedPath, testPngData("trusted"));
	writeFileSync(forgedPath, testPngData("forged"));
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Worker attachment reject", sections: [{ id: "consumer", kind: "overview", title: "Consumer", blocks: [
				{ id: "wireframe-page", type: "image", image: { path: trustedPath } },
				{ id: "wireframe-other", type: "image", image: { path: trustedPath } },
			] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "note-block", noteBlockId: "wireframe-page", question: "다른 파일도 표시해" }) });
		const state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const proposed = structuredClone(state.noteDocument);
		proposed.sections[0].blocks[0].image = { attachmentId: "trusted-asset" };
		proposed.sections[0].blocks[1].image = { attachmentId: "forged-asset" };
		writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, proposed, "가져왔습니다.", "forged import", [{
			attachmentId: "trusted-asset",
			sourcePath: trustedPath,
			targetNoteBlockId: "wireframe-page",
			name: "trusted.png",
			mimeType: "image/png",
		}, {
			attachmentId: "forged-asset",
			sourcePath: forgedPath,
			targetNoteBlockId: "wireframe-other",
			name: "forged.png",
			mimeType: "image/png",
		}]);

		assert.throws(
			() => applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 62),
			/신뢰 경로가 아닙니다/,
		);
		assert.equal(handle.state.attachments.length, 0);
		assert.deepEqual(readdirSync(join(testStateDir, "worker-attachment-reject-attachments")), []);
	} finally {
		try { unlinkSync(trustedPath); } catch {}
		try { unlinkSync(forgedPath); } catch {}
		stopStudyHardStudios();
	}
});

test("worker note는 현재 state에 없던 local image path를 다음 import의 신뢰 경로로 만들 수 없다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-local-path", runId: "worker-local-path" });
	const forgedPath = join(testStateDir, "worker-new-local-path.png");
	writeFileSync(forgedPath, testPngData("forged-local-path"));
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Worker local path", sections: [{ id: "consumer", kind: "overview", title: "Consumer", blocks: [{ id: "lead", type: "paragraph", text: "기존 설명" }] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "로컬 이미지를 추가해" }) });
		const state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const proposed = structuredClone(state.noteDocument);
		proposed.sections[0].blocks.push({ id: "forged-image", type: "image", image: { path: forgedPath } });
		writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, proposed, "이미지를 추가했습니다.");

		assert.throws(
			() => applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 63),
			/없는 local image path/,
		);
		assert.equal(handle.state.noteDocument.sections[0].blocks.some((block) => block.id === "forged-image"), false);
		assert.equal(handle.state.attachments.length, 0);
	} finally {
		try { unlinkSync(forgedPath); } catch {}
		stopStudyHardStudios();
	}
});

test("worker attachment import는 확장자와 실제 이미지 내용이 다르면 거부한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-image-signature", runId: "worker-image-signature" });
	const sourcePath = join(testStateDir, "worker-fake-image.png");
	writeFileSync(sourcePath, "not-a-png");
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Worker image signature", sections: [{ id: "consumer", kind: "overview", title: "Consumer", blocks: [{ id: "fake-image", type: "image", image: { path: sourcePath } }] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "note-block", noteBlockId: "fake-image", question: "표시되게 해" }) });
		const state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const proposed = structuredClone(state.noteDocument);
		proposed.sections[0].blocks[0].image = { attachmentId: "fake-image-asset" };
		writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, proposed, "이미지를 등록했습니다.", "fake image", [{
			attachmentId: "fake-image-asset",
			sourcePath,
			targetNoteBlockId: "fake-image",
			name: "fake-image.png",
			mimeType: "image/png",
		}]);

		assert.throws(
			() => applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 64),
			/파일 내용과 MIME이 다릅니다/,
		);
		assert.equal(handle.state.attachments.length, 0);
	} finally {
		try { unlinkSync(sourcePath); } catch {}
		stopStudyHardStudios();
	}
});

test("worker attachment import는 네 이미지 포맷의 magic header-only 파일을 거부한다", async () => {
	const fixtures = [
		{ extension: "png", mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
		{ extension: "jpg", mimeType: "image/jpeg", data: Buffer.from([0xff, 0xd8, 0xff]) },
		{ extension: "gif", mimeType: "image/gif", data: Buffer.from("GIF89a", "ascii") },
		{ extension: "webp", mimeType: "image/webp", data: Buffer.from("RIFF0000WEBP", "ascii") },
	];
	for (const [index, fixture] of fixtures.entries()) {
		const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
		const runId = `worker-corrupt-image-${fixture.extension}`;
		const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: `https://example.com/${runId}`, runId });
		const sourcePath = join(testStateDir, `${runId}.${fixture.extension}`);
		writeFileSync(sourcePath, fixture.data);
		try {
			updateStudyHardStudio(handle.state.runId, {
				noteDocument: { title: "Corrupt image", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "corrupt-image", type: "image", image: { path: sourcePath } }] }] },
			});
			await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "note-block", noteBlockId: "corrupt-image", question: "표시되게 해" }) });
			const state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
			const proposed = structuredClone(state.noteDocument);
			proposed.sections[0].blocks[0].image = { attachmentId: `corrupt-${fixture.extension}-asset` };
			writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, proposed, "이미지를 등록했습니다.", "corrupt image", [{
				attachmentId: `corrupt-${fixture.extension}-asset`,
				sourcePath,
				targetNoteBlockId: "corrupt-image",
				name: `corrupt-image.${fixture.extension}`,
				mimeType: fixture.mimeType,
			}]);

			assert.throws(
				() => applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, state.questions[0].workerResultPath, 65 + index),
				/이미지 구조가 유효하지 않습니다/,
			);
			assert.equal(handle.state.attachments.length, 0);
		} finally {
			try { unlinkSync(sourcePath); } catch {}
			stopStudyHardStudios();
		}
	}
});

test("worker dispatch 전달 실패는 같은 question을 새 orchestration으로 재시도한다", async () => {
	const messages: Array<{ message: any; options: any }> = [];
	let failDelivery = true;
	const fakePi = {
		sendMessage(message: any, options: any) { messages.push({ message, options }); if (message.customType === "heestolee.study-hard.learner-request" && failDelivery) throw new Error("P0 dispatch failed"); },
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-retry", runId: "worker-retry" });
	try {
		let response = await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "재시도해줘" }) });
		assert.equal(response.status, 202);
		let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.throws(() => routeStudyQuestionToWorker(handle, state.questions[0].id), /P0 dispatch failed/);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		const firstOrchestrationId = state.questions[0].orchestrationId;
		assert.equal(state.questions[0].processingStatus, "failed");
		failDelivery = false;
		response = await fetch(new URL("/questions/retry", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ questionId: state.questions[0].id }) });
		assert.equal(response.status, 202);
		assert.equal((await response.json() as any).retryMode, "worker");
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.questions[0].processingStatus, "queued");
		assert.match(state.questions[0].orchestrationId, /^worker-/);
		assert.notEqual(state.questions[0].orchestrationId, firstOrchestrationId);
		assert.equal(messages.filter(({ message }) => message.customType === "heestolee.study-hard.learner-request").length, 2);
	} finally {
		stopStudyHardStudios();
	}
});

test("적용된 worker 질문은 늦은 실패와 다른 결과에도 answered 상태를 유지한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/monotonic-worker", runId: "monotonic-worker" });
	try {
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "한 번만 답해줘" }) });
		let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		routeStudyQuestionToWorker(handle, state.questions[0].id);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		const question = state.questions[0];
		writeStudyHardWorkerResult(state, question, state.noteDocument, state.noteDocument, "첫 결과");
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 51).status, "applied");

		markStudyHardWorkerFailed(handle.state.runId, question.id, "늦은 실패", 52);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.questions[0].status, "answered");
		assert.equal(state.questions[0].processingStatus, "applied");
		assert.equal(state.questions[0].processingError, undefined);

		writeStudyHardWorkerResult(state, state.questions[0], state.noteDocument, state.noteDocument, "늦은 다른 결과");
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 53).status, "already-applied");
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.questions[0].feedback, "첫 결과");
		assert.equal(state.questions[0].processingStatus, "applied");
	} finally {
		stopStudyHardStudios();
	}
});

test("persisted answered와 failed 모순은 applied 상태로 복구한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/repair-answered",
		runId: "repair-answered",
		initialPatch: {
			questions: [{ id: "Q005", origin: "learner", scope: "session", question: "왜?", feedback: "이미 답함", status: "answered", processingStatus: "failed", processingError: "늦은 중복 결과" }],
		},
	});
	try {
		const state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.questions[0].processingStatus, "applied");
		assert.equal(state.questions[0].processingError, undefined);
	} finally {
		stopStudyHardStudios();
	}
});

test("failed worker의 늦은 충돌 completion과 fallback apply는 terminal 상태를 되살리지 않는다", async () => {
	const requests: ProgrammaticSubagentLaunchRequest[] = [];
	const fakePi = {
		sendMessage() {},
		events: {
			emit(_name: string, payload: unknown) {
				const request = payload as ProgrammaticSubagentLaunchRequest;
				requests.push(request);
				request.claim();
				request.onStarted({ requestId: request.requestId, runId: 91, agent: request.agent });
			},
		},
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/failed-late-completion", runId: "failed-late-completion" });
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Late completion", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A0" }] }] },
			questions: [{ id: "Q001", origin: "learner", scope: "session", question: "A를 바꿔줘", status: "open", processingStatus: "queued", execution: { phase: "routing", routedAt: 100, updatedAt: 100 }, orchestrationId: "pi-test" }],
		});
		routeStudyHardQuestion(handle.state.runId, handle.state.revision, "Q001", "worker", "노트 변경이 필요합니다.");
		let state = structuredClone(handle.state);
		const base = structuredClone(state.noteDocument);
		const proposed = structuredClone(base);
		proposed.sections[0].blocks[0].text = "A-worker";
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Late completion", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A-current" }] }] },
		});
		state = structuredClone(handle.state);
		writeStudyHardWorkerResult(state, state.questions[0], base, proposed, "늦은 worker 결과");
		markStudyHardWorkerFailed(handle.state.runId, "Q001", "worker process failed", 91);
		const failedRevision = handle.state.revision;
		await requests[0]!.onCompleted({
			requestId: requests[0]!.requestId,
			runId: 91,
			agent: requests[0]!.agent,
			status: "done",
			output: `[STUDY_HARD_WORKER_RESULT]\nartifactPath: ${state.questions[0].workerResultPath}`,
		});
		assert.equal(requests.length, 1);
		assert.equal(handle.state.revision, failedRevision);
		assert.equal(handle.state.questions[0].processingStatus, "failed");
		assert.equal(handle.state.questions[0].execution?.phase, "failed");
		assert.equal(handle.state.questions[0].workerRebaseCount, 0);
		assert.equal(handle.state.noteDocument.sections[0].blocks[0].text, "A-current");
		const fallbackApply = applyStudyHardWorkerResult(handle.state.runId, "Q001", state.questions[0].workerResultPath, 91);
		assert.equal(fallbackApply.status, "terminal");
		assert.equal(handle.state.revision, failedRevision);
	} finally {
		stopStudyHardStudios();
	}
});

test("subagent completion 실패는 question을 failed로 남겨 재시도 가능하게 한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-failure", runId: "worker-failure" });
	try {
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "실패 상태를 남겨줘" }) });
		let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		markStudyHardWorkerStarted(handle.state.runId, state.revision, state.questions[0].id);
		markStudyHardWorkerFailed(handle.state.runId, state.questions[0].id, "worker process failed", 19);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.questions[0].processingStatus, "failed");
		assert.equal(state.questions[0].processingErrorStage, "worker");
		assert.equal(state.questions[0].processingError, "worker process failed");
		assert.equal(state.questions[0].workerRunId, 19);
		const response = await fetch(new URL("/questions/retry", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ questionId: state.questions[0].id }) });
		assert.equal(response.status, 202);
	} finally {
		stopStudyHardStudios();
	}
});

test("worker result path 조작은 artifact를 읽기 전에 거부한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/worker-path", runId: "worker-path" });
	try {
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "경로를 검증해줘" }) });
		const state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.throws(
			() => applyStudyHardWorkerResult(handle.state.runId, state.questions[0].id, `${state.questions[0].workerResultPath}.forged`, 20),
			/question 계약과 다릅니다/,
		);
	} finally {
		stopStudyHardStudios();
	}
});

test("서로 다른 블록의 worker 결과를 역순 적용해도 두 변경을 보존한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/parallel-worker", runId: "parallel-worker" });
	try {
		updateStudyHardStudio(handle.state.runId, { noteDocument: { title: "Parallel", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A0" }, { id: "b", type: "paragraph", text: "B0" }] }] } });
		for (const question of ["A를 다듬어줘", "B를 다듬어줘"]) await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question }) });
		let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		const base = structuredClone(state.noteDocument);
		const [questionA, questionB] = state.questions;
		const proposalA = structuredClone(base); proposalA.sections[0].blocks[0].text = "A-worker";
		const proposalB = structuredClone(base); proposalB.sections[0].blocks[1].text = "B-worker";
		writeStudyHardWorkerResult(state, questionA, base, proposalA, "A 반영");
		writeStudyHardWorkerResult(state, questionB, base, proposalB, "B 반영");
		applyStudyHardWorkerResult(handle.state.runId, questionB.id, questionB.workerResultPath, 22);
		applyStudyHardWorkerResult(handle.state.runId, questionA.id, questionA.workerResultPath, 21);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.deepEqual(state.noteDocument.sections[0].blocks.map((block: any) => block.text), ["A-worker", "B-worker"]);
		assert.deepEqual(state.questions.map((question: any) => question.processingStatus), ["applied", "applied"]);
	} finally {
		stopStudyHardStudios();
	}
});

test("겹치는 worker 결과는 한 번 rebase한 뒤에만 적용하고 중복 completion은 멱등 처리한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/conflict-worker", runId: "conflict-worker" });
	try {
		updateStudyHardStudio(handle.state.runId, { noteDocument: { title: "Conflict", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A0" }] }] } });
		for (const question of ["A를 첫 방식으로", "A를 둘째 방식으로"]) await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question }) });
		let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		const base = structuredClone(state.noteDocument);
		const [first, second] = state.questions;
		const firstProposal = structuredClone(base); firstProposal.sections[0].blocks[0].text = "A-first";
		const secondProposal = structuredClone(base); secondProposal.sections[0].blocks[0].text = "A-second";
		writeStudyHardWorkerResult(state, first, base, firstProposal, "첫 변경");
		writeStudyHardWorkerResult(state, second, base, secondProposal, "둘째 변경");
		applyStudyHardWorkerResult(handle.state.runId, first.id, first.workerResultPath, 31);
		const conflicted = applyStudyHardWorkerResult(handle.state.runId, second.id, second.workerResultPath, 32);
		assert.equal(conflicted.status, "rebasing");
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.noteDocument.sections[0].blocks[0].text, "A-first");
		assert.equal(state.questions[1].processingStatus, "rebasing");

		markStudyHardWorkerStarted(handle.state.runId, state.revision, second.id, 32);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.questions[1].processingStatus, "running");
		const rebasedBase = structuredClone(state.noteDocument);
		const rebasedProposal = structuredClone(rebasedBase);
		rebasedProposal.sections[0].blocks[0].text = "A-first + A-second";
		writeStudyHardWorkerResult(state, state.questions[1], rebasedBase, rebasedProposal, "두 변경을 최신 노트에서 조정");
		const applied = applyStudyHardWorkerResult(handle.state.runId, second.id, second.workerResultPath, 32);
		assert.equal(applied.status, "applied");
		const duplicate = applyStudyHardWorkerResult(handle.state.runId, second.id, second.workerResultPath, 32);
		assert.equal(duplicate.status, "already-applied");
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.noteDocument.sections[0].blocks[0].text, "A-first + A-second");
	} finally {
		stopStudyHardStudios();
	}
});

test("worker 재조정 뒤 남은 노트 충돌은 기존·변경·직접 정리 block 선택으로 해소한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/manual-worker-conflict", runId: "manual-worker-conflict" });
	try {
		updateStudyHardStudio(handle.state.runId, { noteDocument: { title: "Conflict", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A0" }] }] } });
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "A를 바꿔줘" }) });
		let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		const question = state.questions[0];
		const base = structuredClone(state.noteDocument);
		const proposal = structuredClone(base); proposal.sections[0].blocks[0].text = "A-worker";
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Conflict", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A-current" }] }] },
		});
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		writeStudyHardWorkerResult(state, state.questions[0], base, proposal, "worker 변경");
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 41).status, "rebasing");
		markStudyHardWorkerStarted(handle.state.runId, handle.state.revision, question.id, 41);
		const conflicted = applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 41);
		assert.equal(conflicted.status, "conflict");
		let response = await fetch(new URL("/questions/conflict-preview", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ questionId: question.id }) });
		assert.equal(response.status, 200);
		const preview = await response.json() as any;
		assert.equal(preview.sections[0].sectionId, "overview");
		assert.equal(preview.sections[0].currentNoteBlocks[0].text, "A-current");
		assert.equal(preview.sections[0].desiredNoteBlocks[0].text, "A-worker");
		assert.deepEqual(preview.sections[0].blockDiff.map((row: any) => row.status), ["changed"]);
		response = await fetch(new URL("/questions/resolve-conflict", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ questionId: question.id, resolution: { overview: { choice: "manual", blocks: [{ id: "a", type: "paragraph", text: "A-direct" }] } } }) });
		assert.equal(response.status, 200);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.noteDocument.sections[0].blocks[0].text, "A-direct");
		assert.equal(state.questions[0].processingStatus, "applied");
		const html = buildStudyHardStudioHtml();
		assert.match(html, /기존 Study Hard/);
		assert.match(html, /변경될 Study Hard/);
		assert.match(html, /충돌 직접 해소/);
	} finally {
		stopStudyHardStudios();
	}
});

test("충돌 확정 뒤 worker artifact가 바뀌면 직접 해소를 거부한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/conflict-artifact-swap", runId: "conflict-artifact-swap" });
	try {
		updateStudyHardStudio(handle.state.runId, { noteDocument: { title: "Artifact swap", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A0" }] }] } });
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "A를 바꿔줘" }) });
		let state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const question = state.questions[0];
		const base = structuredClone(state.noteDocument);
		const proposed = structuredClone(base);
		proposed.sections[0].blocks[0].text = "A-worker";
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Artifact swap", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A-current" }] }] },
		});
		state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		writeStudyHardWorkerResult(state, state.questions[0], base, proposed, "첫 worker 변경");
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 71).status, "rebasing");
		markStudyHardWorkerStarted(handle.state.runId, handle.state.revision, question.id, 71);
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 71).status, "conflict");

		state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const swapped = structuredClone(base);
		swapped.sections[0].blocks[0].text = "A-swapped";
		writeStudyHardWorkerResult(state, state.questions[0], base, swapped, "교체된 worker 변경");
		const stateBeforeRejectedApply = structuredClone(handle.state);
		assert.throws(
			() => applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 72),
			/충돌 확인 후 변경되었습니다/,
		);
		assert.deepEqual(handle.state, stateBeforeRejectedApply);
		const previewResponse = await fetch(new URL("/questions/conflict-preview", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ questionId: question.id }),
		});
		assert.notEqual(previewResponse.status, 200);
		assert.match(String((await previewResponse.json() as any).error), /충돌 확인 후 변경되었습니다/);
		const resolveResponse = await fetch(new URL("/questions/resolve-conflict", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ questionId: question.id, resolution: { overview: { choice: "proposed" } } }),
		});
		assert.notEqual(resolveResponse.status, 200);
		assert.match(String((await resolveResponse.json() as any).error), /충돌 확인 후 변경되었습니다/);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.noteDocument.sections[0].blocks[0].text, "A-current");
		assert.equal(state.questions[0].processingStatus, "conflict");
	} finally {
		stopStudyHardStudios();
	}
});

test("충돌이 clean merge로 바뀌어도 attachment를 materialize한 뒤 원자 적용한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/clean-conflict-attachment", runId: "clean-conflict-attachment" });
	const sourcePath = join(testStateDir, "clean-conflict-attachment.png");
	const imageData = testPngData("clean-conflict");
	writeFileSync(sourcePath, imageData);
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Clean conflict", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [
				{ id: "wireframe", type: "image", image: { path: sourcePath } },
				{ id: "description", type: "paragraph", text: "A0" },
			] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "이미지와 설명을 반영해" }) });
		let state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const question = state.questions[0];
		const base = structuredClone(state.noteDocument);
		const proposed = structuredClone(base);
		proposed.sections[0].blocks[0].image = { attachmentId: "clean-conflict-asset" };
		proposed.sections[0].blocks[1].text = "A-worker";
		const current = structuredClone(base);
		current.sections[0].blocks[1].text = "A-current";
		updateStudyHardStudio(handle.state.runId, { noteDocument: current });
		state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		writeStudyHardWorkerResult(state, state.questions[0], base, proposed, "clean merge worker 변경", "clean conflict import", [{
			attachmentId: "clean-conflict-asset",
			sourcePath,
			targetNoteBlockId: "wireframe",
			name: "wireframe.png",
			mimeType: "image/png",
		}]);
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 72).status, "rebasing");
		markStudyHardWorkerStarted(handle.state.runId, handle.state.revision, question.id, 72);
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 72).status, "conflict");

		updateStudyHardStudio(handle.state.runId, { noteDocument: base });
		const response = await fetch(new URL("/questions/resolve-conflict", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ questionId: question.id, resolution: {} }),
		});
		assert.equal(response.status, 200);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.questions[0].processingStatus, "applied");
		assert.equal(state.noteDocument.sections[0].blocks[0].image.attachmentId, "clean-conflict-asset");
		assert.equal(state.noteDocument.sections[0].blocks[1].text, "A-worker");
		assert.equal(state.attachments.length, 1);
		assert.ok(existsSync(state.attachments[0].path));
		assert.deepEqual(readFileSync(state.attachments[0].path), imageData);
	} finally {
		try { unlinkSync(sourcePath); } catch {}
		stopStudyHardStudios();
	}
});

test("직접 충돌 해소는 같은 attachmentId가 다른 block에만 남으면 import를 버린다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/conflict-import-target", runId: "conflict-import-target" });
	const sourcePath = join(testStateDir, "conflict-import-target.png");
	writeFileSync(sourcePath, testPngData("shared-target"));
	try {
		const attachment = { id: "shared-asset", scope: "note-block", targetNoteBlockId: "image-b", name: "shared.png", mimeType: "image/png", path: sourcePath, createdAt: Date.now() };
		updateStudyHardStudio(handle.state.runId, {
			attachments: [attachment],
			noteDocument: { title: "Import target", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [
				{ id: "image-a", type: "image", image: { path: sourcePath, alt: "A" } },
				{ id: "image-b", type: "image", image: { attachmentId: "shared-asset", alt: "B" } },
			] }] },
		});
		await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "A 이미지를 등록해" }) });
		let state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		const question = state.questions[0];
		const base = structuredClone(state.noteDocument);
		const proposed = structuredClone(base);
		proposed.sections[0].blocks[0].image = { attachmentId: "shared-asset", alt: "A worker" };
		const current = structuredClone(base);
		current.sections[0].blocks[0].image.alt = "A current";
		updateStudyHardStudio(handle.state.runId, { noteDocument: current });
		state = await fetch(new URL("/state", handle.url)).then((response) => response.json() as Promise<any>);
		writeStudyHardWorkerResult(state, state.questions[0], base, proposed, "A worker 변경", "shared id conflict", [{
			attachmentId: "shared-asset",
			sourcePath,
			targetNoteBlockId: "image-a",
			name: "shared.png",
			mimeType: "image/png",
		}]);
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 73).status, "rebasing");
		markStudyHardWorkerStarted(handle.state.runId, handle.state.revision, question.id, 73);
		assert.equal(applyStudyHardWorkerResult(handle.state.runId, question.id, question.workerResultPath, 73).status, "conflict");

		const response = await fetch(new URL("/questions/resolve-conflict", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ questionId: question.id, resolution: { overview: { choice: "current" } } }),
		});
		assert.equal(response.status, 200);
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.noteDocument.sections[0].blocks[0].image.attachmentId, undefined);
		assert.equal(state.noteDocument.sections[0].blocks[1].image.attachmentId, "shared-asset");
		assert.equal(state.attachments.length, 1);
		assert.equal(state.questions[0].processingStatus, "applied");
	} finally {
		try { unlinkSync(sourcePath); } catch {}
		stopStudyHardStudios();
	}
});

test("persisted Q&A는 같은 session에서 중복하지 않고 새 session에는 summary 하나만 연결한다", async () => {
	const runId = "transcript-backfill";
	const firstMessages: Array<{ message: any; options: any }> = [];
	const firstEntries: Array<{ customType: string; data: any }> = [];
	const firstPi = {
		sendMessage(message: any, options: any) { firstMessages.push({ message, options }); },
		appendEntry(customType: string, data: any) { firstEntries.push({ customType, data }); },
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	const questions = [
		{ id: "Q001", origin: "learner", scope: "session", question: `기존 질문 ${"상세 ".repeat(100)}끝문장`, feedback: "기존 Tutor 답변", status: "answered", processingStatus: "applied" },
		{ id: "Q002", origin: "coach", scope: "coach", question: "기존 확인 질문", userAnswer: "기존 내 답변", feedback: "기존 코치 피드백", status: "review", processingStatus: "applied" },
	];
	await startStudyHardStudio(firstPi, { hasUI: false, cwd: "/tmp/study-hard", sessionManager: { getBranch: () => [] } } as any, {
		url: "https://example.com/transcript-backfill",
		runId,
		initialPatch: { questions },
	});
	assert.deepEqual(firstMessages.map(({ message }) => message.details.eventKind), ["learner-question", "tutor-answer", "coach-question", "learner-answer", "coach-feedback"]);
	assert.ok(firstMessages.every(({ message, options }) => message.display === false && options.deliverAs === "nextTurn" && options.triggerTurn === false));
	assert.ok(firstEntries.every(({ data }) => data.display === true));
	const branch = firstEntries.map(({ customType, data }) => ({ type: "custom", customType, data }));
	const initialMessageCount = firstMessages.length;
	await startStudyHardStudio(firstPi, { hasUI: false, cwd: "/tmp/study-hard", sessionManager: { getBranch: () => branch } } as any, {
		url: "https://example.com/transcript-backfill",
		runId,
	});
	assert.equal(firstMessages.length, initialMessageCount);
	await startStudyHardStudio(firstPi, { hasUI: false, cwd: "/tmp/study-hard", sessionManager: { getBranch: () => [] } } as any, {
		url: "https://example.com/transcript-backfill",
		runId,
	});
	assert.equal(firstMessages.length, initialMessageCount + 1);
	assert.equal(firstMessages.at(-1)?.message.details.eventKind, "history-summary");
	assert.doesNotMatch(firstMessages.at(-1)?.message.content, /끝문장/);
	stopStudyHardStudios();

	const sameSessionMessages: unknown[] = [];
	const sameSessionPi = { sendMessage(message: unknown) { sameSessionMessages.push(message); }, exec() { throw new Error("no browser fallback in test"); } } as any;
	await startStudyHardStudio(sameSessionPi, { hasUI: false, cwd: "/tmp/study-hard", sessionManager: { getBranch: () => branch } } as any, {
		url: "https://example.com/transcript-backfill",
		runId,
	});
	assert.equal(sameSessionMessages.length, 0);
	stopStudyHardStudios();

	const newSessionMessages: Array<{ message: any; options: any }> = [];
	const newSessionPi = { sendMessage(message: any, options: any) { newSessionMessages.push({ message, options }); }, exec() { throw new Error("no browser fallback in test"); } } as any;
	await startStudyHardStudio(newSessionPi, { hasUI: false, cwd: "/tmp/study-hard", sessionManager: { getBranch: () => [] } } as any, {
		url: "https://example.com/transcript-backfill",
		runId,
	});
	try {
		assert.equal(newSessionMessages.length, 1);
		assert.equal(newSessionMessages[0]?.message.details.eventKind, "history-summary");
		assert.match(newSessionMessages[0]?.message.content, /기존 Q&A 요약/);
		assert.match(newSessionMessages[0]?.message.content, /질문: 2개/);
		assert.doesNotMatch(newSessionMessages[0]?.message.content, /끝문장/);
		assert.equal(newSessionMessages[0]?.message.display, false);
		assert.equal(newSessionMessages[0]?.options.triggerTurn, false);
		assert.equal(newSessionMessages[0]?.options.deliverAs, "nextTurn");
	} finally {
		stopStudyHardStudios();
	}
});

test("학습 코치는 목표·추천 경로·복습 질문만 갱신하고 학습 노트는 직접 수정하지 않는다", async () => {
	let coachCalls = 0;
	const messages: Array<{ message: any; options: any }> = [];
	const fakePi = {
		sendMessage(message: any, options: any) { messages.push({ message, options }); },
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	const agentRunner = async (request: any): Promise<string> => {
		assert.equal(request.role, "coach");
		coachCalls += 1;
		const baseRevision = Number(/## 기준 revision\n(\d+)/.exec(request.prompt)?.[1]);
		if (coachCalls === 1) {
			return JSON.stringify({
				baseRevision,
				feedback: "먼저 lifecycle을 이해한 뒤 Bridge로 이동하는 편이 좋습니다.",
				goals: ["RN lifecycle을 내 말로 설명하기", "Bridge 실행 경로 추적하기"],
				recommendedNodeId: "goal",
				followups: ["lifecycle과 Bridge 책임 경계를 비교하기"],
				nodeStatusUpdates: [{ id: "goal", status: "confused" }],
				learningPhase: "explain",
				coachRole: "mentor",
				questionStatus: "answered",
				nextQuestion: "지금 가장 설명하기 어려운 부분은 무엇인가요?",
				noteDocument: { title: "이 필드는 무시되어야 함", sections: [] },
			});
		}
		return JSON.stringify({
			baseRevision,
			feedback: "책임 경계가 아직 흐리다는 점을 복습 항목으로 잡겠습니다.",
			goals: ["RN lifecycle을 내 말로 설명하기", "Bridge 실행 경로 추적하기"],
			recommendedNodeId: "goal",
			followups: ["JS와 Native의 side effect owner를 구분하기"],
			nodeStatusUpdates: [{ id: "goal", status: "review" }],
			learningPhase: "reflect",
			coachRole: "rubber-duck",
			questionStatus: "review",
		});
	};
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/learning-coach",
		runId: "learning-coach",
		agentRunner,
	});
	try {
		const originalNote = JSON.stringify(handle.state.noteDocument);
		let response = await fetch(new URL("/coach", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ message: "코드보다 전체 구조를 먼저 공부하고 싶어." }),
		});
		assert.equal(response.status, 202);
		let state = await waitForStudyState(handle, (candidate) => candidate.questions.some((question: any) => question.scope === "coach" && question.origin === "coach" && question.status === "open"));
		assert.deepEqual(state.goals, ["RN lifecycle을 내 말로 설명하기", "Bridge 실행 경로 추적하기"]);
		assert.equal(state.recommendedNodeId, "goal");
		assert.equal(state.nodes.find((node: any) => node.id === "goal")?.status, "confused");
		assert.equal(JSON.stringify(state.noteDocument), originalNote);
		const coachQuestion = state.questions.find((question: any) => question.scope === "coach" && question.origin === "coach" && question.status === "open");

		response = await fetch(new URL("/coach/answer", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ questionId: coachQuestion.id, answer: "JS와 Native 중 누가 side effect를 소유하는지 설명하기 어려워." }),
		});
		assert.equal(response.status, 202);
		state = await waitForStudyState(handle, (candidate) => candidate.questions.find((question: any) => question.id === coachQuestion.id)?.processingStatus === "applied");
		const answeredCoachQuestion = state.questions.find((question: any) => question.id === coachQuestion.id);
		assert.equal(answeredCoachQuestion.userAnswer, "JS와 Native 중 누가 side effect를 소유하는지 설명하기 어려워.");
		assert.equal(answeredCoachQuestion.status, "review");
		assert.match(answeredCoachQuestion.feedback, /책임 경계/);
		assert.equal(state.learningPhase, "reflect");
		assert.equal(state.coachRole, "rubber-duck");
		assert.equal(JSON.stringify(state.noteDocument), originalNote);
		assert.deepEqual(messages.map(({ message }) => message.details.eventKind), ["learner-question", "coach-feedback", "coach-question", "learner-answer", "coach-feedback"]);
		assert.ok(messages.every(({ message, options }) => message.display === false && options.deliverAs === "nextTurn" && options.triggerTurn === false));
		assert.match(messages[0]?.message.content, /코드보다 전체 구조/);
		assert.match(messages.at(-1)?.message.content, /책임 경계/);
	} finally {
		stopStudyHardStudios();
	}
});

test("학습 코치 실행 중 방향 상태가 바뀌면 최신 snapshot으로 한 번 재실행한다", async () => {
	let coachCalls = 0;
	let handle: any;
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const agentRunner = async (request: any): Promise<string> => {
		assert.equal(request.role, "coach");
		coachCalls += 1;
		const baseRevision = Number(/## 기준 revision\n(\d+)/.exec(request.prompt)?.[1]);
		if (coachCalls === 1) {
			updateStudyHardStudio(handle.state.runId, {
				goals: ["사용자가 동시에 바꾼 최신 목표"],
				nodes: handle.state.nodes.map((node: any) => node.id === "goal" ? { ...node, status: "understood" } : node),
			});
			return JSON.stringify({ baseRevision, feedback: "오래된 방향", goals: ["오래된 목표"], recommendedNodeId: "goal", nodeStatusUpdates: [], questionStatus: "answered" });
		}
		return JSON.stringify({ baseRevision, feedback: "최신 목표를 기준으로 다음 순서를 정리했습니다.", goals: ["사용자가 동시에 바꾼 최신 목표", "Bridge 실행 경로 추적"], recommendedNodeId: "goal", nodeStatusUpdates: [], questionStatus: "answered" });
	};
	handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/coach-stale",
		runId: "coach-stale",
		agentRunner,
	});
	try {
		const response = await fetch(new URL("/coach", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ message: "다음 학습 순서를 정리해줘" }) });
		assert.equal(response.status, 202);
		const state = await waitForStudyState(handle, (candidate) => candidate.questions[0]?.processingStatus === "applied");
		assert.equal(coachCalls, 2);
		assert.deepEqual(state.goals, ["사용자가 동시에 바꾼 최신 목표", "Bridge 실행 경로 추적"]);
		assert.equal(state.nodes.find((node: any) => node.id === "goal")?.status, "understood");
	} finally {
		stopStudyHardStudios();
	}
});

test("학습 코치의 잘못된 enum은 기존 이해 상태를 바꾸지 않고 turn을 실패 처리한다", async () => {
	const messages: Array<{ message: any; options: any }> = [];
	const fakePi = { sendMessage(message: any, options: any) { messages.push({ message, options }); }, exec() { throw new Error("no browser fallback in test"); } } as any;
	const agentRunner = async (request: any): Promise<string> => {
		const baseRevision = Number(/## 기준 revision\n(\d+)/.exec(request.prompt)?.[1]);
		return JSON.stringify({ baseRevision, feedback: "잘못된 상태", nodeStatusUpdates: [{ id: "goal", status: "understodo" }], questionStatus: "done" });
	};
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/coach-invalid-enum",
		runId: "coach-invalid-enum",
		agentRunner,
	});
	try {
		const beforeStatus = handle.state.nodes.find((node) => node.id === "goal")?.status;
		const response = await fetch(new URL("/coach", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ message: "이해 상태를 점검해줘" }) });
		assert.equal(response.status, 202);
		const state = await waitForStudyState(handle, (candidate) => candidate.questions[0]?.processingStatus === "failed");
		assert.equal(state.nodes.find((node: any) => node.id === "goal")?.status, beforeStatus);
		assert.equal(state.questions[0].feedback, undefined);
		assert.match(state.questions[0].processingError, /node status가 유효하지 않습니다/);
		assert.deepEqual(messages.map(({ message }) => message.details.eventKind), ["learner-question", "processing-failed"]);
		assert.match(messages[1]?.message.content, /처리 실패/);
		assert.match(messages[1]?.message.content, /node status가 유효하지 않습니다/);
		assert.equal(messages[1]?.options.triggerTurn, false);
	} finally {
		stopStudyHardStudios();
	}
});

test("Study Hard 질문은 owner Pi가 direct로 route하고 같은 drawer에 답할 수 있다", async () => {
	const harness = createStudyHardBoardHarness();
	const runId = "tool-question-direct-route";
	await harness.execute({ action: "start", url: "https://example.com/tool-question-direct-route", runId });
	let handle = updateStudyHardStudio(runId, {
		questions: [{ id: "Q001", origin: "learner", scope: "session", question: "현재 자료의 핵심은 뭐야?", status: "open", processingStatus: "queued", execution: { phase: "routing", routedAt: 100, updatedAt: 100 }, orchestrationId: "pi-test" }],
	});
	const routed = await harness.execute({
		action: "route",
		runId,
		expectedRevision: handle.state.revision,
		questionId: "Q001",
		executionMode: "direct",
		routeReason: "현재 board 문맥만으로 설명할 수 있습니다.",
	});
	assert.equal(routed.details.executionMode, "direct");
	assert.equal(routed.details.workerLaunched, false);
	handle = updateStudyHardStudio(runId, {});
	assert.equal(handle.state.questions[0].execution?.mode, "direct");
	assert.equal(handle.state.questions[0].execution?.phase, "answering");
	assert.equal(handle.state.questions[0].processingStatus, "running");
	await harness.execute({ action: "respond", runId, expectedRevision: handle.state.revision, questionId: "Q001", feedback: "현재 자료의 핵심은 책임 경계를 구분하는 것입니다." });
	handle = updateStudyHardStudio(runId, {});
	assert.equal(handle.state.questions[0].execution?.phase, "answered");
	assert.equal(handle.state.questions[0].feedback, "현재 자료의 핵심은 책임 경계를 구분하는 것입니다.");
});

test("terminal direct 질문의 중복 응답은 최초 feedback과 visible transcript를 보존한다", async () => {
	const entries: Array<{ customType: string; data: any }> = [];
	const fakePi = {
		appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
		sendMessage() {},
		exec() { throw new Error("no browser fallback in test"); },
	} as any;
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/direct-terminal", runId: "direct-terminal" });
	try {
		updateStudyHardStudio(handle.state.runId, {
			questions: [{ id: "Q001", origin: "learner", scope: "session", question: "한 번만 답해줘", status: "open", processingStatus: "queued", execution: { phase: "routing", routedAt: 100, updatedAt: 100 }, orchestrationId: "pi-test" }],
		});
		routeStudyHardQuestion(handle.state.runId, handle.state.revision, "Q001", "direct", "현재 board 문맥으로 답할 수 있습니다.");
		respondStudyHardQuestion(handle.state.runId, handle.state.revision, "Q001", "첫 답변");
		const completedRevision = handle.state.revision;
		respondStudyHardQuestion(handle.state.runId, completedRevision, "Q001", "덮어쓸 두 번째 답변");
		assert.equal(handle.state.revision, completedRevision);
		assert.equal(handle.state.questions[0].feedback, "첫 답변");
		assert.equal(handle.state.questions[0].execution?.phase, "answered");
		assert.equal(entries.filter(({ data }) => data.details?.eventKind === "pi-answer").length, 1);
	} finally {
		stopStudyHardStudios();
	}
});

test("direct 질문은 범위가 넓어지면 같은 ID로 programmatic worker에 한 번 승격한다", async () => {
	const requests: ProgrammaticSubagentLaunchRequest[] = [];
	const handle = await startStudyHardStudio({
		sendMessage() {},
		events: { emit(_name: string, payload: unknown) { const request = payload as ProgrammaticSubagentLaunchRequest; requests.push(request); request.claim(); } },
		exec() { throw new Error("no browser fallback in test"); },
	} as any, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/direct-escalation", runId: "direct-escalation" });
	try {
		updateStudyHardStudio(handle.state.runId, { questions: [{ id: "Q001", origin: "learner", scope: "session", question: "전체 경로도 검증해줘", status: "open", processingStatus: "queued", execution: { phase: "routing", routedAt: 100, updatedAt: 100 }, orchestrationId: "pi-test", workerResultPath: `${handle.statePath}.worker-Q001.json` }] });
		routeStudyHardQuestion(handle.state.runId, handle.state.revision, "Q001", "direct", "현재 문맥부터 확인합니다.");
		routeStudyHardQuestion(handle.state.runId, handle.state.revision, "Q001", "worker", "외부 실행 검증 축이 발견됐습니다.");
		assert.equal(requests.length, 1);
		const state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.questions[0].id, "Q001");
		assert.equal(state.questions[0].execution.mode, "worker");
		assert.equal(state.questions[0].execution.phase, "escalating");
		assert.equal(state.questions[0].execution.escalatedFrom, "direct");
		assert.match(state.questions[0].orchestrationId, /^worker-/);
		assert.throws(
			() => respondStudyHardQuestion(handle.state.runId, handle.state.revision, "Q001", "늦은 direct 답변"),
			/worker 질문을 direct 응답으로 완료할 수 없습니다/,
		);
		const afterLateDirect = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(afterLateDirect.questions[0].status, "open");
		assert.equal(afterLateDirect.questions[0].feedback, undefined);
	} finally {
		stopStudyHardStudios();
	}
});

test("study_hard_board direct respond는 답변만 반영하고 학습 노트 canonical 변경을 거부한다", async () => {
	const harness = createStudyHardBoardHarness();
	const runId = "tool-current-session-respond";
	await harness.execute({
		action: "start",
		url: "https://example.com/tool-current-session-respond",
		runId,
		noteDocument: { title: "Tool Respond", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "combined", type: "paragraph", text: "합쳐진 설명" }] }] },
	});
	let handle = updateStudyHardStudio(runId, {
		questions: [{ id: "Q001", origin: "learner", scope: "note-block", question: "분리해줘", status: "open", targetNoteBlockId: "combined", processingStatus: "queued", orchestrationId: "pi-test" }],
	});
	await assert.rejects(() => harness.execute({
		action: "respond",
		runId,
		expectedRevision: handle.state.revision,
		questionId: "Q001",
		feedback: "현재 Pi가 구조를 분리했습니다.",
		noteDocument: { title: "Tool Respond", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "a", type: "paragraph", text: "A" }, { id: "b", type: "paragraph", text: "B" }] }] },
	}), /direct 질문은 학습 노트 canonical을 수정할 수 없습니다/);
	const result = await harness.execute({ action: "respond", runId, expectedRevision: handle.state.revision, questionId: "Q001", feedback: "이 블록은 A와 B 책임을 함께 설명합니다." });
	assert.equal(result.details.action, "responded");
	handle = updateStudyHardStudio(runId, {});
	assert.equal(handle.state.questions[0].feedback, "이 블록은 A와 B 책임을 함께 설명합니다.");
	assert.equal(handle.state.questions[0].processingStatus, "applied");
	assert.deepEqual(handle.state.noteDocument.sections[0].blocks.map((block) => block.id), ["combined"]);
	await assert.rejects(() => harness.execute({ action: "respond", runId, expectedRevision: handle.state.revision, questionId: "Q001", feedback: "", questions: [] }), /feedback이 필요합니다/);
});

test("Studio 재시작은 중단된 learner 질문을 의미 routing coordinator에 다시 전달한다", async () => {
	const runId = "resume-current-session-question";
	const firstMessages: Array<{ message: any; options: any }> = [];
	let handle = await startStudyHardStudio({
		sendMessage(message: any, options: any) { firstMessages.push({ message, options }); },
		exec() { throw new Error("no browser fallback in test"); },
	} as any, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/resume-current-session",
		runId,
	});
	let response = await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "재시작해도 현재 대화로 이어져?" }) });
	assert.equal(response.status, 202);
	let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
	assert.equal(state.questions[0].processingStatus, "queued");
	assert.equal(state.questions[0].execution?.phase, "routing");
	assert.equal(firstMessages.filter(({ message }) => message.customType === "heestolee.study-hard.question-route").length, 1);
	stopStudyHardStudios();

	const resumedMessages: Array<{ message: any; options: any }> = [];
	handle = await startStudyHardStudio({
		sendMessage(message: any, options: any) { resumedMessages.push({ message, options }); },
		exec() { throw new Error("no browser fallback in test"); },
	} as any, { hasUI: false, cwd: "/tmp/study-hard", sessionManager: { getBranch: () => [] } } as any, {
		url: "https://example.com/resume-current-session",
		runId,
	});
	try {
		state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.equal(state.questions[0].processingStatus, "queued");
		const requests = resumedMessages.filter(({ message }) => message.customType === "heestolee.study-hard.question-route");
		assert.equal(requests.length, 1);
		assert.equal(requests[0].options.triggerTurn, true);
		assert.match(requests[0].message.content, /Study Hard question routing request/);
		assert.match(requests[0].message.content, /executionMode="direct\|worker"/);
	} finally {
		stopStudyHardStudios();
	}
});

test("Study Hard 코드 리뷰 surface는 Meta Review가 연결될 때만 노출된다", () => {
	const html = buildStudyHardStudioHtml();
	assert.match(html, /id="reviewSurfaceTab"[^>]*hidden>코드 리뷰/);
	assert.match(html, /id="reviewSurface"/);
	assert.match(html, /id="reviewRefreshButton"/);
	assert.match(html, /id="reviewFullRefreshButton"/);
	assert.match(html, /id="reviewQuestionButton"[^>]*>질문 패널</);
	assert.match(html, /#workspace\.rightDrawerOpen #reviewSurface \.reviewBody/);
	assert.match(html, /function renderMetaReview/);
	assert.match(html, /function metaReviewExplanationHtml/);
	assert.match(html, /function renderMetaReviewConversation/);
	assert.match(html, /function selectMetaReviewContext/);
	assert.match(html, /전체 PR/);
	assert.match(html, /선택 블록/);
	assert.doesNotMatch(html, /<section class="reviewQuestionPanel"/);
	assert.match(html, /function requestMetaReviewRefresh/);
	assert.match(html, /function scheduleMetaReviewPolling/);
	assert.match(html, /function metaReviewQuestionNeedsPolling/);
	assert.match(html, /metaReviewQuestionDraftAttachments/);
	assert.match(html, /function bindMetaReviewQuestionImagePaste/);
	assert.match(html, /id="metaReviewQuestionAttachmentPreview"/);
	assert.match(html, /이미지는 입력창에 ⌘V로 붙여넣기 · 최대 4장/);
	assert.match(html, /attachmentIds:pendingAttachments/);
	assert.match(html, /metaReviewQuestionDraftAttachments\[draftKey\]=\[\]/);
	assert.match(html, /function metaReviewQuestionAttachmentGalleryHtml/);
	assert.match(html, /run\.status!==['"]ready['"]/);
	const withoutLink = mergeBoardState(createInitialBoardState({ url: "https://example.com/no-review" }), { activeSurface: "review" });
	assert.equal(withoutLink.activeSurface, "note");
	const linked = mergeBoardState(withoutLink, {
		metaReview: { runId: "run-1", runDir: "/tmp/run-1", source: "github-pr", linkedAt: 1000 },
		activeSurface: "review",
	});
	assert.equal(linked.activeSurface, "review");
	assert.equal(linked.metaReview?.runId, "run-1");
});

test("코드 리뷰 변경 파일 관계는 flowchart 또는 sequence로 렌더링한다", () => {
	const html = buildStudyHardStudioHtml();
	const helperStart = html.indexOf("function metaReviewBasename");
	const helperEnd = html.indexOf("function metaReviewFirstParagraph", helperStart);
	assert.ok(helperStart >= 0 && helperEnd > helperStart);
	const relationshipMermaid = new Function(`${html.slice(helperStart, helperEnd)}; return metaReviewRelationshipMermaid;`)() as (document: any, source: any) => string;
	const source = { files: [{ id: "F-policy", path: "src/policy.ts" }, { id: "F-consumer", path: "src/consumer.ts" }] };
	const relationships = {
		summary: "consumer가 policy를 호출합니다.",
		diagram: "flowchart",
		relations: [{ from: "src/consumer.ts", to: "src/policy.ts", label: "노출 여부 조회" }],
		readingOrder: [{ path: "src/policy.ts" }, { path: "src/consumer.ts" }],
	};
	const flowchart = relationshipMermaid({ relationships }, source);
	assert.match(flowchart, /^flowchart LR/m);
	assert.match(flowchart, /F0\["01 · policy\.ts"\]/);
	assert.match(flowchart, /F1 -->\|노출 여부 조회\| F0/);
	const sequence = relationshipMermaid({ relationships: { ...relationships, diagram: "sequence" } }, source);
	assert.match(sequence, /^sequenceDiagram/m);
	assert.match(sequence, /participant F0 as 01 · policy\.ts/);
	assert.match(sequence, /F1->>F0: 노출 여부 조회/);
});

test("변경 의미 visual은 역할 색상 flowchart와 sequence source를 구조화 spec에서 생성한다", () => {
	const html = buildStudyHardStudioHtml();
	const helperStart = html.indexOf("function metaReviewMeaningVisualRoleMeta");
	const helperEnd = html.indexOf("function metaReviewMeaningVisualHtml", helperStart);
	assert.ok(helperStart >= 0 && helperEnd > helperStart);
	const visualMermaid = new Function(`function metaReviewMermaidText(value){return String(value||'').replace(/[\\r\\n\"'\\[\\]{}<>]/g,' ').replace(/\\s+/g,' ').trim();}${html.slice(helperStart, helperEnd)}; return metaReviewMeaningVisualMermaid;`)() as (visual: any) => string;
	const flowchart = visualMermaid({
		kind: "flowchart", direction: "LR",
		groups: [{ id: "before", label: "기존", phase: "before" }, { id: "after", label: "신규", phase: "after" }],
		nodes: [{ id: "manual", label: "수동 처리", role: "removed", groupId: "before" }, { id: "owner", label: "공통 책임", role: "moved", groupId: "after" }, { id: "guard", label: "검증", role: "guard", groupId: "after" }],
		edges: [{ from: "manual", to: "owner", label: "책임 이동", role: "moved" }, { from: "owner", to: "guard", label: "검증", role: "guard", style: "dashed" }],
	});
	assert.match(flowchart, /^flowchart LR/m);
	assert.match(flowchart, /subgraph G1\["BEFORE · 기존"\]/);
	assert.match(flowchart, /class N1 role_removed/);
	assert.match(flowchart, /classDef role_moved/);
	assert.match(flowchart, /linkStyle 1 stroke:#b36a00,stroke-width:2px,stroke-dasharray:5 4/);
	const sequence = visualMermaid({
		kind: "sequence",
		actors: [{ id: "admin", label: "관리자", role: "context" }, { id: "modal", label: "모달", role: "moved" }, { id: "server", label: "서버", role: "guard" }],
		messages: [{ from: "admin", to: "modal", label: "정렬", role: "context" }, { from: "modal", to: "server", label: "expected + ordered", role: "new" }, { from: "server", to: "modal", label: "충돌 refetch", role: "guard", style: "dashed", note: "최신 snapshot" }],
	});
	assert.match(sequence, /^sequenceDiagram/m);
	assert.match(sequence, /rect rgb\(255,242,217\)/);
	assert.match(sequence, /A3-->>A2: 충돌 refetch/);
	assert.match(sequence, /Note over A3,A2: 최신 snapshot/);
	for (const marker of ["reviewMeaningDiagramViewport", "reviewMeaningLegend", "data-review-visual-kind", "max-height:320px", "읽는 법"]) assert.match(html, new RegExp(marker));
});

test("변경 의미 visual은 차트 전용 확대 overlay와 zoom controls를 제공한다", () => {
	const html = buildStudyHardStudioHtml();
	for (const marker of [
		"data-review-visual-expand",
		"reviewMeaningVisualOverlay",
		"reviewMeaningVisualOverlayCanvas",
		"reviewMeaningVisualZoomIn",
		"reviewMeaningVisualZoomOut",
		"reviewMeaningVisualZoomReset",
		"openMetaReviewMeaningVisual",
		"closeMetaReviewMeaningVisual",
		"setMetaReviewMeaningVisualZoom",
		"확대해서 보기",
	]) assert.match(html, new RegExp(marker));
	assert.match(html, /event\.key!==['"]Escape['"]/);
	assert.match(html, /event\.target===event\.currentTarget/);
	assert.match(html, /event\.stopPropagation\(\)/);
});

test("코드 리뷰 surface는 한눈에 보기, 독립 관계·finding, compact 파일 목록과 접힌 문맥을 유지한다", () => {
	const html = buildStudyHardStudioHtml();
	for (const marker of ["reviewOverviewLead", "Review attention", "변경 파일 관계", "실제 리뷰 포인트", "reviewFileSummaryRow", "파일 역할", "호출·데이터 흐름", "사용자·후속 영향"]) assert.match(html, new RegExp(marker));
	const fileStart = html.indexOf("function metaReviewFileHtml");
	const fileEnd = html.indexOf("function metaReviewContextKey", fileStart);
	assert.ok(fileStart >= 0 && fileEnd > fileStart);
	const fileRenderer = html.slice(fileStart, fileEnd);
	assert.match(fileRenderer, /<details class="reviewFile"/);
	assert.doesNotMatch(fileRenderer, /<details class="reviewFile" open/);
	assert.match(fileRenderer, /<summary>[\s\S]*metaReviewFileIntroHtml/);
});

test("코드 리뷰 설명 카드는 evidence 줄을 변경 전후 범위로 표시한다", () => {
	const html = buildStudyHardStudioHtml();
	const helperStart = html.indexOf("function compactMetaReviewLineRanges");
	const helperEnd = html.indexOf("function metaReviewExplanationHtml", helperStart);
	assert.ok(helperStart >= 0 && helperEnd > helperStart);
	const lineRangeLabel = new Function(`${html.slice(helperStart, helperEnd)}; return metaReviewLineRangeLabel;`)() as (hunk: any, file: any) => string;
	const file = {
		lines: [
			{ id: "D001", kind: "deletion", oldLine: 8 },
			{ id: "D002", kind: "deletion", oldLine: 9 },
			{ id: "D003", kind: "addition", newLine: 8 },
			{ id: "D004", kind: "addition", newLine: 9 },
			{ id: "D005", kind: "addition", newLine: 13 },
			{ id: "D006", kind: "context", oldLine: 10, newLine: 10 },
		],
	};
	assert.equal(lineRangeLabel({ evidenceIds: ["D001", "D002", "D003", "D004", "D005"] }, file), "변경 전 L8–L9 · 변경 후 L8–L9 · L13");
	assert.equal(lineRangeLabel({ evidenceIds: ["D001", "D002"] }, file), "변경 전 L8–L9");
	assert.equal(lineRangeLabel({ evidenceIds: ["D006"] }, file), "대상 L10");
	assert.equal(lineRangeLabel({ evidenceIds: ["unknown"] }, file), "");
	assert.match(html, /reviewExplanationRange/);
	assert.match(html, /설명 범위 ·/);
});

test("changed code row는 semantic hunk를 일급 선택 단위로 사용하고 나머지 row는 line으로 fallback한다", () => {
	const html = buildStudyHardStudioHtml();
	const helperStart = html.indexOf("function metaReviewDeclarationForLine");
	const helperEnd = html.indexOf("function metaReviewSelectionAttributes", helperStart);
	assert.ok(helperStart >= 0 && helperEnd > helperStart);
	const selectionContext = new Function(`${html.slice(helperStart, helperEnd)}; return metaReviewLineSelectionContext;`)() as (line: any, file: any, hunk?: any) => any;
	const file = { id: "F001", path: "src/policy.ts" };
	assert.deepEqual(selectionContext({ id: "D001", newLine: 8 }, file, { id: "E-01", title: "공개 상태 계약", evidenceIds: ["D001", "D002"] }), {
		selectionKind: "hunk",
		selectionId: "E-01",
		selectionLabel: "변경 단위 · 공개 상태 계약",
		evidenceIds: ["D001", "D002"],
	});
	assert.deepEqual(selectionContext({ id: "D003", kind: "context", oldLine: 9, newLine: 9 }, file), {
		selectionKind: "line",
		selectionId: "D003",
		selectionLabel: "코드 줄 · src/policy.ts:9",
		evidenceIds: ["D003"],
	});
	for (const marker of ["reviewSemanticUnitHeader", "reviewSemanticUnit", "reviewSemanticStart", "reviewSemanticEnd"]) assert.match(html, new RegExp(marker));
	assert.match(html, /reviewLine\.reviewSemanticUnit\.selected/);
	assert.match(html, /element\.dataset\.reviewLine&&selectedEvidence\.has\(element\.dataset\.reviewLine\)/);
	assert.match(html, /metaReviewDeclarationIsWithin\(elementFile,element\.dataset\.reviewDeclaration,context\.declarationId\)/);
});

test("declaration selection은 가장 작은 선언을 고르고 Glimpse에서 상위·하위 범위와 full source를 탐색한다", () => {
	const html = buildStudyHardStudioHtml();
	const helperStart = html.indexOf("function metaReviewDeclarationForLine");
	const helperEnd = html.indexOf("function metaReviewDeclarationContext", helperStart);
	assert.ok(helperStart >= 0 && helperEnd > helperStart);
	const declarationForLine = new Function(`${html.slice(helperStart, helperEnd)}; return metaReviewDeclarationForLine;`)() as (file: any, line: any) => any;
	const file = {
		declarationSource: {
			declarations: [
				{ id: "A-file", kind: "file", depth: 0, before: { startLine: 1, endLine: 10 }, after: { startLine: 1, endLine: 12 } },
				{ id: "A-function", kind: "function", depth: 1, parentId: "A-file", before: { startLine: 2, endLine: 9 }, after: { startLine: 2, endLine: 11 } },
				{ id: "A-local", kind: "variable", depth: 2, parentId: "A-function", before: { startLine: 4, endLine: 4 }, after: { startLine: 4, endLine: 4 } },
			],
		},
	};
	assert.equal(declarationForLine(file, { kind: "addition", newLine: 4 })?.declaration.id, "A-local");
	assert.equal(declarationForLine(file, { kind: "context", oldLine: 5, newLine: 5 })?.declaration.id, "A-function");
	assert.equal(declarationForLine(file, { kind: "deletion", oldLine: 4 })?.side, "before");
	assert.equal(declarationForLine({ declarationSource: { declarations: [{ id: "A-file", kind: "file", depth: 0, after: { startLine: 1, endLine: 10 } }] } }, { kind: "addition", newLine: 3 }), undefined);
	const containmentStart = html.indexOf("function metaReviewDeclarationIsWithin");
	const containmentEnd = html.indexOf("function metaReviewDeclarationRangeLabel", containmentStart);
	const isWithin = new Function(`function metaReviewDeclarationById(file,id){return file.declarationSource.declarations.find(item=>item.id===id);}${html.slice(containmentStart, containmentEnd)}; return metaReviewDeclarationIsWithin;`)() as (file: any, candidateId: string, ancestorId: string) => boolean;
	assert.equal(isWithin(file, "A-local", "A-function"), true);
	assert.equal(isWithin(file, "A-function", "A-local"), false);
	for (const marker of [
		"reviewDeclarationUnitHeader",
		"reviewDeclarationPreviewHost",
		"reviewDeclarationSourceLine",
		"↑ 상위 범위",
		"더 작은 범위",
		"data-review-declaration-side",
		"reviewSelectionBadge",
		"data-review-selection-clear",
		"anchor.after(host)",
	]) assert.match(html, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	assert.match(html, /reviewSemanticUnitHeader,.reviewDeclarationUnitHeader \{ display:none; \}/);
	assert.match(html, /reviewLine\.selected\.selectionStart/);
});

test("Meta Review 상단은 한눈에 보기, 파일 관계, 리뷰 포인트, 읽는 흐름을 독립 surface로 렌더링한다", () => {
	const html = buildStudyHardStudioHtml();
	for (const marker of [
		"function metaReviewOverviewHtml",
		"<h2>한눈에 보기</h2>",
		"function metaReviewRelationshipHtml",
		"reviewRelationshipSection",
		"reviewRelationshipGuide",
		"관계를 읽는 법",
		"function metaReviewFindingsHtml",
		"reviewFindingsSection",
		"function metaReviewReadingRailHtml",
		"reviewReadingRail",
	]) assert.match(html, new RegExp(marker));
	assert.match(html, /reviewRelationshipDiagram svg \{[^}]*width:max\(100%,1040px\)/);
	assert.match(html, /#workspace\.rightDrawerOpen #reviewSurface \.reviewReadingRail \{ display:none/);
	assert.match(html, /reviewFindingIndex reviewSelectable/);
	assert.match(html, /data-review-select-kind="card"/);
	const renderStart = html.indexOf("function renderMetaReview()");
	const renderEnd = html.indexOf("function scheduleMetaReviewPolling", renderStart);
	const renderSource = html.slice(renderStart, renderEnd);
	assert.ok(renderStart >= 0 && renderEnd > renderStart);
	assert.match(renderSource, /metaReviewOverviewHtml[\s\S]*metaReviewRelationshipHtml[\s\S]*metaReviewFindingsHtml[\s\S]*metaReviewReadingRailHtml/);
});

test("코드 리뷰 질문 drawer는 전체 PR과 선택 block 대화를 분리한다", () => {
	const html = buildStudyHardStudioHtml();
	const matcherBody = /function metaReviewQuestionMatchesContext\(question,context\)\{([\s\S]*?)\}\n    function metaReviewQuestionDraftKey/.exec(html)?.[1];
	assert.ok(matcherBody);
	const matches = new Function(`return function metaReviewQuestionMatchesContext(question,context){${matcherBody}};`)() as (question: any, context: any) => boolean;
	assert.equal(matches({ scope: "session" }, { scope: "session" }), true);
	assert.equal(matches({ scope: "session" }, { scope: "card", cardId: "R-01" }), false);
	assert.equal(matches({ scope: "card", cardId: "R-01" }, { scope: "card", cardId: "R-01" }), true);
	assert.equal(matches({ scope: "card", cardId: "R-02" }, { scope: "card", cardId: "R-01" }), false);
	assert.equal(matches({ scope: "evidence", evidenceIds: ["D001", "D002"] }, { scope: "evidence", evidenceIds: ["D002"] }), true);
	assert.equal(matches({ scope: "evidence", evidenceIds: ["D003"] }, { scope: "evidence", evidenceIds: ["D002"] }), false);
	assert.equal(matches({ scope: "evidence", evidenceIds: ["D002"], selection: { kind: "hunk", id: "E-01" } }, { scope: "evidence", evidenceIds: ["D002"], selectionKind: "line", selectionId: "D002" }), false);
	assert.equal(matches({ scope: "evidence", evidenceIds: ["D001", "D002"], selection: { kind: "hunk", id: "E-01" } }, { scope: "evidence", evidenceIds: ["D001", "D002"], selectionKind: "hunk", selectionId: "E-01" }), true);
	assert.equal(matches({ scope: "section", sectionId: "relationships", selection: { kind: "section", id: "relationships" } }, { scope: "section", sectionId: "relationships", selectionKind: "section", selectionId: "relationships" }), true);
	assert.equal(matches({ scope: "section", sectionId: "overview", selection: { kind: "section", id: "overview" } }, { scope: "section", sectionId: "relationships", selectionKind: "section", selectionId: "relationships" }), false);
	assert.equal(matches({ scope: "declaration", declarationId: "A-local", declarationSide: "after", selection: { kind: "declaration", id: "A-local" } }, { scope: "declaration", declarationId: "A-local", declarationSide: "after", selectionKind: "declaration", selectionId: "A-local" }), true);
	assert.equal(matches({ scope: "declaration", declarationId: "A-local", declarationSide: "before", selection: { kind: "declaration", id: "A-local" } }, { scope: "declaration", declarationId: "A-local", declarationSide: "after", selectionKind: "declaration", selectionId: "A-local" }), false);
	assert.equal(matches({ scope: "meaning", meaningId: "M-contract", selection: { kind: "meaning", id: "M-contract" } }, { scope: "meaning", meaningId: "M-contract", selectionKind: "meaning", selectionId: "M-contract" }), true);
	assert.equal(matches({ scope: "meaning", meaningId: "M-other", selection: { kind: "meaning", id: "M-other" } }, { scope: "meaning", meaningId: "M-contract", selectionKind: "meaning", selectionId: "M-contract" }), false);
});

test("Study Hard 질문 drawer는 direct와 worker 실행 상태를 같은 UI 문법으로 표시한다", () => {
	const html = buildStudyHardStudioHtml();
	assert.match(html, /Pi에 질문하기/);
	assert.doesNotMatch(html, />Worker에 보내기</);
	for (const label of ["답변 경로를 확인하고 있어요.", "현재 Pi가 확인하고 있어요.", "추가 조사를 worker에게 이어서 맡기고 있어요.", "조사 worker를 준비하고 있어요."]) assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
	const helperStart = html.indexOf("function questionExecutionPhase");
	const helperEnd = html.indexOf("function metaReviewQuestionHtml", helperStart);
	assert.ok(helperStart >= 0 && helperEnd > helperStart);
	const helpers = new Function(`${html.slice(helperStart, helperEnd)}; return {questionExecutionPhase,metaReviewQuestionStatusText,metaReviewQuestionNeedsPolling};`)() as any;
	assert.equal(helpers.questionExecutionPhase({ execution: { phase: "routing" } }), "routing");
	assert.equal(helpers.metaReviewQuestionStatusText({ execution: { phase: "answering" } }), "현재 Pi가 실제 source를 확인하고 있어요.");
	assert.equal(helpers.metaReviewQuestionStatusText({ execution: { phase: "worker-running" }, workerRunId: 12 }), "worker #12가 자료를 확인하고 있어요.");
	assert.equal(helpers.metaReviewQuestionStatusText({ execution: { phase: "stale" } }), "기준 source가 변경되어 다시 확인이 필요해요.");
	assert.equal(helpers.metaReviewQuestionNeedsPolling({ execution: { phase: "escalating" } }), true);
	assert.equal(helpers.metaReviewQuestionNeedsPolling({ execution: { phase: "answered" } }), false);
});

test("Study Hard 코드 리뷰 surface는 explanation, 결정, 질문, 명시적 refresh 요청을 같은 run에 연결한다", async () => {
	const reviewRoot = mkdtempSync(join(tmpdir(), "study-hard-meta-review-"));
	const diff = `diff --git a/src/policy.ts b/src/policy.ts\nindex 1111111..2222222 100644\n--- a/src/policy.ts\n+++ b/src/policy.ts\n@@ -1,3 +1,4 @@\n export function visible(status: string) {\n-  return status !== "HIDDEN";\n+  const allowed = new Set(["OPEN", "READY"]);\n+  return allowed.has(status);\n }\n`;
	const beforeSource = `export function visible(status: string) {\n  return status !== "HIDDEN";\n}\n`;
	const afterSource = `export function visible(status: string) {\n  const allowed = new Set(["OPEN", "READY"]);\n  return allowed.has(status);\n}\n`;
	const bundle = await enrichReviewSourceDeclarations(captureUnifiedDiff(diff), async ({ side }) => side === "before" ? beforeSource : afterSource);
	const run = createPrReviewRun(reviewRoot, {
		url: "https://github.com/acme/repo/pull/42",
		owner: "acme",
		repo: "repo",
		number: 42,
		title: "Visibility contract",
		baseSha: "base1234",
		headSha: "head1234567890",
		baseRefName: "main",
	}, bundle, diff, 1000);
	for (const chunk of bundle.chunks) markChunkInspected(run, chunk.id);
	const changedEvidenceIds = bundle.lines.filter((line) => line.kind === "addition" || line.kind === "deletion").map((line) => line.id);
	const findingEvidenceId = bundle.lines.find((line) => line.kind === "deletion")!.id;
	saveMetaReviewSubmission(run, [{
		path: "src/policy.ts",
		role: "상태 노출 정책을 소유합니다.",
		changeReason: "새 상태의 자동 노출을 막습니다.",
		flow: "consumer → visible policy",
		impact: "OPEN과 READY만 노출됩니다.",
		hunks: [{ id: "E-01", title: "허용 상태 명시", evidenceIds: changedEvidenceIds, whatChanged: "부정 조건을 allowlist로 바꿨습니다.", why: "새 상태 자동 노출을 막습니다.", evidence: "삭제 조건과 새 Set을 확인했습니다.", responsibility: "visible이 정책을 소유합니다.", concepts: ["allowlist"], flowImpact: "consumer 결과가 제한됩니다." }],
	}], [{
		id: "R-01",
		title: "호출자 상태도 확인한다",
		strength: "question",
		confidence: "medium",
		evidenceIds: [findingEvidenceId],
		reviewDraft: "기존 NEW 상태 호출자가 의도적으로 제외되는지 확인해주세요.",
		explanation: "정책 변경은 기존 consumer에 영향을 줄 수 있습니다.",
		meta: { summary: "consumer contract test로 보강할 수 있습니다.", scope: "current-pr" },
	}], {
		overview: { summary: "상태 노출 정책을 allowlist로 좁힙니다.", reviewFocus: "consumer 계약을 함께 확인합니다." },
		relationships: { summary: "단일 정책 파일 안에서 변경이 완결됩니다.", diagram: "flowchart", relations: [], readingOrder: [{ path: "src/policy.ts", reason: "정책과 호출 결과를 함께 확인합니다." }] },
		meanings: [{ id: "M-visible-contract", title: "암묵적 상태 허용을 명시적 노출 계약으로 전환", beforeContract: "부정 조건을 통과하는 상태가 노출될 수 있었습니다.", afterContract: "명시한 상태만 노출됩니다.", mechanism: "policy가 allowlist를 소유합니다.", impact: "향후 상태 추가가 자동 노출되지 않습니다.", paths: ["src/policy.ts"], evidenceIds: changedEvidenceIds, basis: [{ kind: "definition", path: "src/policy.ts", line: 1, summary: "visible policy 정의가 allowlist를 소유합니다." }], confidence: "high" }],
	});
	const messages: any[] = [];
	const handle = await startStudyHardStudio({
		sendMessage(message: any, options: any) { messages.push({ message, options }); },
		exec() { throw new Error("no browser fallback in test"); },
	} as any, { hasUI: false, cwd: "/tmp/review-pr-42", sessionManager: { getBranch: () => [] } } as any, {
		url: "https://github.com/acme/repo/pull/42",
		runId: "meta-review-route-test",
		initialPatch: { activeSurface: "review", metaReview: { runId: run.runId, runDir: run.runDir, source: "github-pr", linkedAt: 1000 } },
	});
	try {
		const stateResponse = await fetch(new URL("/meta-review/state", handle.url));
		assert.equal(stateResponse.status, 200);
		const state = await stateResponse.json() as any;
		assert.equal(state.guides.length, 1);
		assert.equal(state.document.overview.reviewFocus, "consumer 계약을 함께 확인합니다.");
		assert.equal(state.document.relationships.readingOrder[0].path, "src/policy.ts");
		assert.equal(state.explanationCoverage.changedLinesExplained, bundle.stats.changedRows);
		assert.ok(state.source.files[0].declarationSource.after.text.includes("const allowed"));
		assert.equal(state.document.meanings[0].id, "M-visible-contract");
		let response = await fetch(new URL("/meta-review/decision", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ cardId: "R-01", decision: "review-only" }) });
		assert.equal(response.status, 200);
		assert.equal((await response.json() as any).card.decision, "review-only");
		response = await fetch(new URL("/attachments", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", name: "review.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${Buffer.from("review-question-image").toString("base64")}`, note: "Meta Review 질문 입력창에서 붙여넣은 이미지" }) });
		assert.equal(response.status, 200);
		const uploaded = (await response.json() as any).attachment;
		response = await fetch(new URL("/meta-review/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ question: "이 allowlist가 왜 필요한가?", scope: "evidence", evidenceIds: [findingEvidenceId], selectionKind: "line", selectionId: findingEvidenceId, attachmentIds: [uploaded.id] }) });
		assert.equal(response.status, 202);
		response = await fetch(new URL("/meta-review/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ question: "이 파일 관계를 어떤 순서로 읽어야 해?", scope: "section", sectionId: "relationships", selectionKind: "section", selectionId: "relationships" }) });
		assert.equal(response.status, 202);
		response = await fetch(new URL("/meta-review/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ question: "이 계약 전환이 어떤 영향을 주나?", scope: "meaning", meaningId: "M-visible-contract", evidenceIds: changedEvidenceIds, selectionKind: "meaning", selectionId: "M-visible-contract" }) });
		assert.equal(response.status, 202);
		const visibleDeclaration = state.source.files[0].declarationSource.declarations.find((item: any) => item.name === "visible");
		response = await fetch(new URL("/meta-review/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ question: "이 함수의 변경을 전체 선언 범위로 설명해줘.", scope: "declaration", fileId: "F001", declarationId: visibleDeclaration.id, declarationSide: "after", evidenceIds: visibleDeclaration.evidenceIds, selectionKind: "declaration", selectionId: visibleDeclaration.id }) });
		assert.equal(response.status, 202);
		response = await fetch(new URL("/meta-review/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ question: "전체 PR의 데이터 흐름은 어떻게 이어지나?", scope: "session" }) });
		assert.equal(response.status, 202);
		const questionState = await fetch(new URL("/meta-review/state", handle.url)).then((result) => result.json() as Promise<any>);
		assert.deepEqual(questionState.questions.map((question: any) => question.scope), ["evidence", "section", "meaning", "declaration", "session"]);
		assert.deepEqual(questionState.questions[0]?.selection, { kind: "line", id: findingEvidenceId, label: "코드 줄 · src/policy.ts:2" });
		assert.deepEqual(questionState.questions[1]?.selection, { kind: "section", id: "relationships", label: "변경 파일 관계" });
		assert.equal(questionState.questions[2]?.selection.kind, "meaning");
		assert.equal(questionState.questions[2]?.meaningId, "M-visible-contract");
		assert.equal(questionState.questions[3]?.selection.kind, "declaration");
		assert.equal(questionState.questions[3]?.declarationSide, "after");
		assert.deepEqual(questionState.questions[0]?.attachmentIds, [uploaded.id]);
		assert.equal(questionState.questions[0]?.attachments?.[0]?.name, "review.png");
		assert.equal(questionState.questions[0]?.attachments?.[0]?.path, uploaded.path);
		const questionMessages = messages.filter(({ message }) => message.customType === "pilee-meta-review-question");
		assert.equal(questionMessages.length, 5);
		assert.match(questionMessages[0]?.message.content || "", /review\.png/);
		assert.match(questionMessages[1]?.message.content || "", /sectionId: relationships/);
		assert.match(questionMessages[2]?.message.content || "", /meaningId: M-visible-contract/);
		assert.match(questionMessages[3]?.message.content || "", new RegExp(`declarationId: ${visibleDeclaration.id}`));
		assert.match(questionMessages[0]?.message.content || "", new RegExp(uploaded.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		response = await fetch(new URL("/attachments/remove", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ attachmentId: uploaded.id }) });
		assert.equal(response.status, 409);
		response = await fetch(new URL("/meta-review/refresh", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ mode: "full" }) });
		assert.equal(response.status, 202);
		assert.ok(messages.some(({ message }) => message.customType === "pilee-meta-review-refresh-request"));
	} finally {
		stopStudyHardStudios();
		rmSync(reviewRoot, { recursive: true, force: true });
	}
});
