import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { captureUnifiedDiff, type ReviewSourceBundle } from "./evidence.ts";
import type { PrReviewRunState } from "./run.ts";

export interface MetaReviewFreshness {
	status: "current" | "stale" | "unknown";
	reason: string;
	checkedAt: number;
	expectedHead?: string;
	observedHead?: string;
}

async function gitDiff(pi: ExtensionAPI, cwd: string, base: string): Promise<string> {
	const result = await pi.exec("git", ["diff", "--no-color", "--find-renames", base], { cwd, timeout: 120_000 });
	if (result.code !== 0) throw new Error(result.stderr || "git diff failed");
	let diff = result.stdout;
	const untrackedResult = await pi.exec("git", ["ls-files", "--others", "--exclude-standard", "-z"], { cwd, timeout: 30_000 });
	if (untrackedResult.code !== 0) throw new Error(untrackedResult.stderr || "git ls-files failed");
	for (const path of untrackedResult.stdout.split("\0").filter(Boolean)) {
		const addition = await pi.exec("git", ["diff", "--no-index", "--no-color", "--", "/dev/null", path], { cwd, timeout: 30_000 });
		if (addition.code !== 0 && addition.code !== 1) throw new Error(addition.stderr || `git diff --no-index failed: ${path}`);
		diff += `${diff && !diff.endsWith("\n") ? "\n" : ""}${addition.stdout}`;
	}
	return diff;
}

export async function checkMetaReviewFreshness(
	pi: ExtensionAPI,
	cwd: string,
	run: PrReviewRunState,
	source: ReviewSourceBundle,
	now = Date.now(),
): Promise<MetaReviewFreshness> {
	try {
		if (run.target.kind === "current-work") {
			const root = run.target.root || cwd;
			const diff = await gitDiff(pi, root, run.target.baseSha ?? "HEAD");
			if (!diff.trim()) return { status: "stale", reason: "현재 변경이 사라졌습니다.", checkedAt: now, expectedHead: run.target.headSha };
			const observed = captureUnifiedDiff(diff, { kind: "freshness-check" });
			return observed.sourceSha256 === source.sourceSha256
				? { status: "current", reason: "현재 worktree diff가 review revision과 같습니다.", checkedAt: now, expectedHead: run.target.headSha }
				: { status: "stale", reason: "현재 worktree diff가 review revision 이후 바뀌었습니다.", checkedAt: now, expectedHead: run.target.headSha };
		}
		const result = await pi.exec("gh", ["pr", "view", String(run.target.number), "--repo", `${run.target.owner}/${run.target.repo}`, "--json", "headRefOid,baseRefOid,baseRefName"], { cwd, timeout: 30_000 });
		if (result.code !== 0) throw new Error(result.stderr || result.stdout || "gh pr view failed");
		const current = JSON.parse(result.stdout) as { headRefOid?: string; baseRefOid?: string; baseRefName?: string };
		const stale = current.headRefOid !== run.target.headSha || current.baseRefOid !== run.target.baseSha || current.baseRefName !== run.target.baseRefName;
		return stale
			? { status: "stale", reason: "PR head 또는 base가 review revision 이후 바뀌었습니다.", checkedAt: now, expectedHead: run.target.headSha, observedHead: current.headRefOid }
			: { status: "current", reason: "PR head와 base가 review revision과 같습니다.", checkedAt: now, expectedHead: run.target.headSha, observedHead: current.headRefOid };
	} catch (error) {
		return { status: "unknown", reason: error instanceof Error ? error.message : String(error), checkedAt: now, expectedHead: run.target.headSha };
	}
}
