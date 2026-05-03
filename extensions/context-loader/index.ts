import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const cwd = ctx.cwd;
    const contextPath = join(cwd, ".context", "work");
    
    if (!existsSync(contextPath)) return;

    // .context/work/ 아래에서 context.md 찾기
    const { readdirSync } = await import("node:fs");
    let contextContent = "";

    try {
      const workDirs = readdirSync(contextPath);
      for (const dir of workDirs) {
        const contextMd = join(contextPath, dir, "context.md");
        if (existsSync(contextMd)) {
          const content = readFileSync(contextMd, "utf-8");
          contextContent += `\n## Workspace Context: ${dir}\n${content}\n`;
        }
      }
    } catch {
      return;
    }

    if (!contextContent) return;

    // system prompt에 context 추가
    return {
      systemPrompt: event.systemPrompt + `\n\n<workspace-context>\n${contextContent}\n</workspace-context>`,
    };
  });
}
