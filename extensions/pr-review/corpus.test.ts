import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { importPrReviewCorpus, parseCasebook, searchPrReviewCorpus } from "./corpus.ts";

const CASEBOOK = `# 사례집

## Product

## 4. 강한 메타 리뷰 사례

| 사례 | 근거 | 판단 |
|---|---|---|
| [#10](https://github.com/acme/product/pull/10) · [댓글](https://github.com/acme/product/pull/10#discussion_r10) | 상태 allowlist가 필요 | 새 enum 상태가 자동 노출되지 않도록 focused test를 추가한다 |

## 5. 부분적 메타 리뷰 사례

| 사례 | 관찰 |
|---|---|
| [#11](https://github.com/acme/product/pull/11#discussion_r11) | 이름이 비슷하지만 전역 lint 근거는 부족하다 |

## 6. 시스템화하면 과한 반례

| 반례 | 근거 | 적절한 처리 |
|---|---|---|
| [#12 상태 allowlist lint](https://github.com/acme/product/pull/12#discussion_r12) | enum 상태 분기 한 건만으로 전역 allowlist lint를 만들지 않는다 | 반복 증거를 기다린다 |

## Frontend

## 3. 강한 메타 리뷰 사례 (1개)

| # | PR · 근거 | 판단 |
|---:|---|---|
| 1 | [#20](https://github.com/acme/frontend/pull/20#discussion_r20) | 상태 계약을 타입으로 고정한다 |

## 5. 시스템화하면 과한 반례

### 1) 중복 UI면 무조건 공통화하지 않는다

- 근거: [#21](https://github.com/acme/frontend/pull/21#discussion_r21)
- variation 축이 안정되기 전에는 현재 화면으로 닫는다.
`;

test("parseCasebook keeps provisional supporting and contrasting lanes", () => {
	const cases = parseCasebook(CASEBOOK);
	assert.equal(cases.length, 5);
	assert.equal(cases.filter((item) => item.kind === "strong").length, 2);
	assert.equal(cases.filter((item) => item.kind === "partial").length, 1);
	assert.equal(cases.filter((item) => item.kind === "counterexample").length, 2);
	assert.ok(cases.every((item) => item.annotationStatus === "machine-draft"));
	assert.ok(cases.filter((item) => item.kind === "counterexample").every((item) => item.lane === "contrasting"));
});

test("corpus import writes canonical JSONL, manifest and searchable SQLite FTS index", () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-pr-review-corpus-"));
	try {
		const eventsPath = join(root, "events.json");
		const casebookPath = join(root, "casebook.md");
		const outputDir = join(root, "corpus");
		writeFileSync(eventsPath, JSON.stringify([
			{
				repo: "product",
				pr_number: 1,
				pr_title: "상태 노출 계약",
				reviewer: "human-a",
				path: "src/status.ts",
				url: "https://github.com/acme/product/pull/1#discussion_r1",
				excerpt: "새 enum 상태가 자동 노출되지 않도록 allowlist를 사용해주세요",
				is_empty: false,
				is_trivial: false
			},
			{
				repo: "frontend",
				pr_number: 2,
				pr_title: "상태 표시",
				reviewer: "human-b",
				path: "ui/status.tsx",
				url: "https://github.com/acme/frontend/pull/2#discussion_r2",
				excerpt: "상태 타입과 UI consumer 계약을 같이 확인해주세요",
				is_empty: false,
				is_trivial: false
			},
			{
				repo: "product",
				pr_number: 3,
				excerpt: "LGTM",
				is_empty: false,
				is_trivial: true
			}
		]), "utf8");
		writeFileSync(casebookPath, CASEBOOK, "utf8");
		const manifest = importPrReviewCorpus({ id: "acme-human-reviews", eventsPath, casebookPath, outputDir, now: 1234 });
		assert.equal(manifest.eventCount, 3);
		assert.equal(manifest.meaningfulEventCount, 2);
		assert.equal(manifest.caseCount, 5);
		assert.equal(readFileSync(join(outputDir, "events.jsonl"), "utf8").trim().split("\n").length, 3);
		assert.equal(readFileSync(join(outputDir, "cases.jsonl"), "utf8").trim().split("\n").length, 5);

		const result = searchPrReviewCorpus(
			{ id: "acme-human-reviews", corpusDir: outputDir, repositories: ["acme/product", "acme/frontend"] },
			{ repository: "acme/product", query: "enum 상태 자동 노출 allowlist", paths: ["src/status.ts"] },
		);
		assert.equal(result.coverage.events, 2);
		assert.equal(result.coverage.cases, 5);
		assert.ok(result.supporting.length >= 1);
		assert.equal(result.supporting[0]?.repo, "product");
		assert.ok(result.contrasting.some((item) => item.url?.includes("discussion_r12")));
		assert.ok(result.crossRepo.some((item) => item.repo === "frontend"));
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
