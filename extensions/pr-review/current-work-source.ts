import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { enrichReviewSourceDeclarations } from "./declarations.ts";
import { captureUnifiedDiff } from "./evidence.ts";
import { createPrReviewRun, type PrReviewRunState, type PrReviewTarget } from "./run.ts";

async function gitText(pi: Pick<ExtensionAPI, "exec">, cwd: string, args: string[], allowDiffExit = false): Promise<string> {
	const result = await pi.exec("git", args, { cwd, timeout: 120_000 });
	if (result.code !== 0 && !(allowDiffExit && result.code === 1)) throw new Error(`git ${args.join(" ")} failed\n${(result.stderr || result.stdout).trim()}`);
	return result.stdout;
}

function remoteRepository(remote: string, fallback: string): { owner: string; repo: string; url: string } {
	const match = remote.trim().match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (!match) return { owner: "local", repo: fallback, url: `https://local.invalid/${encodeURIComponent(fallback)}` };
	return { owner: match[1]!, repo: match[2]!, url: `https://github.com/${match[1]}/${match[2]}` };
}

async function currentWorkBase(pi: Pick<ExtensionAPI, "exec">, root: string, branch: string): Promise<{ baseSha?: string; baseRefName?: string }> {
	const candidates: string[] = [];
	try {
		const worktree = JSON.parse(readFileSync(resolve(root, ".pi", "worktree-meta.json"), "utf8")) as Record<string, unknown>;
		if (worktree.branch === branch && typeof worktree.baseBranch === "string") candidates.push(worktree.baseBranch);
	} catch {}
	if (branch.startsWith("hotfix/") || branch.startsWith("hotfeature/")) candidates.push("production");
	try {
		const result = await pi.exec("gh", ["pr", "view", branch, "--json", "baseRefName"], { cwd: root, timeout: 30_000 });
		if (result.code === 0) {
			const parsed = JSON.parse(result.stdout) as { baseRefName?: string };
			if (parsed.baseRefName) candidates.unshift(parsed.baseRefName);
		}
	} catch {}
	try {
		const originHead = await gitText(pi, root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
		if (originHead.trim()) candidates.push(originHead.trim().replace(/^origin\//, ""));
	} catch {}
	candidates.push("main", "master", "development", "develop", "production");
	for (const candidate of [...new Set(candidates.filter((value) => value && value !== branch))]) {
		for (const ref of [`origin/${candidate}`, candidate]) {
			const result = await pi.exec("git", ["merge-base", "HEAD", ref], { cwd: root, timeout: 30_000 });
			if (result.code === 0 && result.stdout.trim()) return { baseSha: result.stdout.trim(), baseRefName: candidate };
		}
	}
	return {};
}

function readCurrentWorkSource(root: string, path: string): string | undefined {
	try {
		const rootPath = realpathSync(root);
		const candidate = resolve(rootPath, path);
		if (candidate !== rootPath && !candidate.startsWith(`${rootPath}${sep}`)) return undefined;
		if (!existsSync(candidate)) return undefined;
		const stats = lstatSync(candidate);
		if (!stats.isFile() || stats.isSymbolicLink()) return undefined;
		const real = realpathSync(candidate);
		if (real !== rootPath && !real.startsWith(`${rootPath}${sep}`)) return undefined;
		return readFileSync(real, "utf8");
	} catch {
		return undefined;
	}
}

export async function captureCurrentWorkRun(
	pi: Pick<ExtensionAPI, "exec">,
	cwd: string,
	stateRoot: string,
	now = Date.now(),
	baseOverride?: { baseSha?: string; baseRefName?: string },
): Promise<PrReviewRunState> {
	const root = (await gitText(pi, cwd, ["rev-parse", "--show-toplevel"])).trim();
	const branch = (await gitText(pi, root, ["branch", "--show-current"])).trim() || "HEAD";
	const headSha = (await gitText(pi, root, ["rev-parse", "HEAD"])).trim();
	const base = baseOverride?.baseSha ? baseOverride : await currentWorkBase(pi, root, branch);
	let diff = await gitText(pi, root, ["diff", "--no-color", "--find-renames", base.baseSha ?? "HEAD"]);
	const untracked = (await gitText(pi, root, ["ls-files", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean);
	for (const path of untracked) {
		const addition = await gitText(pi, root, ["diff", "--no-index", "--no-color", "--", "/dev/null", path], true);
		diff += `${diff && !diff.endsWith("\n") ? "\n" : ""}${addition}`;
	}
	if (!diff.trim()) throw new Error("현재 worktree에 Meta Review로 설명할 변경이 없습니다.");
	let remote = "";
	try { remote = await gitText(pi, root, ["remote", "get-url", "origin"]); } catch {}
	const repository = remoteRepository(remote, basename(root));
	const rootHash = createHash("sha256").update(root).digest("hex").slice(0, 12);
	const target: PrReviewTarget = {
		kind: "current-work",
		url: repository.url,
		owner: repository.owner,
		repo: repository.repo,
		number: 0,
		title: `${repository.repo} · ${branch} 현재 변경`,
		baseSha: base.baseSha,
		headSha,
		baseRefName: base.baseRefName,
		headRefName: branch,
		root,
		rootHash,
		branch,
	};
	let bundle = captureUnifiedDiff(diff, { kind: "current-work", root, branch, baseSha: base.baseSha, headSha, rootHash });
	bundle = await enrichReviewSourceDeclarations(bundle, async ({ side, path }) => {
		if (side === "after") return readCurrentWorkSource(root, path);
		if (!base.baseSha) return undefined;
		const result = await pi.exec("git", ["show", `${base.baseSha}:${path}`], { cwd: root, timeout: 30_000 });
		return result.code === 0 ? result.stdout : undefined;
	});
	return createPrReviewRun(stateRoot, target, bundle, diff, now);
}
