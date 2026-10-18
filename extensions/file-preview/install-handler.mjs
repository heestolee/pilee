import { execFile } from "node:child_process";
import { constants, realpathSync } from "node:fs";
import { copyFile, lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { APP_NAME, BUNDLE_ID, MARKER, SCHEME } from "./dispatcher.mjs";
import { handlerAppPath, handlerReady, isOwnedHandler } from "./handler.mjs";

const exec = promisify(execFile);
const lsregister = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const sourceDirectory = dirname(fileURLToPath(import.meta.url));

export const handlerScript = `on open location theURL
	set nodePath to POSIX path of (path to resource "node")
	set dispatcherPath to POSIX path of (path to resource "dispatcher.mjs")
	try
		do shell script (quoted form of nodePath) & " " & (quoted form of dispatcherPath) & " " & (quoted form of theURL)
	on error
		display notification "세션이 종료됐거나 사용 중입니다. 원래 Pi에서 /preview를 사용하세요." with title "파일 미리보기"
	end try
end open location
`;

/** Build only. No LaunchServices registration or global settings changes. */
export async function buildHandlerBundle(destination) {
	if (process.platform !== "darwin") throw new Error("macOS에서만 helper를 빌드할 수 있습니다.");
	try { await lstat(destination); throw new Error("기존 경로에는 helper를 빌드하지 않습니다."); }
	catch (error) { if (error.code !== "ENOENT") throw error; }
	await mkdir(dirname(destination), { recursive: true });
	const temp = await mkdtemp(join(dirname(destination), ".pilee-handler-build-"));
	try {
		const script = join(temp, "handler.applescript");
		await writeFile(script, handlerScript, { mode: 0o600 });
		await exec("/usr/bin/osacompile", ["-o", destination, script], { timeout: 30_000 });
		const resources = join(destination, "Contents", "Resources");
		await copyFile(join(sourceDirectory, "dispatcher.mjs"), join(resources, "dispatcher.mjs"));
		// Own the executable, not an ephemeral runtime-package path or shell PATH lookup.
		await copyFile(process.execPath, join(resources, "node"), constants.COPYFILE_FICLONE);
		await writeFile(join(resources, "pilee-handler-marker"), MARKER + "\n", { mode: 0o600 });
		await writeFile(join(destination, "Contents", "Info.plist"), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>applet</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIdentifier</key><string>${BUNDLE_ID}</string>
<key>CFBundleName</key><string>Pilee File Preview</string>
<key>CFBundleVersion</key><string>1</string>
<key>LSUIElement</key><true/>
<key>CFBundleURLTypes</key><array><dict>
<key>CFBundleURLName</key><string>${BUNDLE_ID}</string>
<key>CFBundleURLSchemes</key><array><string>${SCHEME}</string></array>
</dict></array></dict></plist>\n`);
		await exec("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", destination], { timeout: 30_000 });
	} catch (error) { await rm(destination, { recursive: true, force: true }); throw error; }
	finally { await rm(temp, { recursive: true, force: true }); }
}

export async function installHandler() {
	if (process.platform !== "darwin") throw new Error("macOS에서만 설치할 수 있습니다.");
	const destination = handlerAppPath();
	let exists = false;
	try { await lstat(destination); exists = true; } catch (error) { if (error.code !== "ENOENT") throw error; }
	if (exists && !await isOwnedHandler(destination)) throw new Error("본인 marker·bundle ID가 아닌 기존 앱을 덮어쓰지 않습니다.");
	await mkdir(dirname(destination), { recursive: true });
	const staging = await mkdtemp(join(dirname(destination), ".pilee-handler-install-"));
	const built = join(staging, APP_NAME);
	const backup = join(staging, "previous.app");
	let backedUp = false;
	let replaced = false;
	try {
		await buildHandlerBundle(built);
		if (exists) { await rename(destination, backup); backedUp = true; }
		await rename(built, destination); replaced = true;
		await exec(lsregister, ["-f", destination], { timeout: 10_000 });
	} catch (error) {
		if (replaced) await rm(destination, { recursive: true, force: true });
		if (backedUp) await rename(backup, destination);
		throw error;
	} finally { await rm(staging, { recursive: true, force: true }); }
	console.log(await handlerReady() ? "helper 설치·등록 확인됨. Pi /reload 후 클릭을 사용하세요." : "앱은 설치됐지만 기본 URL handler는 확인되지 않았습니다. 클릭은 비활성화되고 /preview를 사용할 수 있습니다.");
}

export async function uninstallHandler() {
	if (process.platform !== "darwin") throw new Error("macOS에서만 제거할 수 있습니다.");
	const destination = handlerAppPath();
	if (!await isOwnedHandler(destination)) throw new Error("본인 marker·bundle ID가 아닌 앱은 제거하지 않습니다.");
	await exec(lsregister, ["-u", destination], { timeout: 10_000 });
	await rm(destination, { recursive: true });
	console.log("helper 제거됨. Pi /reload 후 command-only 모드로 돌아갑니다.");
}

function isCliEntry() {
	try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
	catch { return false; }
}

if (isCliEntry()) {
	const [action, destination] = process.argv.slice(2);
	const operation = action === "--install" ? installHandler : action === "--uninstall" ? uninstallHandler :
		action === "--check" ? async () => console.log(await handlerReady() ? "READY" : "COMMAND_ONLY") :
		action === "--build" && destination ? () => buildHandlerBundle(resolve(destination)) : undefined;
	if (operation) operation().catch((error) => { console.error(error.message); process.exitCode = 1; });
	else { console.log("사용법: node install-handler.mjs --check | --build <새 경로> | --install | --uninstall"); process.exitCode = 2; }
}
