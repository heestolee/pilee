import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setGlimpseOpenForTests } from "../utils/glimpse.ts";
import type { LearningCompanionManifest } from "../learning-companion/state.ts";
import { attachStudyHardLearningCompanion, buildStudyHardStudioHtml, buildStudyNoteExportHtml, checkpointStudyHardLearning, createInitialBoardState, layoutStudyGraph, loadPersistedStudyHardState, mergeBoardState, openExistingStudyHardStudio, proposeStudyHardLearningChange, recordStudyHardLearningEvent, registerStudyHardBoardTool, startStudyHardStudio, stopStudyHardStudios, updateStudyHardStudio } from "./studio.ts";

const originalStateDir = process.env.STUDY_HARD_STATE_DIR;
const testStateDir = mkdtempSync(join(tmpdir(), "study-hard-state-"));
process.env.STUDY_HARD_STATE_DIR = testStateDir;

function authorizedHeaders(handle: { capabilityToken: string }): Record<string, string> {
	return { "Content-Type": "application/json", "X-Study-Hard-Capability": handle.capabilityToken };
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
	current.questions = [{ id: "Q001", question: "전체 구조는?", origin: "learner", scope: "session", status: "open", targetNodeId: "source" }];
	const next = mergeBoardState(current, {
		questions: [{ id: "Q001", question: "전체 구조는?", origin: "coach", feedback: "세 가지 흐름입니다.", status: "answered", targetNodeId: "goal" }],
	});
	assert.deepEqual(
		{ origin: next.questions[0]?.origin, scope: next.questions[0]?.scope, targetNodeId: next.questions[0]?.targetNodeId },
		{ origin: "learner", scope: "session", targetNodeId: "source" },
	);
});

test("mergeBoardState는 학습 코치 scope와 비동기 처리 상태를 보존한다", () => {
	const current = createInitialBoardState({ url: "https://example.com", runId: "coach-question-state" });
	const queued = mergeBoardState(current, {
		questions: [{ id: "Q001", question: "다음에 뭘 공부할까?", origin: "learner", scope: "coach", status: "open", processingStatus: "queued", orchestrationId: "coach-run-1" }],
	});
	const answered = mergeBoardState(queued, {
		questions: [{ id: "Q001", question: "다음에 뭘 공부할까?", origin: "coach", scope: "session", status: "answered", feedback: "Bridge보다 lifecycle을 먼저 보세요." }],
	});

	assert.equal(answered.questions[0]?.origin, "learner");
	assert.equal(answered.questions[0]?.scope, "coach");
	assert.equal(answered.questions[0]?.processingStatus, "queued");
	assert.equal(answered.questions[0]?.orchestrationId, "coach-run-1");
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

test("buildStudyHardStudioHtml centers the learning note, Before/After diagram, and thought board", () => {
	const html = buildStudyHardStudioHtml();
	assert.match(html, /reactflow@11/);
	assert.match(html, /mermaid@11/);
	assert.match(html, /data-surface="note" class="active"/);
	assert.match(html, /Before \/ After/);
	assert.match(html, /생각 보드/);
	assert.match(html, /id="htmlExportButton"/);
	assert.match(html, /id="notionExportButton"/);
	assert.match(html, /id="historyButton"/);
	assert.match(html, /id="historyDrawer"/);
	assert.match(html, /htmlExportButton[\s\S]*surfaceTabs/);
	assert.match(html, /AI가 정리한 개념 카드와 직접 만든 Scratch 메모/);
	assert.match(html, /전체 실행 흐름을 요약 비교/);
	assert.match(html, /학습 코치/);
	assert.match(html, /학습 내용이 아니라 학습 방향을 묻는 곳/);
	assert.match(html, /최대 3개까지 병렬 처리/);
	assert.match(html, /processingStage/);
	assert.match(html, /activeQuestionProcessing/);
	assert.match(html, /composerState/);
	assert.match(html, /conversationCard/);
	assert.match(html, /#detailDrawer #conversation > \.conversationCard/);
	assert.match(html, /#detailDrawer #conversation \.thread \{ flex:1; min-height:180px; max-height:none; \}/);
	assert.match(html, /scrollThreadToBottom/);
	assert.match(html, /isQuestionSubmitShortcut/);
	assert.match(html, /event\.altKey/);
	assert.match(html, /event\.metaKey/);
	assert.match(html, /⌥↵ 또는 ⌘↵로 전송/);
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
	assert.match(html, /isMemo\?summary\.split/);
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
	assert.match(html, /\/history\//);
	assert.match(html, /sequenceDiagram/);
	assert.match(html, /renderNoteMermaidDiagrams/);
	assert.match(html, /data-mermaid-source/);
	assert.match(html, /data-inline-flow/);
	assert.match(html, /sequenceSource\(flow\)/);
	assert.match(html, /boardCards/);
	assert.match(html, /post\('\/memo'/);
	assert.match(html, /color-scheme:light/);
	assert.match(html, /--bg:#f6f1e7/);
	assert.match(html, /\.codeLine\.annotated/);
	assert.match(html, /annotated\.has\(number\)/);
	assert.match(html, /lineNumberMode/);
	assert.match(html, /annotations/);
	assert.match(html, /drawer right/);
	assert.match(html, /\/workspace/);
	assert.match(html, /\/answer/);
	assert.match(html, /\/position/);
	assert.match(html, /\/relayout/);
	assert.match(html, /onNodeDragStop/);
	assert.match(html, /safeUrl/);
	assert.match(html, /EventSource\('\/events'\)/);
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
				{ id: "mental-model", type: "callout", tone: "success", title: "한 문장", body: "공통 core와 platform edge를 분리한다." },
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
	assert.doesNotMatch(html, /htmlExportButton/);
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

test("export routes write HTML to Downloads and pass rendered diagrams to Notion sync", async () => {
	const fakeSyncScript = join(testStateDir, "fake-study-hard-sync.py");
	writeFileSync(fakeSyncScript, "import json\nprint(json.dumps({'pageId':'page-1','pageUrl':'https://notion.so/page1','sessionId':'session-1','sectionHashes':{'#document':'hash-1'}}))\n", "utf-8");
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const runId = "export-routes";
	const downloadDir = join(testStateDir, "Downloads");
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, { url: "https://example.com/export", runId, syncScript: fakeSyncScript, downloadDir });
	try {
		updateStudyHardStudio(runId, {
			noteDocument: { title: "Export Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "Exported body" }, { id: "diagram", type: "code", code: { language: "mermaid", code: "flowchart LR\nA --> B" } }] }] },
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
		assert.equal(state.notionSync.lastSyncedRevision, 1);
		assert.equal(state.notionSync.sectionHashes["#document"], "hash-1");
		const syncInput = JSON.parse(readFileSync(join(testStateDir, `${runId}-exports`, "notion-sync.json"), "utf-8"));
		assert.equal(syncInput.qa[0].id, "Q001");
		assert.equal(syncInput.sourceUrl, "https://example.com/export");
		assert.equal(syncInput.diagramAssets[0].blockId, "diagram");
		assert.equal(readFileSync(syncInput.diagramAssets[0].path, "utf-8"), "rendered-png");
	} finally {
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
			noteDocument: { title: "Visual Export", sections: [{ id: "visuals", kind: "flow", title: "시각화", blocks: [{ id: "architecture", type: "visual", title: "Frame에서 저장까지", visual: { kind: "architecture-flow", title: "Frame에서 저장까지", lanes: ["Frame", "Study Hard"], nodes: [{ id: "frame", lane: "Frame", title: "TFT visual" }], edges: [] } }] }] },
		});
		const headers = authorizedHeaders(handle);
		let response = await fetch(new URL("/export/html", handle.url), { method: "POST", headers, body: "{}" });
		assert.equal(response.status, 200);
		const htmlResult = await response.json() as any;
		const exported = readFileSync(htmlResult.path, "utf-8");
		assert.match(exported, /PNG fallback 보기/);
		assert.match(exported, /data:image\/png;base64/);
		response = await fetch(new URL("/export/notion", handle.url), { method: "POST", headers, body: "{}" });
		assert.equal(response.status, 200);
		const syncInput = JSON.parse(readFileSync(join(testStateDir, `${runId}-exports`, "notion-sync.json"), "utf-8"));
		assert.equal(syncInput.diagramAssets[0]?.blockId, "architecture");
		assert.equal(readFileSync(syncInput.diagramAssets[0]?.path, "utf-8"), "native-visual-png");
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

test("Glimpse node thread keeps learner questions and coach answers on the same node", async () => {
	const messages: Array<{ message: any; options: any }> = [];
	const fakePi = {
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
		questionBatchWindowMs: 60_000,
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
		assert.ok(transcriptMessages.every(({ message, options }) => message.display === true && options.deliverAs === "followUp" && options.triggerTurn === false));
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

test("오른쪽 질문 3개는 Tutor에서 병렬 처리된 뒤 Editor가 한 번에 노트에 반영한다", async () => {
	let activeTutors = 0;
	let maxActiveTutors = 0;
	let startedTutors = 0;
	let completedTutors = 0;
	let editorCalls = 0;
	let releaseTutors!: () => void;
	const allTutorsStarted = new Promise<void>((resolve) => { releaseTutors = resolve; });
	const messages: Array<{ message: any; options: any }> = [];
	const fakePi = {
		sendMessage(message: any, options: any) { messages.push({ message, options }); },
		exec() { throw new Error("no browser fallback in test"); },
		getThinkingLevel() { return "high"; },
	} as any;
	const agentRunner = async (request: any): Promise<string> => {
		if (request.role === "tutor") {
			activeTutors += 1;
			startedTutors += 1;
			maxActiveTutors = Math.max(maxActiveTutors, activeTutors);
			if (startedTutors === 3) releaseTutors();
			await allTutorsStarted;
			await new Promise((resolve) => setTimeout(resolve, 5));
			activeTutors -= 1;
			completedTutors += 1;
			return `Tutor 답변 ${completedTutors}`;
		}
		assert.equal(request.role, "editor");
		assert.equal(completedTutors, 3);
		assert.match(request.prompt, /type: "visual"[\s\S]*원본 spec 전체를 그대로 보존/);
		editorCalls += 1;
		const baseRevision = Number(/## 기준 revision\n(\d+)/.exec(request.prompt)?.[1]);
		return JSON.stringify({
			baseRevision,
			noteDocument: {
				title: "병렬 학습 노트",
				sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "mental-model", type: "callout", tone: "success", title: "Mental model", body: "세 Tutor 답변을 중복 없이 한 번에 반영했다." }] }],
			},
		});
	};
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/parallel-tutors",
		runId: "parallel-tutors",
		agentRunner,
		questionBatchWindowMs: 50,
	});
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "병렬 학습 노트", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "mental-model", type: "callout", tone: "success", title: "Mental model", body: "기존 설명" }] }] },
		});
		const responses = await Promise.all(["첫 질문", "둘째 질문", "셋째 질문"].map((question) => fetch(new URL("/ask", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ scope: "session", question }),
		})));
		assert.deepEqual(responses.map((response) => response.status), [202, 202, 202]);

		const state = await waitForStudyState(handle, (candidate) => candidate.questions.length === 3 && candidate.questions.every((question: any) => question.processingStatus === "applied"));
		assert.equal(maxActiveTutors, 3);
		assert.equal(editorCalls, 1);
		assert.deepEqual(state.questions.map((question: any) => question.status), ["answered", "answered", "answered"]);
		assert.match(state.noteDocument.sections[0].blocks[0].body, /한 번에 반영/);
		const eventKinds = messages.map(({ message }) => message.details.eventKind);
		assert.equal(eventKinds.filter((kind) => kind === "learner-question").length, 3);
		assert.equal(eventKinds.filter((kind) => kind === "tutor-answer").length, 3);
		assert.equal(eventKinds.filter((kind) => kind === "note-merged").length, 1);
		assert.ok(messages.filter(({ message }) => message.details.eventKind === "tutor-answer").every(({ message }) => /질문: (첫 질문|둘째 질문|셋째 질문)\n\n답변:/.test(message.content)));
		assert.ok(messages.every(({ message, options }) => message.display === true && options.triggerTurn === false));
		assert.match(messages.find(({ message }) => message.details.eventKind === "note-merged")?.message.content, /질문 3개의 답변.*revision/);
		assert.ok(messages.every(({ message }) => !/# Study Hard Tutor|baseRevision|noteDocument.*sections/.test(message.content)));
	} finally {
		stopStudyHardStudios();
	}
});

test("note-block Tutor는 선택 블록만 받고 session Tutor는 전체 자료를 받는다", async () => {
	const noteDocument = {
		title: "Scoped Tutor Note",
		sections: [
			{ id: "selected-section", kind: "node", title: "선택 영역", blocks: [{ id: "selected-block", type: "paragraph", text: "선택 블록의 핵심 설명" }] },
			{ id: "unrelated-section", kind: "reflection", title: "다른 영역", blocks: [{ id: "unrelated-block", type: "paragraph", text: "다른 질문의 오래된 설명" }] },
		],
	};
	const flows = [{ id: "unrelated-flow", title: "다른 데이터 흐름", variant: "after", actors: [{ id: "a", label: "A" }, { id: "b", label: "B" }], steps: [{ id: "step", order: 1, from: "a", to: "b", action: "unrelated action" }] }];
	let tutorCalls = 0;
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const agentRunner = async (request: any): Promise<string> => {
		if (request.role === "tutor") {
			tutorCalls += 1;
			if (tutorCalls === 1) {
				assert.match(request.prompt, /selected-block/);
				assert.match(request.prompt, /선택 블록의 핵심 설명/);
				assert.doesNotMatch(request.prompt, /unrelated-block|다른 질문의 오래된 설명|unrelated-flow/);
			} else {
				assert.match(request.prompt, /unrelated-block/);
				assert.match(request.prompt, /unrelated-flow/);
			}
			return `Tutor 답변 ${tutorCalls}`;
		}
		const baseRevision = Number(/## 기준 revision\n(\d+)/.exec(request.prompt)?.[1]);
		return JSON.stringify({ baseRevision, noteDocument });
	};
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/scoped-tutor",
		runId: "scoped-tutor",
		agentRunner,
		questionBatchWindowMs: 0,
	});
	try {
		updateStudyHardStudio(handle.state.runId, { noteDocument, flows });
		let response = await fetch(new URL("/ask", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ scope: "note-block", noteBlockId: "selected-block", question: "이 블록만 설명해줘" }),
		});
		assert.equal(response.status, 202);
		await waitForStudyState(handle, (state) => state.questions.length === 1 && state.questions[0]?.processingStatus === "applied");

		response = await fetch(new URL("/ask", handle.url), {
			method: "POST",
			headers: authorizedHeaders(handle),
			body: JSON.stringify({ scope: "session", question: "전체 자료를 설명해줘" }),
		});
		assert.equal(response.status, 202);
		await waitForStudyState(handle, (state) => state.questions.length === 2 && state.questions.every((question: any) => question.processingStatus === "applied"));
		assert.equal(tutorCalls, 2);
	} finally {
		stopStudyHardStudios();
	}
});

test("persisted Q&A는 같은 session에서 중복하지 않고 새 session에는 summary 하나만 연결한다", async () => {
	const runId = "transcript-backfill";
	const firstMessages: Array<{ message: any; options: any }> = [];
	const firstPi = {
		sendMessage(message: any, options: any) { firstMessages.push({ message, options }); },
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
	const branch = firstMessages.map(({ message }) => ({ type: "custom_message", customType: message.customType, details: message.details }));
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
		assert.equal(newSessionMessages[0]?.options.triggerTurn, false);
		assert.equal(newSessionMessages[0]?.options.deliverAs, "followUp");
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
		assert.ok(messages.every(({ message, options }) => message.display === true && options.triggerTurn === false));
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

test("Editor의 partial state patch를 거부해 기존 노드와 노트를 보존하고 재처리할 수 있다", async () => {
	let editorCalls = 0;
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const agentRunner = async (request: any): Promise<string> => {
		if (request.role === "tutor") return "Tutor의 정상 답변";
		editorCalls += 1;
		const baseRevision = Number(/## 기준 revision\n(\d+)/.exec(request.prompt)?.[1]);
		if (editorCalls === 1) return JSON.stringify({
			baseRevision,
			noteDocument: { title: "Retry Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "적용되면 안 되는 노트" }] }] },
			nodes: [{ id: "goal" }],
		});
		return JSON.stringify({
			baseRevision,
			noteDocument: { title: "Retry Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "재시도 뒤 한 번만 반영" }] }] },
		});
	};
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/editor-retry",
		runId: "editor-retry",
		agentRunner,
		questionBatchWindowMs: 0,
	});
	try {
		updateStudyHardStudio(handle.state.runId, {
			noteDocument: { title: "Retry Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "원래 노트" }] }] },
			nodes: handle.state.nodes.map((node) => node.id === "goal" ? { ...node, status: "understood", summary: "보존해야 하는 목표 설명" } : node),
		});
		let response = await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "실패 뒤 재시도할 수 있어?" }) });
		assert.equal(response.status, 202);
		let state = await waitForStudyState(handle, (candidate) => candidate.questions[0]?.processingStatus === "failed");
		assert.equal(state.noteDocument.sections[0].blocks[0].text, "원래 노트");
		assert.equal(state.nodes.find((node: any) => node.id === "goal")?.status, "understood");
		assert.equal(state.nodes.find((node: any) => node.id === "goal")?.summary, "보존해야 하는 목표 설명");
		assert.equal(state.questions[0].feedback, "Tutor의 정상 답변");
		assert.match(state.questions[0].processingError, /noteDocument 외 상태.*nodes/);

		response = await fetch(new URL("/questions/retry", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ questionId: state.questions[0].id }) });
		assert.equal(response.status, 202);
		state = await waitForStudyState(handle, (candidate) => candidate.questions[0]?.processingStatus === "applied");
		assert.equal(state.noteDocument.sections[0].blocks[0].text, "재시도 뒤 한 번만 반영");
		assert.equal(editorCalls, 2);
	} finally {
		stopStudyHardStudios();
	}
});

test("Editor 실행 중 노트가 바뀌면 최신 semantic snapshot으로 한 번 재실행한다", async () => {
	let editorCalls = 0;
	let handle: any;
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const agentRunner = async (request: any): Promise<string> => {
		if (request.role === "tutor") return "동시 변경을 고려한 Tutor 답변";
		editorCalls += 1;
		const baseRevision = Number(/## 기준 revision\n(\d+)/.exec(request.prompt)?.[1]);
		if (editorCalls === 1) {
			updateStudyHardStudio(handle.state.runId, { noteDocument: { title: "Stale Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "사용자가 동시에 고친 설명" }] }] } });
			return JSON.stringify({ baseRevision, noteDocument: { title: "Stale Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "오래된 Editor 결과" }] }] } });
		}
		return JSON.stringify({ baseRevision, noteDocument: { title: "Stale Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "사용자 설명을 보존하고 Tutor 답변을 병합" }] }] } });
	};
	handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/editor-stale",
		runId: "editor-stale",
		agentRunner,
		questionBatchWindowMs: 0,
	});
	try {
		updateStudyHardStudio(handle.state.runId, { noteDocument: { title: "Stale Note", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "처음 설명" }] }] } });
		const response = await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "동시 변경도 보존해줘" }) });
		assert.equal(response.status, 202);
		const state = await waitForStudyState(handle, (candidate) => candidate.questions[0]?.processingStatus === "applied");
		assert.equal(editorCalls, 2);
		assert.equal(state.noteDocument.sections[0].blocks[0].text, "사용자 설명을 보존하고 Tutor 답변을 병합");
	} finally {
		stopStudyHardStudios();
	}
});

test("Studio를 닫으면 실행 중인 Tutor signal을 취소한다", async () => {
	let startedResolve!: () => void;
	const started = new Promise<void>((resolve) => { startedResolve = resolve; });
	let aborted = false;
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const agentRunner = async (request: any): Promise<string> => {
		assert.equal(request.role, "tutor");
		startedResolve();
		return new Promise<string>((_resolve, reject) => {
			request.signal.addEventListener("abort", () => {
				aborted = true;
				reject(new Error("aborted by test"));
			}, { once: true });
		});
	};
	const handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/abort-tutor",
		runId: "abort-tutor",
		agentRunner,
		questionBatchWindowMs: 0,
	});
	await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "오래 걸리는 질문" }) });
	await started;
	stopStudyHardStudios();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(aborted, true);
});

test("Studio 재시작은 중단된 질문을 queued 상태로 복구해 다시 처리한다", async () => {
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	const runId = "resume-interrupted-question";
	let handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/resume-question",
		runId,
		questionBatchWindowMs: 60_000,
		agentRunner: async () => { throw new Error("first runtime must stop before agent execution"); },
	});
	updateStudyHardStudio(runId, { noteDocument: { title: "Resume Question", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "중단 전" }] }] } });
	let response = await fetch(new URL("/ask", handle.url), { method: "POST", headers: authorizedHeaders(handle), body: JSON.stringify({ scope: "session", question: "재시작해도 이어져?" }) });
	assert.equal(response.status, 202);
	let state = await fetch(new URL("/state", handle.url)).then((result) => result.json() as Promise<any>);
	assert.equal(state.questions[0].processingStatus, "queued");
	updateStudyHardStudio(runId, {
		questions: [...state.questions, { id: "Q002", origin: "learner", scope: "session", question: "구버전 무상태 질문도 이어져?", status: "open" }],
	});
	stopStudyHardStudios();

	let tutorCalls = 0;
	let editorCalls = 0;
	const agentRunner = async (request: any): Promise<string> => {
		if (request.role === "tutor") {
			tutorCalls += 1;
			return "재시작 뒤 Tutor 답변";
		}
		editorCalls += 1;
		const baseRevision = Number(/## 기준 revision\n(\d+)/.exec(request.prompt)?.[1]);
		return JSON.stringify({ baseRevision, noteDocument: { title: "Resume Question", sections: [{ id: "overview", kind: "overview", title: "Overview", blocks: [{ id: "lead", type: "paragraph", text: "재시작 뒤 병합 완료" }] }] } });
	};
	handle = await startStudyHardStudio(fakePi, { hasUI: false, cwd: "/tmp/study-hard" } as any, {
		url: "https://example.com/resume-question",
		runId,
		questionBatchWindowMs: 0,
		agentRunner,
	});
	try {
		state = await waitForStudyState(handle, (candidate) => candidate.questions.length === 2 && candidate.questions.every((question: any) => question.processingStatus === "applied"));
		assert.equal(tutorCalls, 2);
		assert.equal(editorCalls, 1);
		assert.equal(state.noteDocument.sections[0].blocks[0].text, "재시작 뒤 병합 완료");
	} finally {
		stopStudyHardStudios();
	}
});
