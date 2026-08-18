#!/usr/bin/env node
import { resolve } from "node:path";
import { importPrReviewCorpus } from "../extensions/pr-review/corpus.ts";

function args(argv) {
	const result = {};
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (!value.startsWith("--")) continue;
		result[value.slice(2)] = argv[index + 1];
		index += 1;
	}
	return result;
}

const options = args(process.argv.slice(2));
if (!options.id || !options.events || !options.output) {
	console.error("Usage: pr-review-corpus.mjs --id <corpus-id> --events <events.json> [--casebook <casebook.md>] --output <corpus-dir>");
	process.exit(2);
}

const manifest = importPrReviewCorpus({
	id: options.id,
	eventsPath: resolve(options.events),
	casebookPath: options.casebook ? resolve(options.casebook) : undefined,
	outputDir: resolve(options.output),
});
console.log(JSON.stringify(manifest, null, 2));
