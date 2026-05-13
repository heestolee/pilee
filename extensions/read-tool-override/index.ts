// Adapted from github.com/jonghakseo/my-pi's read-tool-override.
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerReadTool } from "../utils/read-tool-ui.ts";

export default function readToolOverride(pi: ExtensionAPI) {
	registerReadTool(pi);
}
