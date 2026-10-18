import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { APP_NAME, BUNDLE_ID, MARKER } from "./dispatcher.mjs";

export function handlerAppPath() { return join(homedir(), "Applications", APP_NAME); }

export async function isOwnedHandler(path) {
	try {
		const info = await lstat(path);
		if (!info.isDirectory() || info.isSymbolicLink()) return false;
		const marker = await readFile(join(path, "Contents", "Resources", "pilee-handler-marker"), "utf8");
		const plist = await readFile(join(path, "Contents", "Info.plist"), "utf8");
		return marker.trim() === MARKER && plist.includes(`<string>${BUNDLE_ID}</string>`);
	} catch { return false; }
}

/** Read-only LaunchServices lookup; never opens or registers an application. */
export async function handlerReady() {
	if (process.platform !== "darwin") return false;
	const app = handlerAppPath();
	if (!await isOwnedHandler(app)) return false;
	try {
		const script = 'ObjC.import("AppKit"); var app = $.NSWorkspace.sharedWorkspace.URLForApplicationToOpenURL($.NSURL.URLWithString("pilee-preview://probe")); app ? app.path.js : "";';
		const { stdout } = await promisify(execFile)("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 3000, maxBuffer: 8192 });
		return await realpath(stdout.trim()) === await realpath(app);
	} catch { return false; }
}
