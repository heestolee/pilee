import assert from "node:assert/strict";
import test from "node:test";
import { LinkCatalog } from "./links.ts";

test("Markdown 링크만 변환하고 코드블록·인라인 코드·HTTP 원문을 보존한다", () => {
	// given
	const source = [
		"[문서](<./한글 (1).md>) [SQL](./query.sql)",
		"[외부](https://example.org/report.md)",
		"`[가짜](./inline.sql)`",
		"```md\n[가짜](./fenced.md)\n```",
		"~~~sql\n[가짜](./tilde.sql)\n~~~",
		"    [가짜](./indented.md)",
		"![그림](./image.png)",
	].join("\n\n");
	const paths: string[] = [];
	const catalog = new LinkCatalog("/workspace", (path) => { paths.push(path); return "pilee-preview://test/cap"; });
	// when
	const result = catalog.transform(source);
	// then
	assert.deepEqual(paths, ["/workspace/한글 (1).md", "/workspace/query.sql"]);
	assert.match(result, /\[문서\]\(<pilee-preview:/u);
	for (const preserved of ["[외부](https://example.org/report.md)", "`[가짜](./inline.sql)`", "[가짜](./fenced.md)", "[가짜](./tilde.sql)", "[가짜](./indented.md)", "![그림](./image.png)"]) assert.ok(result.includes(preserved));
	assert.equal(source.includes("pilee-preview:"), false);
});

test("참조 링크와 이스케이프된 괄호를 세션 cwd 기준으로 발견한다", () => {
	// given
	const catalog = new LinkCatalog("/workspace", () => "pilee-preview://test/cap");
	const source = "[참조][report]\n\n[report]: ./report.md\n\n[괄호](./query\\(1\\).sql)\n\n[파일](file:///tmp/read%20me.md)";
	// when
	const result = catalog.transform(source);
	// then
	assert.deepEqual(catalog.list(), ["/workspace/report.md", "/workspace/query(1).sql", "/tmp/read me.md"]);
	assert.match(result, /\[참조\]\(<pilee-preview:/u);
});

test("helper가 없어도 기존 링크와 재발견 목록을 유지한다", () => {
	// given
	const source = "[보고서](./report.md)";
	const catalog = new LinkCatalog("/workspace");
	// when
	const first = catalog.transform(source);
	const second = catalog.transform(source);
	// then
	assert.equal(first, source);
	assert.equal(second, source);
	assert.deepEqual(catalog.list(), ["/workspace/report.md"]);
});
