import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const contracts = [
  {
    file: 'skills/self-healing/SKILL.md',
    includes: [
      'skills/test-boundary-refactor/SKILL.md',
      'worker가 신규 spec/test 파일을 만들었다.',
      '한 사이클에서 신규 test case를 3개 이상 추가했다.',
      '테스트 추가 줄이 제품 코드 추가 줄보다 많거나',
      'finding 하나당 테스트 하나를 추가하지 않는다.',
      '사용자에게 다이어트를 요청하지 않는다.',
      'noise로 삭제했던 spec 유형',
      '**Cycle 1**: Pi/Codex `stress-interview` 실행 → actionable item만 `worker`가 수정',
      '**Cycle 2**: 다시 Pi/Codex `stress-interview` 실행 → 남은 actionable item만 `worker`가 수정',
      '총 **2 사이클**만 수행한다. 무한 반복하지 않는다.',
      '수정할 actionable item이 더 이상 없음',
      'worker가 범위 초과/불명확성으로 중단함',
      '## 수정 전 기존 결정·이전 대응 회귀 점검',
      '각 cycle에서 `worker`를 실행하기 직전에',
      'cycle 수, 종료 조건, subagent 호출 순서, Test Change Gate는 바꾸지 않는다.',
      '이 점검 때문에 TUI/AskUserQuestion을 열거나 cycle을 중단하지 않는다.',
      '과한 nullable/type ceremony나 fixture assertion을 근거와 함께 제거',
      '기존 리뷰에서 공통 mutex를 근거로 별도 row lock을 추가하지 않기로 대응',
      '수정 전 회귀 점검에서 확인한 기존 결정·이전 대응과 worker 전달에서 제외한 finding',
      '## 기존 결정·이전 대응 회귀 점검',
      '확인한 기존 결정·대응: <대화/commit/기존 리뷰 대응과 locator>',
      '수정 전 제외하거나 범위를 조정한 제안: <없음 | finding과 이유>',
      '보존한 경계: <실제 수정에서 유지한 동작·타입·구조>',
      '판정: <회귀 없음 | 확인 범위 GAP>',
    ],
  },
  {
    file: 'skills/stress-interview/SKILL.md',
    includes: [
      '기존 coverage',
      'finding마다 신규 테스트를 1:1로 제안하지 마',
      '실제 integration GAP',
      'noise로 삭제한 테스트 유형',
    ],
  },
];

const failures = [];

for (const contract of contracts) {
  const content = fs.readFileSync(path.join(root, contract.file), 'utf8');
  for (const requiredText of contract.includes) {
    if (!content.includes(requiredText)) {
      failures.push(`${contract.file}: missing ${JSON.stringify(requiredText)}`);
    }
  }
}

const selfHealing = fs.readFileSync(path.join(root, 'skills/self-healing/SKILL.md'), 'utf8');
const preWorkerDecisionCheck = selfHealing.indexOf('## 수정 전 기존 결정·이전 대응 회귀 점검');
const workerPromptContract = selfHealing.indexOf('## worker 프롬프트 필수 요소');
if (
  preWorkerDecisionCheck === -1 ||
  workerPromptContract === -1 ||
  preWorkerDecisionCheck >= workerPromptContract
) {
  failures.push('skills/self-healing/SKILL.md: pre-worker decision check must precede worker prompt contract');
}

const finalReportStart = selfHealing.indexOf('## 최종 응답 형식');
const finalReportEnd = selfHealing.indexOf('## 주의', finalReportStart);
const finalReport =
  finalReportStart >= 0 && finalReportEnd > finalReportStart
    ? selfHealing.slice(finalReportStart, finalReportEnd)
    : '';
const orderedFinalReportSections = [
  '## Cycle 1',
  '## Cycle 2',
  '## 기존 결정·이전 대응 회귀 점검',
  '## Test Diff',
  '## Remaining Risks',
  '## Recommendation',
];
const finalReportPositions = orderedFinalReportSections.map((heading) => finalReport.indexOf(heading));
if (
  !finalReport ||
  finalReportPositions.some((position) => position === -1) ||
  finalReportPositions.some(
    (position, index) => index > 0 && position <= finalReportPositions[index - 1],
  )
) {
  failures.push(
    `skills/self-healing/SKILL.md: final report section order (${orderedFinalReportSections.join(' → ')})`,
  );
}

if (failures.length > 0) {
  console.error('Self-healing test change gate contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Self-healing test change gate contract passed.');
console.log(`- checked ${contracts.length} skill files`);
console.log(`- checked ${contracts.reduce((sum, contract) => sum + contract.includes.length, 0)} required rules`);
