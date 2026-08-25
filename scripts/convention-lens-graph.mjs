#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, relative, resolve, sep } from 'node:path';
import { conventionGraphCoverage, loadConventionGraph } from '../extensions/convention-lens/graph.ts';
import { loadConventionLensProfiles } from '../extensions/utils/private-profiles.ts';

function parseArgs(argv) {
  const result = { activePackageRoots: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') result.cwd = argv[++index];
    else if (arg === '--profile') result.profileId = argv[++index];
    else if (arg === '--output') result.output = argv[++index];
    else if (arg === '--coverage-output') result.coverageOutput = argv[++index];
    else if (arg === '--active-package-root') result.activePackageRoots.push(argv[++index]);
    else if (arg === '--check') result.check = true;
  }
  return result;
}

function displayPath(path, cwd) {
  const absolute = resolve(path);
  const root = resolve(cwd);
  if (absolute === root || absolute.startsWith(`${root}${sep}`)) return `{repo}/${relative(root, absolute)}`;
  const home = homedir();
  if (absolute === home || absolute.startsWith(`${home}${sep}`)) return `{home}/${relative(home, absolute)}`;
  return absolute;
}

function exportedGraph(graph, cwd) {
  return {
    schemaVersion: 1,
    profileId: graph.profileId,
    graphVersion: graph.version,
    nodes: graph.nodes.map((node) => ({
      ...node,
      source: { ...node.source, path: displayPath(node.source.path, cwd) },
    })),
  };
}

function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, jsonText(value), 'utf8');
}

function assertCurrent(path, value) {
  if (!existsSync(path)) throw new Error(`generated convention lens artifact missing: ${path}`);
  if (readFileSync(path, 'utf8') !== jsonText(value)) throw new Error(`generated convention lens artifact stale: ${path}`);
}

const args = parseArgs(process.argv.slice(2));
if (!args.cwd || !args.profileId) {
  console.error('Usage: convention-lens-graph.mjs --cwd <repo> --profile <id> [--output graph.json] [--coverage-output coverage.json] [--check]');
  process.exit(2);
}
const loadOptions = args.activePackageRoots.length ? { activePackageRoots: args.activePackageRoots, agentDir: '/tmp/convention-lens-empty-agent' } : {};
const profile = loadConventionLensProfiles(loadOptions).find((candidate) => candidate.id === args.profileId);
if (!profile) throw new Error(`convention lens profile not found: ${args.profileId}`);
const graph = loadConventionGraph(profile, resolve(args.cwd));
const coverage = conventionGraphCoverage(graph);
const graphArtifact = exportedGraph(graph, args.cwd);
const coverageArtifact = { schemaVersion: 1, ...coverage };
if (args.check) {
  if (args.output) assertCurrent(resolve(args.output), graphArtifact);
  if (args.coverageOutput) assertCurrent(resolve(args.coverageOutput), coverageArtifact);
} else {
  if (args.output) writeJson(resolve(args.output), graphArtifact);
  if (args.coverageOutput) writeJson(resolve(args.coverageOutput), coverageArtifact);
}
console.log(JSON.stringify(coverage, null, 2));
if (!coverage.pass) process.exitCode = 1;
