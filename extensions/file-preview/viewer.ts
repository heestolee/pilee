import { copyToClipboard, getLanguageFromPath, getMarkdownTheme, highlightCode, type Theme } from "@mariozechner/pi-coding-agent";
import { Markdown, ScrollView, Text, matchesKey, truncateToWidth, type Component, type TuiMouseEvent } from "@mariozechner/pi-tui";
import { safeDisplay, type PreviewFile } from "./files.ts";

export class FileViewer implements Component {
	private raw = false;
	private disposed = false;
	private copying = false;
	private status = "";
	private body: Component;
	private scroll: ScrollView;
	private readonly file: PreviewFile;
	private readonly theme: Theme;
	private readonly requestRender: () => void;
	private readonly rows: () => number;
	private readonly done: () => void;
	private readonly copy: (text: string) => Promise<void>;
	constructor(
		file: PreviewFile,
		theme: Theme,
		requestRender: () => void,
		rows: () => number,
		done: () => void,
		copy: (text: string) => Promise<void> = copyToClipboard,
	) {
		this.file = file;
		this.theme = theme;
		this.requestRender = requestRender;
		this.rows = rows;
		this.done = done;
		this.copy = copy;
		this.body = this.content();
		this.scroll = new ScrollView(this.body, { overscroll: "contain" });
	}

	private content(): Component {
		if (this.file.markdown && !this.raw) return new Markdown(this.file.display, 0, 0, getMarkdownTheme());
		const language = this.raw ? undefined : getLanguageFromPath(this.file.path);
		return new Text(language ? highlightCode(this.file.display, language).join("\n") : this.file.display, 0, 0);
	}

	invalidate(): void {
		this.body = this.content();
		const top = this.scroll.scrollTop;
		this.scroll = new ScrollView(this.body, { overscroll: "contain" });
		// Apply after the next layout knows the content height.
		this.pendingTop = top;
	}
	private pendingTop = 0;

	handleInput(data: string): void {
		if (this.disposed) return;
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || data === "q") { this.done(); return; }
		if (data === "r" && this.file.markdown) { this.raw = !this.raw; this.invalidate(); }
		else if (matchesKey(data, "up") || data === "k") this.scroll.scrollBy(-1);
		else if (matchesKey(data, "down") || data === "j") this.scroll.scrollBy(1);
		else if (matchesKey(data, "pageUp")) this.scroll.scrollBy(-Math.max(1, this.scroll.viewportHeight - 1));
		else if (matchesKey(data, "pageDown") || data === " ") this.scroll.scrollBy(Math.max(1, this.scroll.viewportHeight - 1));
		else if (matchesKey(data, "home") || data === "g") this.scroll.scrollToStart();
		else if (matchesKey(data, "end") || data === "G") this.scroll.scrollToEnd();
		else if (data === "c" && !this.copying) {
			this.copying = true;
			void this.copy(this.file.original).then(() => { this.status = "원문 복사됨"; }, () => { this.status = "복사 실패"; })
				.finally(() => { this.copying = false; if (!this.disposed) this.requestRender(); });
		}
		this.requestRender();
	}

	handleMouse(event: TuiMouseEvent) {
		if (event.type !== "wheel") return;
		this.scroll.scrollBy(event.wheelDelta ?? 0);
		this.requestRender();
		return { handled: true };
	}

	render(width: number): string[] {
		if (width < 1) return [];
		const height = Math.max(1, Math.floor(this.rows() * 0.9));
		const innerWidth = Math.max(1, width - 2);
		const header = this.theme.fg("accent", `파일 미리보기 · ${this.raw ? "원문" : this.file.markdown ? "Markdown" : "코드"} · 읽기 전용`);
		const path = this.theme.fg("muted", safeDisplay(this.file.path));
		// Keep ordinary web links; local/custom-scheme links inside a file cannot run an OS handler.
		const content = this.scroll.render(innerWidth).map((line) => line.replace(/\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)/gu,
			(sequence, url: string) => !url || /^https?:\/\//iu.test(url) ? sequence : ""));
		const bodyHeight = Math.max(1, height - 3);
		this.scroll.updateLayout(content.length, bodyHeight, this.requestRender);
		if (this.pendingTop) { this.scroll.scrollTo(this.pendingTop); this.pendingTop = 0; }
		const visible = content.slice(this.scroll.scrollTop, this.scroll.scrollTop + bodyHeight);
		const footer = this.theme.fg("dim", `Esc 닫기 · ↑↓/PgUp/PgDn · c 원문 복사${this.file.markdown ? " · r 원문/렌더" : ""} · ${this.scroll.scrollTop + 1}/${content.length} ${this.status}`);
		if (width < 4 || height < 4) return [footer, ...visible].slice(0, height).map((line) => truncateToWidth(line, width, "", true));
		while (visible.length < bodyHeight) visible.push("");
		const border = (left: string, line: string, right: string) => this.theme.fg("border", left) + truncateToWidth(line, innerWidth, "…", true) + this.theme.fg("border", right);
		return [border("╭", header, "╮"), border("│", path, "│"), ...visible.map((line) => border("│", line, "│")), border("╰", footer, "╯")];
	}

	dispose(): void { this.disposed = true; }
}
