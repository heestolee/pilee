import type { StudyNoteBlock, StudyNoteDocument, StudyNoteSection } from "../study-hard/studio.ts";
import { buildMetaReviewClientState, type MetaReviewClientState } from "./view-model.ts";

export interface MetaReviewExportReadingStep {
	path: string;
	reason: string;
	sectionId: string;
}

export interface MetaReviewExportSnapshot {
	runId: string;
	seriesId: string;
	revision: number;
	updatedAt: number;
	title: string;
	sourceUrl: string;
	sourceSha256: string;
	readingFlow: MetaReviewExportReadingStep[];
	noteDocument: StudyNoteDocument;
}

function noteId(scope: string, index: number): string {
	return `meta-review-${scope}-${index + 1}`;
}

function paragraph(id: string, text: string): StudyNoteBlock {
	return { id, type: "paragraph", text };
}

function heading(id: string, text: string, level: 2 | 3 = 2): StudyNoteBlock {
	return { id, type: "heading", level, text };
}

function table(id: string, rows: string[][]): StudyNoteBlock {
	return { id, type: "table", columns: ["항목", "내용"], rows };
}

function codeLanguage(path: string): string {
	const extension = path.split(".").pop()?.toLowerCase();
	return ({ ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json", py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", swift: "swift", sql: "sql", sh: "bash", yml: "yaml", yaml: "yaml", md: "markdown" } as Record<string, string>)[extension || ""] || "text";
}

function evidenceCode(file: MetaReviewClientState["source"]["files"][number] | undefined, evidenceIds: string[]): string {
	if (!file) return "";
	const selected = new Set(evidenceIds);
	return file.lines
		.filter((line) => selected.has(line.id))
		.map((line) => {
			const marker = line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " ";
			const number = line.kind === "addition" ? line.newLine : line.oldLine ?? line.newLine;
			return `${marker}${number ? String(number).padStart(5, " ") : "     "} | ${line.text}`;
		})
		.join("\n");
}

function overviewSection(state: MetaReviewClientState): StudyNoteSection {
	const target = state.run.target;
	const coverage = state.explanationCoverage;
	const document = state.document;
	const blocks: StudyNoteBlock[] = [
		{
			id: "meta-review-overview-summary",
			type: "callout",
			tone: "info",
			title: "한눈에 보기",
			body: document?.overview.summary || "Meta Review 문서가 아직 요약을 포함하지 않습니다.",
		},
		table("meta-review-overview-meta", [
			["대상", target.url],
			["기준", target.headSha || state.source.sourceSha256],
			["검토 초점", document?.overview.reviewFocus || "미기록"],
			["설명 coverage", `파일 ${coverage.filesExplained}/${coverage.totalFiles} · 변경 줄 ${coverage.changedLinesExplained}/${coverage.totalChangedLines}`],
			["실제 리뷰 포인트", `${state.cards.length}개`],
		]),
	];
	return { id: "meta-review-overview", kind: "overview", title: "한눈에 보기", blocks };
}

function relationshipSection(state: MetaReviewClientState): StudyNoteSection | undefined {
	const relationships = state.document?.relationships;
	if (!relationships) return undefined;
	const blocks: StudyNoteBlock[] = [paragraph("meta-review-relationships-summary", relationships.summary)];
	if (relationships.relations.length) {
		blocks.push({
			id: "meta-review-relationships-table",
			type: "table",
			columns: ["출발", "도착", "관계", "상세"],
			rows: relationships.relations.map((relation) => [relation.from, relation.to, relation.label, relation.detail || ""]),
		});
	}
	if (relationships.readingOrder.length) {
		blocks.push(
			heading("meta-review-reading-order-title", "읽는 흐름"),
			{
				id: "meta-review-reading-order",
				type: "list",
				ordered: true,
				items: relationships.readingOrder.map((step) => `${step.path} — ${step.reason}`),
			},
		);
	}
	return { id: "meta-review-relationships", kind: "flow", title: "변경 파일 관계와 읽는 순서", blocks };
}

function meaningsSection(state: MetaReviewClientState): StudyNoteSection | undefined {
	const meanings = state.document?.meanings || [];
	if (!meanings.length) return undefined;
	const blocks: StudyNoteBlock[] = [];
	for (const [index, meaning] of meanings.entries()) {
		const prefix = `meta-review-meaning-${index + 1}`;
		blocks.push(
			heading(`${prefix}-heading`, `${meaning.id} · ${meaning.title}`),
			table(`${prefix}-contract`, [
				["Before 계약", meaning.beforeContract],
				["After 계약", meaning.afterContract],
				["전환 메커니즘", meaning.mechanism],
				["영향", meaning.impact],
				["연결 파일", meaning.paths.join(", ")],
				["근거 신뢰도", meaning.confidence],
			]),
			{
				id: `${prefix}-basis`,
				type: "list",
				items: meaning.basis.map((basis) => `${basis.kind} · ${basis.path}${basis.line ? `:${basis.line}` : ""} — ${basis.summary}`),
			},
		);
		if (meaning.visual) {
			const visualItems = meaning.visual.kind === "flowchart"
				? meaning.visual.nodes.map((node) => `${node.label} (${node.role})`)
				: meaning.visual.messages.map((message) => `${message.from} → ${message.to}: ${message.label}`);
			blocks.push({ id: `${prefix}-visual`, type: "callout", tone: "info", title: `시각화 · ${meaning.visual.title}`, body: `${meaning.visual.readingHint}\n\n${visualItems.join("\n")}` });
		}
		if (meaning.uncertainty) blocks.push({ id: `${prefix}-uncertainty`, type: "callout", tone: "warning", title: "확인 필요", body: meaning.uncertainty });
	}
	return { id: "meta-review-meanings", kind: "overview", title: "변경 의미", blocks };
}

function findingsSection(state: MetaReviewClientState): StudyNoteSection | undefined {
	if (!state.cards.length) return undefined;
	const blocks: StudyNoteBlock[] = [];
	for (const [index, card] of state.cards.entries()) {
		const prefix = `meta-review-finding-${index + 1}`;
		blocks.push(
			heading(`${prefix}-heading`, `${card.id} · ${card.title}`),
			{
				id: `${prefix}-draft`,
				type: "callout",
				tone: card.strength === "required" ? "warning" : card.strength === "question" ? "question" : "info",
				title: card.editedReviewDraft ? "편집한 리뷰 초안" : "리뷰 초안",
				body: card.editedReviewDraft || card.reviewDraft,
			},
			table(`${prefix}-meta`, [
				["강도", card.strength],
				["신뢰도", card.confidence],
				["범위", card.meta.scope],
				["사람 결정", card.decision || "미결정"],
			]),
			paragraph(`${prefix}-explanation`, card.explanation),
			paragraph(`${prefix}-summary`, card.meta.summary),
		);
		if (card.code?.text) blocks.push({ id: `${prefix}-code`, type: "code", code: { language: card.code.language || codeLanguage(card.code.path), code: card.code.text, lineNumberMode: card.code.startLine ? "source" : "relative", startLine: card.code.startLine, reference: { kind: "code", label: card.code.path, path: card.code.path, startLine: card.code.startLine } } });
		const guards = [card.meta.existingGuard && `기존 가드: ${card.meta.existingGuard}`, card.meta.structuralPrevention && `구조적 방지: ${card.meta.structuralPrevention}`, card.meta.machinePrevention && `기계적 방지: ${card.meta.machinePrevention}`].filter(Boolean) as string[];
		if (guards.length) blocks.push({ id: `${prefix}-guards`, type: "list", items: guards });
		if (card.precedents?.length) blocks.push({ id: `${prefix}-precedents`, type: "reference-list", references: card.precedents.map((precedent) => ({ kind: "link", label: precedent.label, url: precedent.url, note: `${precedent.similarity}${precedent.difference ? ` · 차이: ${precedent.difference}` : ""}` })) });
	}
	return { id: "meta-review-findings", kind: "reflection", title: "실제 리뷰 포인트", blocks };
}

function orderedFileGuides(state: MetaReviewClientState): Array<{ guide: MetaReviewClientState["guides"][number]; fileIndex: number; sectionId: string }> {
	const indexed = state.guides.map((guide, fileIndex) => ({ guide, fileIndex, sectionId: `meta-review-file-${fileIndex + 1}` }));
	const byPath = new Map(indexed.map((item) => [item.guide.path, item]));
	const seen = new Set<string>();
	const ordered = (state.document?.relationships?.readingOrder || []).flatMap((step) => {
		const item = byPath.get(step.path);
		if (!item || seen.has(step.path)) return [];
		seen.add(step.path);
		return [item];
	});
	return [...ordered, ...indexed.filter((item) => !seen.has(item.guide.path))];
}

function fileSections(state: MetaReviewClientState): StudyNoteSection[] {
	return orderedFileGuides(state).map(({ guide, fileIndex, sectionId }) => {
		const file = state.source.files.find((candidate) => candidate.path === guide.path);
		const blocks: StudyNoteBlock[] = [
			{
				id: noteId(`file-${fileIndex + 1}-intro`, 0),
				type: "callout",
				tone: "info",
				title: "파일 책임과 변경 이유",
				body: `${guide.role}\n\n${guide.changeReason}`,
			},
			table(noteId(`file-${fileIndex + 1}-flow`, 0), [["호출·데이터 흐름", guide.flow], ["사용자·후속 영향", guide.impact || "직접 영향 미기록"]]),
		];
		for (const [hunkIndex, hunk] of guide.hunks.entries()) {
			const prefix = `meta-review-file-${fileIndex + 1}-hunk-${hunkIndex + 1}`;
			blocks.push(
				heading(`${prefix}-heading`, `${hunk.id} · ${hunk.title}`, 3),
				table(`${prefix}-explanation`, [
					["무엇이 바뀌었나", hunk.whatChanged],
					["왜 바뀌었나", hunk.why],
					["코드·도메인 근거", hunk.evidence],
					["이 레이어의 책임", hunk.responsibility],
					["호출·데이터 흐름과 영향", hunk.flowImpact],
					["사용된 개념", hunk.concepts?.join(", ") || "없음"],
					["상태", hunk.status],
				]),
			);
			const source = evidenceCode(file, hunk.evidenceIds);
			if (source) blocks.push({ id: `${prefix}-code`, type: "code", code: { language: "diff", code: source, lineNumberMode: "none", reference: { kind: "code", label: guide.path, path: guide.path } } });
			if (hunk.uncertainty) blocks.push({ id: `${prefix}-uncertainty`, type: "callout", tone: "warning", title: "불확실한 가정", body: hunk.uncertainty });
		}
		return { id: sectionId, kind: "node", subjectId: file?.id, title: guide.path, blocks };
	});
}

function questionsSection(state: MetaReviewClientState): StudyNoteSection | undefined {
	if (!state.questions.length) return undefined;
	const blocks: StudyNoteBlock[] = [];
	for (const [index, question] of state.questions.entries()) {
		const prefix = `meta-review-question-${index + 1}`;
		blocks.push(
			heading(`${prefix}-heading`, `${question.id} · ${question.question}`),
			table(`${prefix}-meta`, [
				["범위", question.selection?.label || question.filePath || question.scope],
				["상태", question.status],
				["worker", question.workerRunId ? `#${question.workerRunId}` : "직접 응답 또는 미배정"],
			]),
		);
		if (question.answer) blocks.push({ id: `${prefix}-answer`, type: "callout", tone: question.status === "answered" ? "success" : "info", title: "답변", body: question.answer });
		if (question.uncertainty) blocks.push({ id: `${prefix}-uncertainty`, type: "callout", tone: "warning", title: "불확실성", body: question.uncertainty });
		if (question.error) blocks.push({ id: `${prefix}-error`, type: "callout", tone: "warning", title: "처리 오류", body: question.error });
		if (question.evidence?.length) blocks.push({ id: `${prefix}-evidence`, type: "reference-list", references: question.evidence.map((evidence, evidenceIndex) => ({ id: `${prefix}-evidence-${evidenceIndex + 1}`, kind: evidence.path ? "code" : "link", label: evidence.label, path: evidence.path, line: undefined, startLine: evidence.line, url: evidence.url, note: evidence.note })) });
		if (question.change) blocks.push({ id: `${prefix}-change`, type: "list", items: [`로컬 변경 상태: ${question.change.status}`, `로컬 변경 파일: ${question.change.files.join(", ") || "없음"}`, `리뷰 갱신: ${question.change.refreshedRunId || "미실행"}${question.change.refreshMode ? ` · ${question.change.refreshMode}` : ""}`] });
	}
	return { id: "meta-review-questions", kind: "reflection", title: "질문과 답변", blocks };
}

export function buildMetaReviewNoteDocument(state: MetaReviewClientState): StudyNoteDocument {
	const target = state.run.target;
	const title = target.kind === "current-work" ? `Meta Review · ${target.title}` : `Meta Review · #${target.number} ${target.title}`;
	const sections = [overviewSection(state), relationshipSection(state), meaningsSection(state), findingsSection(state), ...fileSections(state), questionsSection(state)].filter(Boolean) as StudyNoteSection[];
	return { title, sections };
}

function buildMetaReviewReadingFlow(state: MetaReviewClientState): MetaReviewExportReadingStep[] {
	const sectionIdByPath = new Map(orderedFileGuides(state).map((item) => [item.guide.path, item.sectionId]));
	return (state.document?.relationships?.readingOrder || []).flatMap((step) => {
		const sectionId = sectionIdByPath.get(step.path);
		return sectionId ? [{ path: step.path, reason: step.reason, sectionId }] : [];
	});
}

export function buildMetaReviewExportSnapshotFromState(state: MetaReviewClientState): MetaReviewExportSnapshot {
	if (state.run.status !== "ready") throw new Error("완료된 Meta Review revision이 없어 내보낼 수 없습니다.");
	const noteDocument = buildMetaReviewNoteDocument(state);
	return {
		runId: state.run.runId,
		seriesId: state.series?.seriesId || state.run.runId,
		revision: state.run.revisionNumber || 1,
		updatedAt: state.run.updatedAt,
		title: noteDocument.title,
		sourceUrl: state.run.target.url,
		sourceSha256: state.source.sourceSha256,
		readingFlow: buildMetaReviewReadingFlow(state),
		noteDocument,
	};
}

export function buildMetaReviewExportSnapshot(linkedRunDir: string): MetaReviewExportSnapshot {
	return buildMetaReviewExportSnapshotFromState(buildMetaReviewClientState(linkedRunDir));
}
