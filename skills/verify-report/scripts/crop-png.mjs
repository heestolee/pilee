#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { PNG } from "pngjs";

function usage() {
	console.error(`Usage:
  crop-png.mjs <input.png> <output.png> --x <number> --y <number> --width <number> --height <number>

Example:
  crop-png.mjs full-page.png summary-cards-crop.png --x 220 --y 360 --width 520 --height 680`);
}

function parseArgs(argv) {
	const [input, output, ...rest] = argv;
	const values = { input, output };
	for (let i = 0; i < rest.length; i += 2) {
		const key = rest[i];
		const value = rest[i + 1];
		if (!key?.startsWith("--") || value == null) throw new Error(`Invalid argument near ${key ?? "<end>"}`);
		values[key.slice(2)] = Number(value);
	}
	for (const key of ["input", "output", "x", "y", "width", "height"]) {
		if (values[key] == null || values[key] === "" || (typeof values[key] === "number" && !Number.isFinite(values[key]))) {
			throw new Error(`Missing or invalid ${key}`);
		}
	}
	return {
		input: values.input,
		output: values.output,
		x: Math.floor(values.x),
		y: Math.floor(values.y),
		width: Math.floor(values.width),
		height: Math.floor(values.height),
	};
}

function assertCropBounds(source, crop) {
	if (crop.x < 0 || crop.y < 0 || crop.width <= 0 || crop.height <= 0) throw new Error("Crop rectangle must be positive and inside the image.");
	if (crop.x + crop.width > source.width || crop.y + crop.height > source.height) {
		throw new Error(`Crop rectangle ${crop.x},${crop.y},${crop.width}x${crop.height} exceeds source ${source.width}x${source.height}.`);
	}
}

try {
	const crop = parseArgs(process.argv.slice(2));
	const source = PNG.sync.read(readFileSync(crop.input));
	assertCropBounds(source, crop);

	const target = new PNG({ width: crop.width, height: crop.height });
	for (let row = 0; row < crop.height; row += 1) {
		const sourceStart = ((crop.y + row) * source.width + crop.x) * 4;
		const sourceEnd = sourceStart + crop.width * 4;
		const targetStart = row * crop.width * 4;
		source.data.copy(target.data, targetStart, sourceStart, sourceEnd);
	}

	mkdirSync(dirname(crop.output), { recursive: true });
	writeFileSync(crop.output, PNG.sync.write(target));
	console.log(JSON.stringify({ input: crop.input, output: crop.output, source: { width: source.width, height: source.height }, crop: { x: crop.x, y: crop.y, width: crop.width, height: crop.height } }, null, 2));
} catch (error) {
	usage();
	console.error(error instanceof Error ? error.message : String(error));
	process.exit(1);
}
