import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { localPath, readPreview } from "./files.ts";

test("공백·괄호·한글 경로를 같은 로컬 파일로 연다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const path = join(dir, "한글 (초안).md");
	await writeFile(path, "# 제목\n\n- 항목\n");
	// when
	const files = await Promise.all([readPreview(path, dir), readPreview("./한글%20(초안).md", dir), readPreview(pathToFileURL(path).href, dir)]);
	// then
	const canonical = await realpath(path);
	assert.ok(files.every((file) => file.path === canonical && file.markdown && file.display.includes("# 제목")));
	assert.equal(localPath("https://example.org/report.md", dir), undefined);
	assert.equal(localPath("file://remote/report.md", dir), undefined);
	assert.equal(localPath("./bad%00.md", dir), undefined);
});

test("SQL 미리보기는 원문을 보존하고 실행하지 않는다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const path = join(dir, "report.sql");
	const source = "DROP TABLE example;\r\nSELECT '한글';\n\x1b]52;c;ZXZpbA==\x07\x1b[31m색상\x1b[0m";
	await writeFile(path, source);
	// when
	const file = await readPreview(path, dir);
	// then
	assert.equal(file.original, source);
	assert.equal(await readFile(path, "utf8"), source);
	assert.equal(file.display, "DROP TABLE example;\nSELECT '한글';\n색상");
	assert.equal(file.markdown, false);
});

test("디렉터리·바이너리·큰 파일·없는 경로는 거부한다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await mkdir(join(dir, "folder"));
	await writeFile(join(dir, "binary"), Buffer.from([0xff, 0x00]));
	await writeFile(join(dir, "huge"), Buffer.alloc(1024 * 1024 + 1, 65));
	// when / then
	for (const name of ["folder", "binary", "huge", "missing"]) await assert.rejects(readPreview(name, dir));
});

test("인코딩된 #는 파일명으로 보존하고 뒤의 문서 fragment만 제거한다", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "preview-fragment-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "notes#1.md"), "# 결과");
	const file = await readPreview("notes%231.md#section", dir);
	assert.equal(file.path, await realpath(join(dir, "notes#1.md")));
	assert.equal(file.original, "# 결과");
});

test("심볼릭 링크는 실제 일반 파일을 읽는다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "source.sql"), "SELECT 1;");
	await symlink(join(dir, "source.sql"), join(dir, "alias.sql"));
	// when
	const file = await readPreview("alias.sql", dir);
	// then
	assert.equal(file.path, await realpath(join(dir, "source.sql")));
	assert.equal(file.original, "SELECT 1;");
});
