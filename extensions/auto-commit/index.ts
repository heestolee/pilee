import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type, type Static } from "typebox";

interface CommitPlanEntry {
	message: string;
	paths: string[];
}

interface PushPlan {
	remote?: string;
	branch?: string;
	forceWithLease?: boolean;
	noVerify?: boolean;
}

interface AutoCommitPlan {
	expectedHead?: string;
	resetTo?: string;
	backupBranch?: string;
	allowLeftovers?: boolean;
	rejectScopeParentheses?: boolean;
	commitNoVerify?: boolean;
	commits: CommitPlanEntry[];
	push?: PushPlan;
}

interface AutoCommitResult {
	mode: "apply" | "split-head";
	backupBranch?: string;
	commits: Array<{ message: string; hash: string; paths: string[] }>;
	leftovers: string[];
	pushed: boolean;
}

const autoCommitToolSchema = Type.Object({
	action: StringEnum(["status", "apply", "split-head"] as const),
	planPath: Type.Optional(Type.String({ description: "Path to an auto-commit JSON plan file." })),
});

type AutoCommitToolInput = Static<typeof autoCommitToolSchema>;

type ExecHost = Pick<ExtensionAPI, "exec">;
type CommandCtx = Pick<ExtensionContext, "cwd" | "hasUI"> & { ui?: ExtensionCommandContext["ui"] };

function lines(text: string | undefined): string[] {
	return (text ?? "")
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

async function git(pi: ExecHost, cwd: string, args: string[], label = `git ${args.join(" ")}`): Promise<string> {
	const result = await pi.exec("git", args, { cwd });
	if (result.code !== 0) {
		const stderr = result.stderr?.trim();
		const stdout = result.stdout?.trim();
		throw new Error([`${label} failed`, stderr, stdout].filter(Boolean).join("\n"));
	}
	return result.stdout ?? "";
}

async function gitCode(pi: ExecHost, cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	const result = await pi.exec("git", args, { cwd });
	return { code: result.code ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

async function statusLines(pi: ExecHost, cwd: string): Promise<string[]> {
	return lines(await git(pi, cwd, ["status", "--porcelain"]));
}

async function currentHead(pi: ExecHost, cwd: string): Promise<string> {
	return (await git(pi, cwd, ["rev-parse", "HEAD"])).trim();
}

function assertPlan(plan: AutoCommitPlan): void {
	if (!plan || typeof plan !== "object") throw new Error("auto-commit plan must be an object");
	if (!Array.isArray(plan.commits) || plan.commits.length === 0) {
		throw new Error("auto-commit plan requires at least one commit entry");
	}

	for (const [index, entry] of plan.commits.entries()) {
		if (!entry || typeof entry !== "object") throw new Error(`commits[${index}] must be an object`);
		if (typeof entry.message !== "string" || entry.message.trim().length === 0) {
			throw new Error(`commits[${index}].message is required`);
		}
		if ((plan.rejectScopeParentheses ?? true) && /^[a-z]+\([^)]*\):/iu.test(entry.message.trim())) {
			throw new Error(`commits[${index}].message must not use scope parentheses: ${entry.message}`);
		}
		if (!Array.isArray(entry.paths) || entry.paths.length === 0) {
			throw new Error(`commits[${index}].paths requires at least one path`);
		}
		for (const path of entry.paths) {
			if (typeof path !== "string" || path.trim().length === 0) {
				throw new Error(`commits[${index}].paths contains an invalid path`);
			}
		}
	}
}

async function loadPlan(cwd: string, planPath: string): Promise<AutoCommitPlan> {
	const absolutePath = resolve(cwd, planPath.replace(/^@/u, ""));
	const content = await readFile(absolutePath, "utf-8");
	const plan = JSON.parse(content) as AutoCommitPlan;
	assertPlan(plan);
	return plan;
}

async function maybeCreateBackupBranch(pi: ExecHost, cwd: string, branch: string | undefined): Promise<void> {
	if (!branch) return;
	const existing = await gitCode(pi, cwd, ["rev-parse", "--verify", branch]);
	if (existing.code === 0) return;
	await git(pi, cwd, ["branch", branch, "HEAD"], `git branch ${branch} HEAD`);
}

async function assertExpectedHead(pi: ExecHost, cwd: string, expectedHead: string | undefined): Promise<void> {
	if (!expectedHead) return;
	const head = await currentHead(pi, cwd);
	if (!head.startsWith(expectedHead) && expectedHead !== head) {
		throw new Error(`HEAD mismatch: expected ${expectedHead}, actual ${head}`);
	}
}

async function commitEntry(
	pi: ExecHost,
	cwd: string,
	entry: CommitPlanEntry,
	commitNoVerify: boolean | undefined,
): Promise<{ message: string; hash: string; paths: string[] }> {
	await git(pi, cwd, ["reset"], "git reset");
	await git(pi, cwd, ["add", "--", ...entry.paths], `git add -- ${entry.paths.join(" ")}`);
	const diff = await gitCode(pi, cwd, ["diff", "--cached", "--quiet"]);
	if (diff.code === 0) {
		throw new Error(`No staged changes for commit: ${entry.message}`);
	}

	const args = ["commit"];
	if (commitNoVerify) args.push("--no-verify");
	args.push("-m", entry.message);
	await git(pi, cwd, args, `git commit -m ${entry.message}`);
	const hash = (await git(pi, cwd, ["rev-parse", "--short=12", "HEAD"])).trim();
	return { message: entry.message, hash, paths: [...entry.paths] };
}

async function pushIfRequested(pi: ExecHost, cwd: string, push: PushPlan | undefined): Promise<boolean> {
	if (!push) return false;
	const remote = push.remote ?? "origin";
	const branch = push.branch ?? (await git(pi, cwd, ["branch", "--show-current"])).trim();
	if (!branch) throw new Error("push.branch is required when HEAD is detached");

	const args = ["push"];
	if (push.forceWithLease) args.push("--force-with-lease");
	if (push.noVerify) args.push("--no-verify");
	args.push(remote, `HEAD:${branch}`);
	await git(pi, cwd, args, `git push ${remote} HEAD:${branch}`);
	return true;
}

async function applyPlan(pi: ExecHost, cwd: string, mode: "apply" | "split-head", plan: AutoCommitPlan): Promise<AutoCommitResult> {
	await assertExpectedHead(pi, cwd, plan.expectedHead);
	if (mode === "split-head") {
		const currentStatus = await statusLines(pi, cwd);
		if (currentStatus.length > 0) {
			throw new Error(`split-head requires a clean worktree before reset. Dirty entries:\n${currentStatus.join("\n")}`);
		}
		await maybeCreateBackupBranch(pi, cwd, plan.backupBranch);
		await git(pi, cwd, ["reset", "--mixed", plan.resetTo ?? "HEAD~1"], "git reset --mixed");
	}

	const commits: AutoCommitResult["commits"] = [];
	try {
		for (const entry of plan.commits) {
			commits.push(await commitEntry(pi, cwd, entry, plan.commitNoVerify));
		}
		await git(pi, cwd, ["reset"], "git reset");
		const leftovers = await statusLines(pi, cwd);
		if (leftovers.length > 0 && !plan.allowLeftovers) {
			throw new Error(`auto-commit plan left unstaged changes:\n${leftovers.join("\n")}`);
		}
		const pushed = await pushIfRequested(pi, cwd, plan.push);
		return { mode, backupBranch: plan.backupBranch, commits, leftovers, pushed };
	} catch (error) {
		await gitCode(pi, cwd, ["reset"]);
		throw error;
	}
}

function formatResult(result: AutoCommitResult): string {
	const rows = result.commits.map((commit, index) => `${index + 1}. ${commit.hash} ${commit.message}`).join("\n");
	const extras = [
		result.backupBranch ? `backup: ${result.backupBranch}` : null,
		result.pushed ? "push: done" : "push: skipped",
		result.leftovers.length > 0 ? `leftovers:\n${result.leftovers.join("\n")}` : "leftovers: none",
	].filter(Boolean);
	return [`auto-commit ${result.mode} 완료`, rows, ...extras].join("\n");
}

async function runStatus(pi: ExecHost, cwd: string): Promise<string> {
	const [branch, head, status] = await Promise.all([
		git(pi, cwd, ["branch", "--show-current"]).then((value) => value.trim()).catch(() => ""),
		currentHead(pi, cwd).catch(() => ""),
		statusLines(pi, cwd).catch((error: unknown) => [`status failed: ${String(error)}`]),
	]);
	return [`branch: ${branch || "(detached)"}`, `HEAD: ${head}`, status.length > 0 ? status.join("\n") : "working tree clean"].join("\n");
}

async function runFromArgs(pi: ExecHost, ctx: CommandCtx, args: string): Promise<string> {
	const [rawMode, ...rest] = args.trim().split(/\s+/u).filter(Boolean);
	const mode = rawMode === "apply" || rawMode === "split-head" || rawMode === "status" ? rawMode : "apply";
	if (mode === "status") return runStatus(pi, ctx.cwd);

	const planPath = mode === rawMode ? rest.join(" ") : args.trim();
	if (!planPath) throw new Error(`/${"auto-commit"} ${mode} requires a plan JSON path`);
	const plan = await loadPlan(ctx.cwd, planPath);
	return formatResult(await applyPlan(pi, ctx.cwd, mode, plan));
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("auto-commit", {
		description: "Apply a JSON commit plan or split HEAD into focused commits.",
		handler: async (args, ctx) => {
			try {
				const output = await runFromArgs(pi, ctx, args);
				if (ctx.hasUI) ctx.ui.notify(output, "info");
				else console.log(output);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (ctx.hasUI) ctx.ui.notify(message, "error");
				else console.error(message);
				throw error;
			}
		},
	});

	pi.registerTool({
		name: "auto_commit",
		label: "Auto Commit",
		description: "Apply an explicit JSON commit plan, optionally splitting HEAD into focused commits and pushing with force-with-lease.",
		promptSnippet: "Create focused git commits from an explicit JSON plan.",
		promptGuidelines: [
			"Use auto_commit only with an explicit commit plan whose file groups and messages are reviewable.",
			"auto_commit rejects conventional commit scope parentheses by default; use messages like 'feat: 한글 설명'.",
		],
		parameters: autoCommitToolSchema,
		async execute(_toolCallId, params: AutoCommitToolInput, _signal, _onUpdate, ctx) {
			if (params.action === "status") {
				const output = await runStatus(pi, ctx.cwd);
				return { content: [{ type: "text", text: output }], details: { action: params.action } };
			}
			if (!params.planPath) throw new Error("planPath is required");
			const plan = await loadPlan(ctx.cwd, params.planPath);
			const result = await applyPlan(pi, ctx.cwd, params.action, plan);
			return { content: [{ type: "text", text: formatResult(result) }], details: result };
		},
	});
}
