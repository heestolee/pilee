import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { resolveStudyHardRuntimeConfig } from "./runtime-config.ts";
import { registerStudyHardBoardTool, startStudyHardStudio, stopStudyHardStudios, type StudyHardBoardState } from "./studio.ts";
const CUSTOM_TYPE = "heestolee.study-hard";

const HELP = `/study-hard — URL 기반 학습 모드

Usage:
  /study-hard https://reactnative.dev/architecture/xplat-implementation
  /study-hard <article-or-video-url> [관심 주제 힌트]
  /study-hard help

Flow:
  1. URL 내용을 가져온다.
  2. 요약만 하지 않고 질문-답변을 한 문제씩 반복한다.
  3. 사용자가 이해했다고 할 때까지 오개념을 짚고 다음 질문을 낸다.
  4. "노션에 저장"/"저장해줘" 요청 시 automation-scripts의 study_hard_sync.py로 날짜별 학습 페이지를 부분 업데이트한다.`;

export interface StudyHardInvocation {
	url: string;
	hints: string;
	commandLine: string;
	syncScript: string;
	syncScriptExists: boolean;
	boardRunId?: string;
	boardUrl?: string;
	boardStatePath?: string;
}

export function parseStudyHardArgs(args: string, cwd?: string): StudyHardInvocation | { help: true } | { error: string } {
	const trimmed = args.trim();
	if (!trimmed || ["help", "--help", "-h"].includes(trimmed.toLowerCase())) return { help: true };

	const tokens = trimmed.split(/\s+/g);
	const urlIndex = tokens.findIndex((token) => isHttpUrl(token));
	if (urlIndex < 0) {
		return { error: "URL을 찾지 못했습니다. 예: /study-hard https://reactnative.dev/architecture/xplat-implementation" };
	}

	const url = tokens[urlIndex]!;
	const hints = tokens.filter((_, index) => index !== urlIndex).join(" ").trim();
	const { syncScript } = resolveStudyHardRuntimeConfig(cwd);
	return {
		url,
		hints,
		commandLine: `/study-hard ${trimmed}`,
		syncScript,
		syncScriptExists: existsSync(syncScript),
	};
}

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

export function buildStudyHardPrompt(invocation: StudyHardInvocation, cwd: string, board?: StudyHardBoardState): string {
	const hints = invocation.hints ? invocation.hints : "(none)";
	const syncStatus = invocation.syncScriptExists ? "available" : "missing";
	const boardRunId = board?.runId || invocation.boardRunId || "(not-started)";
	const boardUrl = invocation.boardUrl || "(not-opened)";
	const boardStatePath = invocation.boardStatePath || "(not-created)";
	return `# /study-hard learning session

사용자가 \`${invocation.commandLine}\`를 실행했습니다.

대상 URL: ${invocation.url}
관심 주제 힌트: ${hints}
현재 cwd: ${cwd}
Notion sync script: ${invocation.syncScript} (${syncStatus})
Study Hard Studio runId: ${boardRunId}
Study Hard Studio URL: ${boardUrl}
Study Hard board state path: ${boardStatePath}

## 핵심 계약

이 턴은 "요약 리포트"가 아니라 "이해할 때까지 같이 공부하는 세션"입니다.

1. 먼저 URL 내용을 가져오고 자료 유형을 분류합니다.
   - 기본은 \`fetch_content\`입니다.
   - PR/코드 URL이면 실제 diff·파일·심볼·호출경로를 함께 읽습니다.
   - 영상/동적 페이지라 본문 추출이 부족하면 \`web_search\`나 transcript 요청으로 보완합니다.
   - \`sourceKind\`는 \`code|article|video|mixed\` 중 하나로 둡니다.
   - 가져오지 못했으면 추측 요약으로 시작하지 말고 접근 실패와 필요한 입력을 말합니다.
2. 자료를 읽으면 \`study_hard_board\`로 계층 지도를 먼저 만듭니다.
   - action: \`update\`, runId: \`${boardRunId}\`, expectedRevision: 현재 board revision
   - sourceKind, learningPhase, coachRole, goals, quickMap, nodes, edges, recommendedNodeId를 넣습니다.
   - \`edges\`는 parent-child hierarchy 전용입니다. runtime 호출·event·payload 관계를 hierarchy edge에 섞지 않습니다.
   - 노드를 선택해도 다른 노드나 계층선을 숨기거나 재배치하지 않습니다. 조상→현재→다음 자식 경로만 강조합니다.
   - 최초에는 subtree 단위 자동배치하고 이후 같은 id의 사용자 위치를 보존합니다.
   - type은 \`root|concept|question|confusion|decision|file|risk|summary|attachment\`, status는 \`unknown|learning|confused|understood|review\`입니다.
3. runtime/data flow는 지도와 분리해 \`flows\`로 만듭니다.
   - flow는 id, title, variant(before|after|current), actors, 순서가 있는 steps를 가집니다.
   - 각 step은 from/to, action, trigger, payload, sideEffect, result/risk, 실제 code reference를 구분합니다.
   - 코드/PR에서는 Before와 After가 같은 actor 순서로 비교되고 side effect ownership이 어디서 달라졌는지 읽혀야 합니다.
4. 선택 상세와 최종 문서는 \`noteDocument\`와 node.blocks로 만듭니다.
   - 최종 outline은 핵심 질문 → 한 문장 mental model → Before 문제 → After 해결 → 설계 원칙 → 코드 읽기 → 한계·오해 → 이해 확인 순서입니다.
   - code block은 복사 가능한 원문, language, lineNumberMode(source|relative), startLine, revision/path/symbol reference, annotations를 가집니다.
   - annotation은 line/endLine, behavior|reason|risk|change, 설명을 연결합니다. revision과 실제 line 근거가 없으면 source line이라고 주장하지 말고 relative를 사용합니다.
   - Studio와 Notion이 같은 noteDocument를 소비합니다. raw JSON이나 Mermaid source를 최종 학습 노트로 대체하지 않습니다.
5. 모든 표면은 자료 유형에 맞는 실제 근거를 담아야 합니다.
   - 코드/PR: 파일 경로, revision, symbol, 실제 line과 excerpt를 references/code block에 연결합니다.
   - 아티클: 주장, 근거, 반론, 원문 구간을 연결합니다.
   - 영상: 챕터, timestamp, 주장과 예시를 연결합니다.
   - 버그/설계: 증상, 가설, 실행 경로, 대안, trade-off를 연결합니다.
6. 첫 설명은 질문보다 먼저입니다.
   - 전체 지도의 큰 가지와 읽는 순서를 먼저 설명합니다.
   - 선택할 만한 시작 노드를 recommendedNodeId로 제안합니다.
   - 사용자가 맥락을 보지 못한 상태에서 진단 질문부터 던지지 않습니다.
7. 학습 진행은 혼합형입니다.
   - 사용자는 언제든 전체 지도를 탐색하고 원하는 노드를 질문할 수 있습니다.
   - 시스템은 강제로 잠그지 않고 다음 추천 단계만 제시합니다.
   - 개념 설명은 mentor, 사고 정리는 rubber-duck, 대안 비교는 peer, 코드·설계 검토는 lead 역할을 선택합니다.
   - 역할이나 phase가 바뀌면 coachRole/learningPhase/recommendedNodeId를 갱신합니다.
8. 질문과 답변은 하나의 composer에서 범위를 나눠 이어집니다.
   - \`scope: session\`은 전체 자료·여러 노드 관계·응용 질문입니다.
   - \`scope: node\`는 선택 노드의 개념·코드·근거 질문입니다.
   - \`scope: flow-step\`은 특정 인과 단계, \`scope: note-block\`은 특정 학습 문서 블록 질문입니다.
   - \`scope: coach\`는 왼쪽 학습 코치에서 목표·이해 빈틈·다음 학습 순서를 조정하는 대화이며 학습노트 내용 질문과 분리합니다.
   - 사용자의 질문은 \`origin: learner\`, 시스템의 이해 확인 질문은 \`origin: coach\`입니다.
   - Studio 오른쪽 Drawer의 learner 질문은 도구 없는 격리 Tutor가 최대 3개 병렬 답변하고 Editor가 최신 snapshot의 noteDocument에 한 번 병합합니다. Editor는 nodes/edges/flows/goals를 수정하지 않습니다.
   - worker 연산은 메인 Pi 모델에서 중복 실행하지 않지만, 사용자의 질문·최종 Tutor/Coach 답변·노트 반영·실패는 visible custom message로 같은 Pi transcript에 기록하며 다음 Pi context에도 포함합니다. Glimpse는 별도 대화가 아니라 이 canonical 학습 대화의 UI입니다.
   - 내부 Tutor/Editor/Coach prompt와 patch JSON은 Pi transcript에 노출하지 않습니다.
   - learner 질문에는 같은 question의 feedback으로 답하고 \`processingStatus: queued|running|answered|merging|applied|failed\`를 보존합니다.
   - coach 질문에는 userAnswer를 받은 뒤 feedback과 status를 갱신합니다.
   - update마다 마지막 tool result의 expectedRevision을 보내 stale snapshot이면 다시 status를 읽고 병합합니다.
   - 기존 questions 전체를 보존하고 같은 scope/target context id와 orchestrationId를 유지합니다.
   - 이해 확인 질문은 학습상 의미가 있을 때만 한 번에 하나 추가하며 기계적으로 매 답변 뒤에 만들지 않습니다.
9. 이해 상태와 적용을 함께 추적합니다.
   - 맞은 부분, 빈틈, 오개념을 구분하고 node status를 갱신합니다.
   - 새 연결이 생기면 nodes/edges/references를 확장합니다.
   - 이해한 내용을 실제 코드·새 사례·설계 판단에 적용하도록 practice 단계를 제안합니다.
10. 사용자가 "이해했어", "다음", "저장", "노션" 같은 의도를 말하면 그에 맞게 진행합니다.
   - 저장 요청 전에는 Notion write를 하지 않습니다.
   - user-facing 문장은 한국어를 기본으로 하되 원문 용어/API/코드명은 그대로 둡니다.

## 세션 중 유지할 학습 상태

대화 중 아래 상태를 간결하게 갱신해 두세요.

- source_url
- source_title
- source_kind: code|article|video|mixed
- learning_phase: map|explain|trace|practice|reflect
- coach_role: mentor|rubber-duck|peer|lead
- schemaVersion: 1, revision
- active_surface: map|flow|note와 선택 node/flow step/note block, map viewport
- layout_mode와 사용자 이동 x/y/positionLocked
- recommended_node_id
- 핵심 개념
- 사용자가 헷갈린 지점
- 범위별 Q&A 스레드: id, origin, scope(session|node|flow-step|note-block|coach), question, user_answer, feedback, status, processingStatus, orchestrationId, targetNodeId
- 최종 이해 요약
- 복습/후속 질문
- hierarchy nodes/edges: id, label, summary, detail, type, status, parentId, references, blocks
- runtime flows: id, variant, actors, ordered steps, payload, sideEffect, result/risk, code
- noteDocument: stable section/block id, fixed learning outline, code line annotations
- selected_node_id
- node-scoped questions: targetNodeId 포함
- attachments: id, nodeId, name, mimeType, path/url
- notionSync: page/session id와 sectionHashes (재동기화 conflict/no-op 판정용)

## Notion 저장 계약

사용자가 "저장해줘", "노션에 저장", "오늘 공부 기록 남겨"처럼 명시하면 다음을 수행합니다.

1. 현재 학습 상태를 JSON 파일로 씁니다. 권장 경로:
   - \`.context/study-hard/<session-id>.json\`
2. JSON schema는 아래 필드를 사용합니다.

\`\`\`json
{
  "schemaVersion": 1,
  "revision": 1,
  "date": "YYYY-MM-DD",
  "title": "학습 제목",
  "sourceUrl": "${invocation.url}",
  "sourceTitle": "원문 제목",
  "sessionId": "stable-url-or-topic-slug",
  "sourceKind": "code|article|video|mixed",
  "learningPhase": "map|explain|trace|practice|reflect",
  "coachRole": "mentor|rubber-duck|peer|lead",
  "activeSurface": "map|flow|note",
  "layoutMode": "auto|manual",
  "recommendedNodeId": "next-concept",
  "summary": "최종 이해 요약",
  "concepts": ["핵심 개념"],
  "nodes": [{"id":"concept","label":"개념","summary":"설명","type":"concept","status":"understood","parentId":"root","references":[{"kind":"code","label":"구현","path":"src/file.ts","symbol":"run","revision":"commit-sha","startLine":12}],"blocks":[{"id":"code-reading","type":"code","code":{"language":"typescript","code":"const value = run();","lineNumberMode":"source","startLine":12,"annotations":[{"line":12,"kind":"reason","text":"이 줄의 이유"}]}}],"positionLocked":true,"x":0,"y":0}],
  "edges": [{"source":"root","target":"concept","label":"hierarchy only"}],
  "flows": [{"id":"after","title":"After","variant":"after","actors":[{"id":"web","label":"WebView"},{"id":"native","label":"Native"}],"steps":[{"id":"request","order":1,"from":"web","to":"native","action":"request","payload":"{ eventId }","sideEffect":"none"}]}],
  "noteDocument": {"title":"최종 학습 노트","sections":[{"id":"overview","kind":"overview","title":"핵심 질문과 Mental Model","blocks":[{"id":"mental-model","type":"callout","tone":"success","title":"한 문장 Mental Model","body":"..."}]}]},
  "selectedNodeId": "concept",
  "attachments": [{"id":"img-1","nodeId":"concept","name":"screenshot.png","mimeType":"image/png","path":"/local/path/screenshot.png"}],
  "boardStatePath": "${boardStatePath}",
  "qa": [
    {
      "id": "Q001",
      "origin": "learner|coach",
      "scope": "session|node|flow-step|note-block",
      "question": "질문",
      "userAnswer": "사용자 답변",
      "feedback": "피드백",
      "status": "understood|review|open",
      "targetNodeId": "concept"
    }
  ],
  "notionSync": {"pageId":"optional","sessionBlockId":"optional","sectionHashes":{"#learning-note":"last-synced-hash"}},
  "followups": ["복습 질문"]
}
\`\`\`

3. sync script가 available이면 아래처럼 실행합니다.

\`\`\`bash
python3 "${invocation.syncScript}" --file .context/study-hard/<session-id>.json
\`\`\`

4. sync script가 missing이면 파일만 만들고 BLOCKED로 보고합니다. 토큰/DB 값을 pilee public repo에 새로 쓰거나 추정하지 않습니다.
5. 수정 요청이 들어오면 같은 JSON의 해당 questions/nodes/flows/noteDocument/attachments를 stable id로 갱신한 뒤 같은 script를 다시 실행합니다.
6. script 결과의 pageId/sessionId/sectionHashes를 JSON의 notionSync에 보존합니다. 다음 sync는 동일 hash를 no-op으로 처리하고, Notion 수동 편집 hash와 충돌하면 자동 덮어쓰기하지 않습니다.
7. script는 날짜 페이지 전체나 비관리 block을 삭제하지 않습니다. 변경 section은 새 shadow를 먼저 완성·검증한 뒤 이전 관리 section만 교체합니다.

이제 URL 내용을 가져와 자료 유형을 분류하고, 근거가 연결된 전체 학습 지도와 설명부터 시작하세요. 질문은 사용자가 지도를 이해할 맥락을 얻은 뒤에만 제안하세요.`;
}

export default function studyHard(pi: ExtensionAPI) {
	registerStudyHardBoardTool(pi);
	pi.on("session_shutdown", () => stopStudyHardStudios());

	pi.registerCommand("study-hard", {
		description: "URL의 코드·PR·아티클·영상으로 개념 지도, 실제 근거, 노드별 대화, 적용 연습을 이어가는 적응형 학습 모드.",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parsed = parseStudyHardArgs(args, ctx.cwd);
			if ("help" in parsed) {
				ctx.ui.notify(HELP, "info");
				return;
			}
			if ("error" in parsed) {
				ctx.ui.notify(`${parsed.error}\n\n${HELP}`, "warning");
				return;
			}

			ctx.ui.notify("📚 Study Hard를 시작합니다. 전체 지도를 열고 실제 근거를 따라가며 같이 공부합니다.", "info");
			const handle = await startStudyHardStudio(pi, ctx, { url: parsed.url, title: parsed.hints || undefined, hints: parsed.hints, syncScript: parsed.syncScript });
			const invocation = { ...parsed, boardRunId: handle.state.runId, boardUrl: handle.url, boardStatePath: handle.statePath };
			pi.sendMessage(
				{
					customType: CUSTOM_TYPE,
					content: buildStudyHardPrompt(invocation, ctx.cwd ?? process.cwd(), handle.state),
					display: false,
					details: invocation,
				},
				{ deliverAs: "followUp", triggerTurn: true },
			);
		},
	});
}
