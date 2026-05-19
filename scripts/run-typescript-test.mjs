#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function canStripTypes(nodeBin) {
	const result = spawnSync(nodeBin, ["--experimental-strip-types", "--eval", ""], { encoding: "utf8" });
	return result.status === 0;
}

function candidateNodes() {
	const candidates = [process.execPath];
	if (process.env.NODE22) candidates.push(process.env.NODE22);
	candidates.push(join(homedir(), ".nvm", "versions", "node", "v22.22.0", "bin", "node"));
	candidates.push("node22");
	candidates.push("node");
	return [...new Set(candidates)].filter(Boolean);
}

const args = process.argv.slice(2);
if (args.length === 0) {
	console.error("Usage: run-typescript-test.mjs <node --test args...>");
	process.exit(2);
}

let selected = "";
for (const candidate of candidateNodes()) {
	if (candidate.includes("/") && !existsSync(candidate)) continue;
	if (canStripTypes(candidate)) {
		selected = candidate;
		break;
	}
}

if (!selected) {
	console.error("No Node runtime with --experimental-strip-types support found. Set NODE22=/path/to/node22.");
	process.exit(1);
}

const result = spawnSync(selected, ["--experimental-strip-types", "--test", ...args], { stdio: "inherit" });
if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}
process.exit(result.status ?? 1);
