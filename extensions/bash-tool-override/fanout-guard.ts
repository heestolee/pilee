export type ValidationFanoutGuardBlock = {
	kind: "wrapper-path-after-double-dash" | "broad-validation-script" | "broad-turbo-validation";
	command: string;
	script: string;
	reason: string;
	suggestion: string;
};

const BYPASS_PATTERN = /\b(?:ALLOW_BROAD_VALIDATION|PI_ALLOW_BROAD_VALIDATION)=1\b|#\s*(?:allow-broad-validation|allow broad validation)\b/i;
const VALIDATION_SCRIPT_PATTERN = /^(?:test|lint|build|type-check|typecheck)(?::.*)?$/;
const TARGETED_SCRIPT_PATTERN = /(?:changes?|changed|staged|affected|related|current|nearest|targeted)/i;
const BROAD_SCRIPT_SUFFIX_PATTERN = /^(?:all|full|ci|unit|units|e2e|integration|workspace|repo|app|apps|web|admin|mobile|frontend|backend|server|client|storybook)$/i;
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn"]);
const PACKAGE_MANAGER_OPTIONS_WITH_VALUE = new Set([
	"--dir",
	"-C",
	"--cwd",
	"--filter",
	"-F",
	"--workspace",
	"-w",
	"--workspace-root",
	"--config",
	"--registry",
]);

export function analyzeValidationFanout(command: string): ValidationFanoutGuardBlock | null {
	if (!command.trim() || BYPASS_PATTERN.test(command)) return null;

	for (const segment of splitShellSegments(stripSilentPrefix(command))) {
		const tokens = tokenizeShellSegment(segment);
		if (!tokens.length) continue;

		const packageManagerBlock = analyzePackageManagerValidation(tokens, segment.trim());
		if (packageManagerBlock) return packageManagerBlock;

		const turboBlock = analyzeTurboValidation(tokens, segment.trim());
		if (turboBlock) return turboBlock;
	}

	return null;
}

export function formatValidationFanoutGuardBlock(block: ValidationFanoutGuardBlock): string {
	return [
		"[validation fan-out guard] 명령 실행을 차단했습니다.",
		`이유: ${block.reason}`,
		`감지된 script: ${block.script}`,
		`권장: ${block.suggestion}`,
		"정말 전역/넓은 검증이 필요하면, 실행 전 이유를 사용자에게 밝힌 뒤 `ALLOW_BROAD_VALIDATION=1`을 같은 명령에 붙여 재실행하세요.",
	].join("\n");
}

function analyzePackageManagerValidation(
	tokens: string[],
	segment: string,
): ValidationFanoutGuardBlock | null {
	const executableIndex = firstExecutableIndex(tokens);
	const executable = tokens[executableIndex];
	if (!PACKAGE_MANAGERS.has(executable)) return null;

	const parsed = parsePackageManagerScriptInvocation(executable, tokens.slice(executableIndex + 1));
	if (!parsed || !isValidationScriptName(parsed.script)) return null;

	const doubleDashIndex = parsed.args.indexOf("--");
	if (doubleDashIndex >= 0) {
		const afterDoubleDash = parsed.args.slice(doubleDashIndex + 1);
		if (afterDoubleDash.some(isPathLikeArg)) {
			return {
				kind: "wrapper-path-after-double-dash",
				command: segment,
				script: parsed.script,
				reason:
					"package script 뒤 `-- <path>`는 wrapper가 path를 실제 runner에 targeted positional arg로 전달한다는 보장이 없습니다. 실제로 전체 suite discovery로 fan-out될 수 있습니다.",
				suggestion: directValidationSuggestion(parsed.script, afterDoubleDash),
			};
		}
	}

	if (isBroadValidationScript(parsed.script) && !hasTargetedValidationArg(parsed.args)) {
		return {
			kind: "broad-validation-script",
			command: segment,
			script: parsed.script,
			reason:
				"package validation script에 파일·spec·changed/affected filter가 없어 package/app/workspace 전체로 fan-out될 가능성이 큽니다.",
			suggestion: directValidationSuggestion(parsed.script),
		};
	}

	return null;
}

function analyzeTurboValidation(tokens: string[], segment: string): ValidationFanoutGuardBlock | null {
	const executableIndex = firstExecutableIndex(tokens);
	if (tokens[executableIndex] !== "turbo") return null;

	const args = tokens.slice(executableIndex + 1);
	const runIndex = args.indexOf("run");
	if (runIndex < 0) return null;

	const script = args[runIndex + 1];
	if (!script || !isBroadValidationScript(script)) return null;

	const filters = args.filter((arg) => arg === "--filter" || arg.startsWith("--filter="));
	const hasExplicitFilterValue = args.some((arg, index) => {
		if (arg === "--filter") return !!args[index + 1] && !args[index + 1].includes("*");
		if (arg.startsWith("--filter=")) return !arg.slice("--filter=".length).includes("*");
		return false;
	});

	if (filters.length === 0 || !hasExplicitFilterValue) {
		return {
			kind: "broad-turbo-validation",
			command: segment,
			script,
			reason:
				"turbo validation에 명시적 package filter가 없거나 wildcard filter가 있어 workspace fan-out 가능성이 큽니다.",
			suggestion:
				"필요한 package만 `turbo run <script> --filter=<package>`로 좁히거나, 파일 단위 검증은 package cwd에서 direct executable을 사용하세요.",
		};
	}

	return null;
}

function parsePackageManagerScriptInvocation(
	packageManager: string,
	args: string[],
): { script: string; args: string[] } | null {
	let index = 0;
	while (index < args.length) {
		const token = args[index];
		if (!token.startsWith("-")) break;
		index += optionConsumesNextValue(token) && args[index + 1] ? 2 : 1;
	}

	const command = args[index];
	if (!command) return null;
	if (command === "exec" || command === "dlx" || command === "x" || command === "create") return null;
	if (command === "install" || command === "i" || command === "add" || command === "remove") return null;

	if (command === "run" || (packageManager === "npm" && command === "run-script")) {
		const script = args[index + 1];
		return script ? { script, args: args.slice(index + 2) } : null;
	}

	if (packageManager === "npm" && (command === "test" || command === "t")) {
		return { script: "test", args: args.slice(index + 1) };
	}

	return { script: command, args: args.slice(index + 1) };
}

function isValidationScriptName(script: string): boolean {
	return VALIDATION_SCRIPT_PATTERN.test(script);
}

function isBroadValidationScript(script: string): boolean {
	if (!isValidationScriptName(script) || TARGETED_SCRIPT_PATTERN.test(script)) return false;

	const [, suffix] = script.split(":", 2);
	return !suffix || BROAD_SCRIPT_SUFFIX_PATTERN.test(suffix);
}

function hasTargetedValidationArg(args: string[]): boolean {
	if (args.length === 0) return false;
	if (args.some((arg) => arg === "--changed" || arg === "--staged" || arg === "--affected")) return true;
	if (args.some(isPathLikeArg)) return true;
	return false;
}

function isPathLikeArg(arg: string): boolean {
	if (!arg || arg.startsWith("-")) return false;
	return (
		/[\\/]/.test(arg) ||
		/\.(?:[cm]?[jt]sx?|spec|test|snap|vue|svelte|graphql|gql|css|scss|mdx?)$/i.test(arg) ||
		/[?*\[\]{}]/.test(arg)
	);
}

function directValidationSuggestion(script: string, targets: string[] = []): string {
	const targetText = targets.filter(isPathLikeArg).join(" ") || "<changed-file-or-spec>";

	if (script.startsWith("test")) {
		return `package cwd에서 direct runner를 호출하세요. 예: \`pnpm exec vitest run ${targetText}\` 또는 \`pnpm exec jest ${targetText}\`.`;
	}
	if (script.startsWith("lint")) {
		return `package cwd에서 direct linter를 호출하세요. 예: \`pnpm exec eslint ${targetText}\`.`;
	}
	if (script === "type-check" || script === "typecheck" || script.startsWith("type-check:")) {
		return "파일 단위 타입 검증이 불가능하면 먼저 가까운 lint/test를 닫고, app/package type-check가 필요한 이유를 밝힌 뒤 broad bypass를 사용하세요.";
	}
	if (script.startsWith("build")) {
		return "build는 대개 broad validation입니다. 현재 diff가 bundling/output surface를 바꿨을 때만 이유를 밝힌 뒤 broad bypass를 사용하세요.";
	}
	return "현재 diff를 닫는 가장 가까운 direct executable 또는 changed-file validation을 사용하세요.";
}

function firstExecutableIndex(tokens: string[]): number {
	let index = 0;
	while (index < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(tokens[index])) {
		index += 1;
	}
	return index;
}

function optionConsumesNextValue(token: string): boolean {
	if (token.includes("=")) return false;
	return PACKAGE_MANAGER_OPTIONS_WITH_VALUE.has(token);
}

function stripSilentPrefix(command: string): string {
	return command.trim().replace(/^!!\s*/, "");
}

function splitShellSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (let index = 0; index < command.length; index += 1) {
		const char = command[index];
		const next = command[index + 1];

		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === "\\") {
			current += char;
			escaped = true;
			continue;
		}

		if ((char === "'" || char === '"') && !escaped) {
			quote = quote === char ? null : quote ?? char;
			current += char;
			continue;
		}

		if (!quote && (char === "\n" || char === ";" || (char === "&" && next === "&"))) {
			if (current.trim()) segments.push(current.trim());
			current = "";
			if (char === "&") index += 1;
			continue;
		}

		current += char;
	}

	if (current.trim()) segments.push(current.trim());
	return segments;
}

function tokenizeShellSegment(segment: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: "'" | '"' | null = null;
	let escaped = false;

	for (const char of segment) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (char === "\\") {
			escaped = true;
			continue;
		}

		if ((char === "'" || char === '"') && !escaped) {
			quote = quote === char ? null : quote ?? char;
			continue;
		}

		if (!quote && /\s/.test(char)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (current) tokens.push(current);
	return tokens;
}
