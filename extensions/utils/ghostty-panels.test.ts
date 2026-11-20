import assert from "node:assert/strict";
import test from "node:test";
import {
	beginPanelRequest,
	buildCloseTerminalScript,
	buildInputTerminalScript,
	buildOpenPanelScript,
	buildRepanelScript,
	endPanelRequest,
	findOwnTerminal,
	openPanel,
	rememberOwnTerminal,
	type SplitPlacement,
} from "./ghostty-panels.ts";

const right: SplitPlacement = { anchorPath: [], splitDirection: "right" };
const launchScriptPath = "/tmp/pilee-panel-launch/launch-1-abcd1234.sh";

function fakeExec(responses: string[]) {
	const scripts: string[] = [];
	const exec = async (_command: string, args: string[]) => {
		scripts.push(args[args.length - 1]);
		const stdout = responses.shift() ?? "";
		return { code: 0, stdout, stderr: "", killed: false };
	};
	return { pi: { exec } as any, scripts };
}

test("오른쪽 열기는 출처 패널을 id로 찾아 그 옆을 나누고, 포커스를 앞으로 끌어오지 않고 되돌린다", () => {
	const script = buildOpenPanelScript({ target: right, cwd: "/tmp/작업 폴더", launchScriptPath, sourceTerminalId: "SRC-1" });
	assert.match(script, /if candidateTermIds contains "SRC-1" then/);
	assert.match(script, /set srcTerm to first terminal of srcTab whose id is srcTermId/);
	assert.match(script, /set newTerm to split anchorTerm direction right with configuration launchConfig/);
	assert.match(script, /set command of launchConfig to "\/tmp\/pilee-panel-launch\/launch-1-abcd1234\.sh"/);
	assert.match(script, /repeat with stepDirection in \{"left"\}/);
	assert.match(script, /if appWasFront and userTerm is not missing value then focus userTerm/);
	assert.doesNotMatch(script, /^\s*activate\s*$/m);
	assert.doesNotMatch(script, /input text|keystroke/);
});

test("anchorPath가 있으면 출처 패널의 탭 안에서만 이동하고 되돌아오는 경로도 역순으로 만든다", () => {
	const script = buildOpenPanelScript({ target: { anchorPath: ["up"], splitDirection: "right" }, cwd: "/tmp", launchScriptPath, sourceTerminalId: "SRC" });
	assert.match(script, /perform action "goto_split:up" on anchorTerm/);
	assert.match(script, /set nextAnchorTerm to focused terminal of srcTab/);
	assert.match(script, /repeat with stepDirection in \{"left", "down"\}/);
	assert.doesNotMatch(script, /nextAnchorTerm to focused terminal of selected tab/);
});

test("새 탭은 출처 패널이 있는 창에 만들고, 그 창의 선택 탭과 원래 앞에 있던 앱을 되돌린다", () => {
	const script = buildOpenPanelScript({ target: "tab", cwd: "/tmp", launchScriptPath, sourceTerminalId: "SRC" });
	assert.match(script, /set newTab to new tab in srcWindow with configuration launchConfig/);
	assert.match(script, /select tab previousTab/);
	assert.match(script, /if not appWasFront then\n\s+if previousPid is not 0 then/);
	assert.doesNotMatch(script, /new tab in front window/);
});

test("같은 요청에서 이어 여는 새 탭은 같은 탭 안에 나누고 너비를 맞춘다", () => {
	const script = buildOpenPanelScript({ target: "tab", cwd: "/tmp", launchScriptPath, sourceTerminalId: "SRC", groupTerminalId: "LAST" });
	assert.match(script, /if candidateTermIds contains "LAST" then/);
	assert.match(script, /set newTerm to split groupTerm direction right with configuration launchConfig/);
	assert.match(script, /perform action "equalize_splits" on newTerm/);
});

test("같은 요청에서 이어 여는 오른쪽 패널은 출처 패널을 다시 나누지 않고 첫 패널 쪽에 아래로 쌓는다", () => {
	const script = buildOpenPanelScript({ target: right, cwd: "/tmp", launchScriptPath, sourceTerminalId: "SRC", groupTerminalId: "LAST" });
	assert.match(script, /set newTerm to split groupTerm direction down with configuration launchConfig/);
	assert.doesNotMatch(script, /equalize_splits/);
});

test("출처 패널을 모르면 포커스된 패널 기준으로 열고 그 사실을 결과로 돌려준다", () => {
	const script = buildOpenPanelScript({ target: right, cwd: "/tmp", launchScriptPath });
	assert.match(script, /set srcTerm to missing value/);
	assert.match(script, /set anchorKind to "focused"\n\s+set srcWindow to front window/);
	assert.doesNotMatch(script, /candidateTermIds contains/);
});

test("Ghostty 명령 문자열은 ASCII 경로만 넘긴다", () => {
	const script = buildOpenPanelScript({ target: "tab", cwd: "/tmp/한글 폴더", launchScriptPath, sourceTerminalId: "SRC" });
	const command = script.match(/set command of launchConfig to "([^"]+)"/)?.[1] ?? "";
	assert.equal(command, launchScriptPath);
	assert.equal([...command].every((char) => char.charCodeAt(0) < 128), true);
});

test("한 요청 안에서 연 패널만 묶고, 요청이 끝나면 새로 시작한다", async () => {
	rememberOwnTerminal("OWN");
	const { pi, scripts } = fakeExec(["T1\tsource", "T2\tgroup", "T3\tsource"]);
	try {
		beginPanelRequest();
		assert.deepEqual(await openPanel(pi, { target: "tab", cwd: "/tmp", launchScriptPath }), { ok: true, terminalId: "T1", anchor: "source" });
		await openPanel(pi, { target: "tab", cwd: "/tmp", launchScriptPath });
		endPanelRequest();
		await openPanel(pi, { target: "tab", cwd: "/tmp", launchScriptPath });
		assert.match(scripts[0], /contains "OWN"/);
		assert.doesNotMatch(scripts[0], /groupTermId/);
		assert.match(scripts[1], /contains "T1"/);
		assert.doesNotMatch(scripts[2], /groupTermId/);
	} finally {
		endPanelRequest();
		rememberOwnTerminal(undefined);
	}
});

test("방향이 다른 열기는 서로 묶지 않는다", async () => {
	rememberOwnTerminal("OWN");
	const { pi, scripts } = fakeExec(["T1\tsource", "R1\tsource"]);
	try {
		beginPanelRequest();
		await openPanel(pi, { target: "tab", cwd: "/tmp", launchScriptPath });
		await openPanel(pi, { target: right, cwd: "/tmp", launchScriptPath });
		assert.doesNotMatch(scripts[1], /groupTermId/);
	} finally {
		endPanelRequest();
		rememberOwnTerminal(undefined);
	}
});

test("동시에 여러 개를 열어도 Ghostty 스크립트는 하나씩 차례로 실행된다", async () => {
	rememberOwnTerminal("OWN");
	let running = 0;
	let maxRunning = 0;
	let next = 0;
	const pi = {
		exec: async () => {
			running += 1;
			maxRunning = Math.max(maxRunning, running);
			await new Promise((resolve) => setTimeout(resolve, 20));
			running -= 1;
			return { code: 0, stdout: `T${++next}\tsource`, stderr: "", killed: false };
		},
	} as any;
	try {
		beginPanelRequest();
		const results = await Promise.all([1, 2, 3].map(() => openPanel(pi, { target: "tab", cwd: "/tmp", launchScriptPath })));
		assert.equal(maxRunning, 1);
		assert.deepEqual(results.map((result) => result.ok && result.terminalId), ["T1", "T2", "T3"]);
	} finally {
		endPanelRequest();
		rememberOwnTerminal(undefined);
	}
});

test("기억한 자기 패널이 없고 UI 컨텍스트도 없으면 Ghostty에 묻지 않는다", async () => {
	rememberOwnTerminal(undefined);
	const { pi, scripts } = fakeExec([]);
	assert.equal(await findOwnTerminal(pi), undefined);
	assert.equal(scripts.length, 0);
});

test("닫기·입력은 지정한 터미널 id만 대상으로 한다", () => {
	assert.equal(buildCloseTerminalScript("T1", 0.2), 'delay 0.2\ntell application "Ghostty"\n  close (first terminal whose id is "T1")\nend tell');
	const input = buildInputTerminalScript("T1", launchScriptPath, 0.8);
	assert.match(input, /set targetTerm to first terminal whose id is "T1"/);
	assert.doesNotMatch(input, /focused terminal|front window|activate/);
});

test("repanel은 자기 패널 기준으로 기준 패널을 찾은 뒤에 닫고, 남은 패널은 같은 탭에서 고른다", () => {
	const script = buildRepanelScript("OWN", { anchorPath: ["right"], splitDirection: "down" }, "/tmp", launchScriptPath);
	const navigation = script.indexOf('perform action "goto_split:right"');
	const close = script.indexOf("close ownTerm");
	assert.ok(navigation > -1 && close > navigation);
	assert.match(script, /set nextAnchorTerm to focused terminal of ownTab/);
	assert.match(script, /split anchorTerm direction down with configuration launchConfig/);

	const simple = buildRepanelScript("OWN", right, "/tmp", launchScriptPath);
	assert.match(simple, /close ownTerm\n\s+delay 0\.7\n\s+set anchorTerm to focused terminal of ownTab/);
	assert.doesNotMatch(`${script}\n${simple}`, /front window|^\s*activate\s*$/m);
});
