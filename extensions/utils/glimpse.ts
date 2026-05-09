import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface GlimpseWindow {
	on(event: "closed", handler: () => void): void;
	on(event: "message", handler: (data: unknown) => void): void;
	on(event: "ready", handler: (info: { screen?: { visibleHeight?: number } }) => void): void;
	close(): void;
	_write?(message: Record<string, unknown>): void;
}

export type GlimpseOpen = (html: string, opts: Record<string, unknown>) => GlimpseWindow;

let glimpseOpen: GlimpseOpen | null | undefined;

function findGlimpseMjs(): string | null {
	try {
		const req = createRequire(import.meta.url);
		return req.resolve("glimpseui");
	} catch {}
	try {
		const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
		const entry = join(globalRoot, "glimpseui", "src", "glimpse.mjs");
		if (existsSync(entry)) return entry;
	} catch {}
	return null;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function installDarwinStderrFilter(resolvedGlimpseMjs: string): void {
	if (process.platform !== "darwin") return;
	if (process.env.GLIMPSE_BINARY_PATH || process.env.GLIMPSE_HOST_PATH) return;

	const realHost = join(dirname(resolvedGlimpseMjs), "glimpse");
	if (!existsSync(realHost)) return;

	const dir = join(homedir(), ".pi", "agent", "glimpse");
	const wrapper = join(dir, "glimpse-stderr-filter.sh");
	const content = `#!/usr/bin/env bash
set -euo pipefail
real_host=${shellQuote(realHost)}
exec "$real_host" "$@" 2> >(
  while IFS= read -r line; do
    case "$line" in
      *"TSM AdjustCapsLockLEDForKeyTransitionHandling"*|*"_ISSetPhysicalKeyboardCapsLockLED Inhibit"*|*"IMKCFRunLoopWakeUpReliable"*) ;;
      *) printf '%s\\n' "$line" >&2 ;;
    esac
  done
)
`;
	try {
		mkdirSync(dir, { recursive: true });
		if (!existsSync(wrapper) || readFileSync(wrapper, "utf-8") !== content) {
			writeFileSync(wrapper, content, "utf-8");
			chmodSync(wrapper, 0o755);
		}
		process.env.GLIMPSE_HOST_PATH = wrapper;
	} catch {
		// If the wrapper cannot be installed, keep Glimpse behavior unchanged.
	}
}

export async function getGlimpseOpen(): Promise<GlimpseOpen | null> {
	if (glimpseOpen !== undefined) return glimpseOpen;
	const resolved = findGlimpseMjs();
	if (resolved) {
		installDarwinStderrFilter(resolved);
		try {
			glimpseOpen = (await import(resolved)).open as GlimpseOpen;
			return glimpseOpen;
		} catch {}
	}
	glimpseOpen = null;
	return glimpseOpen;
}
