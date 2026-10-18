import { join, resolve } from "node:path";
import type { DefaultResourceLoader, ResourceDiagnostic } from "@mariozechner/pi-coding-agent";

const EXPECTED_PROJECT_OVERRIDES = new Set(["frame", "decide", "verify", "tft-guidelines", "start-local-dev"]);
const FILTER_STATE = Symbol.for("pilee.tft.skill-diagnostics");
type SkillLoader = Pick<DefaultResourceLoader, "getSkills">;
type SkillResult = ReturnType<SkillLoader["getSkills"]>;
interface FilterState {
	roots: Map<string, number>;
	original: SkillLoader["getSkills"];
	filtered: SkillLoader["getSkills"];
}
type LoaderPrototype = SkillLoader & { [FILTER_STATE]?: FilterState };

function isExpectedOverride(diagnostic: ResourceDiagnostic, result: SkillResult, roots: Map<string, number>): boolean {
	const collision = diagnostic.collision;
	if (diagnostic.type !== "collision" || collision?.resourceType !== "skill" || !EXPECTED_PROJECT_OVERRIDES.has(collision.name)) return false;
	const winner = result.skills.find((skill) => skill.name === collision.name && skill.filePath === collision.winnerPath);
	if (winner?.sourceInfo?.scope !== "project" || winner.sourceInfo.origin !== "top-level") return false;
	return [...roots.keys()].some((root) => resolve(collision.loserPath) === join(root, "skills", collision.name, "SKILL.md"));
}

/** Pi exposes discovery additions but no diagnostic hook. Adapt only the public loader's read result. */
export function installExpectedSkillCollisionFilter(prototype: LoaderPrototype, packageRoot: string): () => void {
	let state = prototype[FILTER_STATE];
	if (!state) {
		const roots = new Map<string, number>();
		const original = prototype.getSkills;
		const filtered: SkillLoader["getSkills"] = function (this: SkillLoader) {
			const result = original.call(this);
			return { ...result, diagnostics: result.diagnostics.filter((diagnostic) => !isExpectedOverride(diagnostic, result, roots)) };
		};
		state = { roots, original, filtered };
		prototype[FILTER_STATE] = state;
		prototype.getSkills = filtered;
	}
	const root = resolve(packageRoot);
	state.roots.set(root, (state.roots.get(root) ?? 0) + 1);
	let active = true;
	return () => {
		if (!active) return;
		active = false;
		const remaining = (state.roots.get(root) ?? 1) - 1;
		if (remaining > 0) state.roots.set(root, remaining);
		else state.roots.delete(root);
		if (state.roots.size === 0 && prototype.getSkills === state.filtered) {
			prototype.getSkills = state.original;
			delete prototype[FILTER_STATE];
		}
	};
}
