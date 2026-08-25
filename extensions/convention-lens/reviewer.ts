import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ConventionLensMode } from "../utils/private-profiles.ts";
import type { ConventionLensReviewTarget, ConventionLensSelection } from "./types.ts";

export const CONVENTION_LENS_FOLLOWUP_MARKER = "# Convention Lens automatic review";

export interface ConventionLensReviewArtifact {
	schemaVersion: 1;
	profileId: string;
	mode: ConventionLensMode;
	cwd: string;
	target: {
		kind: ConventionLensReviewTarget["kind"];
		baseHead: string;
		currentHead: string;
		fingerprint: string;
		paths: string[];
	};
	evidence: ConventionLensReviewTarget["bundle"];
	lenses: Array<{
		id: string;
		title: string;
		authority: string;
		status: string;
		confidence?: string;
		score: number;
		reasons: string[];
		body: string;
		source: unknown;
	}>;
}

function atomicJson(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
}

export function writeConventionLensReviewArtifact(
	stateDir: string,
	cwd: string,
	mode: ConventionLensMode,
	target: ConventionLensReviewTarget,
	selection: ConventionLensSelection,
): { requestId: string; artifactPath: string; artifact: ConventionLensReviewArtifact } {
	const requestId = `convention-lens-${createHash("sha256").update(`${selection.profileId}:${target.fingerprint}`).digest("hex").slice(0, 20)}`;
	const artifactPath = join(stateDir, "runs", `${requestId}.json`);
	const artifact: ConventionLensReviewArtifact = {
		schemaVersion: 1,
		profileId: selection.profileId,
		mode,
		cwd,
		target: {
			kind: target.kind,
			baseHead: target.baseHead,
			currentHead: target.currentHead,
			fingerprint: target.fingerprint,
			paths: target.paths,
		},
		evidence: target.bundle,
		lenses: selection.candidates.map((candidate) => ({
			id: candidate.node.id,
			title: candidate.node.title,
			authority: candidate.node.authority,
			status: candidate.node.status,
			confidence: candidate.node.confidence,
			score: candidate.score,
			reasons: candidate.reasons,
			body: candidate.node.body,
			source: candidate.node.source,
		})),
	};
	atomicJson(artifactPath, artifact);
	return { requestId, artifactPath, artifact };
}

export function buildConventionLensFollowUpMessage(
	artifactPath: string,
	artifact: ConventionLensReviewArtifact,
): { customType: string; content: string; display: boolean; details: Record<string, unknown> } {
	const repairContract = artifact.mode === "repair"
		? [
			"- 현재 코드와 D evidence를 먼저 확인한 뒤 KEEP/AUTO_FIX/ASK/INFO로 분류합니다.",
			"- AUTO_FIX는 reviewed lens, high confidence, current paths, no authority/lens conflict, no external side effect, nearest validation이 모두 닫힐 때만 제안합니다.",
			"- candidate/draft/private-case만 근거인 finding은 AUTO_FIX로 제출하지 않고 ASK 또는 INFO로 둡니다.",
			"- 먼저 convention_lens submit으로 판정을 제출합니다. Tool이 repairAuthorized=true를 반환하기 전에는 edit/write/mutating bash를 호출하지 않습니다.",
			"- 승인된 AUTO_FIX만 최소 수정하고 가장 가까운 검증을 실행합니다.",
			"- 원 사용자 요청에 commit/push가 포함됐을 때만 그 범위를 이어갑니다.",
		]
		: [
			"- 현재 코드와 D evidence를 확인해 KEEP/AUTO_FIX/ASK/INFO로 분류합니다.",
			"- convention_lens submit으로 판정을 제출합니다.",
			"- review mode에서는 tool 제출 전후 모두 코드를 수정하지 않고 finding과 근거만 보고합니다.",
		];
	return {
		customType: "convention-lens-review",
		display: true,
		content: [
			CONVENTION_LENS_FOLLOWUP_MARKER,
			"",
			`Artifact: ${artifactPath}`,
			`Mode: ${artifact.mode}`,
			`Target: ${artifact.target.kind} · ${artifact.target.paths.join(", ")}`,
			`Fingerprint: ${artifact.target.fingerprint}`,
			"",
			"## 실행 계약",
			"1. Artifact를 읽고 selected lens와 unified diff D evidence만으로 현재 변경을 다시 검토합니다.",
			"2. Artifact에 없는 code/lens를 상상하지 않습니다. 필요하면 target file과 1-hop consumer만 읽습니다.",
			"3. authority 순서는 user/frame > AGENTS/lint/schema > team convention > generic guideline > personal precedent/private case입니다.",
			"4. finding마다 lens ID와 evidence ID를 명시합니다.",
			"5. 판정이 끝나면 반드시 convention_lens tool을 action=submit, verdict, summary, findings로 호출합니다. Finding shape은 id, verdict, lensIds, evidenceIds, confidence, recommendation, optional validation입니다.",
			...repairContract,
			"6. Graph/card source를 자동 수정하지 않습니다. 새 사례는 proposal 후보로만 남깁니다.",
			"7. 동일 diff를 다시 검토하라는 상태 설명만 반복하지 말고 실제 판정/수정/검증을 수행합니다.",
			"",
			"## Selected lenses",
			...artifact.lenses.map((lens) => `- ${lens.id} · ${lens.authority}/${lens.status} · score ${lens.score}`),
		].join("\n"),
		details: {
			artifactPath,
			mode: artifact.mode,
			fingerprint: artifact.target.fingerprint,
			lensIds: artifact.lenses.map((lens) => lens.id),
		},
	};
}
