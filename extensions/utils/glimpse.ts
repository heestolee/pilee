import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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

function patchDarwinWebViewShortcutSupport(source: string): string | null {
	const originalPanel = `class GlimpsePanel: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}`;
	const patchedPanel = `class GlimpsePanel: NSWindow {
    weak var targetWebView: WKWebView?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }

    private func pastePlainTextIntoFocusedElement() -> Bool {
        guard let webView = targetWebView else { return false }
        guard let text = NSPasteboard.general.string(forType: .string) else { return false }
        guard let data = try? JSONSerialization.data(withJSONObject: [text], options: []),
              let jsonPayload = String(data: data, encoding: .utf8) else { return false }
        let js = """
(function(payload) {
  var text = payload && payload[0] ? String(payload[0]) : '';
  var el = document.activeElement;
  if (!el) return false;
  var tag = (el.tagName || '').toLowerCase();
  var inputType = String(el.type || 'text').toLowerCase();
  var textInput = tag === 'textarea' || (tag === 'input' && !/^(button|checkbox|radio|file|submit|reset|image|color|range|date|time|datetime-local|month|week|hidden)$/.test(inputType));
  if (textInput) {
    var value = String(el.value || '');
    var start = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
    var end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
    el.value = value.slice(0, start) + text + value.slice(end);
    var next = start + text.length;
    if (typeof el.setSelectionRange === 'function') el.setSelectionRange(next, next);
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text })); }
    catch (_) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  }
  if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
    return true;
  }
  return false;
})(\\(jsonPayload));
"""
        webView.evaluateJavaScript(js, completionHandler: nil)
        return true
    }

    private func emitPageZoom(_ zoom: CGFloat) {
        let value = String(format: "%.4f", Double(zoom))
        let js = "window.dispatchEvent(new CustomEvent('glimpse:pageZoom', { detail: { zoom: \\(value) } }));"
        targetWebView?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func adjustPageZoom(_ factor: CGFloat) -> Bool {
        guard let webView = targetWebView else { return false }
        let nextZoom = min(max(webView.pageZoom * factor, 0.5), 3.0)
        webView.pageZoom = nextZoom
        emitPageZoom(nextZoom)
        return true
    }

    private func resetPageZoom() -> Bool {
        guard let webView = targetWebView else { return false }
        webView.pageZoom = 1.0
        emitPageZoom(1.0)
        return true
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        guard event.type == .keyDown else { return super.performKeyEquivalent(with: event) }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command), flags.subtracting([.command, .shift]).isEmpty else { return super.performKeyEquivalent(with: event) }
        let key = event.charactersIgnoringModifiers?.lowercased()
        if key == "+" || key == "=" || event.keyCode == 24 {
            if adjustPageZoom(1.1) { return true }
        }
        if key == "-" || key == "_" || event.keyCode == 27 {
            if adjustPageZoom(1.0 / 1.1) { return true }
        }
        if key == "0" || event.keyCode == 29 {
            if resetPageZoom() { return true }
        }
        let action: Selector?
        if key == "v" || event.keyCode == 9 {
            if pastePlainTextIntoFocusedElement() { return true }
            action = #selector(NSText.paste(_:))
        } else if key == "x" || event.keyCode == 7 {
            action = #selector(NSText.cut(_:))
        } else if key == "c" || event.keyCode == 8 {
            action = #selector(NSText.copy(_:))
        } else if key == "a" || event.keyCode == 0 {
            action = #selector(NSText.selectAll(_:))
        } else {
            action = nil
        }
        guard let action else { return super.performKeyEquivalent(with: event) }
        if targetWebView?.tryToPerform(action, with: nil) == true { return true }
        if NSApp.sendAction(action, to: nil, from: self) { return true }
        return super.performKeyEquivalent(with: event)
    }
}`;
	const originalMonitorSlot = `var popoverViewController: StatusItemViewController?`;
	const patchedMonitorSlot = `var popoverViewController: StatusItemViewController?
    var editKeyMonitor: Any?`;
	const originalLaunch = `    func applicationDidFinishLaunching(_ notification: Notification) {
        if config.statusItem {`;
	const patchedLaunch = `    func applicationDidFinishLaunching(_ notification: Notification) {
        setupEditMenu()
        if config.statusItem {`;
	const originalSetupWindow = `    private func setupWindow() {`;
	const patchedSetupWindow = `    private func setupEditMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu(title: "Application")
        appMenu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(NSMenuItem.separator())
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        let zoomInItem = NSMenuItem(title: "Zoom In", action: #selector(zoomIn(_:)), keyEquivalent: "=")
        zoomInItem.keyEquivalentModifierMask = [.command]
        zoomInItem.target = self
        viewMenu.addItem(zoomInItem)
        let zoomOutItem = NSMenuItem(title: "Zoom Out", action: #selector(zoomOut(_:)), keyEquivalent: "-")
        zoomOutItem.keyEquivalentModifierMask = [.command]
        zoomOutItem.target = self
        viewMenu.addItem(zoomOutItem)
        let actualSizeItem = NSMenuItem(title: "Actual Size", action: #selector(resetZoom(_:)), keyEquivalent: "0")
        actualSizeItem.keyEquivalentModifierMask = [.command]
        actualSizeItem.target = self
        viewMenu.addItem(actualSizeItem)
        viewMenuItem.submenu = viewMenu

        NSApp.mainMenu = mainMenu
    }

    @objc private func zoomIn(_ sender: Any?) {
        _ = adjustPageZoom(1.1)
    }

    @objc private func zoomOut(_ sender: Any?) {
        _ = adjustPageZoom(1.0 / 1.1)
    }

    @objc private func resetZoom(_ sender: Any?) {
        _ = resetPageZoom()
    }

    private func setupWindow() {`;
	const originalSetupWebView = `    private func setupWebView() {
        webView = WKWebView(frame: window.contentView!.bounds, configuration: makeWebViewConfiguration())`;
	const patchedSetupWebView = `    private func pastePlainTextIntoFocusedElement() -> Bool {
        guard let text = NSPasteboard.general.string(forType: .string) else { return false }
        guard let data = try? JSONSerialization.data(withJSONObject: [text], options: []),
              let jsonPayload = String(data: data, encoding: .utf8) else { return false }
        let js = """
(function(payload) {
  var text = payload && payload[0] ? String(payload[0]) : '';
  var el = document.activeElement;
  if (!el) return false;
  var tag = (el.tagName || '').toLowerCase();
  var inputType = String(el.type || 'text').toLowerCase();
  var textInput = tag === 'textarea' || (tag === 'input' && !/^(button|checkbox|radio|file|submit|reset|image|color|range|date|time|datetime-local|month|week|hidden)$/.test(inputType));
  if (textInput) {
    var value = String(el.value || '');
    var start = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
    var end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
    el.value = value.slice(0, start) + text + value.slice(end);
    var next = start + text.length;
    if (typeof el.setSelectionRange === 'function') el.setSelectionRange(next, next);
    try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: text })); }
    catch (_) { el.dispatchEvent(new Event('input', { bubbles: true })); }
    return true;
  }
  if (el.isContentEditable) {
    document.execCommand('insertText', false, text);
    return true;
  }
  return false;
})(\\(jsonPayload));
"""
        webView.evaluateJavaScript(js, completionHandler: nil)
        return true
    }

    private func emitPageZoom(_ zoom: CGFloat) {
        let value = String(format: "%.4f", Double(zoom))
        let js = "window.dispatchEvent(new CustomEvent('glimpse:pageZoom', { detail: { zoom: \\(value) } }));"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    private func adjustPageZoom(_ factor: CGFloat) -> Bool {
        guard webView != nil else { return false }
        let nextZoom = min(max(webView.pageZoom * factor, 0.5), 3.0)
        webView.pageZoom = nextZoom
        emitPageZoom(nextZoom)
        return true
    }

    private func resetPageZoom() -> Bool {
        guard webView != nil else { return false }
        webView.pageZoom = 1.0
        emitPageZoom(1.0)
        return true
    }

    private func installWebViewEditKeyMonitor() {
        if editKeyMonitor != nil { return }
        editKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            guard let self else { return event }
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            guard flags.contains(.command), flags.subtracting([.command, .shift]).isEmpty else { return event }
            guard self.window?.isKeyWindow == true || self.webView?.window?.isKeyWindow == true else { return event }
            let key = event.charactersIgnoringModifiers?.lowercased()
            if key == "+" || key == "=" || event.keyCode == 24 {
                if self.adjustPageZoom(1.1) { return nil }
            }
            if key == "-" || key == "_" || event.keyCode == 27 {
                if self.adjustPageZoom(1.0 / 1.1) { return nil }
            }
            if key == "0" || event.keyCode == 29 {
                if self.resetPageZoom() { return nil }
            }
            let action: Selector?
            if key == "v" || event.keyCode == 9 {
                if self.pastePlainTextIntoFocusedElement() { return nil }
                action = #selector(NSText.paste(_:))
            } else if key == "x" || event.keyCode == 7 {
                action = #selector(NSText.cut(_:))
            } else if key == "c" || event.keyCode == 8 {
                action = #selector(NSText.copy(_:))
            } else if key == "a" || event.keyCode == 0 {
                action = #selector(NSText.selectAll(_:))
            } else {
                action = nil
            }
            guard let action else { return event }
            if self.webView?.tryToPerform(action, with: nil) == true { return nil }
            if NSApp.sendAction(action, to: nil, from: self) { return nil }
            return event
        }
    }

    private func setupWebView() {
        webView = WKWebView(frame: window.contentView!.bounds, configuration: makeWebViewConfiguration())`;
	const originalDelegate = `webView.navigationDelegate = self
        if config.transparent {`;
	const patchedDelegate = `webView.navigationDelegate = self
        if let panel = window as? GlimpsePanel {
            panel.targetWebView = webView
        }
        installWebViewEditKeyMonitor()
        if config.transparent {`;
	if (!source.includes(originalPanel) || !source.includes(originalMonitorSlot) || !source.includes(originalLaunch) || !source.includes(originalSetupWindow) || !source.includes(originalSetupWebView) || !source.includes(originalDelegate)) return null;
	return source
		.replace(originalPanel, patchedPanel)
		.replace(originalMonitorSlot, patchedMonitorSlot)
		.replace(originalLaunch, patchedLaunch)
		.replace(originalSetupWindow, patchedSetupWindow)
		.replace(originalSetupWebView, patchedSetupWebView)
		.replace(originalDelegate, patchedDelegate);
}

function resolveDarwinHostWithShortcutSupport(resolvedGlimpseMjs: string, dir: string): string | null {
	const sourcePath = join(dirname(resolvedGlimpseMjs), "glimpse.swift");
	const originalHost = join(dirname(resolvedGlimpseMjs), "glimpse");
	if (!existsSync(sourcePath) || !existsSync(originalHost)) return existsSync(originalHost) ? originalHost : null;
	try {
		const originalSource = readFileSync(sourcePath, "utf-8");
		const patchedSource = patchDarwinWebViewShortcutSupport(originalSource);
		if (!patchedSource) return originalHost;
		const hash = createHash("sha1").update(patchedSource).digest("hex").slice(0, 12);
		const buildDir = join(dir, `darwin-webview-shortcuts-${hash}`);
		const patchedSourcePath = join(buildDir, "glimpse.swift");
		const patchedHost = join(buildDir, "glimpse");
		mkdirSync(buildDir, { recursive: true });
		if (!existsSync(patchedHost)) {
			writeFileSync(patchedSourcePath, patchedSource, "utf-8");
			execFileSync("swiftc", ["-O", patchedSourcePath, "-o", patchedHost], { encoding: "utf-8", timeout: 120000 });
			chmodSync(patchedHost, 0o755);
		}
		return existsSync(patchedHost) ? patchedHost : originalHost;
	} catch {
		return originalHost;
	}
}

function installDarwinHostAdapter(resolvedGlimpseMjs: string): void {
	if (process.platform !== "darwin") return;
	if (process.env.GLIMPSE_BINARY_PATH || process.env.GLIMPSE_HOST_PATH) return;

	const dir = join(homedir(), ".pi", "agent", "glimpse");
	const realHost = resolveDarwinHostWithShortcutSupport(resolvedGlimpseMjs, dir);
	if (!realHost) return;

	const wrapper = join(dir, "glimpse-host-adapter.sh");
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
		// If the adapter cannot be installed, keep Glimpse behavior unchanged.
	}
}

export async function getGlimpseOpen(): Promise<GlimpseOpen | null> {
	if (glimpseOpen !== undefined) return glimpseOpen;
	const resolved = findGlimpseMjs();
	if (resolved) {
		installDarwinHostAdapter(resolved);
		try {
			glimpseOpen = (await import(resolved)).open as GlimpseOpen;
			return glimpseOpen;
		} catch {}
	}
	glimpseOpen = null;
	return glimpseOpen;
}
