#!/usr/bin/env node
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULTS = {
	fps: 12,
	frameDuration: 1.1,
	duration: 8,
	width: "source",
	maxColors: 256,
	statsMode: "diff",
	dither: "sierra2_4a",
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".webm", ".mp4", ".mov", ".m4v"]);

function usage(exitCode = 1) {
	const text = `Usage:
  make-motion-gif.mjs --output <out.gif> [options] <input.webm|input.mp4>
  make-motion-gif.mjs --output <out.gif> [options] --frames <frame1.png> <frame2.png> [...]

Defaults:
  --fps 12
  --width source          # preserve source width; no hidden downscale
  --duration 8           # video mode trim limit
  --frame-duration 1.1   # frame mode display duration per frame
  --dither sierra2_4a
  --stats-mode diff
  --colors 256

Options:
  --start <seconds>       video mode trim start
  --duration <seconds>    video mode max duration
  --fps <number>          output frame rate
  --width source|<px>     source preserves source width; numeric scales to px width
  --max-width <px>        scale down only when source is wider than this
  --frame-duration <sec>  frame mode duration per source frame
  --dither <name>         paletteuse dither, e.g. sierra2_4a, bayer, floyd_steinberg
  --stats-mode <mode>     palettegen stats_mode, e.g. diff or full
  --colors <number>       palette max colors, default 256

Examples:
  make-motion-gif.mjs --output captures/click-flow.gif captures/click-flow.webm
  make-motion-gif.mjs --output captures/before-after.gif --frames captures/before.png captures/after.png
  make-motion-gif.mjs --output captures/short.gif --start 1 --duration 4 --fps 15 --max-width 1440 captures/flow.mp4`;
	console.error(text);
	process.exit(exitCode);
}

function parseArgs(argv) {
	const options = { ...DEFAULTS, output: undefined, start: undefined, frames: false, inputs: [] };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") usage(0);
		if (arg === "--frames") {
			options.frames = true;
			continue;
		}
		if (arg?.startsWith("--")) {
			const key = arg.slice(2);
			const value = argv[index + 1];
			if (value == null || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
			index += 1;
			switch (key) {
				case "output":
					options.output = value;
					break;
				case "fps":
					options.fps = parsePositiveNumber(value, key);
					break;
				case "duration":
					options.duration = parsePositiveNumber(value, key);
					break;
				case "start":
					options.start = parseNonNegativeNumber(value, key);
					break;
				case "frame-duration":
					options.frameDuration = parsePositiveNumber(value, key);
					break;
				case "width":
					options.width = parseWidth(value);
					break;
				case "max-width":
					options.maxWidth = parsePositiveInteger(value, key);
					break;
				case "colors":
					options.maxColors = parsePositiveInteger(value, key);
					if (options.maxColors > 256) throw new Error("GIF palette colors cannot exceed 256");
					break;
				case "stats-mode":
					options.statsMode = value;
					break;
				case "dither":
					options.dither = value;
					break;
				default:
					throw new Error(`Unknown option --${key}`);
			}
			continue;
		}
		options.inputs.push(arg);
	}
	if (!options.output) throw new Error("Missing --output <out.gif>");
	if (extname(options.output).toLowerCase() !== ".gif") throw new Error("--output must end with .gif");
	if (options.inputs.length === 0) throw new Error("Missing input file(s)");
	return options;
}

function parsePositiveNumber(value, key) {
	const number = Number(value);
	if (!Number.isFinite(number) || number <= 0) throw new Error(`--${key} must be a positive number`);
	return number;
}

function parseNonNegativeNumber(value, key) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < 0) throw new Error(`--${key} must be a non-negative number`);
	return number;
}

function parsePositiveInteger(value, key) {
	const number = Number(value);
	if (!Number.isInteger(number) || number <= 0) throw new Error(`--${key} must be a positive integer`);
	return number;
}

function parseWidth(value) {
	if (value === "source" || value === "original") return "source";
	return parsePositiveInteger(value, "width");
}

function validateInputs(options) {
	const inputs = options.inputs.map((input) => resolve(input));
	for (const input of inputs) {
		if (!existsSync(input)) throw new Error(`Input does not exist: ${input}`);
		if (!statSync(input).isFile()) throw new Error(`Input is not a file: ${input}`);
	}
	const extensions = inputs.map((input) => extname(input).toLowerCase());
	const allImages = extensions.every((extension) => IMAGE_EXTENSIONS.has(extension));
	const allVideos = extensions.every((extension) => VIDEO_EXTENSIONS.has(extension));
	if (options.frames || inputs.length > 1) {
		if (!allImages) throw new Error("Frame mode requires only image inputs (.png/.jpg/.jpeg/.webp)");
		if (inputs.length < 2) throw new Error("Frame mode needs at least two input frames");
		return { mode: "frames", inputs };
	}
	if (!allVideos) throw new Error("Video mode requires one .webm/.mp4/.mov/.m4v input, or use --frames for images");
	return { mode: "video", inputs };
}

function scaleFilter(options) {
	if (options.width !== "source") return `scale=${options.width}:-2:flags=lanczos`;
	if (options.maxWidth) return `scale='min(iw\\,${options.maxWidth})':-2:flags=lanczos`;
	return null;
}

function buildQualityFilter(options, upstreamFilter = null) {
	const filters = [];
	if (upstreamFilter) filters.push(upstreamFilter);
	filters.push(`fps=${options.fps}`);
	const scale = scaleFilter(options);
	if (scale) filters.push(scale);
	filters.push("split[s0][s1]");
	return `${filters.join(",")};[s0]palettegen=stats_mode=${options.statsMode}:max_colors=${options.maxColors}[p];[s1][p]paletteuse=dither=${options.dither}`;
}

function buildVideoArgs(options, input, output) {
	const args = ["-y"];
	if (options.start != null) args.push("-ss", String(options.start));
	if (options.duration != null) args.push("-t", String(options.duration));
	args.push("-i", input, "-filter_complex", buildQualityFilter(options), "-loop", "0", output);
	return args;
}

function buildFrameArgs(options, inputs, output) {
	const args = ["-y"];
	for (const input of inputs) args.push("-loop", "1", "-t", String(options.frameDuration), "-i", input);
	const labels = inputs.map((_, index) => `[${index}:v]setsar=1[v${index}]`).join(";");
	const concatInputs = inputs.map((_, index) => `[v${index}]`).join("");
	const upstream = `${labels};${concatInputs}concat=n=${inputs.length}:v=1:a=0`;
	args.push("-filter_complex", buildQualityFilter(options, upstream), "-loop", "0", output);
	return args;
}

function runFfmpeg(args) {
	const result = spawnSync("ffmpeg", args, { stdio: "inherit" });
	if (result.error) {
		if (result.error.code === "ENOENT") throw new Error("ffmpeg not found. Install ffmpeg before creating motion GIF evidence.");
		throw result.error;
	}
	if (result.status !== 0) throw new Error(`ffmpeg failed with exit code ${result.status}`);
}

try {
	const options = parseArgs(process.argv.slice(2));
	const { mode, inputs } = validateInputs(options);
	const output = resolve(options.output);
	mkdirSync(dirname(output), { recursive: true });
	const args = mode === "frames" ? buildFrameArgs(options, inputs, output) : buildVideoArgs(options, inputs[0], output);
	runFfmpeg(args);
	const bytes = statSync(output).size;
	console.log(JSON.stringify({ output, mode, inputs, fps: options.fps, width: options.width, maxWidth: options.maxWidth ?? null, frameDuration: mode === "frames" ? options.frameDuration : null, duration: mode === "video" ? options.duration : null, dither: options.dither, statsMode: options.statsMode, maxColors: options.maxColors, bytes }, null, 2));
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	console.error("Run with --help for usage.");
	process.exit(1);
}
