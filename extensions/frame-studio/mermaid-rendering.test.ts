import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPageHtml, buildStaticTftStudioHtmlFromTranscript, buildTftVisualEmbedHtml, tftStudioMermaidBundleSource } from "./index.ts";

function extractStudioScript(html: string): string {
	const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
	assert.ok(scripts.length > 0, "inline Studio script should exist");
	return scripts.at(-1) ?? "";
}

function makeElement(source: string) {
	const attributes = new Map<string, string>([["data-mermaid-source", encodeURIComponent(source)]]);
	return {
		id: "mermaid-test",
		className: "mermaid-visual",
		innerHTML: "",
		getAttribute(name: string) {
			return attributes.get(name) ?? "";
		},
		setAttribute(name: string, value: string) {
			attributes.set(name, String(value));
		},
	};
}

function loadStudioMarkdownRuntime(mermaid: unknown) {
	const elements = new Map<string, any>();
	const document = {
		documentElement: { scrollTop: 0, scrollHeight: 1200, offsetHeight: 1200, clientHeight: 700 },
		body: { scrollTop: 0, scrollHeight: 1200, offsetHeight: 1200, classList: { contains() { return false; } } },
		getElementById(id: string) {
			if (!elements.has(id)) elements.set(id, { id, className: "", innerHTML: "", textContent: "" });
			return elements.get(id);
		},
		querySelectorAll() { return []; },
		addEventListener() {},
	};
	const window = {
		mermaid,
		pageYOffset: 0,
		innerHeight: 700,
		scrollTo() {},
		addEventListener() {},
	};
	const EventSource = function EventSource(this: any) { this.close = () => {}; };
	const fetch = () => Promise.reject(new Error("initial state disabled in test"));
	const setTimeout = (fn: () => void) => { fn(); return 1; };
	const requestAnimationFrame = (fn: () => void) => { fn(); return 1; };
	const script = extractStudioScript(buildPageHtml());
	const factory = new Function(
		"window",
		"document",
		"EventSource",
		"fetch",
		"setTimeout",
		"requestAnimationFrame",
		`${script}\nreturn { renderMarkdown: renderMarkdown, renderMermaidElement: renderMermaidElement };`,
	);
	return factory(window, document, EventSource, fetch, setTimeout, requestAnimationFrame) as {
		renderMarkdown(markdown: string): string;
		renderMermaidElement(element: ReturnType<typeof makeElement>): Promise<void>;
	};
}

test("Frame Studio는 로컬 Mermaid browser bundle과 외부 image 차단 CSP를 제공한다", () => {
	const html = buildPageHtml();
	assert.match(html, /<script src="\/mermaid\.min\.js"><\/script>/);
	assert.match(html, /http-equiv="Content-Security-Policy"/);
	assert.match(html, /img-src 'self' data: blob:/);
	assert.match(html, /connect-src 'self'/);
	const bundle = tftStudioMermaidBundleSource();
	assert.ok(bundle && bundle.length > 100_000, "installed Mermaid browser bundle should be readable");
});

test("정적 archive는 렌더 대상 어디에든 Mermaid가 있을 때만 bundle을 inline한다", () => {
	const dir = mkdtempSync(join(tmpdir(), "pilee-mermaid-static-"));
	const mermaidFile = join(dir, "with-mermaid.json");
	const questionFile = join(dir, "question-mermaid.json");
	const answerFile = join(dir, "answer-mermaid.json");
	const plainFile = join(dir, "without-mermaid.json");
	const mermaidMarkdown = ["# Diagram", "", "```mermaid", "flowchart LR", "A --> B", "```"].join("\n");
	const questionMarkdown = ["질문 제목: 구조 선택", "", "현재 이해:", "```mermaid", "flowchart LR", "Q --> A", "```", "", "질문:", "어떤 구조가 좋을까요?"].join("\n");
	const transcript = (markdown: string) => ({
		title: "Static Mermaid test",
		activeTab: "frame",
		status: "done",
		markdown,
		tabs: { frame: { markdown, step: "Visual", updatedAt: 1 } },
		timeline: [{ id: "u1", time: 1, kind: "update", tab: "frame", step: "Visual", markdown }],
		logs: [],
	});
	try {
		const plainTranscript = transcript("# Plain transcript");
		writeFileSync(mermaidFile, JSON.stringify(transcript(mermaidMarkdown)));
		writeFileSync(questionFile, JSON.stringify({
			...plainTranscript,
			status: "awaiting",
			question: { id: "q1", tab: "frame", question: questionMarkdown, options: [], multiSelect: false, allowText: false, createdAt: 1 },
			timeline: [],
		}));
		writeFileSync(answerFile, JSON.stringify({
			...plainTranscript,
			timeline: [{
				id: "a1", time: 1, kind: "answer", tab: "frame",
				answer: { status: "answered", question: questionMarkdown, selectedIndices: [], selectedOptions: [], submittedAt: 1 },
			}],
		}));
		writeFileSync(plainFile, JSON.stringify(plainTranscript));
		const mermaidHtml = buildStaticTftStudioHtmlFromTranscript(mermaidFile);
		const questionHtml = buildStaticTftStudioHtmlFromTranscript(questionFile);
		const answerHtml = buildStaticTftStudioHtmlFromTranscript(answerFile);
		const plainHtml = buildStaticTftStudioHtmlFromTranscript(plainFile);
		const visualEmbedHtml = buildTftVisualEmbedHtml({
			kind: "architecture-flow",
			title: "TFT visual only",
			nodes: [{ id: "a", title: "A" }, { id: "b", title: "B" }],
			edges: [{ from: "a", to: "b" }],
		});

		assert.match(mermaidHtml, /globalThis\["mermaid"\]/);
		assert.match(questionHtml, /globalThis\["mermaid"\]/);
		assert.match(answerHtml, /globalThis\["mermaid"\]/);
		assert.doesNotMatch(mermaidHtml, /<script src="\/mermaid\.min\.js"><\/script>/);
		assert.doesNotMatch(plainHtml, /globalThis\["mermaid"\]|<script src="\/mermaid\.min\.js">/);
		assert.doesNotMatch(visualEmbedHtml, /globalThis\["mermaid"\]|<script src="\/mermaid\.min\.js">/);
		assert.ok(plainHtml.length < mermaidHtml.length - 3_000_000, "plain archive should not carry the Mermaid bundle weight");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("mermaid fence를 코드 블록이 아닌 diagram placeholder로 변환한다", () => {
	const studio = loadStudioMarkdownRuntime({ initialize() {}, render() {} });
	const source = "flowchart LR\n  A[요청] --> B[응답]";
	const html = studio.renderMarkdown(`## 흐름\n\n\`\`\`mermaid\n${source}\n\`\`\``);

	assert.match(html, /class="mermaid-visual"/);
	assert.match(html, /data-mermaid-source=/);
	assert.doesNotMatch(html, /<pre><code>/);
	assert.doesNotMatch(html, />flowchart LR</);
});

test("여러 Mermaid diagram을 한 번 초기화하고 각각 고유 SVG로 렌더링한다", async () => {
	const initialized: unknown[] = [];
	const rendered: Array<{ id: string; source: string }> = [];
	const bound: unknown[] = [];
	const studio = loadStudioMarkdownRuntime({
		initialize(options: unknown) { initialized.push(options); },
		async render(id: string, source: string) {
			rendered.push({ id, source });
			return {
				svg: `<svg data-render-id="${id}"><text>${source}</text></svg>`,
				bindFunctions(root: unknown) { bound.push(root); },
			};
		},
	});
	const first = makeElement("flowchart LR\nA --> B");
	const second = makeElement("sequenceDiagram\nA->>B: hello");

	await studio.renderMermaidElement(first);
	await studio.renderMermaidElement(second);

	assert.equal(initialized.length, 1);
	assert.deepEqual(initialized[0], { startOnLoad: false, securityLevel: "strict", theme: "base", suppressErrorRendering: true });
	assert.equal(rendered.length, 2);
	assert.notEqual(rendered[0].id, rendered[1].id);
	assert.match(first.innerHTML, /<svg data-render-id=/);
	assert.match(second.innerHTML, /<svg data-render-id=/);
	assert.equal(first.getAttribute("data-rendered"), "1");
	assert.equal(second.getAttribute("data-rendered"), "1");
	assert.deepEqual(bound, [first, second]);
});

test("Mermaid 렌더 실패 시 오류와 escape된 원문을 보존한다", async () => {
	const studio = loadStudioMarkdownRuntime({
		initialize() {},
		async render() { throw new Error("Parse error on line 2"); },
	});
	const element = makeElement("flowchart LR\nA[<unsafe>] -->");

	await studio.renderMermaidElement(element);

	assert.equal(element.className, "mermaid-visual mermaid-visual-failed");
	assert.match(element.innerHTML, /Mermaid 렌더링 실패/);
	assert.match(element.innerHTML, /Parse error on line 2/);
	assert.match(element.innerHTML, /flowchart LR/);
	assert.match(element.innerHTML, /A\[&lt;unsafe&gt;\] --&gt;/);
	assert.doesNotMatch(element.innerHTML, /A\[<unsafe>\]/);
	assert.equal(element.getAttribute("data-rendered"), "error");
});
