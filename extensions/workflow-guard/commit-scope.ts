import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export interface StagedDiffSummary {
	files: string[];
	fileCount: number;
	added: number;
	deleted: number;
	areas: string[];
	binaryFiles: number;
	large: boolean;
	reason: string;
	identity: string;
	merge: boolean;
}

const oid = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

// Git owns the graph/merge calculation. Never reset, checkout, stage, or change merge parents here.
export async function stagedDiffSummary(pi: Pick<ExtensionAPI, "exec">, cwd: string): Promise<StagedDiffSummary | null> {
	const run = (args: string[]) => pi.exec("git", args, { cwd, timeout: 15_000 });
	const checked = async (args: string[]) => {
		const result = await run(args);
		if (result.code !== 0) throw new Error(`commit inspection failed: git ${args[0]}`);
		return result.stdout ?? "";
	};
	const root = (await checked(["rev-parse", "--show-toplevel"])).trim();
	if (!root) return null;
	const gitDir = (await checked(["rev-parse", "--absolute-git-dir"])).trim();
	const mergePath = (await checked(["rev-parse", "--git-path", "MERGE_HEAD"])).trim();
	let mergeHead: string | undefined;
	try {
		mergeHead = await readFile(resolve(cwd, mergePath), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const merge = mergeHead !== undefined;
	if (mergeHead !== undefined && !mergeHead.trim()) throw new Error("unsupported merge state: empty MERGE_HEAD");
	if ((await checked(["ls-files", "--unmerged", "-z"])).length) {
		throw new Error("unresolved merge conflicts: stage each resolution before retrying git commit");
	}
	const tree = (await checked(["write-tree"])).trim();
	const headResult = await run(["rev-parse", "--verify", "HEAD"]);
	const head = headResult.code === 0 ? headResult.stdout.trim() : "unborn";
	const branch = (await checked(["symbolic-ref", "-q", "HEAD"]).catch(() => "detached")).trim();
	let baseline = head;
	if (mergeHead !== undefined) {
		const parents = mergeHead.trim().split(/\s+/u);
		if (parents.length !== 1 || !oid.test(parents[0]) || !oid.test(head)) throw new Error("unsupported merge state: exactly two valid parents required");
		mergeHead = parents[0];
		if ((await checked(["rev-parse", "--verify", `${mergeHead}^{commit}`])).trim() !== mergeHead) throw new Error("invalid merge parent");
		if ((await checked(["rev-parse", "--verify", "ORIG_HEAD"])).trim() !== head) throw new Error("unsupported merge state: ORIG_HEAD differs from HEAD");
		const integrated = await run(["merge-base", "--is-ancestor", mergeHead, head]);
		if (integrated.code !== 1) throw new Error("unsupported merge state: merge parent is already integrated or ancestry inspection failed");
		const bases = (await checked(["merge-base", "--all", head, mergeHead])).trim().split(/\s+/u);
		if (bases.length !== 1 || !oid.test(bases[0])) throw new Error("unsupported merge state: unique common ancestor required");
		const automatic = await run(["merge-tree", "--write-tree", head, mergeHead]);
		baseline = (automatic.stdout ?? "").split(/\r?\n/u)[0];
		// Exit 1 with a valid tree is Git's documented conflicted auto-merge result.
		if (![0, 1].includes(automatic.code) || !oid.test(baseline)) throw new Error("unsupported merge state: git merge-tree --write-tree unavailable or failed");
		await checked(["cat-file", "-e", `${baseline}^{tree}`]);
	}
	const diffArgs = merge ? [baseline, tree] : ["--cached"];
	const files = (await checked(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", ...diffArgs, "--name-only", "-z", "--"])).split("\0").filter(Boolean);
	const numstat = await checked(["diff", "--no-ext-diff", "--no-textconv", "--no-renames", ...diffArgs, "--numstat", "-z", "--"]);
	let added = 0, deleted = 0, binaryFiles = 0;
	for (const line of numstat.split("\0").filter(Boolean)) {
		const [a, d] = line.split("\t");
		if (a === "-" || d === "-") binaryFiles++;
		else { added += Number(a) || 0; deleted += Number(d) || 0; }
	}
	const areas = [...new Set(files.map((path) => {
		const parts = path.split("/");
		return ["extensions", "skills", "docs"].includes(parts[0]) ? parts.slice(0, 2).join("/") : parts[0];
	}))].sort();
	const large = files.length > 8 || added + deleted > 700 || (areas.length > 3 && files.length > 4) || (merge && binaryFiles > 0);
	return {
		files, fileCount: files.length, added, deleted, areas, binaryFiles, large, merge,
		reason: `${merge ? "merge resolution/additional" : "staged"} diff is ${large ? "large" : "small"}: ${files.length} files, +${added}/-${deleted}, ${areas.length} areas`,
		identity: createHash("sha256").update(JSON.stringify([root, gitDir, branch, head, tree, mergeHead])).digest("hex"),
	};
}
