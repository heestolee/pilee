import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { FrameIdentity } from "../tft-commands/frame-identity.ts";
import type { StudyNoteDocument } from "../study-hard/studio.ts";

export type FrameV2Mode = "draft" | "guided";

export interface FrameV2Invocation {
	mode: FrameV2Mode;
	topic: string;
	args: string;
	sourceUrl: string;
}

export interface FrameV2Manifest {
	schemaVersion: 1;
	status: "drafting" | "refining" | "ready" | "started";
	mode: FrameV2Mode;
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

export function parseFrameV2Args(args: string, identityKey: string): FrameV2Invocation | { help: true } {
	const trimmed = args.trim();
	if (["help", "--help", "-h"].includes(trimmed.toLowerCase())) return { help: true };
	const tokens = trimmed.split(/\s+/g).filter(Boolean);
	const draft = tokens.includes("--draft");
	const guided = tokens.includes("--guided");
	const topic = tokens.filter((token) => token !== "--draft" && token !== "--guided").join(" ").trim() || "현재 대화의 작업 주제";
	return {
		mode: draft && !guided ? "draft" : "guided",
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
		? "먼저 조사한 초안을 만들고, 확인되지 않은 내용은 가정·열린 질문으로 남깁니다."
		: "현재 Frame의 질문 규율로 핵심 계약을 함께 확인하며 초안을 만듭니다.";
	return {
		title: `Frame v2 · ${topic}`,
		sections: [
			{
				id: "frame-v2-overview",
				kind: "overview",
				title: "문제와 목표",
				blocks: [
					{ id: "frame-v2-mode", type: "callout", tone: "info", title: mode === "draft" ? "초안 먼저" : "질문하며 만들기", body: modeText },
					{ id: "frame-v2-goal", type: "paragraph", text: "조사와 대화를 통해 목표, 범위, 성공 기준을 구체화합니다." },
				],
			},
			{
				id: "frame-v2-mental-model",
				kind: "node",
				title: "Mental model과 확인된 사실",
				blocks: [{ id: "frame-v2-mental-model-pending", type: "paragraph", text: "코드·문서·기획 근거를 읽고 현재 구조와 핵심 개념을 채웁니다." }],
			},
			{
				id: "frame-v2-visuals",
				kind: "flow",
				title: "데이터 모델 · ERD · 실행 흐름",
				blocks: [{ id: "frame-v2-visuals-pending", type: "paragraph", text: "구조 이해에 필요한 시각 자료만 선택해 그립니다." }],
			},
			{
				id: "frame-v2-contract",
				kind: "practice",
				title: "요구사항 · 검증 · 구현 지도",
				blocks: [{ id: "frame-v2-contract-pending", type: "paragraph", text: "Requirement Matrix, 성공 기준, 검증 증거, 구현 slice를 연결합니다." }],
			},
			{
				id: "frame-v2-open-questions",
				kind: "reflection",
				title: "가정과 열린 질문",
				blocks: [{ id: "frame-v2-open-pending", type: "callout", tone: "question", title: "아직 확정하지 않은 것", body: "초안과 대화에서 확인되지 않은 내용을 여기에 보존합니다." }],
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
