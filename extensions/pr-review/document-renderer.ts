import type { MetaReviewClientState } from "./view-model.ts";
import { META_REVIEW_DOCUMENT_CSS } from "./document-styles.ts";

export { META_REVIEW_DOCUMENT_CSS } from "./document-styles.ts";

export type MetaReviewRenderMode = "live" | "static";

export interface MetaReviewRenderOptions {
	mode: MetaReviewRenderMode;
}

export type MetaReviewLivePayload = MetaReviewClientState & {
	documentHtml: string;
};

export const META_REVIEW_MERMAID_CONFIG = Object.freeze({
	startOnLoad: false,
	theme: "base",
	securityLevel: "strict",
});

type ReviewFile = MetaReviewClientState["source"]["files"][number];
type ReviewGuide = MetaReviewClientState["guides"][number];
type ReviewCard = MetaReviewClientState["cards"][number];

function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function safeHttpUrl(value: unknown): string {
	try {
		const url = new URL(String(value ?? ""));
		return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
	} catch {
		return "";
	}
}

function attribute(name: string, value: unknown): string {
	return ` ${name}="${escapeHtml(value)}"`;
}

function selectableClass(base: string, mode: MetaReviewRenderMode): string {
	return `${base}${mode === "live" ? " reviewSelectable" : ""}`;
}

function selectionAttributes(mode: MetaReviewRenderMode, values: Record<string, unknown>): string {
	if (mode !== "live") return "";
	return Object.entries(values)
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(([name, value]) => attribute(name, value))
		.join("");
}

function firstParagraph(value: unknown): string {
	return String(value ?? "")
		.split(/\n\s*\n/)
		.map((part) => part.replace(/^#+\s*/gm, "").replace(/^[-*]\s*/gm, "").trim())
		.find(Boolean) || "";
}

function basename(path: string): string {
	return path.split("/").at(-1) || path || "file";
}

function mermaidText(value: unknown): string {
	return String(value ?? "")
		.replace(/[\r\n]+/g, " ")
		.replace(/["|\[\]{}<>;]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function authoredFiles(state: MetaReviewClientState): ReviewFile[] {
	const byPath = new Map(state.source.files.map((file) => [file.path, file]));
	const seen = new Set<string>();
	const ordered = (state.document?.relationships?.readingOrder || []).flatMap((step) => {
		const file = byPath.get(step.path);
		if (!file || seen.has(file.path)) return [];
		seen.add(file.path);
		return [file];
	});
	return [...ordered, ...state.source.files.filter((file) => !seen.has(file.path))];
}

function guideFor(state: MetaReviewClientState, path: string): ReviewGuide | undefined {
	return state.guides.find((guide) => guide.path === path);
}

function relationshipMermaid(state: MetaReviewClientState): string {
	const relationship = state.document?.relationships;
	const relations = relationship?.relations || [];
	if (!relations.length) return "";
	const files = authoredFiles(state);
	const byPath = new Map(files.map((file, index) => [file.path, { file, alias: `F${index + 1}`, index }]));
	const relationPaths = new Set(relations.flatMap((relation) => [relation.from, relation.to]));
	const orderedPaths = files.map((file) => file.path).filter((path) => relationPaths.has(path));
	const lines = relationship?.diagram === "sequence" ? ["sequenceDiagram"] : ["flowchart LR"];
	for (const path of orderedPaths) {
		const item = byPath.get(path);
		if (!item) continue;
		const label = `${String(item.index + 1).padStart(2, "0")} · ${basename(path)}`;
		lines.push(relationship?.diagram === "sequence"
			? `participant ${item.alias} as ${mermaidText(label)}`
			: `${item.alias}["${mermaidText(label)}"]`);
	}
	for (const relation of relations) {
		const from = byPath.get(relation.from);
		const to = byPath.get(relation.to);
		if (!from || !to) continue;
		const label = mermaidText(relation.label);
		lines.push(relationship?.diagram === "sequence"
			? `${from.alias}->>${to.alias}: ${label}`
			: `${from.alias} -->|${label}| ${to.alias}`);
	}
	return lines.join("\n");
}

function overviewHtml(state: MetaReviewClientState, mode: MetaReviewRenderMode): string {
	const target = state.run.target;
	const overview = state.document?.overview;
	const relationship = state.document?.relationships;
	const summary = overview?.summary || firstParagraph(target.body) || target.title || "PR 목적과 diff를 함께 확인합니다.";
	const focus = overview?.reviewFocus || "파일별 역할과 실제 review finding을 분리해서 확인합니다.";
	return `<section class="${selectableClass("reviewOverview", mode)}" id="reviewOverview"${selectionAttributes(mode, {
		"data-review-section": "overview",
		"data-review-select-kind": "section",
		"data-review-select-id": "overview",
		"data-review-select-label": "한눈에 보기",
	})}><div class="reviewOverviewLead"><div><p class="reviewSectionLabel">Overview</p><h2>한눈에 보기</h2><p class="reviewOverviewHint">변경 목적·파일 관계·검토 초점을 먼저 잡고 상세 diff로 내려갑니다.</p></div><p class="reviewOverviewTitle">${escapeHtml(target.title || "현재 PR의 변경 목적과 영향")}</p></div><div class="reviewOverviewGrid"><div class="reviewOverviewItem"><b>변경 목적</b><p>${escapeHtml(summary)}</p></div><div class="reviewOverviewItem"><b>파일 관계</b><p>${escapeHtml(relationship?.summary || "변경 파일별 책임과 호출·데이터 연결을 관계도에서 확인합니다.")}</p></div><div class="reviewOverviewItem"><b>검토 초점</b><p>${escapeHtml(focus)}</p></div></div><div class="reviewOverviewMetrics"><div class="reviewMetric"><b>${escapeHtml(state.source.stats?.files || 0)}</b><span>변경 파일</span></div><div class="reviewMetric"><b>+${escapeHtml(state.source.stats?.additions || 0)} / -${escapeHtml(state.source.stats?.deletions || 0)}</b><span>diff</span></div><div class="reviewMetric"><b>${escapeHtml(state.explanationCoverage?.changedLinesExplained || 0)}/${escapeHtml(state.explanationCoverage?.totalChangedLines || 0)}</b><span>설명된 변경 줄</span></div><div class="reviewMetric"><b>${escapeHtml(state.cards.length)}</b><span>실제 리뷰 포인트</span></div></div></section>`;
}

function fileJumpButton(path: string, state: MetaReviewClientState): string {
	const file = state.source.files.find((item) => item.path === path);
	return `<button type="button"${attribute("data-review-file-jump", file?.id || "")}>${escapeHtml(path)}</button>`;
}

function relationshipHtml(state: MetaReviewClientState, mode: MetaReviewRenderMode): string {
	const relationship = state.document?.relationships;
	const relations = relationship?.relations || [];
	const source = relationshipMermaid(state);
	const diagram = source
		? `<div class="reviewRelationshipDiagram"${attribute("data-mermaid-source", encodeURIComponent(source))}><p class="small">파일 관계도를 렌더링하는 중입니다.</p></div>`
		: `<div class="reviewRelationshipEmpty">구조화된 relation이 없어 파일별 설명에서 관계를 확인합니다.</div>`;
	const rows = relations.length
		? `<div class="reviewRelationList">${relations.map((relation) => `<div class="reviewRelationRow">${fileJumpButton(relation.from, state)}<span>→</span>${fileJumpButton(relation.to, state)}<p>${escapeHtml(relation.label || "두 파일의 책임이 연결됩니다.")}</p></div>`).join("")}</div>`
		: `<div class="reviewRelationshipEmpty">구조화된 relation이 없어 파일별 설명에서 관계를 확인합니다.</div>`;
	return `<section class="${selectableClass("reviewRelationshipSection", mode)}" id="reviewRelationships"${selectionAttributes(mode, {
		"data-review-section": "relationships",
		"data-review-select-kind": "section",
		"data-review-select-id": "relationships",
		"data-review-select-label": "변경 파일 관계",
	})}><div class="reviewRelationshipHeader"><p class="reviewSectionLabel">Structure</p><h2>변경 파일 관계</h2><p>${escapeHtml(relationship?.summary || "파일별 역할과 호출·데이터 흐름을 함께 읽습니다.")}</p></div>${diagram}<div class="reviewRelationshipGuide"><div class="reviewRelationshipLegend"><b>관계를 읽는 법</b><ol><li>노드 번호는 오른쪽 읽는 흐름의 순서입니다.</li><li>화살표는 호출·데이터·상태가 전달되는 방향입니다.</li><li>선 위 문구는 두 파일이 연결되는 이유입니다.</li><li>먼저 01에서 시작한 뒤 화살표와 관계 해설을 따라가세요.</li></ol></div>${rows}</div></section>`;
}

const VISUAL_ROLE_META = {
	removed: { label: "제거·deprecated", className: "removed", stroke: "#b73535", rect: "rgb(253,232,232)" },
	new: { label: "신규·강화", className: "new", stroke: "#238b50", rect: "rgb(228,248,233)" },
	moved: { label: "책임 이동·통합", className: "moved", stroke: "#7142c4", rect: "rgb(238,232,255)" },
	preserved: { label: "유지되는 경계", className: "preserved", stroke: "#356fb8", rect: "rgb(233,241,251)" },
	guard: { label: "검증·충돌", className: "guard", stroke: "#b36a00", rect: "rgb(255,242,217)" },
	context: { label: "주변 문맥", className: "context", stroke: "#6f757c", rect: "rgb(241,242,244)" },
} as const;

type VisualRole = keyof typeof VISUAL_ROLE_META;

function roleMeta(role: unknown) {
	return VISUAL_ROLE_META[String(role || "context") as VisualRole] || VISUAL_ROLE_META.context;
}

function visualRoles(visual: any): VisualRole[] {
	const explicit = Array.isArray(visual?.legend) ? visual.legend : [];
	const derived = visual?.kind === "flowchart"
		? [...(visual.nodes || []).map((item: any) => item.role), ...(visual.edges || []).map((item: any) => item.role)]
		: visual?.kind === "sequence"
			? [...(visual.actors || []).map((item: any) => item.role), ...(visual.messages || []).map((item: any) => item.role)]
			: [];
	return [...new Set((explicit.length ? explicit : derived).filter((role: unknown) => role in VISUAL_ROLE_META))] as VisualRole[];
}

function meaningVisualMermaid(visual: any): string {
	if (!visual) return "";
	if (visual.kind === "flowchart") {
		const nodeAliases = new Map((visual.nodes || []).map((node: any, index: number) => [node.id, `N${index + 1}`]));
		const groupAliases = new Map((visual.groups || []).map((group: any, index: number) => [group.id, `G${index + 1}`]));
		const lines = [`flowchart ${visual.direction === "TB" ? "TB" : "LR"}`];
		for (const group of visual.groups || []) {
			const groupAlias = groupAliases.get(group.id);
			const phase = group.phase === "before" ? "BEFORE" : group.phase === "after" ? "AFTER" : "공통";
			lines.push(`subgraph ${groupAlias}["${phase} · ${mermaidText(group.label)}"]`, "direction TB");
			for (const node of (visual.nodes || []).filter((item: any) => item.groupId === group.id)) {
				lines.push(`${nodeAliases.get(node.id)}["${mermaidText(node.label)}${node.detail ? `<br/>${mermaidText(node.detail)}` : ""}"]`);
			}
			lines.push("end");
		}
		for (const node of (visual.nodes || []).filter((item: any) => !item.groupId)) {
			lines.push(`${nodeAliases.get(node.id)}["${mermaidText(node.label)}${node.detail ? `<br/>${mermaidText(node.detail)}` : ""}"]`);
		}
		for (const [index, edge] of (visual.edges || []).entries()) {
			const arrow = edge.style === "dashed" ? "-.->" : "-->";
			const label = edge.label ? `|${mermaidText(edge.label)}|` : "";
			lines.push(`${nodeAliases.get(edge.from)} ${arrow}${label} ${nodeAliases.get(edge.to)}`);
			const meta = roleMeta(edge.role);
			lines.push(`linkStyle ${index} stroke:${meta.stroke},stroke-width:2px${edge.style === "dashed" ? ",stroke-dasharray:5 4" : ""}`);
		}
		const styles: Record<VisualRole, string> = {
			removed: "fill:#fde8e8,stroke:#b73535,color:#6f2020,stroke-width:2px,stroke-dasharray:5 4",
			new: "fill:#e4f8e9,stroke:#238b50,color:#185d39,stroke-width:2px",
			moved: "fill:#eee8ff,stroke:#7142c4,color:#4f2b8f,stroke-width:3px",
			preserved: "fill:#e9f1fb,stroke:#356fb8,color:#244f85,stroke-width:2px",
			guard: "fill:#fff2d9,stroke:#b36a00,color:#754700,stroke-width:2px",
			context: "fill:#f1f2f4,stroke:#6f757c,color:#464b50,stroke-width:1.5px",
		};
		for (const role of Object.keys(styles) as VisualRole[]) {
			lines.push(`classDef role_${role} ${styles[role]}`);
			const aliases = (visual.nodes || []).filter((node: any) => node.role === role).map((node: any) => nodeAliases.get(node.id)).filter(Boolean);
			if (aliases.length) lines.push(`class ${aliases.join(",")} role_${role}`);
		}
		for (const group of visual.groups || []) {
			const style = group.phase === "before" ? "fill:#fff8e9,stroke:#dfbf7e,stroke-width:1px" : group.phase === "after" ? "fill:#f1fbf4,stroke:#8ac39e,stroke-width:1px" : "fill:#f2f6fb,stroke:#9bb2ce,stroke-width:1px";
			lines.push(`style ${groupAliases.get(group.id)} ${style}`);
		}
		return lines.join("\n");
	}
	if (visual.kind === "sequence") {
		const actorAliases = new Map((visual.actors || []).map((actor: any, index: number) => [actor.id, `A${index + 1}`]));
		const lines = ["sequenceDiagram", "autonumber"];
		for (const actor of visual.actors || []) lines.push(`participant ${actorAliases.get(actor.id)} as ${mermaidText(actor.label)}`);
		for (const message of visual.messages || []) {
			const from = actorAliases.get(message.from);
			const to = actorAliases.get(message.to);
			const meta = roleMeta(message.role);
			lines.push(`rect ${meta.rect}`, `${from}${message.style === "dashed" ? "-->>" : "->>"}${to}: ${mermaidText(message.label)}`);
			if (message.note) lines.push(`Note over ${from},${to}: ${mermaidText(message.note)}`);
			lines.push("end");
		}
		return lines.join("\n");
	}
	return "";
}

function meaningVisualHtml(visual: any): string {
	if (!visual) return "";
	const source = meaningVisualMermaid(visual);
	const legend = visualRoles(visual).map((role) => `<span class="${roleMeta(role).className}">${escapeHtml(roleMeta(role).label)}</span>`).join("");
	return `<div class="reviewMeaningVisual"${attribute("data-review-visual-kind", visual.kind)}><div class="reviewMeaningVisualHeader"><b>${escapeHtml(visual.title)}</b><div class="reviewMeaningVisualHeaderActions"><div class="reviewMeaningLegend">${legend}</div><button type="button" class="reviewMeaningVisualExpand" data-review-visual-expand${attribute("data-review-visual-title", visual.title)}${attribute("data-review-visual-hint", visual.readingHint)}>확대해서 보기</button></div></div><div class="reviewMeaningDiagramViewport"><div class="noteDiagramCanvas"${attribute("data-mermaid-source", encodeURIComponent(source))}><span class="small">변경 의미 다이어그램을 렌더링하는 중...</span></div></div><p class="reviewMeaningReadingHint"><b>읽는 법</b> · ${escapeHtml(visual.readingHint)}</p></div>`;
}

function meaningsHtml(state: MetaReviewClientState, mode: MetaReviewRenderMode): string {
	const meanings = state.document?.meanings || [];
	if (!meanings.length) return "";
	const cards = meanings.map((meaning) => {
		const basis = (meaning.basis || []).map((item) => `<span>${escapeHtml(`${item.kind} · ${item.path}${item.line ? `:${item.line}` : ""}`)}</span>`).join("");
		return `<article class="${selectableClass("reviewMeaning", mode)}"${selectionAttributes(mode, {
			"data-review-meaning": meaning.id,
			"data-review-evidence": (meaning.evidenceIds || []).join(","),
			"data-review-select-kind": "meaning",
			"data-review-select-id": meaning.id,
			"data-review-select-label": `변경 의미 · ${meaning.title}`,
		})}><div class="reviewMeaningHeader"><h3>${escapeHtml(meaning.title)}</h3><span class="reviewStatus">${escapeHtml(meaning.confidence || "unknown")}</span></div>${meaningVisualHtml(meaning.visual)}<div class="reviewMeaningTransition"><div class="reviewMeaningContract"><b>Before 계약</b>${escapeHtml(meaning.beforeContract)}</div><div class="reviewMeaningArrow">→</div><div class="reviewMeaningContract"><b>After 계약</b>${escapeHtml(meaning.afterContract)}</div></div><p><b>전환 메커니즘</b> · ${escapeHtml(meaning.mechanism)}</p><p><b>영향</b> · ${escapeHtml(meaning.impact)}</p><div class="reviewMeaningBasis">${basis}</div>${meaning.uncertainty ? `<p class="small">확인 필요 · ${escapeHtml(meaning.uncertainty)}</p>` : ""}</article>`;
	}).join("");
	return `<section class="reviewMeaningsSection" id="reviewMeanings"><div class="reviewMeaningsHeader"><p class="reviewSectionLabel">계약 전환</p><h2>변경 의미</h2><p>코드 위치가 아니라 계약·책임·흐름의 Before → After 전환으로 묶었습니다.</p></div><div class="reviewMeaningList">${cards}</div></section>`;
}

function findingsHtml(state: MetaReviewClientState, mode: MetaReviewRenderMode): string {
	const body = state.cards.length ? state.cards.map((card) => {
		const file = state.source.files.find((item) => card.code?.path === item.path);
		return `<article class="${selectableClass("reviewFindingIndex", mode)}"${attribute("data-review-card", card.id)}${attribute("data-review-file", file?.id || "")}${attribute("data-review-path", card.code?.path || "")}${selectionAttributes(mode, {
			"data-review-evidence": (card.evidenceIds || []).join(","),
			"data-review-select-kind": "card",
			"data-review-select-id": card.id,
			"data-review-select-label": `리뷰 포인트 · ${card.id} · ${card.title}`,
		})}><b>${escapeHtml(card.strength)}</b><div><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.explanation || card.reviewDraft || "실제 코드 근거를 확인해야 하는 리뷰 포인트입니다.")}</p><small>${escapeHtml(card.code?.path || "파일 위치 미확인")}</small></div><button type="button"${attribute("data-review-card-jump", card.id)}>코드 위치</button></article>`;
	}).join("") : `<div class="reviewRelationshipEmpty">직접 근거로 닫을 수 있는 review finding은 없습니다. 이는 승인이나 안전 보장을 의미하지 않습니다.</div>`;
	return `<section class="reviewFindingsSection" id="reviewAttention"><div class="reviewFindingsHeader"><p class="reviewSectionLabel">Review attention</p><h2>먼저 볼 점</h2><p>관계 설명과 분리된 실제 코드 review finding입니다. 코드 위치에서 근거와 판단을 함께 확인합니다.</p></div><div class="reviewFindingList">${body}</div></section>`;
}

function readingRailHtml(state: MetaReviewClientState): string {
	const relationship = state.document?.relationships;
	const reasonByPath = new Map((relationship?.readingOrder || []).map((step) => [step.path, step.reason]));
	const files = authoredFiles(state);
	const steps = files.map((file, index) => `<button type="button" class="reviewReadingStep"${attribute("data-review-file-jump", file.id)}${attribute("data-reading-file", file.id)}><b>${String(index + 1).padStart(2, "0")}</b><span>${escapeHtml(file.path)}<small>${escapeHtml(reasonByPath.get(file.path) || "나머지 변경 파일을 이어서 확인합니다.")}</small></span></button>`).join("");
	return `<aside class="reviewReadingRail" id="reviewReadingRail"><div class="reviewReadingRailHeader"><h3>읽는 흐름</h3><span id="reviewReadingProgress">0% 읽음</span></div><div class="reviewReadingOrder">${steps || `<div class="reviewRelationshipEmpty">구조화된 읽는 흐름이 없습니다.</div>`}</div><div class="reviewReadingRailFooter">${files.length} steps · ${relationship?.relations?.length || 0} relations</div></aside>`;
}

function compactLineRanges(values: Array<number | undefined>): string {
	const normalized = [...new Set(values.filter((value): value is number => Number.isInteger(value) && Number(value) > 0))].sort((left, right) => left - right);
	if (!normalized.length) return "";
	const groups: string[] = [];
	let start = normalized[0];
	let end = start;
	for (const value of normalized.slice(1)) {
		if (value === end + 1) {
			end = value;
			continue;
		}
		groups.push(start === end ? `L${start}` : `L${start}–L${end}`);
		start = end = value;
	}
	groups.push(start === end ? `L${start}` : `L${start}–L${end}`);
	return groups.join(" · ");
}

function lineRangeLabel(hunk: any, file: ReviewFile): string {
	const evidence = new Set(hunk.evidenceIds || []);
	const lines = file.lines.filter((line) => evidence.has(line.id));
	const before = compactLineRanges(lines.filter((line) => line.kind === "deletion").map((line) => line.oldLine));
	const after = compactLineRanges(lines.filter((line) => line.kind === "addition").map((line) => line.newLine));
	const parts = [before && `변경 전 ${before}`, after && `변경 후 ${after}`].filter(Boolean);
	if (parts.length) return parts.join(" · ");
	const fallback = compactLineRanges(lines.map((line) => line.newLine ?? line.oldLine));
	return fallback ? `대상 ${fallback}` : "";
}

function explanationHtml(hunk: any, file: ReviewFile, mode: MetaReviewRenderMode): string {
	const range = lineRangeLabel(hunk, file);
	return `<aside class="${selectableClass("reviewExplanation", mode)}"${attribute("data-review-hunk", hunk.id)}${attribute("data-review-file", file.id)}${attribute("data-review-path", file.path)}${selectionAttributes(mode, {
		"data-review-evidence": (hunk.evidenceIds || []).join(","),
		"data-review-select-kind": "hunk",
		"data-review-select-id": hunk.id,
		"data-review-select-label": `변경 단위 · ${hunk.title}${range ? ` · ${range}` : ""}`,
	})}><h4>📖 ${escapeHtml(hunk.title)} <span class="reviewStatus">설명 단위 · 여러 구조 범위 가능</span> <span class="reviewStatus">${escapeHtml(hunk.status || "new")}</span></h4>${range ? `<div class="reviewExplanationRange">설명 범위 · ${escapeHtml(range)}</div>` : ""}<dl><dt>무엇이 바뀌었나</dt><dd>${escapeHtml(hunk.whatChanged)}</dd><dt>왜 바뀌었나</dt><dd>${escapeHtml(hunk.why)}</dd><dt>코드·도메인 근거</dt><dd>${escapeHtml(hunk.evidence)}</dd><dt>이 레이어의 책임</dt><dd>${escapeHtml(hunk.responsibility)}</dd><dt>호출·데이터 영향</dt><dd>${escapeHtml(hunk.flowImpact)}</dd>${hunk.concepts?.length ? `<dt>사용된 개념</dt><dd>${escapeHtml(hunk.concepts.join(" · "))}</dd>` : ""}${hunk.uncertainty ? `<dt>❓ 확인 필요</dt><dd>${escapeHtml(hunk.uncertainty)}</dd>` : ""}</dl></aside>`;
}

function precedentHtml(card: ReviewCard): string {
	return (card.precedents || []).map((item) => {
		const url = safeHttpUrl(item.url);
		const label = escapeHtml(item.label);
		const link = url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>` : label;
		return `<p>${link} · ${escapeHtml(item.similarity || "")}${item.difference ? ` · 차이: ${escapeHtml(item.difference)}` : ""}</p>`;
	}).join("");
}

function inlineFindingHtml(card: ReviewCard, file: ReviewFile, mode: MetaReviewRenderMode): string {
	const draft = card.editedReviewDraft || card.reviewDraft || "";
	const liveEditor = mode === "live"
		? `<label>리뷰 문구 수정<textarea data-review-draft>${escapeHtml(draft)}</textarea></label></details><div class="reviewActions"><button class="primary" data-review-decision="review-only">리뷰 채택</button><button data-review-decision="review-with-meta">메타 포함</button><button data-review-decision="edit">수정 저장</button><button data-review-decision="follow-up">후속</button><button data-review-decision="hold">보류</button><button data-review-decision="dismiss">폐기</button></div>`
		: `</details>`;
	return `<aside class="${selectableClass("reviewFinding", mode)}"${attribute("data-review-card", card.id)}${attribute("data-review-file", file.id)}${attribute("data-review-path", file.path)}${selectionAttributes(mode, {
		"data-review-evidence": (card.evidenceIds || []).join(","),
		"data-review-select-kind": "card",
		"data-review-select-id": card.id,
		"data-review-select-label": `리뷰 포인트 · ${card.id} · ${card.title}`,
	})}><h4>⚠️ ${escapeHtml(card.id)} · ${escapeHtml(card.title)}</h4><div class="small">${escapeHtml(card.strength)} · confidence ${escapeHtml(card.confidence)}${card.decision ? ` · ${escapeHtml(card.decision)}` : ""}</div><div class="reviewFindingDraft">${escapeHtml(draft)}</div><p>${escapeHtml(card.explanation || "")}</p><details><summary>메타적 관점과 인간 리뷰 precedent</summary><p>${escapeHtml(card.meta?.summary || "")}</p>${precedentHtml(card)}${liveEditor}</aside>`;
}

function fileIntroHtml(file: ReviewFile, guide: ReviewGuide | undefined, mode: MetaReviewRenderMode): string {
	return `<div class="${selectableClass("reviewFileIntro", mode)}"${attribute("data-review-file", file.id)}${attribute("data-review-path", file.path)}${selectionAttributes(mode, {
		"data-review-select-kind": "file",
		"data-review-select-id": file.id,
		"data-review-select-label": `파일 · ${file.path}`,
	})}>${guide ? `<p><b>파일 역할</b> · ${escapeHtml(guide.role)}</p><p><b>이 PR에서 바뀐 이유</b> · ${escapeHtml(guide.changeReason)}</p><p><b>호출·데이터 흐름</b> · ${escapeHtml(guide.flow)}</p><p><b>사용자·후속 영향</b> · ${escapeHtml(guide.impact || "직접 사용자 영향은 없거나 diff에서 확인되지 않았습니다.")}</p>` : `<p>이 파일의 학습 설명이 기록되지 않았습니다.</p>`}</div>`;
}

const DECLARATION_KIND_LABELS: Record<string, string> = {
	file: "파일", import: "import", variable: "변수", function: "함수", component: "함수", hook: "함수", method: "메서드", constructor: "생성자", class: "클래스", interface: "인터페이스", type: "타입", enum: "enum", namespace: "namespace", property: "속성", accessor: "접근자", "test-suite": "테스트 묶음", test: "테스트",
};

function declarationForLine(file: any, line: any): { declaration: any; side: "before" | "after" } | undefined {
	const declarations = file.declarationSource?.declarations || [];
	const side = line.kind === "deletion" ? "before" : "after";
	const lineNumber = side === "before" ? line.oldLine : line.newLine;
	if (!lineNumber) return undefined;
	const candidates = declarations.filter((declaration: any) => declaration.kind !== "file" && declaration[side] && lineNumber >= declaration[side].startLine && lineNumber <= declaration[side].endLine)
		.sort((left: any, right: any) => (left[side].endLine - left[side].startLine) - (right[side].endLine - right[side].startLine) || right.depth - left.depth || left.id.localeCompare(right.id));
	return candidates[0] ? { declaration: candidates[0], side } : undefined;
}

function lineSelection(line: any, file: ReviewFile, hunk: any): any {
	const declaration = declarationForLine(file, line);
	if (declaration) {
		const range = declaration.declaration[declaration.side];
		return {
			selectionKind: "declaration",
			selectionId: declaration.declaration.id,
			selectionLabel: `${DECLARATION_KIND_LABELS[declaration.declaration.kind] || "선언"} · ${declaration.declaration.name} · ${declaration.side === "before" ? "변경 전" : "변경 후"} L${range.startLine}${range.startLine === range.endLine ? "" : `–L${range.endLine}`}`,
			declarationId: declaration.declaration.id,
			declarationSide: declaration.side,
			evidenceIds: [...(declaration.declaration.evidenceIds || [])],
		};
	}
	if (hunk) return { selectionKind: "hunk", selectionId: hunk.id, selectionLabel: `변경 단위 · ${hunk.title}`, evidenceIds: [...(hunk.evidenceIds || [])] };
	const lineNumber = line.newLine ?? line.oldLine;
	return { selectionKind: "line", selectionId: line.id, selectionLabel: `코드 줄 · ${file.path}${lineNumber == null ? "" : `:${lineNumber}`}`, evidenceIds: [line.id] };
}

function fileHtml(state: MetaReviewClientState, file: ReviewFile, index: number, mode: MetaReviewRenderMode): string {
	const guide = guideFor(state, file.path);
	const hunks = guide?.hunks || [];
	const cards = state.cards.filter((card) => card.code?.path === file.path);
	const lineIndexById = new Map(file.lines.map((line, lineIndex) => [line.id, lineIndex]));
	const hunkByEvidence = new Map<string, any>();
	const afterLine = new Map<string, string[]>();
	for (const hunk of hunks) {
		const ordered = (hunk.evidenceIds || []).filter((id) => lineIndexById.has(id)).sort((left, right) => Number(lineIndexById.get(left)) - Number(lineIndexById.get(right)));
		for (const id of ordered) hunkByEvidence.set(id, hunk);
		const anchor = ordered.at(-1) || hunk.evidenceIds?.at(-1);
		if (anchor) afterLine.set(anchor, [...(afterLine.get(anchor) || []), explanationHtml(hunk, file, mode)]);
	}
	for (const card of cards) {
		const anchor = card.evidenceIds?.at(-1);
		if (anchor) afterLine.set(anchor, [...(afterLine.get(anchor) || []), inlineFindingHtml(card, file, mode)]);
	}
	const selections = file.lines.map((line) => lineSelection(line, file, hunkByEvidence.get(line.id)));
	const unitKey = (selection: any) => selection?.selectionKind === "declaration" || selection?.selectionKind === "hunk" ? `${selection.selectionKind}:${selection.selectionId}` : "";
	const diff = file.lines.map((line, lineIndex) => {
		const hunk = hunkByEvidence.get(line.id);
		const selection = selections[lineIndex];
		const key = unitKey(selection);
		const previous = lineIndex ? unitKey(selections[lineIndex - 1]) : "";
		const next = lineIndex < selections.length - 1 ? unitKey(selections[lineIndex + 1]) : "";
		const declaration = selection.selectionKind === "declaration" ? file.declarationSource?.declarations?.find((item: any) => item.id === selection.declarationId) : undefined;
		const unitClass = declaration ? ` reviewDeclarationUnit${key !== previous ? " reviewDeclarationStart" : ""}${key !== next ? " reviewDeclarationEnd" : ""}` : hunk ? ` reviewSemanticUnit${key !== previous ? " reviewSemanticStart" : ""}${key !== next ? " reviewSemanticEnd" : ""}` : "";
		const attrs = selectionAttributes(mode, {
			"data-review-evidence": (selection.evidenceIds || []).join(","),
			"data-review-file": file.id,
			"data-review-path": file.path,
			"data-review-select-kind": selection.selectionKind,
			"data-review-select-id": selection.selectionId,
			"data-review-select-label": selection.selectionLabel,
			"data-review-declaration": selection.declarationId,
			"data-review-declaration-side": selection.declarationSide,
		});
		const header = mode === "live" && declaration && key !== previous
			? `<div class="reviewDeclarationUnitHeader reviewSelectable"${attrs}><b>${escapeHtml(DECLARATION_KIND_LABELS[declaration.kind] || "선언")}</b><span>${escapeHtml(declaration.name)}</span><small>${escapeHtml(selection.selectionLabel)}</small></div>`
			: mode === "live" && hunk && key !== previous
				? `<div class="reviewSemanticUnitHeader reviewSelectable"${attrs}><b>변경 단위</b><span>${escapeHtml(hunk.title)}</span><small>${escapeHtml(lineRangeLabel(hunk, file))}</small></div>`
				: "";
		const kind = escapeHtml(String(line.kind || "metadata").replaceAll("_", "-"));
		const row = `<div class="${selectableClass(`reviewLine ${kind}${unitClass}`, mode)}"${attribute("data-review-line", line.id)}${attrs}><span class="reviewLineNo">${escapeHtml(line.oldLine ?? "")}</span><span class="reviewLineNo">${escapeHtml(line.newLine ?? "")}</span><span class="reviewLineCode">${escapeHtml(line.text)}</span></div>`;
		return `${header}${row}${(afterLine.get(line.id) || []).join("")}`;
	}).join("");
	const summary = cards.length ? cards.map((card) => card.title).join(" · ") : guide?.changeReason || "전체 diff를 검토했고 별도 review finding은 없습니다.";
	return `<details class="reviewFile"${attribute("data-review-file-section", file.id)}${attribute("data-review-path", file.path)}><summary><div class="reviewFileSummaryRow"><span class="reviewFileNumber">${String(index + 1).padStart(2, "0")}</span><span class="reviewFilePath">${escapeHtml(file.path)}</span><span class="reviewFileSummary">${escapeHtml(summary)}</span><span class="reviewFileCount">+${escapeHtml(file.additions)} / -${escapeHtml(file.deletions)}</span><span class="reviewFileToggle" aria-hidden="true"></span></div>${fileIntroHtml(file, guide, mode)}</summary><div class="reviewFileBody">${mode === "live" ? `<div class="reviewDeclarationPreviewHost"${attribute("data-review-declaration-host", file.id)}></div>` : ""}<div class="reviewDiff">${diff}</div></div></details>`;
}

function filesHtml(state: MetaReviewClientState, mode: MetaReviewRenderMode): string {
	return `<section class="reviewFiles"><div class="reviewFilesHeader"><p class="reviewSectionLabel">Guided diff</p><h2>파일별 변경과 설명</h2></div>${authoredFiles(state).map((file, index) => fileHtml(state, file, index, mode)).join("")}</section>`;
}

export function renderMetaReviewDocument(state: MetaReviewClientState, options: MetaReviewRenderOptions): string {
	const mode = options.mode;
	return `<div class="reviewLayout"><main class="reviewMain">${overviewHtml(state, mode)}${relationshipHtml(state, mode)}${meaningsHtml(state, mode)}${findingsHtml(state, mode)}${filesHtml(state, mode)}</main>${readingRailHtml(state)}</div>`;
}

export function buildMetaReviewLivePayload(state: MetaReviewClientState): MetaReviewLivePayload {
	return { ...state, documentHtml: renderMetaReviewDocument(state, { mode: "live" }) };
}

function staticQuestionsHtml(state: MetaReviewClientState): string {
	if (!state.questions.length) return "";
	const questions = state.questions.map((question) => {
		const scope = question.selection?.label || question.filePath || question.scope;
		const worker = question.workerRunId ? `worker #${question.workerRunId}` : "직접 응답 또는 미배정";
		const evidence = (question.evidence || []).map((item) => {
			const location = [item.path, item.line].filter(Boolean).join(":");
			const url = safeHttpUrl(item.url);
			const label = escapeHtml(`${item.label}${location ? ` · ${location}` : ""}${item.note ? ` · ${item.note}` : ""}`);
			return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>` : `<span>${label}</span>`;
		}).join("");
		const answer = question.answer ? `<div class="reviewStaticAnswer">${escapeHtml(question.answer)}</div>` : "";
		const uncertainty = question.uncertainty ? `<p class="small">미확인 · ${escapeHtml(question.uncertainty)}</p>` : "";
		const error = question.error ? `<p class="small">처리 오류 · ${escapeHtml(question.error)}</p>` : "";
		const change = question.change;
		const failedValidation = change?.validation?.filter((item) => item.status === "failed").map((item) => item.command).join(", ") || "";
		const changeHtml = change ? `<div class="reviewStaticQuestionChange"><b>로컬 변경 · ${escapeHtml(change.status)}</b><span>파일 · ${escapeHtml(change.files.join(", ") || "없음")}</span><span>리뷰 갱신 · ${escapeHtml(change.refreshedRunId || "미실행")}${change.refreshMode ? ` · ${escapeHtml(change.refreshMode)}` : ""}</span>${failedValidation ? `<span>실패한 검증 · ${escapeHtml(failedValidation)}</span>` : ""}${change.refreshError ? `<span>갱신 오류 · ${escapeHtml(change.refreshError)}</span>` : ""}</div>` : "";
		return `<article class="reviewStaticQuestion"><h3>${escapeHtml(`${question.id} · ${question.question}`)}</h3><div class="reviewStaticQuestionMeta"><span>범위 · ${escapeHtml(scope)}</span><span>상태 · ${escapeHtml(question.status)}</span><span>${escapeHtml(worker)}</span></div>${answer}${uncertainty}${error}${evidence ? `<div class="reviewStaticQuestionEvidence">${evidence}</div>` : ""}${changeHtml}</article>`;
	}).join("");
	return `<section class="reviewStaticQuestions"><div class="reviewStaticQuestionsHeader"><p class="reviewSectionLabel">Read-only conversation</p><h2>질문과 답변</h2><p class="small">Glimpse 질문 drawer에 기록된 대화와 적용 결과를 읽기 전용으로 보존합니다.</p></div><div class="reviewStaticQuestionList">${questions}</div></section>`;
}

function staticRuntimeScript(): string {
	return String.raw`(function(){
	var readFiles=new Set(),renderVersion=0;
	function updateReading(){var buttons=Array.from(document.querySelectorAll('[data-reading-file]')),known=new Set(buttons.map(function(button){return button.dataset.readingFile;}).filter(Boolean)),count=Array.from(readFiles).filter(function(id){return known.has(id);}).length,progress=document.getElementById('reviewReadingProgress');if(progress)progress.textContent=(known.size?Math.round(count/known.size*100):0)+'% 읽음';buttons.forEach(function(button){button.classList.toggle('active',readFiles.has(button.dataset.readingFile));});}
	function openFile(fileId,cardId){if(!fileId)return;readFiles.add(fileId);var section=Array.from(document.querySelectorAll('[data-review-file-section]')).find(function(item){return item.dataset.reviewFileSection===fileId;});if(!section)return;section.open=true;updateReading();setTimeout(function(){var target=cardId?Array.from(section.querySelectorAll('[data-review-card]')).find(function(item){return item.dataset.reviewCard===cardId;}):section;(target||section).scrollIntoView({behavior:'smooth',block:'start'});},0);}
	document.querySelectorAll('[data-review-file-jump]').forEach(function(button){button.addEventListener('click',function(event){event.preventDefault();openFile(button.dataset.reviewFileJump);});});
	document.querySelectorAll('[data-review-card-jump]').forEach(function(button){button.addEventListener('click',function(event){event.preventDefault();var card=document.querySelector('[data-review-card="'+button.dataset.reviewCardJump+'"]'),fileId=card&&card.dataset.reviewFile;openFile(fileId,button.dataset.reviewCardJump);});});
	document.querySelectorAll('[data-review-file-section]').forEach(function(section){section.addEventListener('toggle',function(){if(section.open){readFiles.add(section.dataset.reviewFileSection);updateReading();}});});
	function fallback(target,source){target.textContent='';var pre=document.createElement('pre');pre.className='diagramFallback';pre.textContent=source;target.appendChild(pre);}
	async function renderDiagrams(){var targets=Array.from(document.querySelectorAll('[data-mermaid-source]'));if(window.mermaid)window.mermaid.initialize(${JSON.stringify(META_REVIEW_MERMAID_CONFIG)});for(var index=0;index<targets.length;index++){var target=targets[index],source=decodeURIComponent(target.dataset.mermaidSource||'');try{if(!window.mermaid)throw new Error('offline');var result=await window.mermaid.render('meta-review-static-'+(++renderVersion),source);target.innerHTML=result.svg;}catch(error){fallback(target,source);}}}
	function closeVisual(){var overlay=document.getElementById('reviewMeaningVisualOverlay');if(overlay)overlay.hidden=true;}
	document.querySelectorAll('[data-review-visual-expand]').forEach(function(button){button.addEventListener('click',async function(){var visual=button.closest('.reviewMeaningVisual'),sourceTarget=visual&&visual.querySelector('[data-mermaid-source]'),source=sourceTarget&&decodeURIComponent(sourceTarget.dataset.mermaidSource||''),overlay=document.getElementById('reviewMeaningVisualOverlay'),stage=document.getElementById('reviewMeaningVisualOverlayStage');if(!overlay||!stage||!source)return;document.getElementById('reviewMeaningVisualOverlayTitle').textContent=button.dataset.reviewVisualTitle||'차트 확대 보기';document.getElementById('reviewMeaningVisualOverlayHint').textContent='읽는 법 · '+(button.dataset.reviewVisualHint||'원본 SVG를 크게 확인합니다.');overlay.hidden=false;try{if(!window.mermaid)throw new Error('offline');var result=await window.mermaid.render('meta-review-static-overlay-'+(++renderVersion),source);stage.innerHTML=result.svg;}catch(error){fallback(stage,source);}});});
	var close=document.getElementById('reviewMeaningVisualOverlayClose');if(close)close.addEventListener('click',closeVisual);
	var overlay=document.getElementById('reviewMeaningVisualOverlay');if(overlay)overlay.addEventListener('click',function(event){if(event.target===overlay)closeVisual();});
	updateReading();void renderDiagrams();
})();`;
}

export function buildMetaReviewStandaloneHtml(state: MetaReviewClientState): string {
	const target = state.run.target;
	const title = target.kind === "current-work" ? `Meta Review · ${target.title}` : `Meta Review · #${target.number} ${target.title}`;
	const sourceUrl = safeHttpUrl(target.url);
	const revision = state.run.revisionNumber || 1;
	const updatedAt = new Date(state.run.updatedAt).toLocaleString("ko-KR");
	return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeHtml(title)}</title>
<style>:root{color-scheme:light;--bg:#f6f1e7;--panel:#fffdf8;--panel2:#eee8de;--line:#d8cfc1;--text:#2d2925;--muted:#756e66;--accent:#157a6e;--ok:#3f7d54;--warn:#b7791f;--bad:#b9505b;--review:#7660a9}*{box-sizing:border-box}html,body{width:100%;min-height:100%;margin:0}body{background:#f8f7f4;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}button,textarea{font:inherit}button{color:#403a34;background:#fffaf2;border:1px solid #cfc4b5;border-radius:10px;padding:8px 11px;font-weight:750;cursor:pointer}button:hover{border-color:#9f9282;background:#f8f1e6}a{color:#166a61}.staticReviewHeader{display:flex;justify-content:space-between;gap:20px;padding:18px 22px;border-bottom:1px solid var(--line);background:#fbf7ef}.staticReviewHeader h1{margin:0 0 5px;font-size:18px}.staticReviewHeader p{margin:0;color:var(--muted);font-size:11px}.staticReviewHeader a{align-self:center}.reviewBody{overflow:visible;min-height:auto}.reviewDocument{max-width:1680px}.small{color:var(--muted);font-size:11px;line-height:1.5}.diagramFallback{white-space:pre-wrap;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#4b443d}.noteDiagramCanvas{min-height:260px;padding:18px;overflow:auto;display:grid;place-items:center}.noteDiagramCanvas svg{display:block;max-width:100%!important;height:auto}.reviewSelectable{cursor:default}${META_REVIEW_DOCUMENT_CSS}</style>
</head><body><header class="staticReviewHeader"><div><h1>${escapeHtml(title)}</h1><p>Meta Review · revision ${escapeHtml(revision)} · ${escapeHtml(updatedAt)}</p></div>${sourceUrl ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">원본 자료</a>` : ""}</header><div class="reviewBody"><article id="metaReviewDocument" class="reviewDocument">${renderMetaReviewDocument(state, { mode: "static" })}${staticQuestionsHtml(state)}</article></div><section id="reviewMeaningVisualOverlay" class="reviewMeaningVisualOverlay" hidden role="dialog" aria-modal="true" aria-labelledby="reviewMeaningVisualOverlayTitle"><div class="reviewMeaningVisualOverlayDialog"><header class="reviewMeaningVisualOverlayHeader"><div><p>변경 의미 차트</p><h2 id="reviewMeaningVisualOverlayTitle">차트 확대 보기</h2></div><button id="reviewMeaningVisualOverlayClose" type="button" class="primary">닫기</button></header><div class="reviewMeaningVisualOverlayMeta"><p id="reviewMeaningVisualOverlayHint" class="reviewMeaningVisualOverlayHint">원본 SVG를 크게 확인합니다.</p></div><div class="reviewMeaningVisualOverlayCanvas"><div id="reviewMeaningVisualOverlayStage" class="reviewMeaningVisualOverlayStage"></div></div></div></section><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script><script>${staticRuntimeScript()}</script></body></html>`;
}
