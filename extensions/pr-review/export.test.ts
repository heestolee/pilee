import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMetaReviewNoteDocument } from "./export.ts";

test("Meta Review export model은 overview·관계·의미·finding·전체 설명 줄·질문을 한 문서에 보존한다", () => {
	const document = buildMetaReviewNoteDocument({
		run: {
			runId: "review-run-1",
			status: "ready",
			target: { kind: "github-pr", url: "https://github.com/acme/repo/pull/42", owner: "acme", repo: "repo", number: 42, title: "Visibility contract", headSha: "head1234567890" },
			updatedAt: 2000,
			revisionNumber: 2,
			revisionMode: "incremental",
		},
		source: {
			sourceSha256: "source-hash",
			stats: { files: 1, additions: 2, deletions: 1, changedRows: 3 },
			files: [{
				id: "F001",
				path: "src/policy.ts",
				status: "modified",
				additions: 2,
				deletions: 1,
				binary: false,
				lines: [
					{ id: "D001", kind: "deletion", text: "  return status !== 'HIDDEN';", oldLine: 2 },
					{ id: "D002", kind: "addition", text: "  const allowed = new Set(['OPEN']);", newLine: 2 },
					{ id: "D003", kind: "addition", text: "  return allowed.has(status);", newLine: 3 },
				],
			}],
		},
		inspection: { inspected: 1, total: 1, pending: [] },
		document: {
			overview: { summary: "노출 정책을 allowlist로 좁힙니다.", reviewFocus: "consumer 계약" },
			relationships: {
				summary: "policy가 노출 여부를 결정합니다.",
				diagram: "flowchart",
				relations: [{ from: "consumer.ts", to: "policy.ts", label: "노출 여부 조회" }],
				readingOrder: [{ path: "src/policy.ts", reason: "정책부터 읽습니다." }],
			},
			meanings: [{ id: "M-01", title: "노출 계약 명시", beforeContract: "숨김 외 상태 노출", afterContract: "허용 상태만 노출", mechanism: "allowlist", impact: "신규 상태 자동 노출 차단", paths: ["src/policy.ts"], evidenceIds: ["D001", "D002", "D003"], basis: [{ kind: "definition", path: "src/policy.ts", line: 2, summary: "정책 정의" }], confidence: "high" }],
		},
		guides: [{
			path: "src/policy.ts",
			role: "노출 정책 소유",
			changeReason: "신규 상태 자동 노출 차단",
			flow: "consumer → policy",
			impact: "OPEN만 노출",
			hunks: [{ id: "E-01", title: "allowlist 전환", evidenceIds: ["D001", "D002", "D003"], whatChanged: "부정 조건을 Set으로 변경", why: "명시적 계약", evidence: "세 변경 줄", responsibility: "policy", concepts: ["allowlist"], flowImpact: "consumer 결과 제한", status: "new" }],
		}],
		explanationCoverage: { filesExplained: 1, totalFiles: 1, changedLinesExplained: 3, totalChangedLines: 3, missingEvidenceIds: [], duplicateEvidenceIds: [] },
		cards: [{
			id: "R-01",
			title: "consumer 상태 확인",
			strength: "question",
			confidence: "medium",
			evidenceIds: ["D001"],
			reviewDraft: "기존 호출자가 의도적으로 제외되는지 확인해주세요.",
			explanation: "consumer 계약에 영향이 있습니다.",
			meta: { summary: "contract test 후보", scope: "current-pr" },
			code: { path: "src/policy.ts", language: "typescript", startLine: 2, endLine: 3, text: "return status !== 'HIDDEN';" },
			decision: "review-only",
		}],
		series: undefined,
		freshness: { status: "current", revision: 2, mode: "incremental", headSha: "head1234567890" },
		questions: [{
			id: "Q001",
			runId: "review-run-1",
			question: "왜 allowlist인가?",
			scope: "session",
			status: "answered",
			answer: "신규 상태의 자동 노출을 막기 위해서입니다.",
			createdAt: 1000,
			updatedAt: 1100,
		}],
	} as any);

	assert.equal(document.title, "Meta Review · #42 Visibility contract");
	assert.deepEqual(document.sections.map((section) => section.id), [
		"meta-review-overview",
		"meta-review-relationships",
		"meta-review-meanings",
		"meta-review-findings",
		"meta-review-file-1",
		"meta-review-questions",
	]);
	const serialized = JSON.stringify(document);
	for (const expected of [
		"consumer 계약",
		"노출 여부 조회",
		"Before 계약",
		"실제 리뷰 포인트",
		"기존 호출자가 의도적으로 제외되는지 확인해주세요.",
		"-    2 |   return status !== 'HIDDEN';",
		"+    2 |   const allowed = new Set(['OPEN']);",
		"+    3 |   return allowed.has(status);",
		"왜 allowlist인가?",
		"신규 상태의 자동 노출을 막기 위해서입니다.",
	]) assert.match(serialized, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
