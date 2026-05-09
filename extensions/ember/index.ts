import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const HELP = `불씨 / Ember — pilee knowledge friendly entrypoint

Usage:
  /ember [topic]        현재 세션에서 knowledge 후보를 찾기
  /ember collect [q]    같은 동작. 불씨 후보 수집
  /ember add [q]        후보를 docs/knowledge 문서로 추가/갱신
  /ember tend           freshness / confidence review queue 점검
  /ember resolve [opts] stale/review_needed 문서를 로컬 맥락으로 실제 해소
  /ember review         medium/low confidence 문서 검토 준비
  /ember graph          knowledge graph/index 재생성·검증

Canonical storage remains docs/knowledge and scripts/knowledge.mjs.`;

function normalizeArgs(args: string): { sub: string; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { sub: "collect", rest: "" };
	const [first = "", ...restParts] = trimmed.split(/\s+/);
	const sub = first.toLowerCase();
	if (["collect", "add", "ignite", "tend", "resolve", "review", "graph", "help"].includes(sub)) {
		return { sub: sub === "ignite" ? "add" : sub, rest: restParts.join(" ").trim() };
	}
	return { sub: "collect", rest: trimmed };
}

function buildPrompt(sub: string, rest: string): string {
	const topicLine = rest ? `\n관심 주제/힌트: ${rest}` : "";
	const commonRules = `
공통 규칙:
- \`불씨/Ember\`는 friendly command/branding이고, canonical 용어는 계속 \`knowledge\`로 유지한다.
- 저장소 구조는 \`docs/knowledge\`, \`scripts/knowledge.mjs\`, freshness, confidence, reviewed_commit 용어를 사용한다.
- private history 원문은 공개 문서에 복사하지 말고 public/sanitized doctrine으로 재작성한다.
- 바로 큰 rename을 하지 말고, 필요하면 기존 knowledge 문서 갱신 또는 신규 판단 문서 생성을 제안한다.`;

	if (sub === "add") {
		return `불씨를 pilee knowledge로 추가하거나 기존 문서에 접목해줘.${topicLine}

이 흐름은 product \`/add-knowledge\`의 좋은 점(기존 문서 검색 → 범위/판단 정렬 → 작성 계획 → 검증)을 가져오되, pilee의 canonical 모델에 맞춘다. pilee knowledge 문서의 단위는 코드 scope가 아니라 public/sanitized reusable judgment다.

해야 할 일:
1. 먼저 git status를 확인하고, 충돌/무관 WIP가 있으면 중단하고 보고한다.
2. 주제를 정규화한다: 핵심 judgment 1문장, 검색어 3~6개, 예상 \`applies_to\` surface를 정리한다.
3. 반드시 \`node scripts/knowledge.mjs "<검색어>"\`로 기존 knowledge를 검색한다. 기존 문서로 충분하면 신규 문서를 만들지 않고 갱신한다.
4. 관련 public 파일(knowledge 문서, skill/extension/script)을 필요한 만큼 읽는다. private history/session은 로컬 근거로만 사용하고 원문·경로·민감 맥락은 공개 문서/PR body에 복사하지 않는다.
5. 문서 전략을 고른다: 기존 문서 수정 / 신규 1개 / 여러 문서 분리. 신규 문서는 독립 검색될 reusable judgment일 때만 만든다.
6. 의미 있는 분기(신규 vs 기존, 문서 분할, confidence)가 있으면 파일 쓰기 전에 번호형 작성 계획을 사용자에게 확인한다. 단, 직전 \`/ember collect\` 후보를 사용자가 명시적으로 “추가”하라고 했고 전략이 하나로 명백하면 \`(명백: collect에서 확인된 단일 후보)\`를 보고하고 진행한다.
7. \`docs/knowledge/*.md\`를 작성/수정한다. frontmatter는 title/tags/category/status/confidence/applies_to/source/reviewed_at/reviewed_commit/related를 갖춘다. 본문은 구현 파일 나열보다 판단 기준, 대체된 결정, review trigger를 우선한다.
8. \`node scripts/knowledge.mjs --graph\`, \`node scripts/knowledge.mjs --validate\`, \`node scripts/knowledge.mjs --freshness\`로 검증한다. 검토가 실제로 끝난 문서는 필요 시 \`node scripts/knowledge.mjs --confirm <doc-id>\`를 사용한다.
9. 완료 보고에는 주제, 전략, 수정 파일, 연결 문서, 검증 결과, 보류/사용자 판단 필요 항목을 짧게 적는다.

Red flags:
- 기존 knowledge 검색 없이 새 문서를 만든다.
- private journal 원문을 public doctrine에 붙여넣는다.
- README generated block을 수동 편집한다.
- related 없이 고립 문서를 만든다.
- 실제 검토 없이 reviewed_at/reviewed_commit만 갱신한다.
- 구현 파일/함수 목록을 knowledge 본문으로 대체한다.
${commonRules}`;
	}

	if (sub === "tend") {
		return `불씨의 불길을 살펴줘. pilee knowledge freshness/confidence 상태를 점검하고 다음 action만 짧게 정리해줘.${topicLine}

해야 할 일:
1. \`node scripts/knowledge.mjs --freshness\`를 실행한다.
2. deterministic action과 AI/human review action을 분리해서 요약한다.
3. medium/low confidence 문서는 사용자 review queue로 남기고, 임의로 \`--confirm\`하지 않는다.
${commonRules}`;
	}

	if (sub === "resolve") {
		const resolverArgs = rest ? (rest.startsWith("--") ? rest : `--topic "${rest.replace(/"/g, '\\"')}"`) : "--limit 8";
		return `불씨 resolver로 stale/review_needed knowledge 문서를 실제 해소해줘.${topicLine}

해야 할 일:
1. 먼저 git status를 확인하고, 충돌/무관 WIP가 있으면 중단하고 보고한다.
2. \`node scripts/knowledge.mjs --resolve-stale ${resolverArgs}\`를 실행해 로컬 resolver plan을 만든다.
3. 생성된 \`.context/knowledge-resolver/.../resolve-plan.md\`와 \`prompt.md\`를 읽는다.
4. 각 후보별로 관련 knowledge 문서, 관련 커밋 diff, 필요 시 로컬 Pi session hint의 전문을 확인한다.
5. 문서가 현재 판단과 다르면 public/sanitized 내용으로 수정하고, 여전히 맞으면 근거를 확인한 뒤 \`node scripts/knowledge.mjs --confirm <doc-id>\`로 reviewed 기준을 갱신한다.
6. private journal/session 원문, session path, \`freshness.local.json\` 내용은 공개 문서나 PR body에 복사하지 않는다.
7. \`node scripts/knowledge.mjs --graph\`, \`node scripts/knowledge.mjs --validate\`, \`node scripts/knowledge.mjs --freshness\`로 검증한다.
8. 실제 업데이트 PR을 만들 준비가 되면 로컬 브랜치/커밋/PR body를 구성하고, 수정/confirm-only/보류 항목을 구분해 보고한다.
${commonRules}`;
	}

	if (sub === "review") {
		return `불씨 review queue를 정리해줘. medium/low confidence knowledge 문서를 검토할 수 있게 후보와 판단 포인트를 요약해줘.${topicLine}

해야 할 일:
1. \`node scripts/knowledge.mjs --freshness\`와 필요하면 \`node scripts/knowledge.mjs --review-candidates\`를 실행한다.
2. 각 후보별로 확인해야 할 사용자 판단, 관련 파일, 추천 action을 정리한다.
3. 사용자가 명시 승인하기 전에는 confidence를 high로 승격하지 않는다.
${commonRules}`;
	}

	if (sub === "graph") {
		return `knowledge graph/index를 정리해줘. generated block을 CLI로 갱신하고 검증해줘.${topicLine}

해야 할 일:
1. \`node scripts/knowledge.mjs --graph\`를 실행한다.
2. \`node scripts/knowledge.mjs --validate\`와 \`node scripts/knowledge.mjs --freshness\`로 검증한다.
3. README generated block은 수동 편집하지 않는다.
${commonRules}`;
	}

	return `오늘 세션에서 남길 불씨를 찾아줘. 현재 대화/작업에서 public knowledge로 키울 만한 reusable judgment 후보를 정리해줘.${topicLine}

해야 할 일:
1. 후보를 \`제목 / 판단 단위 / 공개 가능성 / applies_to / 기존 문서 연결 / 추천 action\` 표로 제안한다.
2. 기존 문서로 충분하면 신규 문서를 만들지 말고 갱신 후보로 표시한다.
3. 바로 파일을 수정하지 말고, 먼저 후보와 추천 action을 보고한다.
4. 필요하면 \`node scripts/knowledge.mjs \"<query>\"\`로 기존 knowledge를 검색한다.
${commonRules}`;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("ember", {
		description: "불씨 — pilee knowledge 후보 수집/정합성 점검 friendly entrypoint",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const { sub, rest } = normalizeArgs(args);
			if (sub === "help") {
				ctx.ui.notify(HELP, "info");
				return;
			}

			ctx.ui.notify("🔥 불씨를 knowledge 작업으로 이어갑니다.", "info");
			pi.sendUserMessage(buildPrompt(sub, rest), { deliverAs: "followUp" });
		},
	});
}
