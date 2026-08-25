import type { ConventionLensMode } from "../utils/private-profiles.ts";
import type { ConventionLensReviewArtifact } from "./reviewer.ts";

export interface ConventionLensSubmittedFinding {
	id: string;
	verdict: "KEEP" | "AUTO_FIX" | "ASK" | "INFO";
	lensIds: string[];
	evidenceIds: string[];
	confidence: "high" | "medium" | "low";
	recommendation: string;
	counterevidence?: string;
	validation?: string[];
}

export interface ConventionLensSubmission {
	verdict: "KEEP" | "AUTO_FIX" | "ASK" | "INFO" | "NO_MATCH";
	summary: string;
	findings: ConventionLensSubmittedFinding[];
	repairAuthorized: boolean;
}

function assertString(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

function normalizeFinding(
	raw: Record<string, unknown>,
	artifact: ConventionLensReviewArtifact,
	mode: ConventionLensMode,
): ConventionLensSubmittedFinding {
	assertString(raw.id, "finding.id");
	assertString(raw.recommendation, "finding.recommendation");
	const verdict = String(raw.verdict || "INFO") as ConventionLensSubmittedFinding["verdict"];
	if (!["KEEP", "AUTO_FIX", "ASK", "INFO"].includes(verdict)) throw new Error(`${raw.id}: invalid verdict ${verdict}`);
	const confidence = String(raw.confidence || "low") as ConventionLensSubmittedFinding["confidence"];
	if (!["high", "medium", "low"].includes(confidence)) throw new Error(`${raw.id}: invalid confidence ${confidence}`);
	const lensIds = Array.isArray(raw.lensIds) ? raw.lensIds.map(String) : [];
	const evidenceIds = Array.isArray(raw.evidenceIds) ? raw.evidenceIds.map(String) : [];
	const validLenses = new Map(artifact.lenses.map((lens) => [lens.id, lens]));
	const validEvidence = new Set(artifact.evidence.lines.map((line) => line.id));
	if (!lensIds.length || lensIds.some((id) => !validLenses.has(id))) throw new Error(`${raw.id}: unknown or empty lensIds`);
	if (!evidenceIds.length || evidenceIds.some((id) => !validEvidence.has(id))) throw new Error(`${raw.id}: unknown or empty evidenceIds`);
	const repairSafe = mode === "repair"
		&& verdict === "AUTO_FIX"
		&& confidence === "high"
		&& lensIds.every((id) => validLenses.get(id)?.status === "reviewed");
	return {
		id: raw.id,
		verdict: verdict === "AUTO_FIX" && !repairSafe ? "ASK" : verdict,
		lensIds,
		evidenceIds,
		confidence,
		recommendation: raw.recommendation,
		counterevidence: typeof raw.counterevidence === "string" ? raw.counterevidence : undefined,
		validation: Array.isArray(raw.validation) ? raw.validation.map(String) : undefined,
	};
}

export function validateConventionLensSubmission(
	input: { verdict?: unknown; summary?: unknown; findings?: unknown },
	artifact: ConventionLensReviewArtifact,
	mode: ConventionLensMode,
): ConventionLensSubmission {
	const verdict = String(input.verdict || "NO_MATCH") as ConventionLensSubmission["verdict"];
	if (!["KEEP", "AUTO_FIX", "ASK", "INFO", "NO_MATCH"].includes(verdict)) throw new Error(`invalid submission verdict: ${verdict}`);
	assertString(input.summary, "submission.summary");
	const findings = Array.isArray(input.findings)
		? input.findings.map((finding) => normalizeFinding(finding as Record<string, unknown>, artifact, mode))
		: [];
	const effectiveVerdict = findings.some((finding) => finding.verdict === "AUTO_FIX")
		? "AUTO_FIX"
		: findings.some((finding) => finding.verdict === "ASK")
			? "ASK"
			: findings.some((finding) => finding.verdict === "INFO")
				? "INFO"
				: verdict;
	return {
		verdict: effectiveVerdict,
		summary: input.summary,
		findings,
		repairAuthorized: mode === "repair" && findings.some((finding) => finding.verdict === "AUTO_FIX"),
	};
}
