type Component = {
	render(width: number): string[];
	invalidate(): void;
};
type Container = Component & { children: Component[] };
type MainScreen = Container & {
	mode: string;
	terminal: { columns: number; rows: number };
	previousLines: string[];
	previousWidth: number;
	previousHeight: number;
	previousViewportTop: number;
	cursorRow: number;
	hardwareCursorRow: number;
	maxLinesRendered: number;
	previousKittyImageIds: Set<number>;
	hasOverlayEntries: boolean;
	getClearOnShrink(): boolean;
	doRender(): void;
};
const INSTALLED = Symbol.for("pilee.tool-group-renderer.transcript-render");
const CACHED = Symbol.for("pilee.tool-group-renderer.transcript-cache");
const STATIC_COMPONENTS = new Set([
	"Text", "Spacer", "UserMessageComponent", "AssistantMessageComponent",
	"ToolExecutionComponent", "McpToolResultComponent", "GroupedBuiltinToolComponent",
	"CompactionSummaryMessageComponent", "BranchSummaryMessageComponent", "CustomMessageComponent",
]);

/** Cache the transcript at its mutation boundary, not by walking every row on input. */
function cacheTranscript(chat: Container) {
	const cached = chat as Container & { [CACHED]?: { unchangedLines(): number } };
	if (cached[CACHED]) return cached[CACHED];
	let dirty = 0;
	let width = -1;
	let unchanged = 0;
	const live = new Map<Component, { index: number; lines: string[] }>();
	const lines: string[] = [];
	const offsets = [0];
	const watched = new WeakMap<Component, { index: number }>();
	const mark = (index: number) => { dirty = Math.min(dirty, index); };
	const track = (children: Component[]) => new Proxy(children, {
		set(target, key, value) {
			if (key === "length") mark(Math.min(target.length, value));
			else if (typeof key === "string" && /^\d+$/.test(key)) mark(Number(key));
			return Reflect.set(target, key, value);
		},
		deleteProperty(target, key) {
			if (typeof key === "string" && /^\d+$/.test(key)) mark(Number(key));
			return Reflect.deleteProperty(target, key);
		},
	});
	let children = track(chat.children);
	Object.defineProperty(chat, "children", {
		configurable: true,
		get: () => children,
		set: (next: Component[]) => { dirty = 0; children = track(next); },
	});
	const invalidate = chat.invalidate;
	chat.invalidate = function () { dirty = 0; invalidate.call(this); };
	chat.render = function (nextWidth) {
		if (width !== nextWidth) dirty = 0;
		// Unknown/custom animated components retain their normal render contract.
		for (const [child, record] of live) {
			if (children[record.index] !== child) { live.delete(child); continue; }
			const next = child.render(nextWidth);
			if (next.length !== record.lines.length || next.some((line, i) => line !== record.lines[i])) mark(record.index);
			record.lines = next;
		}
		unchanged = offsets[dirty] ?? 0;
		lines.length = unchanged;
		for (let i = dirty; i < children.length; i++) {
			const child = children[i];
			let record = watched.get(child);
			if (!record) {
				record = { index: i };
				watched.set(child, record);
				// Built-in message/tool setters and async image completion converge here.
				// Expansion is also watched for custom/entry renderers with their own rebuild.
				const target = child as Component & Record<string, unknown>;
				for (const name of ["invalidate", "updateContent", "updateDisplay", "refreshDisplay", "rebuild", "setExpanded", "setText"]) {
					const method = target[name];
					if (typeof method !== "function") continue;
					const position = record;
					target[name] = function (this: Component, ...args: unknown[]) {
						mark(position.index);
						return method.apply(this, args);
					};
				}
			}
			record.index = i;
			const rendered = live.get(child)?.lines ?? child.render(nextWidth);
			if (!STATIC_COMPONENTS.has(child.constructor.name) || ("customRenderer" in child && child.customRenderer)) {
				live.set(child, { index: i, lines: rendered });
			}
			for (const line of rendered) lines.push(line);
			offsets[i + 1] = lines.length;
		}
		offsets.length = children.length + 1;
		dirty = children.length;
		width = nextWidth;
		return lines;
	};
	cached[CACHED] = { unchangedLines: () => unchanged };
	return cached[CACHED];
}

/**
 * Keep the complete transcript and terminal scrollback. Only lend the core renderer
 * a suffix for a differential update, then restore its absolute coordinates.
 * No session/model-context mutation, alternate screen, or history pagination.
 */
export function installTranscriptRender(mode: {
	chatContainer: Container;
	documentContainer?: Container;
	renderer?: MainScreen;
}): void {
	const ui = mode.renderer;
	const document = mode.documentContainer;
	if (!ui || ui.mode !== "regular" || !document || typeof ui.doRender !== "function") return;
	const installed = ui as MainScreen & { [INSTALLED]?: boolean };
	if (installed[INSTALLED]) return;
	// Only the regular renderer with the known transcript-first layout is supported.
	if (!Array.isArray(ui.previousLines) || ui.children[0] !== document || document.children.at(-1) !== mode.chatContainer) return;
	installed[INSTALLED] = true;
	const cache = cacheTranscript(mode.chatContainer);
	const original = ui.doRender;
	let header: string[] = [];
	ui.doRender = function () {
		const width = this.terminal.columns;
		const height = this.terminal.rows;
		const nextHeader = document.children.slice(0, -1).flatMap((child) => child.render(width));
		const stable = header.length === nextHeader.length && header.every((line, i) => line === nextHeader[i]);
		const chat = mode.chatContainer.render(width);
		const unchanged = nextHeader.length + cache.unchangedLines();
		const cut = Math.min(this.previousViewportTop, unchanged);
		const canSkip = stable && cut > 0 && this.previousWidth === width && this.previousHeight === height
			&& !this.hasOverlayEntries
			&& this.children[0] === document && document.children.at(-1) === mode.chatContainer;
		header = nextHeader;
		if (!canSkip) return original.call(this);

		const suffix = cut < header.length ? header.slice(cut) : [];
		for (let i = Math.max(0, cut - header.length); i < chat.length; i++) suffix.push(chat[i]);
		for (let i = 1; i < this.children.length; i++) {
			for (const line of this.children[i].render(width)) suffix.push(line);
		}
		// These cases make the core clear/replay scrollback. Give it the full document.
		const oldSuffix = this.previousLines.slice(cut);
		const isImage = (line: string) => line.includes("\x1b_G") || line.includes("\x1b]1337;File=");
		if (unchanged < this.previousViewportTop || oldSuffix.length - suffix.length > height
			|| (this.getClearOnShrink() && suffix.length + cut < this.maxLinesRendered)
			|| suffix.some(isImage) || oldSuffix.some(isImage)) {
			return original.call(this);
		}
		const full = this.previousLines;
		const render = this.render;
		const images = this.previousKittyImageIds;
		this.previousKittyImageIds = new Set();
		this.previousLines = oldSuffix;
		this.render = () => suffix;
		this.previousViewportTop -= cut;
		this.cursorRow -= cut;
		this.hardwareCursorRow -= cut;
		this.maxLinesRendered -= cut;
		try {
			original.call(this);
		} finally {
			// Mutate only the suffix. concat/spread here would re-copy all history.
			full.length = cut;
			for (const line of this.previousLines) full.push(line);
			this.previousLines = full;
			this.previousKittyImageIds = images;
			this.render = render;
			this.previousViewportTop += cut;
			this.cursorRow += cut;
			this.hardwareCursorRow += cut;
			this.maxLinesRendered += cut;
		}
	};
}
