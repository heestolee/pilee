import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Text, truncateToWidth } from "@mariozechner/pi-tui";

const WIDGET_ID = "queued-messages";

const SLOW_HINTS: Array<{ test: (tool: string, args: string) => boolean; hint: string }> = [
	{ test: (t, a) => t === "bash" && /^find\s+(\/|~|\$HOME)/.test(a), hint: "루트/홈 디렉토리 전체 탐색 중일 수 있음" },
	{ test: (t, a) => t === "bash" && /^sleep\b/.test(a), hint: "의도적 대기 중" },
	{ test: (t, a) => t === "bash" && /npm install|pnpm install|yarn install|pnpm i\b/.test(a), hint: "패키지 설치 중" },
	{ test: (t, a) => t === "bash" && /git clone\b/.test(a), hint: "레포 클론 중" },
	{ test: (t, a) => t === "bash" && /docker build\b/.test(a), hint: "도커 빌드 중" },
	{ test: (t, a) => t === "bash" && /npm run build|pnpm build|yarn build|tsc\b/.test(a), hint: "빌드/컴파일 중" },
	{ test: (t, a) => t === "bash" && /npm test|pnpm test|yarn test|jest|vitest/.test(a), hint: "테스트 실행 중" },
	{ test: (t, a) => t === "bash" && /curl|wget/.test(a), hint: "네트워크 요청 대기 중" },
	{ test: (t, a) => t === "bash" && /migration:run|migrate\b/.test(a), hint: "DB 마이그레이션 실행 중" },
	{ test: (t, a) => t === "bash" && /grep -r|rg\b/.test(a) && /\/(\s|$)|~/.test(a), hint: "넓은 범위 검색 중" },
	{ test: (t) => t === "Agent", hint: "서브에이전트 실행 중 — 완료까지 시간이 걸릴 수 있음" },
	{ test: (t) => t === "web_search" || t === "fetch_content", hint: "웹 검색/콘텐츠 가져오는 중" },
];

function getSlowCommandHint(tool: string, args: string): string | null {
	const normalized = tool.toLowerCase();
	for (const { test, hint } of SLOW_HINTS) {
		if (test(normalized, args)) return hint;
	}
	return null;
}

// Idle watchdog config
const IDLE_THRESHOLD_MS = 5 * 60 * 1000;     // 5분 무응답 시 알림
const ALERT_REPEAT_MS = 5 * 60 * 1000;        // 알림 후 5분마다 반복
const IDLE_CHECK_INTERVAL_MS = 30 * 1000;     // 30초마다 체크

interface QueuedMessage {
	text: string;
	queuedAt: number;
}

export default function (pi: ExtensionAPI) {
	const queue: QueuedMessage[] = [];
	let currentCtx: ExtensionContext | undefined;

	// Idle watchdog state
	let lastOutputAt = 0;
	let lastAlertAt = 0;
	let agentRunning = false;

	function clearWidget(ctx: ExtensionContext) {
		if (ctx.hasUI) ctx.ui.setWidget(WIDGET_ID, undefined);
	}

	function updateWidget(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		if (queue.length === 0) {
			ctx.ui.setWidget(WIDGET_ID, undefined);
			return;
		}

		const items = [...queue];
		ctx.ui.setWidget(WIDGET_ID, (_tui, theme) => ({
			invalidate() {},
			render(width: number) {
				const lines: string[] = [];
				const header = `${theme.fg("accent", "📋")} ${theme.fg("accent", theme.bold(`메시지 큐 ${items.length}개`))} ${theme.fg("dim", "(스티어/팔로업)")}`;
				lines.push(truncateToWidth(header, width));
				for (const [i, m] of items.entries()) {
					const num = theme.fg("dim", `${i + 1}.`);
					const preview = m.text.replace(/\n/g, " ").trim();
					lines.push(truncateToWidth(`  ${num} ${theme.fg("muted", preview)}`, width));
				}
				return lines;
			},
			handleInput() {},
		}));
	}

	// Track user input — if agent is busy, the message is queued
	pi.on("input", async (event, ctx) => {
		currentCtx = ctx;
		if (!ctx.isIdle()) {
			queue.push({ text: event.text, queuedAt: Date.now() });
			updateWidget(ctx);
		}
	});

	// Track agent activity for idle watchdog
	pi.on("agent_start", async (_e, ctx) => {
		currentCtx = ctx;
		agentRunning = true;
		lastOutputAt = Date.now();
		lastAlertAt = 0;
	});

	pi.on("message_update", async (_e, ctx) => {
		currentCtx = ctx;
		lastOutputAt = Date.now();
	});

	pi.on("tool_execution_end", async (_e, ctx) => {
		currentCtx = ctx;
		lastOutputAt = Date.now();
	});

	// When agent picks up a steering message (between turns)
	pi.on("turn_start", async (_e, ctx) => {
		currentCtx = ctx;
		lastOutputAt = Date.now();
		syncWithReality(ctx);
	});

	// When agent fully done (followUp messages get delivered then)
	pi.on("agent_end", async (_e, ctx) => {
		currentCtx = ctx;
		agentRunning = false;
		// agent_end fires before followUp delivery... give a tick
		setTimeout(() => {
			if (currentCtx) syncWithReality(currentCtx);
		}, 100);
	});

	// Periodic sync — best-effort cleanup if our tracking gets out of sync
	const syncInterval = setInterval(() => {
		if (currentCtx) syncWithReality(currentCtx);
	}, 1500);

	// Idle watchdog
	const idleInterval = setInterval(() => {
		if (!currentCtx?.hasUI || !agentRunning) return;
		const now = Date.now();
		const idleFor = now - lastOutputAt;
		if (idleFor < IDLE_THRESHOLD_MS) return;
		if (lastAlertAt > 0 && now - lastAlertAt < ALERT_REPEAT_MS) return;

		lastAlertAt = now;
		const minutes = Math.floor(idleFor / 60000);

		const lines: string[] = [
			`⚠️ 에이전트가 ${minutes}분간 출력 없음`,
		];
		if (currentTool) {
			lines.push(`🔄 현재 실행 중: ${currentTool}${currentToolArgs ? ` — ${currentToolArgs}` : ""}`);
			const hint = getSlowCommandHint(currentTool, currentToolArgs);
			if (hint) lines.push(`💡 ${hint}`);
		}
		if (queue.length > 0) {
			lines.push("");
			lines.push(`큐잉된 메시지 (${queue.length}개):`);
			for (const [i, m] of queue.entries()) {
				const preview = m.text.replace(/\n/g, " ").slice(0, 80);
				lines.push(`  ${i + 1}. ${preview}${m.text.length > 80 ? "…" : ""}`);
			}
		}
		lines.push("");
		lines.push("필요 시 Esc로 abort 가능");

		currentCtx.ui.notify(lines.join("\n"), "warning");
	}, IDLE_CHECK_INTERVAL_MS);

	function syncWithReality(ctx: ExtensionContext) {
		if (!ctx.hasPendingMessages() && queue.length > 0) {
			// Real queue empty but we still have items — clear
			queue.length = 0;
			updateWidget(ctx);
			return;
		}
		// Otherwise just re-render in case nothing changed
		if (queue.length > 0) updateWidget(ctx);
	}

	pi.on("session_start", async (_e, ctx) => {
		currentCtx = ctx;
		queue.length = 0;
		agentRunning = false;
		lastOutputAt = 0;
		lastAlertAt = 0;
		clearWidget(ctx);
	});

	pi.on("session_shutdown", async (_e, ctx) => {
		clearInterval(syncInterval);
		clearInterval(idleInterval);
		queue.length = 0;
		clearWidget(ctx);
	});
}
