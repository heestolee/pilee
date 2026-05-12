import type { ExtensionAPI, Theme } from "@mariozechner/pi-coding-agent";
import { Input, Key, matchesKey, Text, truncateToWidth, visibleWidth, type Focusable } from "@mariozechner/pi-tui";
import { Type } from "typebox";

type TuiAskStatus = "submitted" | "cancelled" | "unavailable" | "invalid";

interface TuiAskResult {
	status: TuiAskStatus;
	question: string;
	options: string[];
	selectedIndices: number[];
	selectedOptions: string[];
	text: string | null;
	multiSelect: boolean;
	allowText: boolean;
}

interface TuiAskParams {
	title?: string;
	question: string;
	options?: string[];
	multiSelect?: boolean;
	allowText?: boolean;
	placeholder?: string;
	defaultSelectedIndices?: number[];
}

const TuiAskParamsSchema = Type.Object({
	title: Type.Optional(Type.String({ description: "Short overlay title. Defaults to '질문'." })),
	question: Type.String({ description: "Question to ask the user." }),
	options: Type.Optional(Type.Array(Type.String(), { description: "Choice labels shown in the TUI overlay." })),
	multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple option selection with Space. Defaults to false." })),
	allowText: Type.Optional(Type.Boolean({ description: "Allow direct text input through the TUI overlay. Defaults to false." })),
	placeholder: Type.Optional(Type.String({ description: "Placeholder shown for direct text input." })),
	defaultSelectedIndices: Type.Optional(Type.Array(Type.Integer(), { description: "1-based option indices selected initially, useful for multiSelect." })),
});

export default function tuiAsk(pi: ExtensionAPI) {
	pi.registerTool({
		name: "tui_ask",
		label: "TUI Ask",
		description: "Ask the user through an in-terminal TUI overlay. Use for small decision gates such as branch naming, PR intent, approval, single/multiple choice, or direct text input. Prefer this over webview/Studio when a lightweight terminal interaction is enough.",
		parameters: TuiAskParamsSchema,
		async execute(_toolCallId, params: TuiAskParams, _signal, _onUpdate, ctx) {
			const options = normalizeOptions(params.options);
			const multiSelect = params.multiSelect === true;
			const allowText = params.allowText === true;

			if (!allowText && options.length === 0) {
				return toolResult({
					status: "invalid",
					question: params.question,
					options,
					selectedIndices: [],
					selectedOptions: [],
					text: null,
					multiSelect,
					allowText,
				});
			}

			if (!ctx.hasUI) {
				return toolResult({
					status: "unavailable",
					question: params.question,
					options,
					selectedIndices: [],
					selectedOptions: [],
					text: null,
					multiSelect,
					allowText,
				});
			}

			const result = await ctx.ui.custom<TuiAskResult | null>(
				(_tui, theme, _keybindings, done) =>
					new TuiAskOverlay(theme, {
						title: params.title ?? "질문",
						question: params.question,
						options,
						multiSelect,
						allowText,
						placeholder: params.placeholder ?? "직접 입력",
						defaultSelectedIndices: params.defaultSelectedIndices ?? [],
						done,
					}),
				{ overlay: true, overlayOptions: { width: "82%", minWidth: 56, maxHeight: "80%", anchor: "center" } },
			);

			return toolResult(
				result ?? {
					status: "cancelled",
					question: params.question,
					options,
					selectedIndices: [],
					selectedOptions: [],
					text: null,
					multiSelect,
					allowText,
				},
			);
		},
		renderCall(args: TuiAskParams, theme) {
			const options = normalizeOptions(args.options);
			const flags = [args.multiSelect ? "multi" : "single", args.allowText ? "text" : null].filter(Boolean).join(" · ");
			const lines = [`${theme.fg("toolTitle", theme.bold("tui_ask"))} ${theme.fg("muted", args.question)}`];
			if (flags) lines.push(theme.fg("dim", `  ${flags}`));
			if (options.length > 0) lines.push(theme.fg("dim", `  ${options.map((option, index) => `${index + 1}. ${option}`).join("  ")}`));
			return new Text(lines.join("\n"), 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as TuiAskResult | undefined;
			if (!details) return new Text("", 0, 0);
			if (details.status === "cancelled") return new Text(theme.fg("warning", "취소됨"), 0, 0);
			if (details.status === "unavailable") return new Text(theme.fg("warning", "TUI 없음 — 번호/text fallback 필요"), 0, 0);
			if (details.status === "invalid") return new Text(theme.fg("error", "옵션 또는 text 입력이 필요함"), 0, 0);
			const parts = [];
			if (details.selectedOptions.length > 0) parts.push(details.selectedOptions.map((option, index) => `${details.selectedIndices[index]}. ${option}`).join(", "));
			if (details.text) parts.push(`text: ${details.text}`);
			return new Text(theme.fg("success", "✓ ") + theme.fg("accent", parts.join(" · ") || "제출됨"), 0, 0);
		},
	});
}

interface TuiAskOverlayOptions {
	title: string;
	question: string;
	options: string[];
	multiSelect: boolean;
	allowText: boolean;
	placeholder: string;
	defaultSelectedIndices: number[];
	done: (result: TuiAskResult | null) => void;
}

class TuiAskOverlay implements Focusable {
	private readonly input = new Input();
	private readonly theme: Theme;
	private readonly options: TuiAskOverlayOptions;
	private selectedIndex = 0;
	private textMode = false;
	private textValue = "";
	private readonly selected = new Set<number>();

	constructor(theme: Theme, options: TuiAskOverlayOptions) {
		this.theme = theme;
		this.options = options;
		this.textMode = options.options.length === 0 && options.allowText;
		for (const oneBasedIndex of options.defaultSelectedIndices) {
			const index = oneBasedIndex - 1;
			if (index >= 0 && index < options.options.length) this.selected.add(index);
		}
		this.input.onSubmit = (value) => {
			const trimmed = value.trim();
			if (trimmed.length === 0) {
				this.textMode = false;
				this.setFocusedInput(false);
				return;
			}
			this.textValue = trimmed;
			this.options.done(this.buildResult("submitted", trimmed));
		};
		this.input.onEscape = () => {
			this.textMode = false;
			this.setFocusedInput(false);
		};
	}

	set focused(value: boolean) {
		this.setFocusedInput(value && this.textMode);
	}

	get focused(): boolean {
		return this.input.focused;
	}

	handleInput(data: string): void {
		if (this.textMode) {
			this.input.handleInput(data);
			return;
		}

		if (data === "q" || matchesKey(data, Key.escape)) {
			this.options.done(null);
			return;
		}
		if (matchesKey(data, Key.up) || data === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			return;
		}
		if (matchesKey(data, Key.down) || data === "j") {
			this.selectedIndex = Math.min(this.rowCount() - 1, this.selectedIndex + 1);
			return;
		}
		if (this.options.allowText && data === "i") {
			this.enterTextMode();
			return;
		}
		if (this.options.multiSelect && data === " ") {
			this.toggleCurrentSelection();
			return;
		}
		if (/^[1-9]$/.test(data)) {
			const index = Number(data) - 1;
			if (index >= 0 && index < this.options.options.length) {
				this.selectedIndex = index;
				if (this.options.multiSelect) this.toggleOption(index);
				else this.submitSingle(index);
				return;
			}
			if (this.options.allowText && index === this.options.options.length) {
				this.selectedIndex = index;
				this.enterTextMode();
				return;
			}
		}
		if (matchesKey(data, Key.enter)) {
			if (this.options.allowText && this.selectedIndex === this.options.options.length) {
				if (this.textValue.trim()) this.options.done(this.buildResult("submitted", this.textValue.trim()));
				else this.enterTextMode();
				return;
			}
			if (this.options.multiSelect) {
				this.options.done(this.buildResult("submitted", this.textValue || null));
				return;
			}
			this.submitSingle(this.selectedIndex);
		}
	}

	render(width: number): string[] {
		const w = Math.max(40, width);
		const lines: string[] = [];
		const add = (line: string) => lines.push(truncateToWidth(line, w, ""));
		const accentLine = this.theme.fg("accent", "─".repeat(w));

		add(accentLine);
		add(`  ${this.theme.fg("accent", this.theme.bold(this.options.title))}`);
		for (const line of wrapPlainText(this.options.question, Math.max(20, w - 4))) {
			add(`  ${this.theme.fg("text", line)}`);
		}
		add(accentLine);

		for (let i = 0; i < this.options.options.length; i++) {
			const option = this.options.options[i] ?? "";
			const selected = this.selectedIndex === i;
			const checked = this.options.multiSelect ? (this.selected.has(i) ? "☑" : "☐") : `${i + 1}.`;
			const cursor = selected ? this.theme.fg("accent", "▶") : " ";
			const label = selected ? this.theme.fg("accent", option) : this.theme.fg("text", option);
			add(`${cursor} ${checked} ${label}`);
		}

		if (this.options.allowText) {
			const directIndex = this.options.options.length;
			const selected = this.selectedIndex === directIndex || this.textMode;
			const label = this.textValue ? `직접 입력: ${this.textValue}` : this.options.placeholder;
			add(`${selected ? this.theme.fg("accent", "▶") : " "} ${directIndex + 1}. ${selected ? this.theme.fg("accent", label) : this.theme.fg("text", label)}`);
		}

		if (this.textMode) {
			add("");
			add(`  ${this.theme.fg("muted", "입력 후 Enter로 제출 · Esc로 옵션으로 돌아가기")}`);
			for (const line of this.input.render(Math.max(10, w - 4))) add(`  ${line}`);
		}

		add(accentLine);
		add(`  ${this.theme.fg("border", this.footerText())}`);
		return lines;
	}

	invalidate(): void {
		this.input.invalidate();
	}

	private rowCount(): number {
		return this.options.options.length + (this.options.allowText ? 1 : 0);
	}

	private setFocusedInput(value: boolean): void {
		this.input.focused = value;
	}

	private enterTextMode(): void {
		this.textMode = true;
		this.input.setValue(this.textValue);
		this.setFocusedInput(true);
	}

	private toggleCurrentSelection(): void {
		if (this.selectedIndex >= 0 && this.selectedIndex < this.options.options.length) this.toggleOption(this.selectedIndex);
	}

	private toggleOption(index: number): void {
		if (this.selected.has(index)) this.selected.delete(index);
		else this.selected.add(index);
	}

	private submitSingle(index: number): void {
		if (index < 0 || index >= this.options.options.length) return;
		this.selected.clear();
		this.selected.add(index);
		this.options.done(this.buildResult("submitted", null));
	}

	private buildResult(status: TuiAskStatus, text: string | null): TuiAskResult {
		const selectedIndices = [...this.selected].sort((a, b) => a - b);
		return {
			status,
			question: this.options.question,
			options: this.options.options,
			selectedIndices: selectedIndices.map((index) => index + 1),
			selectedOptions: selectedIndices.map((index) => this.options.options[index] ?? ""),
			text,
			multiSelect: this.options.multiSelect,
			allowText: this.options.allowText,
		};
	}

	private footerText(): string {
		if (this.textMode) return "Enter 제출 · Esc 옵션으로";
		const parts = ["↑↓/j/k 이동"];
		if (this.options.multiSelect) parts.push("Space 선택", "Enter 제출");
		else parts.push("Enter 선택");
		if (this.options.allowText) parts.push("i 직접 입력");
		parts.push("q/Esc 취소");
		return parts.join(" · ");
	}
}

function normalizeOptions(options: string[] | undefined): string[] {
	return (options ?? []).map((option) => String(option).trim()).filter(Boolean);
}

function wrapPlainText(text: string, width: number): string[] {
	const words = String(text).replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
	if (words.length === 0) return [""];
	const lines: string[] = [];
	let current = "";
	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (visibleWidth(candidate) <= width) {
			current = candidate;
			continue;
		}
		if (current) lines.push(current);
		current = word;
	}
	if (current) lines.push(current);
	return lines;
}

function toolResult(details: TuiAskResult) {
	return {
		content: [{ type: "text" as const, text: resultText(details) }],
		details,
	};
}

function resultText(details: TuiAskResult): string {
	if (details.status === "invalid") return "TUI 질문 오류: options 또는 allowText=true가 필요합니다.";
	if (details.status === "unavailable") return fallbackText(details);
	if (details.status === "cancelled") return "사용자가 TUI 질문을 취소했습니다.";
	const selected = details.selectedOptions.length > 0 ? `선택=${details.selectedIndices.join(",")}: ${details.selectedOptions.join(" | ")}` : "선택=(없음)";
	const text = details.text ? ` 입력=${details.text}` : "";
	return `사용자가 TUI 질문에 답했습니다: ${selected}${text}`;
}

function fallbackText(details: TuiAskResult): string {
	const lines = ["TUI를 사용할 수 없습니다. 번호/text fallback으로 사용자에게 질문하세요.", "", details.question];
	for (let i = 0; i < details.options.length; i++) {
		lines.push(`${i + 1}. ${details.options[i]}`);
	}
	if (details.allowText) lines.push(`${details.options.length + 1}. 직접 입력`);
	return lines.join("\n");
}
