import { rmSync } from "node:fs";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { captureCurrentWorkRun } from "./current-work-source.ts";
import { seedIncrementalMetaReviewRevision, type MetaReviewIncrementalSeedResult } from "./incremental.ts";
import { attachMetaReviewRevision, decideMetaReviewRefresh, type MetaReviewRevisionEntry, type MetaReviewSeries } from "./revision.ts";
import { readJson, type PrReviewRunState } from "./run.ts";
import type { ReviewSourceBundle } from "./evidence.ts";

export interface CurrentWorkMetaReviewRefreshResult {
	mode: "none" | "incremental" | "full";
	reason: string;
	previousRunId: string;
	run: PrReviewRunState;
	revision?: MetaReviewRevisionEntry;
	series?: MetaReviewSeries;
	incrementalSeed?: MetaReviewIncrementalSeedResult;
}

export async function refreshCurrentWorkMetaReview(
	pi: Pick<ExtensionAPI, "exec">,
	state: PrReviewRunState,
	cwd: string,
	stateRoot: string,
	mode: "auto" | "full" = "auto",
	now = Date.now(),
): Promise<CurrentWorkMetaReviewRefreshResult> {
	if (state.target.kind !== "current-work") throw new Error("current-work Meta Review만 coordinator refresh를 직접 적용할 수 있습니다.");
	const previousSource = readJson<ReviewSourceBundle>(state.sourcePath);
	const captured = await captureCurrentWorkRun(pi, state.target.root || cwd, stateRoot, now);
	const capturedSource = readJson<ReviewSourceBundle>(captured.sourcePath);
	if (mode !== "full" && captured.target.headSha === state.target.headSha && capturedSource.sourceSha256 === previousSource.sourceSha256) {
		rmSync(captured.runDir, { recursive: true, force: true });
		return { mode: "none", reason: "same-head-and-source", previousRunId: state.runId, run: state };
	}
	const decision = decideMetaReviewRefresh(state.target, captured.target, {
		forceFull: mode === "full",
		previousIsAncestor: true,
		sourceChanged: capturedSource.sourceSha256 !== previousSource.sourceSha256,
	});
	if (decision.mode === "none") {
		rmSync(captured.runDir, { recursive: true, force: true });
		return { mode: "none", reason: decision.reason, previousRunId: state.runId, run: state };
	}
	const linked = attachMetaReviewRevision(captured, capturedSource.sourceSha256, decision.mode, state, now);
	const incrementalSeed = decision.mode === "incremental" ? seedIncrementalMetaReviewRevision(state, linked.run) : undefined;
	return {
		mode: decision.mode,
		reason: decision.reason,
		previousRunId: state.runId,
		run: linked.run,
		revision: linked.revision,
		series: linked.series,
		incrementalSeed,
	};
}
