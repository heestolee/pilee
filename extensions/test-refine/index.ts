import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { formatInlinedSkill, pileeSkillPath as skillPath, readPileeSkill as readSkill } from "../utils/inlined-skill.ts";

const SKILL_NAME = "test-boundary-refactor";
const SKILL_PATH = skillPath(SKILL_NAME);
const SHIM_CUSTOM_TYPE = "pilee-test-refine-command";

const HELP = `Test Refine — practical test boundary refactor

Usage:
  /test-refine                 현재 git diff의 테스트/대상 파일을 기준으로 audit 후 수정 계획 제시
  /test-refine --apply         경계가 명확한 테스트 정리는 바로 적용
  /test-refine --staged        staged diff 기준으로만 분석
  /test-refine <path...>       지정한 파일/디렉터리 중심으로 분석
  /test-refine help            도움말

Boundary rule:
  기능 테스트는 유저 행동만, 내부 로직은 직접 테스트, 외부 의존성만 mock으로 격리한다.`;

export interface TestRefineGitSnapshot {
	root?: string;
	status?: string;
	changedFiles?: string[];
	stagedFiles?: string[];
	testLikeFiles?: string[];
	error?: string;
}

function splitLines(text = ""): string[] {
	return text
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean);
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function isTestLikePath(path: string): boolean {
	return /(^|\/)(__tests__|tests?)\//.test(path) || /(?:^|[/.])(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function formatList(values?: string[], empty = "(none)"): string {
	if (!values || values.length === 0) return empty;
	return values.map((value) => `- ${value}`).join("\n");
}

async function git(pi: ExtensionAPI, cwd: string, args: string[]) {
	return pi.exec("git", args, { cwd, timeout: 10_000 });
}

export async function collectTestRefineGitSnapshot(pi: ExtensionAPI, cwd: string, args: string): Promise<TestRefineGitSnapshot> {
	try {
		const rootResult = await git(pi, cwd, ["rev-parse", "--show-toplevel"]);
		if (rootResult.code !== 0) {
			return { error: splitLines(rootResult.stderr || rootResult.stdout).join("\n") || "현재 cwd가 git repository가 아닙니다." };
		}

		const root = rootResult.stdout.trim();
		const statusResult = await git(pi, root, ["status", "--short", "--branch"]);
		const changedResult = await git(pi, root, args.includes("--staged") ? ["diff", "--cached", "--name-only"] : ["diff", "--name-only"]);
		const stagedResult = await git(pi, root, ["diff", "--cached", "--name-only"]);
		const changedFiles = splitLines(changedResult.stdout);
		const stagedFiles = splitLines(stagedResult.stdout);
		const allFiles = unique([...changedFiles, ...stagedFiles]);

		return {
			root,
			status: statusResult.stdout.trim(),
			changedFiles,
			stagedFiles,
			testLikeFiles: allFiles.filter(isTestLikePath),
		};
	} catch (error) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

export function buildTestRefinePrompt(args: string, cwd: string, snapshot: TestRefineGitSnapshot): string {
	const skill = readSkill(SKILL_NAME);
	const commandLine = `/test-refine${args.trim() ? ` ${args.trim()}` : ""}`;
	const explicitTargets = args
		.split(/\s+/g)
		.map((part) => part.trim())
		.filter((part) => part && !part.startsWith("-") && part !== "help");

	return [
		"# pilee Test Refine command shim",
		"",
		`You are executing \`${commandLine}\` through pilee's extension command shim.`,
		"",
		"Hard routing rules:",
		`- Use the inlined pilee \`${SKILL_NAME}\` SKILL.md below as the authoritative workflow for this invocation.`,
		"- Do not ask the user to re-invoke `/skill:test-boundary-refactor`; continue now using the inlined instructions.",
		"- `/test-refine` is the only user-facing command. The skill name is intentionally different to avoid duplicate slash surfaces.",
		"- Keep the practical boundary rule central: behavior tests assert user-visible behavior, internal logic is tested directly, and only external dependencies are mocked.",
		"- If `--apply` is absent, audit first and ask before non-trivial edits. If `--apply` is present, apply narrow low-risk refactors and validate nearby tests.",
		"- Do not broaden into full-suite validation unless the current diff makes it necessary; state expected fan-out before validation commands.",
		"",
		`Current cwd: ${cwd}`,
		"",
		"Original user command arguments:",
		"----- BEGIN ORIGINAL ARGUMENTS -----",
		args.trim() || "(none)",
		"----- END ORIGINAL ARGUMENTS -----",
		"",
		"Explicit target paths from arguments:",
		formatList(explicitTargets),
		"",
		"Git snapshot:",
		`- root: ${snapshot.root ?? "unknown"}`,
		`- snapshot error: ${snapshot.error ?? "none"}`,
		"",
		"Status:",
		"```",
		snapshot.status || "(empty)",
		"```",
		"",
		"Changed files:",
		formatList(snapshot.changedFiles),
		"",
		"Staged files:",
		formatList(snapshot.stagedFiles),
		"",
		"Test-like changed/staged files:",
		formatList(snapshot.testLikeFiles),
		"",
		"## Inlined target skill",
		formatInlinedSkill(skill),
		"",
		"Now execute the test boundary refactor workflow for the original user command.",
	].join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("test-refine", {
		description: "테스트 mock/fixture/assertion을 기능·내부 로직·외부 의존성 경계 기준으로 실용적으로 다듬기",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			if (trimmed === "help" || trimmed === "--help" || trimmed === "-h") {
				ctx.ui.notify(HELP, "info");
				return;
			}

			try {
				const cwd = ctx.cwd ?? process.cwd();
				const snapshot = await collectTestRefineGitSnapshot(pi, cwd, args);
				const prompt = buildTestRefinePrompt(args, cwd, snapshot);
				ctx.ui.notify("🧪 Test Refine을 시작합니다. 테스트 경계와 mock 기준을 점검합니다.", "info");
				pi.sendMessage(
					{
						customType: SHIM_CUSTOM_TYPE,
						content: prompt,
						display: false,
						details: {
							command: "test-refine",
							args,
							skillPath: SKILL_PATH,
							snapshot,
						},
					},
					{ deliverAs: "followUp", triggerTurn: true },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`pilee /test-refine shim failed: ${message}`, "error");
			}
		},
	});
}
