import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { auditTftContracts } from './tft-regression-audit.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

// 실제 스킬/프롬프트에 옛 directive를 재삽입해 재발 차단을 확인한다.
for (const [file, directive, rule] of [
  ['skills/decide/SKILL.md', '모든 결정에서 challenge를 수행한다.', 'mandatory-challenge'],
  ['skills/frame/SKILL.md', 'Productive Resistance는 독립 단계다.', 'mandatory-challenge'],
  ['extensions/frame-v2/index.ts', 'Guided mode: Deep Interview/(명백)/Productive Resistance', 'mandatory-challenge'],
  ['skills/frame/SKILL.md', '질문: frame draft에서 무엇을 가장 엄격히 볼까요? (최대 2개)', 'verification-axis-ceremony'],
  ['skills/ask-user-question-rules/SKILL.md', '질문 제목: 검증 축 선택', 'verification-axis-ceremony'],
  ['skills/frame/SKILL.md', '틀린 가정이 있으면 정정해주세요. 없으면 `ok`.', 'repeat-approval-ceremony'],
  ['skills/frame/SKILL.md', 'patch 후 저장 확인만 짧게 받는다.', 'repeat-approval-ceremony'],
  ['skills/decide/SKILL.md', 'Pi UI와 `frame_studio`가 있으면 같은 work unit의 `tab=decide`를 사용한다.', 'forced-implementation-decision-surface'],
  ['extensions/frame-v2/index.ts', 'route material unresolved technical choices to /decide', 'forced-implementation-decision-surface'],
  ['extensions/tft-commands/frame-worktree-fork.ts', '구현 중 중요한 결정은 반드시 /decide로 보낸다.', 'forced-implementation-decision-surface'],
  ['skills/frame/SKILL.md', '질문 본문을 채팅에 번호형 메뉴로 출력하는 것은 UI가 unavailable일 때만 허용한다.', 'forced-implementation-decision-surface'],
]) {
  test(`옛 의례 재삽입 차단: ${directive}`, () => {
    const failures = auditTftContracts(root, { [file]: `${read(file)}\n${directive}\n` });
    assert.ok(failures.some((failure) => failure.file === file && failure.id === rule));
  });
}

for (const [file, contract] of [
  ['skills/tft-guidelines/SKILL.md', '미확인 사실을 사용자 선택으로 바꾸지 않는다'],
  ['skills/tft-guidelines/SKILL.md', '공개 계약·보안 보장·운영 비용·되돌리기 비용·유지보수 비용'],
  ['skills/tft-guidelines/SKILL.md', '설계 선택 승인은 운영 실행 승인과 다르며'],
  ['skills/frame-v2/SKILL.md', '현재 대화에서 결정'],
  ['skills/decide/SKILL.md', '질문 전에 최신 canonical'],
  ['skills/decide/SKILL.md', '명시 답변을 기다린다'],
  ['skills/decide/SKILL.md', '침묵·취소·모호한 답은 승인이 아니다'],
  ['skills/decide/SKILL.md', 'pending과 같은 ID'],
  ['skills/decide/SKILL.md', '다른 미결정과 다른 task blocker는 보존'],
  ['skills/decide/SKILL.md', '채팅 결정의 state 저장만으로'],
  ['skills/decide/SKILL.md', 'Frame 없는 즉석 결정'],
  ['skills/decide/SKILL.md', '명시 `/decide`'],
  ['extensions/frame-v2/index.ts', 'A ready slice must not depend on an unresolved choice'],
]) {
  test(`질문 축소 중 중요한 판단·안전 계약 삭제 감지: ${contract}`, () => {
    const failures = auditTftContracts(root, { [file]: read(file).replaceAll(contract, '') });
    assert.ok(failures.some((failure) => failure.file === file && failure.id === 'missing-contract-phrase' && failure.message.includes(contract)));
  });
}

test('현재 계약과 명시적 grill·legacy 기록은 의례로 오인하지 않는다', () => {
  const file = 'skills/decide/SKILL.md';
  const allowed = '\n의무 반론은 금지한다.\n사용자가 명시적으로 반론 검토를 요청하면 수행한다.\n기존 challenged: true 기록은 보존한다.\n';
  assert.deepEqual(auditTftContracts(root, { [file]: read(file) + allowed }), []);
});
