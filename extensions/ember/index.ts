import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const HELP = `불씨 / Ember — pilee knowledge friendly entrypoint

Usage:
  /ember [topic]        현재 세션에서 knowledge 후보를 찾기
  /ember collect [q]    같은 동작. 불씨 후보 수집
  /ember tend           freshness / confidence review queue 점검
  /ember review         medium/low confidence 문서 검토 준비
  /ember graph          knowledge graph/index 재생성·검증

Canonical storage remains docs/knowledge and scripts/knowledge.mjs.`;

function normalizeArgs(args: string): { sub: string; rest: string } {
	const trimmed = args.trim();
	if (!trimmed) return { sub: "collect", rest: "" };
	const [first = "", ...restParts] = trimmed.split(/\s+/);
	const sub = first.toLowerCase();
	if (["collect", "ignite", "tend", "review", "graph", "help"].includes(sub)) {
		return { sub, rest: restParts.join(" ").trim() };
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

	if (sub === "tend") {
		return `불씨의 불길을 살펴줘. pilee knowledge freshness/confidence 상태를 점검하고 다음 action만 짧게 정리해줘.${topicLine}

해야 할 일:
1. \`node scripts/knowledge.mjs --freshness\`를 실행한다.
2. deterministic action과 AI/human review action을 분리해서 요약한다.
3. medium/low confidence 문서는 사용자 review queue로 남기고, 임의로 \`--confirm\`하지 않는다.
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
