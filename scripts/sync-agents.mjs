#!/usr/bin/env node

/**
 * sync-agents.mjs
 *
 * Copies agent definition files (*.md) from this package's agents/ directory
 * into ~/.pi/agent/agents/.
 *
 * Default behavior: run at most once per package version. Use --force to overwrite.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.join(repoRoot, "agents");
const agentRootDir = path.join(os.homedir(), ".pi", "agent");
const targetDir = path.join(agentRootDir, "agents");
const stateDir = path.join(agentRootDir, "state");
const stampFile = path.join(stateDir, "pilee-sync-agents.json");
const packageJsonPath = path.join(repoRoot, "package.json");
const forceOverwrite = process.argv.includes("--force");

function readPackageVersion() {
	try {
		const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
		return typeof pkg.version === "string" ? pkg.version : "0.0.0";
	} catch {
		return "0.0.0";
	}
}

const packageVersion = readPackageVersion();

function readStamp() {
	if (!fs.existsSync(stampFile)) return null;
	try { return JSON.parse(fs.readFileSync(stampFile, "utf8")); } catch { return null; }
}

function shouldSkipByStamp() {
	if (forceOverwrite) return false;
	const stamp = readStamp();
	return stamp?.version === packageVersion;
}

function writeStamp() {
	try {
		fs.mkdirSync(stateDir, { recursive: true });
		fs.writeFileSync(stampFile, JSON.stringify({ version: packageVersion, syncedAt: Date.now() }, null, 2));
	} catch {}
}

function copyFile(srcPath, destPath) {
	if (fs.existsSync(destPath) && !forceOverwrite) {
		const srcStat = fs.statSync(srcPath);
		const destStat = fs.statSync(destPath);
		if (destStat.mtimeMs >= srcStat.mtimeMs) return false;
	}
	fs.copyFileSync(srcPath, destPath);
	return true;
}

function main() {
	if (!fs.existsSync(sourceDir)) {
		console.log(`[pilee sync-agents] No agents/ directory at ${sourceDir}, skipping.`);
		return;
	}

	if (shouldSkipByStamp()) {
		console.log(`[pilee sync-agents] Already synced for v${packageVersion}, skipping. Use --force to override.`);
		return;
	}

	fs.mkdirSync(targetDir, { recursive: true });

	const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".md"));
	let copied = 0;
	let skipped = 0;

	for (const file of files) {
		const src = path.join(sourceDir, file);
		const dest = path.join(targetDir, file);
		if (copyFile(src, dest)) copied++;
		else skipped++;
	}

	writeStamp();
	console.log(`[pilee sync-agents] v${packageVersion}: ${copied} copied, ${skipped} skipped → ${targetDir}`);
}

main();
