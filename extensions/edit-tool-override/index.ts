// Adapted from github.com/jonghakseo/my-pi's edit-tool-override.
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerEditTool } from "../utils/edit-tool-ui.ts";

export default function editToolOverride(pi: ExtensionAPI) {
	registerEditTool(pi);
}
