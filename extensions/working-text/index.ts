import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const TIPS = [
	"tips: Escape 두 번 → /tree 세션 트리 탐색",
	"tips: Ctrl+L → 모델 변경",
	"tips: Shift+Tab → thinking level 변경",
	"tips: /compact → 컨텍스트 압축",
	"tips: /diff → git 변경사항 확인",
	"tips: /fork → 세션 분기",
	"tips: /export → 세션 HTML 내보내기",
	"tips: @ → 파일 참조 검색",
] as const;

const ROTATE_MS = 8000;
const PAUSE_TOOLS = new Set(["ask_user_question"]);

function pick(arr: readonly string[]): string {
	return arr[Math.floor(Math.random() * arr.length)] ?? arr[0];
}

function elapsed(since: number): string {
	const s = Math.floor((Date.now() - since) / 1000);
	if (s < 60) return `${s}초`;
	const m = Math.floor(s / 60);
	return `${m}분 ${s % 60}초`;
}

export default function (pi: ExtensionAPI) {
	let startedAt = 0;
	let message = "";
	let lastRotate = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let ctx: ExtensionContext | undefined;
	let paused = 0;
	let currentTool = "";
	let currentToolArgs = "";

	const stop = () => {
		if (timer) clearInterval(timer);
		timer = null;
	};

	const start = () => {
		stop();
		timer = setInterval(() => {
			if (!ctx?.hasUI || startedAt <= 0 || paused > 0) return;
			const now = Date.now();
			if (now - lastRotate >= ROTATE_MS) {
				message = pick(TIPS);
				lastRotate = now;
			}
			const toolInfo = currentTool ? ` [${currentTool}${currentToolArgs ? `: ${currentToolArgs}` : ""}]` : "";
			ctx.ui.setWorkingMessage(`${message} · ${elapsed(startedAt)}${toolInfo}`);
		}, 1000);
	};

	pi.on("agent_start", async (_e, c) => {
		ctx = c;
		startedAt = Date.now();
		message = pick(TIPS);
		lastRotate = Date.now();
		paused = 0;
		start();
	});

	pi.on("agent_end", async (_e, c) => {
		stop();
		paused = 0;
		if (c.hasUI) c.ui.setWorkingMessage();
		startedAt = 0;
	});

	pi.on("tool_execution_start", async (e) => {
		if (PAUSE_TOOLS.has(e.toolName)) paused++;
		currentTool = e.toolName;
		const args = e.args;
		if (e.toolName === "Bash" || e.toolName === "bash") {
			const cmd = typeof args === "string" ? args : args?.command ?? "";
			currentToolArgs = cmd.split("\n")[0].slice(0, 40);
		} else if (e.toolName === "Read" || e.toolName === "read") {
			currentToolArgs = (typeof args === "string" ? args : args?.path ?? "").split("/").pop() ?? "";
		} else if (e.toolName === "Edit" || e.toolName === "edit" || e.toolName === "Write" || e.toolName === "write") {
			currentToolArgs = (typeof args === "string" ? args : args?.path ?? "").split("/").pop() ?? "";
		} else if (e.toolName === "Agent") {
			currentToolArgs = (typeof args === "string" ? args : args?.description ?? "").slice(0, 30);
		} else {
			currentToolArgs = "";
		}
	});

	pi.on("tool_execution_end", async (e) => {
		if (PAUSE_TOOLS.has(e.toolName) && paused > 0) paused--;
		currentTool = "";
		currentToolArgs = "";
	});

	pi.on("session_start", async () => {
		stop();
		startedAt = 0;
		paused = 0;
	});

	pi.on("session_shutdown", async () => stop());
}
