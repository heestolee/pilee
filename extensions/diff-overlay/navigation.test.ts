import assert from "node:assert/strict";
import test from "node:test";
import { DiffOverlay } from "./index.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function createPanel(colors = theme) {
	const totals = { additions: 2, deletions: 1, binaryFiles: 0 };
	const files = ["a.ts", "b.ts", "c.ts"].map((path) => ({ path, status: "modified", rawStatus: "M", diffTotals: totals }));
	const state = {
		files: [], filesByScope: { branch: [], working: [], "last-commit": [] },
		totalsByScope: { branch: totals, working: totals, "last-commit": totals },
		scope: "branch", searchQuery: "", searchMode: false,
		selectedIndex: 0, selectedFilePath: null, fileScrollOffset: 0,
		treeNodes: [], expandedDirs: new Set(),
		diffCache: new Map(), highlightedDiffCache: new Map(), diffScrollMemory: new Map(), diffScrollOffset: 0,
		wrapLines: true, changedOnly: false, showFullFile: false, showHelp: false,
		reviewDrafts: [], reviewInput: { active: false },
		viewMode: "commit", focus: "right", branch: "feature/example", baseBranch: "main", baseSource: "test", error: null,
		commits: [{ hash: "abc123", shortHash: "abc123", author: "author", relativeDate: "now", subject: "fix: example" }],
		commitSelectedIndex: 0, commitScrollOffset: 0,
		commitFilesCache: new Map([["abc123", files]]), commitFilesLoading: new Set(),
		commitMessageCache: new Map([["abc123", "fix: example\n\nA decision."]]), commitMessageLoading: new Set(),
		commitMessageExpanded: false,
		commitExpandedByHash: new Map([["abc123", new Set(["a.ts"])]]),
		commitFileDiffCache: new Map([["abc123\0a.ts", "@@ -1 +1,2 @@\n-before\n+after\n+last-a"]]),
		commitFileDiffLoading: new Set(),
		commitFileSelectedIndex: 0, commitFileLineOffset: 0, commitFileScrollOffset: 0,
	} as any;
	const overlay = new DiffOverlay({} as any, "/repo", state, () => {});
	const tui = { requestRender() {}, terminal: { rows: 14 } };
	let width = 100;
	const render = () => overlay.render(width, tui.terminal.rows, colors);
	const press = (key: string) => { overlay.handleInput(key, tui); return render(); };
	const cursor = () => render().find((line) => line.includes("▶")) ?? "";
	const resize = (columns: number, rows: number) => { width = columns; tui.terminal.rows = rows; return render(); };
	render();
	return { state, overlay, tui, render, press, cursor, resize };
}

test("j/k로 파일 제목과 펼친 diff를 한 줄씩 연속 탐색한다", () => {
	// given
	const panel = createPanel();
	assert.match(panel.cursor(), /a\.ts/);

	// when
	const visited = [];
	for (let step = 0; step < 5; step++) {
		panel.press("j");
		visited.push(panel.cursor());
	}

	// then
	for (const [index, expected] of [/@@/, /-before/, /\+after/, /\+last-a/, /b\.ts/].entries()) {
		assert.match(visited[index], expected);
	}
	assert.match(panel.press("k").find((line) => line.includes("▶")) ?? "", /\+last-a/);
});

test("커밋 diff에서도 방향키는 10줄씩 이동한다", () => {
	// given
	const panel = createPanel();
	panel.state.commitFileDiffCache.set("abc123\0a.ts", "@@ -0,0 +1,30 @@\n" + Array.from({ length: 30 }, (_, i) => `+value-${i + 1}`).join("\n"));
	panel.render();

	// when
	panel.press("\u001b[B");
	const afterDown = panel.cursor();
	panel.press("j");
	const afterFineDown = panel.cursor();
	panel.press("k");
	panel.press("\u001b[B");
	const afterSecondDown = panel.cursor();
	panel.press("\u001b[A");
	const afterUp = panel.cursor();
	panel.press("\u001b[A");

	// then
	assert.match(afterDown, /value-9\b/);
	assert.match(afterFineDown, /value-10\b/);
	assert.match(afterSecondDown, /value-19\b/);
	assert.match(afterUp, /value-9\b/);
	assert.match(panel.cursor(), /a\.ts/);
});

test("방향키로 파일 경계를 넘어도 처음과 마지막 줄에서 멈춘다", () => {
	// given
	const panel = createPanel();
	panel.state.commitFileDiffCache.set("abc123\0a.ts", "@@ -0,0 +1,8 @@\n" + Array.from({ length: 8 }, (_, i) => `+value-${i + 1}`).join("\n"));
	panel.render();

	// when
	panel.press("\u001b[B");
	const nextFile = panel.cursor();
	panel.press("\u001b[A");
	const previousFile = panel.cursor();
	panel.press("\u001b[A");
	panel.press("\u001b[A");
	const top = panel.cursor();
	panel.press("G");
	panel.press("\u001b[B");

	// then
	assert.match(nextFile, /b\.ts/);
	assert.match(previousFile, /a\.ts/);
	assert.match(top, /CHANGED FILES/);
	assert.match(panel.cursor(), /c\.ts/);
});

test("j/k로 접힌 파일과 펼친 파일을 오가며 제목에서만 접고 펼친다", () => {
	// given
	const panel = createPanel();
	panel.press("\r");

	// when
	panel.press("j");
	const nextFile = panel.cursor();
	panel.press("k");
	panel.press("\r");
	panel.press("j");
	panel.press("\r");

	// then
	assert.match(nextFile, /b\.ts/);
	assert.match(panel.cursor(), /@@/);
	assert.match(panel.render().join("\n"), /\+after/);
	panel.press("k");
	panel.press("\r");
	assert.doesNotMatch(panel.render().join("\n"), /\+after/);
	assert.match(panel.cursor(), /a\.ts/);
});

test("줄바꿈된 긴 diff도 끝까지 이동한 뒤 위아래로 계속 탐색할 수 있다", () => {
	// given
	const panel = createPanel();
	panel.state.commitExpandedByHash.get("abc123").add("c.ts");
	panel.state.commitFileDiffCache.set("abc123\0c.ts", "@@ -0,0 +1 @@\n+" + "긴 내용 ".repeat(200) + "마지막표식");
	panel.resize(75, 16);

	// when
	panel.press("G");
	const bottom = panel.cursor();
	panel.press("k");
	const above = panel.cursor();
	panel.press("j");

	// then
	assert.match(bottom, /마지막표식/);
	assert.doesNotMatch(above, /마지막표식/);
	assert.match(panel.cursor(), /마지막표식/);
	assert.equal(panel.render().length, 16);
});

test("메시지 토글과 화면 폭 변경은 현재 탐색 중인 파일을 바꾸지 않는다", () => {
	// given
	const panel = createPanel();
	panel.press("G");
	assert.match(panel.cursor(), /c\.ts/);

	// when
	panel.press("m");
	panel.resize(70, 18);
	const expandedMessage = panel.cursor();
	panel.press("m");
	panel.press("w");

	// then
	assert.match(expandedMessage, /c\.ts/);
	assert.match(panel.cursor(), /c\.ts/);
	panel.press("k");
	assert.match(panel.cursor(), /b\.ts/);
});

test("페이지 이동 후에도 커서가 화면에 남고 역방향 탐색이 이어진다", () => {
	// given
	const panel = createPanel();
	panel.state.commitFileDiffCache.set("abc123\0a.ts", "@@ -0,0 +1,160 @@\n" + Array.from({ length: 160 }, (_, i) => `+value-${i + 1}`).join("\n"));
	panel.render();

	// when
	panel.press("i");
	const afterPage = panel.cursor();
	panel.press("k");
	const previous = panel.cursor();
	panel.press("u");

	// then
	assert.match(afterPage, /value-99\b/);
	assert.match(previous, /value-98\b/);
	assert.match(panel.cursor(), /CHANGED FILES/);
	panel.press("j");
	assert.match(panel.cursor(), /a\.ts/);
});

test("앞 파일의 비동기 diff 로딩이 끝나도 뒤 파일의 탐색 위치를 유지한다", () => {
	// given
	const panel = createPanel();
	panel.state.commitFileDiffCache.delete("abc123\0a.ts");
	panel.press("G");
	assert.match(panel.cursor(), /c\.ts/);

	// when
	panel.state.commitFileDiffCache.set("abc123\0a.ts", "@@ -0,0 +1,20 @@\n" + Array.from({ length: 20 }, () => "+loaded").join("\n"));
	panel.render();
	panel.press("k");

	// then
	assert.match(panel.cursor(), /b\.ts/);
	panel.press("k");
	assert.match(panel.cursor(), /\+loaded/);
});

test("diff에서 리뷰를 시작하면 커서가 속한 파일의 드래프트를 연다", () => {
	// given
	const panel = createPanel();
	panel.state.commitExpandedByHash.get("abc123").add("c.ts");
	panel.state.commitFileDiffCache.set("abc123\0c.ts", "@@ -0,0 +1 @@\n+last-c");
	panel.press("G");
	assert.match(panel.cursor(), /last-c/);

	// when
	panel.press("r");
	panel.press("\r");
	for (const character of "확인할 내용") panel.press(character);
	panel.press("\r");

	// then
	assert.deepEqual(panel.state.reviewDrafts.map(({ filePath, prompt }: { filePath: string; prompt: string }) => ({ filePath, prompt })), [
		{ filePath: "c.ts", prompt: "확인할 내용" },
	]);
});

test("커밋 메시지가 길어도 상세 패널에 진입하면 첫 파일 제목에서 시작한다", () => {
	// given
	const panel = createPanel();
	panel.state.commitMessageExpanded = true;
	panel.state.commitMessageCache.set("abc123", Array.from({ length: 40 }, (_, i) => `설명 ${i}`).join("\n"));
	panel.press("\u001b[D");

	// when
	panel.press("\r");

	// then
	assert.match(panel.cursor(), /a\.ts/);
	panel.press("k");
	assert.match(panel.cursor(), /CHANGED FILES/);
});

test("파일 목록 로딩 중 렌더가 발생해도 도착 후 첫 파일에서 시작한다", () => {
	// given
	const panel = createPanel();
	const files = panel.state.commitFilesCache.get("abc123");
	panel.state.commitMessageExpanded = true;
	panel.state.commitFilesCache.delete("abc123");
	panel.render();

	// when
	panel.state.commitFilesCache.set("abc123", files);
	panel.render();

	// then
	assert.match(panel.cursor(), /a\.ts/);
});

test("파일 선택 안내 오류는 파일로 이동하면 사라진다", () => {
	// given
	const panel = createPanel();
	panel.press("g");
	assert.match(panel.press("r").join("\n"), /Select a file before adding review feedback/);

	// when
	const frame = panel.press("j").join("\n");

	// then
	assert.match(panel.cursor(), /a\.ts/);
	assert.doesNotMatch(frame, /Select a file before adding review feedback/);
});

test("테마 무효화 후에는 캐시된 파일 제목도 새 테마로 다시 그린다", () => {
	// given
	let color = "light";
	const panel = createPanel({ ...theme, fg: (kind, text) => kind === "text" ? `${color}:${text}` : text });
	panel.press("\r");
	assert.match(panel.render().join("\n"), /light:b\.ts/);

	// when
	color = "dark";
	panel.overlay.invalidate();

	// then
	assert.match(panel.render().join("\n"), /dark:b\.ts/);
});

test("일반 diff 모드는 방향키 10줄과 j/k 한 줄 스크롤을 유지한다", () => {
	// given
	const panel = createPanel();
	const file = { path: "a.ts", status: "modified", rawStatus: "M", commitState: "committed" };
	panel.state.viewMode = "diff";
	panel.state.files = [file];
	panel.state.filesByScope.branch = [file];
	panel.state.selectedFilePath = file.path;
	panel.state.treeNodes = [{ type: "file", name: "a.ts", fullPath: "a.ts" }];
	panel.state.diffCache.set("branch\0a.ts", "@@ -0,0 +1,30 @@\n" + Array.from({ length: 30 }, (_, i) => `+value-${i + 1}`).join("\n"));
	panel.render();

	// when
	const afterArrow = panel.press("\u001b[B").join("\n");
	const afterUp = panel.press("k").join("\n");

	// then
	assert.match(afterArrow, /value-10\b/);
	assert.doesNotMatch(afterArrow, /value-9\b/);
	assert.match(afterUp, /value-9\b/);
	panel.press("g");
	assert.match(panel.render().join("\n"), /value-1\b/);
});
