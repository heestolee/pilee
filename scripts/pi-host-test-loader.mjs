import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function hostRoot() {
	const configured = process.env.PILEE_TEST_HOST_ROOT || process.env.PI_CODING_AGENT_ROOT;
	if (configured) return resolvePath(configured);
	return dirname(dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"))));
}

function importTarget(value) {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map(importTarget).find(Boolean);
	if (value && typeof value === "object") return importTarget(value.import) || importTarget(value.node) || importTarget(value.default);
}

function hostedModule(root, name, subpath = ".") {
	for (let parent = root; ; parent = dirname(parent)) {
		const packageRoot = join(parent, "node_modules", name);
		const manifest = join(packageRoot, "package.json");
		if (existsSync(manifest)) {
			const pkg = JSON.parse(readFileSync(manifest, "utf8"));
			let entry = pkg.exports && (pkg.exports[subpath] ?? (subpath === "." ? pkg.exports : undefined));
			let wildcard;
			if (entry === undefined && pkg.exports && typeof pkg.exports === "object") {
				for (const [pattern, value] of Object.entries(pkg.exports)) {
					if (!pattern.includes("*")) continue;
					const [prefix, suffix] = pattern.split("*");
					if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
					wildcard = subpath.slice(prefix.length, suffix ? -suffix.length : undefined);
					entry = value;
					break;
				}
			}
			let target = importTarget(entry) || (subpath === "." ? pkg.module || pkg.main : undefined);
			if (target && wildcard !== undefined) target = target.replaceAll("*", wildcard);
			if (!target) throw new Error(`No host import entry for ${name}${subpath === "." ? "" : subpath.slice(1)}`);
			return pathToFileURL(resolvePath(packageRoot, target)).href;
		}
		if (dirname(parent) === parent) throw new Error(`Host dependency not found: ${name}`);
	}
}

const root = hostRoot();
const aliases = new Map();
for (const namespace of ["@earendil-works", "@mariozechner"]) {
	aliases.set(`${namespace}/pi-coding-agent`, pathToFileURL(join(root, "dist/index.js")).href);
	for (const name of ["pi-agent-core", "pi-tui"]) aliases.set(`${namespace}/${name}`, hostedModule(root, `@earendil-works/${name}`));
	aliases.set(`${namespace}/pi-ai`, hostedModule(root, "@earendil-works/pi-ai", "./compat"));
	for (const subpath of ["compat", "oauth", "providers/all"]) aliases.set(`${namespace}/pi-ai/${subpath}`, hostedModule(root, "@earendil-works/pi-ai", `./${subpath}`));
}
for (const suffix of ["", "/compile", "/value"]) {
	const target = hostedModule(root, "typebox", suffix ? `.${suffix}` : ".");
	aliases.set(`typebox${suffix}`, target);
	aliases.set(`@sinclair/typebox${suffix}`, target);
}

export async function resolve(specifier, context, nextResolve) {
	const url = aliases.get(specifier);
	if (url) return { url, shortCircuit: true };
	try { return await nextResolve(specifier, context); } catch (error) {
		// Pi also resolves source TS when an extension imports its emitted .js path.
		if (error.code === "ERR_MODULE_NOT_FOUND" && /^\.\.?\//u.test(specifier) && specifier.endsWith(".js")) return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
		throw error;
	}
}
