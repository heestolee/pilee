import { Marked, type Token } from "@mariozechner/pi-tui";
import { localPath } from "./files.ts";

const parser = new Marked();

/** Rewrites only parsed Markdown links, not code, images, HTML, or unparsed text. */
export function mapLocalLinks(markdown: string, cwd: string, target: (path: string) => string | undefined): string {
	const replacements: { start: number; end: number; text: string }[] = [];
	function visit(tokens: Token[], source: string, base: number) {
		let cursor = 0;
		for (const token of tokens) {
			const start = source.indexOf(token.raw, cursor);
			if (start < 0) continue; // Conservative fallback for normalized nested source.
			cursor = start + token.raw.length;
			if (token.type === "link") {
				const path = localPath(token.href, cwd);
				const url = path && target(path);
				if (url) replacements.push({ start: base + start, end: base + cursor, text: `[${token.text}](<${url}>)` });
				continue;
			}
			if (token.type === "code" || token.type === "codespan" || token.type === "html" || token.type === "image") continue;
			if (token.type === "list") visit(token.items, token.raw, base + start);
			else if (token.type === "table") {
				visit([...token.header, ...token.rows.flat()].flatMap((cell) => cell.tokens), token.raw, base + start);
			} else if ("tokens" in token && token.tokens) visit(token.tokens, token.raw, base + start);
		}
	}
	visit(parser.lexer(markdown), markdown, 0);
	let result = markdown;
	for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
		result = result.slice(0, replacement.start) + replacement.text + result.slice(replacement.end);
	}
	return result;
}

/** Bounded, session-local catalog; render calls do no disk IO and never read history. */
export class LinkCatalog {
	private readonly paths = new Set<string>();
	private readonly cache = new Map<string, string>();
	private readonly cwd: string;
	private readonly target?: (path: string) => string | undefined;
	constructor(cwd: string, target?: (path: string) => string | undefined) {
		this.cwd = cwd;
		this.target = target;
	}

	transform(markdown: string): string {
		if (markdown.length > 128 * 1024) return markdown;
		const cached = this.cache.get(markdown);
		if (cached !== undefined) return cached;
		const result = mapLocalLinks(markdown, this.cwd, (path) => {
			if (!this.paths.has(path) && this.paths.size >= 2000) return;
			this.paths.add(path);
			return this.target?.(path);
		});
		if (this.cache.size >= 16) this.cache.delete(this.cache.keys().next().value!);
		this.cache.set(markdown, result);
		return result;
	}

	list(): string[] { return [...this.paths]; }
}
