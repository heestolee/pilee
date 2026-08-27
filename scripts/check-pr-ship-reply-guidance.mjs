#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const skillPath = path.join(repoRoot, 'skills/pr-ship/SKILL.md');
const commandPath = path.join(repoRoot, 'extensions/ship-commands/index.ts');
const writeToolPath = path.join(repoRoot, 'extensions/ship-commands/pr-ship-write-tool.ts');
const skill = fs.readFileSync(skillPath, 'utf8');
const command = fs.readFileSync(commandPath, 'utf8');
const writeTool = fs.readFileSync(writeToolPath, 'utf8');

const requiredSkillSnippets = [
  'Reviewer Actor Gate — 최우선 철칙',
  '인간이 자동 리뷰 결과를 전달한 review는 인간 review다.',
  '`local-analysis-only`',
  '제품 파일 수정, 테스트 수정, commit, push, comment/reply',
  '특정 review/comment URL의 actor가 local-only면 다른 unresolved 자동 리뷰 thread를 대신 처리하지 않는다.',
  '외부 review write의 유일한 경로는 `pr_ship_review_write` tool이다.',
  'raw `gh api`/`gh pr review`/`gh pr edit --add-reviewer`/GraphQL mutation으로 우회하지 않는다.',
  'same exact login 하나만',
  '인간 reviewer의 review state가 `CHANGES_REQUESTED`여도 re-request하지 않는다.',
  '인간/미확인 review/comment | local analysis report만 제공. 답글·초안 없음',
  '`pr_timeline_comment` | `/pr-ship`에서는 항상 금지.',
  'Actor routing: <author → external-write-eligible | local-analysis-only>',
  '인간 리뷰에 하지 않은 것: edit/commit/push/comment/re-request/resolve 전부 수행하지 않음',
  '반드시 `리뷰 대응 평가`를 함께 포함한다.',
  '### 과하지 않았나?',
  '### 아쉬운 점',
  '### 남은 후속 후보',
  'Decision Preservation Gate — 기존 결정 회귀 방지',
  'pre-response HEAD',
  '리뷰 severity와 자동 리뷰어 신뢰도는 기존 결정을 뒤집는 승인으로 취급하지 않는다.',
  '기존 결정·이전 대응 회귀 점검: <PASS | CHANGED(승인됨) | GAP>',
  '보존한 결정/대응: <내용 + commit/reply/decision locator>',
  '되살리거나 원복한 항목: <없음 | 내용>',
  '의도적 결정 변경: <없음 | 변경한 결정, 새 근거, 사용자 승인>',
  '확인 범위: <부모 대화, frame/decision, 기존 답글, 대응 commit | 확인하지 못한 범위>',
  '| 리뷰 | Actor route | 기존 결정 관계 | 대응 필요성 | 평가 |',
  '`PASS`: protected decision ledger와 Decision Regression Audit를 완료했고',
  '`CHANGED(승인됨)`: superseding evidence와 사용자 승인에 따라',
  '`GAP`: 부모 대화, decision artifact, 기존 답글·대응 commit 또는 diff audit 일부를 확인하지 못했다.',
  '`compatible`',
  '`stale/reintroduction`',
  '`conflict`',
  '`superseding evidence`',
];

const requiredCommandSnippets = [
  'formatPrShipExternalWritePolicy',
  'parsePullRequestReviewUrl',
  'registerPrShipReviewWriteTool(pi)',
  'isDirectPrShipReviewWriteCommand',
  'Blocked raw GitHub review write during /pr-ship.',
];

const requiredWriteToolSnippets = [
  'name: "pr_ship_review_write"',
  'requireAllowedAuthor(repository.fullName, snapshot.author, loadProfiles())',
  'requireAllowedAuthor(repository.fullName, reviewer, loadProfiles())',
  'Protected human/unknown reviews are local-analysis-only.',
  'Posted review reply body did not match the requested body',
];

const missing = [
  ...requiredSkillSnippets.filter((snippet) => !skill.includes(snippet)).map((snippet) => `skill: ${snippet}`),
  ...requiredCommandSnippets.filter((snippet) => !command.includes(snippet)).map((snippet) => `command: ${snippet}`),
  ...requiredWriteToolSnippets.filter((snippet) => !writeTool.includes(snippet)).map((snippet) => `write-tool: ${snippet}`),
];

const orderedDecisionSections = [
  '### 1. Context Reconstruction',
  '### 1.1 Decision Preservation Gate — 기존 결정 회귀 방지',
  '### 2. Comment Triage',
  '### 5. Implement',
  '#### Decision Regression Audit',
  '### 7. Commit + Push',
];
const sectionPositions = orderedDecisionSections.map((heading) => skill.indexOf(heading));
if (
  sectionPositions.some((position) => position === -1) ||
  sectionPositions.some((position, index) => index > 0 && position <= sectionPositions[index - 1])
) {
  missing.push(`skill: decision preservation section order (${orderedDecisionSections.join(' → ')})`);
}
if ((skill.match(/`pre-response HEAD`/g) ?? []).length < 2) {
  missing.push('skill: pre-response HEAD must be captured and audited');
}

const finalReportStart = skill.indexOf('## Final Report');
const finalReportEnd = skill.indexOf('## Red Flags', finalReportStart);
const finalReport =
  finalReportStart >= 0 && finalReportEnd > finalReportStart
    ? skill.slice(finalReportStart, finalReportEnd)
    : '';
const orderedDecisionReportFields = [
  '- 기존 결정·이전 대응 회귀 점검: <PASS | CHANGED(승인됨) | GAP>',
  '  - 보존한 결정/대응:',
  '  - 되살리거나 원복한 항목:',
  '  - 의도적 결정 변경:',
  '  - 확인 범위:',
  '| 리뷰 | Actor route | 기존 결정 관계 | 대응 필요성 | 평가 |',
  '`기존 결정·이전 대응 회귀 점검` 판정 규칙:',
  '- `PASS`:',
  '- `CHANGED(승인됨)`:',
  '- `GAP`:',
];
const decisionReportPositions = orderedDecisionReportFields.map((field) => finalReport.indexOf(field));
if (
  !finalReport ||
  decisionReportPositions.some((position) => position === -1) ||
  decisionReportPositions.some(
    (position, index) => index > 0 && position <= decisionReportPositions[index - 1],
  )
) {
  missing.push(`skill: decision regression report order (${orderedDecisionReportFields.join(' → ')})`);
}
if (/^- 기존 결정 보존:/m.test(finalReport) || /^- 의도적 결정 변경:/m.test(finalReport)) {
  missing.push('skill: obsolete top-level decision report fields must not remain');
}

if (missing.length) {
  console.error('pr-ship reviewer boundary is missing required snippets:');
  for (const snippet of missing) console.error(`- ${snippet}`);
  process.exit(1);
}

const forbiddenSkillSnippets = [
  '기본 모드에서는 push와 thread 답글이 끝나면 승인되지 않은 리뷰어/팀에게 review를 재요청한다.',
  'user reviewer와 team reviewer를 target으로 삼는다.',
  'PR timeline 일반 코멘트 작성: 사용자가 명시적으로 요청한 경우에만',
  'review re-request: `gh api --method POST',
  'review thread 답글 작성: `jq -n',
  '리뷰 요청이 있으면 기존 결정을 우선 덮어쓴다.',
  '자동 리뷰어의 severity가 높으면 사용자 결정을 되돌릴 수 있다.',
];
const forbidden = forbiddenSkillSnippets.filter((snippet) => skill.includes(snippet));
if (forbidden.length) {
  console.error('pr-ship guidance contains forbidden human/generic write guidance or private actor data:');
  for (const snippet of forbidden) console.error(`- ${snippet}`);
  process.exit(1);
}

console.log('pr-ship reviewer boundary check passed');
