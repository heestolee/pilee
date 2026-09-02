import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import {
	buildMetaReviewLivePayload,
	buildMetaReviewStandaloneHtml,
	META_REVIEW_DOCUMENT_CSS,
	META_REVIEW_MERMAID_CONFIG,
	renderMetaReviewDocument,
} from "./document-renderer.ts";

function fixtureState(): any {
	return {
		run: {
			runId: "review-run-1",
			status: "ready",
			target: {
				kind: "github-pr",
				url: "https://github.com/acme/repo/pull/42",
				owner: "acme",
				repo: "repo",
				number: 42,
				title: "Visibility contract",
				body: "상태 노출 정책을 명시합니다.",
				headSha: "head1234567890",
			},
			updatedAt: 2_000,
			revisionNumber: 3,
			revisionMode: "incremental",
		},
		source: {
			sourceSha256: "source-hash",
			stats: { files: 3, hunks: 3, additions: 3, deletions: 1, changedRows: 4, physicalLines: 12, bytes: 500, chunks: 1 },
			files: [
				{
					id: "F001",
					path: "src/first.ts",
					status: "modified",
					additions: 1,
					deletions: 1,
					binary: false,
					lines: [
						{ id: "D001", kind: "deletion", text: "-legacy();", oldLine: 2 },
						{ id: "D002", kind: "addition", text: "+policy();", newLine: 2 },
					],
				},
				{
					id: "F002",
					path: "src/second.ts",
					status: "modified",
					additions: 1,
					deletions: 0,
					binary: false,
					lines: [{ id: "D003", kind: "addition", text: "+consume();", newLine: 8 }],
				},
				{
					id: "F003",
					path: "src/unlisted.ts",
					status: "added",
					additions: 1,
					deletions: 0,
					binary: false,
					lines: [{ id: "D004", kind: "addition", text: "+fallback();", newLine: 1 }],
				},
			],
		},
		inspection: { inspected: 1, total: 1, pending: [] },
		document: {
			overview: { summary: "노출 정책을 allowlist로 좁힙니다.", reviewFocus: "consumer 계약" },
			relationships: {
				summary: "consumer에서 policy로 흐릅니다.",
				diagram: "flowchart",
				relations: [{ from: "src/second.ts", to: "src/first.ts", label: "노출 정책 조회" }],
				readingOrder: [
					{ path: "src/second.ts", reason: "consumer를 먼저 확인합니다." },
					{ path: "src/first.ts", reason: "producer 계약으로 돌아갑니다." },
				],
			},
			meanings: [{
				id: "M-contract",
				title: "암묵적 허용을 명시적 계약으로 전환",
				beforeContract: "숨김 외 상태를 노출",
				afterContract: "허용 상태만 노출",
				mechanism: "policy allowlist",
				impact: "신규 상태 자동 노출 차단",
				paths: ["src/first.ts", "src/second.ts"],
				evidenceIds: ["D001", "D002", "D003"],
				basis: [{ kind: "definition", path: "src/first.ts", line: 2, summary: "정책 정의" }],
				confidence: "high",
				visual: {
					kind: "flowchart",
					title: "계약 전환",
					readingHint: "왼쪽 기존 계약에서 오른쪽 새 계약으로 읽습니다.",
					groups: [{ id: "before", label: "기존", phase: "before" }, { id: "after", label: "신규", phase: "after" }],
					nodes: [{ id: "legacy", label: "암묵적 허용", role: "removed", groupId: "before" }, { id: "policy", label: "allowlist", role: "new", groupId: "after" }],
					edges: [{ from: "legacy", to: "policy", label: "계약 전환", role: "moved" }],
				},
			}],
		},
		guides: [
			{ path: "src/first.ts", role: "정책 소유", changeReason: "허용 상태를 명시합니다.", flow: "consumer → policy", impact: "노출 범위 축소", hunks: [{ id: "E-01", title: "allowlist 전환", evidenceIds: ["D001", "D002"], whatChanged: "부정 조건을 allowlist로 변경", why: "자동 노출 방지", evidence: "삭제·추가 줄", responsibility: "정책 소유", concepts: ["allowlist"], flowImpact: "consumer 결과 제한", status: "new" }] },
			{ path: "src/second.ts", role: "정책 소비", changeReason: "새 계약을 소비합니다.", flow: "UI → consumer", impact: "표시 결과 변경", hunks: [{ id: "E-02", title: "consumer 연결", evidenceIds: ["D003"], whatChanged: "policy 호출 추가", why: "계약 적용", evidence: "추가 줄", responsibility: "consumer", flowImpact: "UI 전달", status: "new" }] },
			{ path: "src/unlisted.ts", role: "fallback", changeReason: "보조 경로입니다.", flow: "fallback", impact: "직접 영향 없음", hunks: [{ id: "E-03", title: "fallback 추가", evidenceIds: ["D004"], whatChanged: "fallback 추가", why: "보조", evidence: "추가 줄", responsibility: "fallback", flowImpact: "없음", status: "new" }] },
		],
		explanationCoverage: { filesExplained: 3, totalFiles: 3, changedLinesExplained: 4, totalChangedLines: 4, missingEvidenceIds: [], duplicateEvidenceIds: [] },
		cards: [{
			id: "R-01",
			title: "consumer 상태 확인",
			strength: "question",
			confidence: "medium",
			evidenceIds: ["D003"],
			reviewDraft: "기존 호출자가 제외되는지 확인해주세요.",
			explanation: "consumer 계약에 영향이 있습니다.",
			meta: { summary: "contract test 후보", scope: "current-pr" },
			code: { path: "src/second.ts", language: "typescript", startLine: 8, endLine: 8, text: "consume();" },
			decision: "review-only",
			precedents: [{ id: "P-01", url: "https://example.com/review", label: "선행 리뷰", similarity: "같은 계약" }],
		}],
		series: { seriesId: "series-1", revisions: [] },
		freshness: { status: "current", revision: 3, mode: "incremental", headSha: "head1234567890" },
		questions: [{
			id: "Q-01",
			runId: "run-1",
			question: "왜 allowlist인가?",
			scope: "declaration",
			filePath: "src/first.ts",
			selection: { kind: "declaration", id: "D001", label: "함수 · policy · 변경 후 L2–L4" },
			status: "answered",
			workerRunId: 91,
			answer: "새 상태가 자동으로 노출되지 않게 하기 위해서입니다.",
			uncertainty: "legacy consumer는 추가 확인이 필요합니다.",
			evidence: [{ label: "정책 정의", path: "src/first.ts", line: 2 }],
			change: { status: "applied-with-validation-failure", files: ["src/first.ts"], validation: [{ command: "node --test policy.test.ts", status: "failed" }], refreshedRunId: "run-2", refreshMode: "incremental", refreshError: "review refresh failed" },
			createdAt: 100,
			updatedAt: 200,
		}, {
			id: "Q-02",
			runId: "run-1",
			question: "실패한 질문인가?",
			scope: "session",
			status: "failed",
			error: "worker artifact를 읽지 못했습니다.",
			createdAt: 300,
			updatedAt: 400,
		}],
	};
}

function coreOutline(html: string): string[] {
	const { document } = parseHTML(`<article id="root">${html}</article>`);
	return [...document.querySelectorAll("#root .reviewMain > section")].map((element) => `${element.id}:${element.className}`);
}

function fileOrder(html: string): string[] {
	const { document } = parseHTML(`<article id="root">${html}</article>`);
	return [...document.querySelectorAll("#root [data-review-file-section]")].map((element) => element.getAttribute("data-review-path") || "");
}

test("live와 static Meta Review는 같은 pure document hierarchy와 authored file order를 쓴다", () => {
	const state = fixtureState();
	const before = structuredClone(state);
	const live = renderMetaReviewDocument(state, { mode: "live" });
	const standalone = buildMetaReviewStandaloneHtml(state);
	const { document } = parseHTML(standalone);
	const staticDocument = document.getElementById("metaReviewDocument")?.innerHTML || "";

	assert.deepEqual(coreOutline(live), [
		"reviewOverview:reviewOverview reviewSelectable",
		"reviewRelationships:reviewRelationshipSection reviewSelectable",
		"reviewMeanings:reviewMeaningsSection",
		"reviewAttention:reviewFindingsSection",
		":reviewFiles",
	]);
	assert.deepEqual(coreOutline(staticDocument).map((item) => item.replaceAll(" reviewSelectable", "")), coreOutline(live).map((item) => item.replaceAll(" reviewSelectable", "")));
	assert.deepEqual(fileOrder(live), ["src/second.ts", "src/first.ts", "src/unlisted.ts"]);
	assert.deepEqual(fileOrder(staticDocument), ["src/second.ts", "src/first.ts", "src/unlisted.ts"]);
	assert.deepEqual([...document.querySelectorAll("[data-reading-file]")].map((item) => item.getAttribute("data-reading-file")), ["F002", "F001", "F003"]);
	assert.deepEqual(state, before, "renderer는 canonical client snapshot을 변경하지 않는다");
});

test("live payload와 standalone은 같은 renderer CSS 계약을 공유한다", () => {
	const state = fixtureState();
	const payload = buildMetaReviewLivePayload(state);
	const standalone = buildMetaReviewStandaloneHtml(state);
	assert.equal(payload.documentHtml, renderMetaReviewDocument(state, { mode: "live" }));
	assert.equal((standalone.match(new RegExp(META_REVIEW_DOCUMENT_CSS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1);
	assert.deepEqual(META_REVIEW_MERMAID_CONFIG, { startOnLoad: false, theme: "base", securityLevel: "strict" });
	assert.equal((payload as Record<string, unknown>).capabilityToken, undefined);
});

test("standalone HTML은 read-only 결정만 남기고 server mutation/state transport를 포함하지 않는다", () => {
	const html = buildMetaReviewStandaloneHtml(fixtureState());
	assert.match(html, /review-only/);
	assert.match(html, /질문과 답변/);
	assert.match(html, /왜 allowlist인가\?/);
	assert.match(html, /새 상태가 자동으로 노출되지 않게 하기 위해서입니다/);
	assert.match(html, /함수 · policy · 변경 후 L2–L4/);
	assert.match(html, /worker #91/);
	assert.match(html, /로컬 변경 · applied-with-validation-failure/);
	assert.match(html, /파일 · src\/first\.ts/);
	assert.match(html, /리뷰 갱신 · run-2 · incremental/);
	assert.match(html, /미확인 · legacy consumer는 추가 확인이 필요합니다/);
	assert.match(html, /실패한 검증 · node --test policy\.test\.ts/);
	assert.match(html, /갱신 오류 · review refresh failed/);
	assert.match(html, /처리 오류 · worker artifact를 읽지 못했습니다/);
	for (const forbidden of [
		/data-review-decision/,
		/data-review-draft/,
		/<textarea/i,
		/fetch\s*\(/,
		/\/meta-review\//,
		/capabilityToken/,
		/token=/i,
		/outerHTML/,
		/cloneNode/,
		/documentHtml/,
		/exportReadingRail/,
	]) assert.doesNotMatch(html, forbidden);
	assert.match(html, /class="reviewReadingRail"/);
	assert.match(html, /class="reviewLayout"/);
});

test("renderer는 악성 text·attribute·URL 값을 실행 가능한 markup으로 내보내지 않는다", () => {
	const state = fixtureState();
	state.run.target.title = `</title><script>globalThis.pwned=true</script>`;
	state.source.files[0].path = `src/x\" onmouseover=\"globalThis.pwned=true.ts`;
	state.guides[0].path = state.source.files[0].path;
	state.document.relationships.readingOrder[1].path = state.source.files[0].path;
	state.cards[0].reviewDraft = `<img src=x onerror=globalThis.pwned=true>`;
	state.cards[0].editedReviewDraft = `<script>globalThis.pwned=true</script>`;
	state.cards[0].precedents[0].url = "javascript:globalThis.pwned=true";
	const html = buildMetaReviewStandaloneHtml(state);

	assert.doesNotMatch(html, /<script>globalThis\.pwned/);
	assert.doesNotMatch(html, /<img src=x/);
	assert.doesNotMatch(html, /javascript:globalThis/);
	assert.doesNotMatch(html, /onmouseover="globalThis/);
	assert.match(html, /&lt;script&gt;globalThis\.pwned=true&lt;\/script&gt;/);
	for (const script of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1] || "").filter((source) => source.trim())) {
		assert.doesNotThrow(() => new Function(script));
	}
});

test("관계와 변경 의미 Mermaid는 공통 renderer의 authored order와 역할 표현을 따른다", () => {
	const state = fixtureState();
	const relationshipDocument = parseHTML(renderMetaReviewDocument(state, { mode: "live" })).document;
	const relationshipSource = decodeURIComponent(relationshipDocument.querySelector(".reviewRelationshipDiagram")?.getAttribute("data-mermaid-source") || "");
	assert.match(relationshipSource, /^flowchart LR/m);
	assert.match(relationshipSource, /F1\["01 · second\.ts"\]/);
	assert.match(relationshipSource, /F2\["02 · first\.ts"\]/);
	assert.match(relationshipSource, /F1 -->\|노출 정책 조회\| F2/);
	const meaningSource = decodeURIComponent(relationshipDocument.querySelector(".reviewMeaningVisual [data-mermaid-source]")?.getAttribute("data-mermaid-source") || "");
	assert.match(meaningSource, /subgraph G1\["BEFORE · 기존"\]/);
	assert.match(meaningSource, /class N1 role_removed/);
	assert.match(meaningSource, /classDef role_moved/);
	assert.equal(relationshipDocument.querySelector(".reviewMeaningVisualExpand")?.textContent, "확대해서 보기");

	state.document.relationships.diagram = "sequence";
	state.document.meanings[0].visual = {
		kind: "sequence",
		title: "호출 전환",
		readingHint: "관리자에서 서버까지 읽습니다.",
		actors: [{ id: "admin", label: "관리자", role: "context" }, { id: "server", label: "서버", role: "guard" }],
		messages: [{ from: "server", to: "admin", label: "충돌 refetch", role: "guard", style: "dashed", note: "최신 snapshot" }],
	};
	const sequenceDocument = parseHTML(renderMetaReviewDocument(state, { mode: "live" })).document;
	const relationshipSequence = decodeURIComponent(sequenceDocument.querySelector(".reviewRelationshipDiagram")?.getAttribute("data-mermaid-source") || "");
	assert.match(relationshipSequence, /^sequenceDiagram/m);
	assert.match(relationshipSequence, /participant F1 as 01 · second\.ts/);
	assert.match(relationshipSequence, /F1->>F2: 노출 정책 조회/);
	const meaningSequence = decodeURIComponent(sequenceDocument.querySelector(".reviewMeaningVisual [data-mermaid-source]")?.getAttribute("data-mermaid-source") || "");
	assert.match(meaningSequence, /rect rgb\(255,242,217\)/);
	assert.match(meaningSequence, /A2-->>A1: 충돌 refetch/);
	assert.match(meaningSequence, /Note over A2,A1: 최신 snapshot/);
});

test("설명 range와 live 선택 단위는 생성된 diff DOM에서 직접 보존된다", () => {
	const state = fixtureState();
	const first = state.source.files[0];
	first.lines = [
		{ id: "D001", kind: "deletion", text: "-oldA", oldLine: 8 },
		{ id: "D002", kind: "deletion", text: "-oldB", oldLine: 9 },
		{ id: "D005", kind: "addition", text: "+newA", newLine: 8 },
		{ id: "D006", kind: "addition", text: "+newB", newLine: 9 },
		{ id: "D007", kind: "addition", text: "+newC", newLine: 13 },
		{ id: "D008", kind: "context", text: " unchanged", oldLine: 14, newLine: 14 },
	];
	state.guides[0].hunks[0].evidenceIds = ["D001", "D002", "D005", "D006", "D007"];
	first.declarationSource = {
		before: { text: "\nfunction policy() {\n  oldA\n  oldB\n}\n" },
		after: { text: "\nfunction policy() {\n  const value = true\n  return value\n}\n" },
		declarations: [
			{ id: "A-file", kind: "file", name: "first.ts", depth: 0, before: { startLine: 1, endLine: 20 }, after: { startLine: 1, endLine: 20 }, evidenceIds: [] },
			{ id: "A-function", kind: "function", name: "policy", depth: 1, parentId: "A-file", before: { startLine: 2, endLine: 14 }, after: { startLine: 2, endLine: 14 }, evidenceIds: ["D001", "D002", "D005", "D006", "D007"] },
			{ id: "A-local", kind: "variable", name: "value", depth: 2, parentId: "A-function", after: { startLine: 8, endLine: 8 }, evidenceIds: ["D005"] },
		],
	};
	const { document } = parseHTML(renderMetaReviewDocument(state, { mode: "live" }));
	assert.equal(document.querySelector('[data-review-file-section="F001"] .reviewExplanationRange')?.textContent, "설명 범위 · 변경 전 L8–L9 · 변경 후 L8–L9 · L13");
	assert.equal(document.querySelector('[data-review-line="D005"]')?.getAttribute("data-review-select-kind"), "declaration");
	assert.equal(document.querySelector('[data-review-line="D005"]')?.getAttribute("data-review-declaration"), "A-local");
	assert.equal(document.querySelector('[data-review-line="D006"]')?.getAttribute("data-review-declaration"), "A-function");
	assert.equal(document.querySelector('[data-review-line="D003"]')?.getAttribute("data-review-select-kind"), "hunk");
	state.source.files[2].lines.push({ id: "D099", kind: "context", text: " unchanged", oldLine: 2, newLine: 2 });
	const fallbackDocument = parseHTML(renderMetaReviewDocument(state, { mode: "live" })).document;
	assert.equal(fallbackDocument.querySelector('[data-review-line="D099"]')?.getAttribute("data-review-select-kind"), "line");
});

test("standalone runtime은 file jump·details·reading progress와 Mermaid fallback을 로컬에서 처리한다", async () => {
	const html = buildMetaReviewStandaloneHtml(fixtureState());
	const { document, window } = parseHTML(html);
	(window as any).requestAnimationFrame = (callback: () => void) => callback();
	(window as any).scrollY = 0;
	(window as any).innerHeight = 800;
	(window as any).scrollTo = () => {};
	let scrolled = false;
	const firstFile = document.querySelector('[data-review-file-section="F002"]') as any;
	firstFile.scrollIntoView = () => { scrolled = true; };
	const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((match) => match[1] || "").filter((source) => source.trim());
	assert.ok(inlineScripts.length > 0);
	for (const script of inlineScripts) new Function("window", "document", "requestAnimationFrame", "setTimeout", script)(window, document, (window as any).requestAnimationFrame, (callback: () => void) => callback());
	await new Promise((resolve) => setTimeout(resolve, 0));

	const jump = document.querySelector('[data-review-file-jump="F002"]') as any;
	jump.dispatchEvent(new (window as any).Event("click", { bubbles: true, cancelable: true }));
	assert.equal(firstFile.open, true);
	assert.equal(scrolled, true);
	assert.equal(document.getElementById("reviewReadingProgress")?.textContent, "33% 읽음");
	assert.match(document.querySelector(".diagramFallback")?.textContent || "", /flowchart LR/);
	assert.ok(document.querySelector("details.reviewFile"), "파일 본문은 native details로 유지한다");
});
