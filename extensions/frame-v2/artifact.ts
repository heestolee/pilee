import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FrameIdentity } from "../tft-commands/frame-identity.ts";
import type { StudyNoteDocument } from "../study-hard/studio.ts";

export type FrameV2Mode = "draft" | "guided";
export type FrameV2EntryMode = "frame-first" | "study-hard-first";

export interface FrameV2Invocation {
	mode: FrameV2Mode;
	entryMode: FrameV2EntryMode;
	topic: string;
	args: string;
	sourceUrl: string;
}

export interface FrameV2Manifest {
	schemaVersion: 1;
	status: "drafting" | "refining" | "ready" | "started";
	mode: FrameV2Mode;
	entryMode: FrameV2EntryMode;
	topic: string;
	identity: Pick<FrameIdentity, "mode" | "key" | "displayTitle" | "storageDir" | "ticket" | "sessionFile">;
	studyHard: {
		runId: string;
		statePath: string;
		sourceUrl: string;
	};
	learningCompanion?: {
		manifestPath: string;
		companionId: string;
	};
	framePath: string;
	createdAt: number;
	updatedAt: number;
}

function shortHash(value: string): string {
	return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function firstHttpUrl(value: string): string | undefined {
	for (const token of value.split(/\s+/g)) {
		try {
			const url = new URL(token);
			if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
		} catch {}
	}
	return undefined;
}

export function parseFrameV2Args(args: string, identityKey: string, entryMode: FrameV2EntryMode = "frame-first"): FrameV2Invocation | { help: true } {
	const trimmed = args.trim();
	if (["help", "--help", "-h"].includes(trimmed.toLowerCase())) return { help: true };
	const tokens = trimmed.split(/\s+/g).filter(Boolean);
	const draft = tokens.includes("--draft");
	const guided = tokens.includes("--guided");
	const topic = tokens.filter((token) => token !== "--draft" && token !== "--guided").join(" ").trim() || "현재 대화의 작업 주제";
	return {
		mode: draft && !guided ? "draft" : "guided",
		entryMode,
		topic,
		args: trimmed,
		sourceUrl: firstHttpUrl(topic) ?? `https://frame-v2.invalid/${shortHash(identityKey)}`,
	};
}

export function frameV2RunId(identityKey: string): string {
	return `frame-v2-${shortHash(identityKey)}`;
}

export function buildInitialFrameV2Note(topic: string, mode: FrameV2Mode): StudyNoteDocument {
	const modeText = mode === "draft"
		? "먼저 조사한 학습 초안을 만들고, 확인되지 않은 내용은 가정으로 표시합니다."
		: "대화하며 선수 지식과 Mental Model을 채우고 내 말로 설명할 수 있게 다듬습니다.";
	return {
		title: `Frame v2 · ${topic}`,
		sections: [
			{
				id: "frame-v2-context",
				kind: "overview",
				title: "왜 이 작업이 필요한가",
				blocks: [
					{ id: "frame-v2-mode", type: "callout", tone: "info", title: mode === "draft" ? "학습 초안 먼저" : "대화하며 학습", body: modeText },
					{ id: "frame-v2-context-pending", type: "paragraph", text: "문제의 배경과 이 작업이 해결하려는 사용자·시스템 결과를 설명합니다." },
				],
			},
			{
				id: "frame-v2-foundations",
				kind: "node",
				title: "먼저 알아야 할 개념",
				blocks: [{ id: "frame-v2-foundations-pending", type: "paragraph", text: "이 작업을 이해하는 데 필요한 선수 지식과 용어를 실제 근거와 함께 채웁니다." }],
			},
			{
				id: "frame-v2-mental-model",
				kind: "node",
				title: "핵심 Mental Model",
				blocks: [{ id: "frame-v2-mental-model-pending", type: "paragraph", text: "구조와 책임을 한 문장으로 설명할 수 있는 모델을 만듭니다." }],
			},
			{
				id: "frame-v2-before-after",
				kind: "flow",
				title: "Before / After · 무엇이 왜 바뀌는가",
				blocks: [{ id: "frame-v2-before-after-pending", type: "paragraph", text: "현재 문제와 제안 구조의 차이를 같은 경로로 비교합니다." }],
			},
			{
				id: "frame-v2-code-reading",
				kind: "practice",
				title: "실제 코드 읽는 순서",
				blocks: [{ id: "frame-v2-code-reading-pending", type: "paragraph", text: "개념이 실제 코드와 데이터 흐름에 연결되는 순서만 안내합니다." }],
			},
			{
				id: "frame-v2-limits",
				kind: "reflection",
				title: "한계와 오해하기 쉬운 점",
				blocks: [{ id: "frame-v2-limits-pending", type: "callout", tone: "warning", title: "구분할 것", body: "학습 설명과 작업상 미정 결정을 섞지 않습니다." }],
			},
			{
				id: "frame-v2-understanding",
				kind: "reflection",
				title: "이해 확인",
				blocks: [{ id: "frame-v2-understanding-pending", type: "callout", tone: "question", title: "내 말로 설명하기", body: "핵심 흐름과 트레이드오프를 내 말로 설명해 봅니다." }],
			},
		],
	};
}

function readManifest(path: string): FrameV2Manifest | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as FrameV2Manifest;
	} catch {
		return undefined;
	}
}

function writeManifest(path: string, manifest: FrameV2Manifest, now: number): FrameV2Manifest {
	const temporaryPath = `${path}.tmp-${process.pid}-${now}`;
	writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	renameSync(temporaryPath, path);
	return manifest;
}

export function updateFrameV2ManifestStatus(path: string, status: FrameV2Manifest["status"], now = Date.now()): FrameV2Manifest {
	const current = readManifest(path);
	if (!current) throw new Error(`Frame v2 manifest를 찾을 수 없습니다: ${path}`);
	return writeManifest(path, { ...current, status, updatedAt: now }, now);
}

export function linkFrameV2LearningCompanion(path: string, companion: NonNullable<FrameV2Manifest["learningCompanion"]>, now = Date.now()): FrameV2Manifest {
	const current = readManifest(path);
	if (!current) throw new Error(`Frame v2 manifest를 찾을 수 없습니다: ${path}`);
	return writeManifest(path, { ...current, learningCompanion: companion, updatedAt: now }, now);
}

export function writeFrameV2Manifest(params: {
	identity: FrameIdentity;
	invocation: FrameV2Invocation;
	runId: string;
	statePath: string;
	sourceUrl: string;
	now?: number;
}): { path: string; manifest: FrameV2Manifest } {
	mkdirSync(params.identity.storageDir, { recursive: true });
	const path = join(params.identity.storageDir, "frame-v2.json");
	const previous = readManifest(path);
	const now = params.now ?? Date.now();
	const manifest: FrameV2Manifest = {
		schemaVersion: 1,
		status: previous?.status ?? "drafting",
		mode: params.invocation.mode,
		entryMode: params.invocation.entryMode,
		topic: params.invocation.topic,
		identity: {
			mode: params.identity.mode,
			key: params.identity.key,
			displayTitle: params.identity.displayTitle,
			storageDir: params.identity.storageDir,
			ticket: params.identity.ticket,
			sessionFile: params.identity.sessionFile,
		},
		studyHard: { runId: params.runId, statePath: params.statePath, sourceUrl: params.sourceUrl },
		framePath: join(params.identity.storageDir, "frame.json"),
		createdAt: previous?.createdAt ?? now,
		updatedAt: now,
	};
	const temporaryPath = `${path}.tmp-${process.pid}-${now}`;
	writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
	renameSync(temporaryPath, path);
	return { path, manifest };
}
