#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const targetFiles = [
  'AGENTS.md',
  'skills/ask-user-question-rules/SKILL.md',
  'skills/frame/SKILL.md',
  'skills/frame-v2/SKILL.md',
  'extensions/frame-v2/index.ts',
  'extensions/tft-commands/frame-worktree-fork.ts',
  'skills/frame/references/source-grounded-planning.md',
  'skills/decide/SKILL.md',
  'skills/verify/SKILL.md',
  'skills/tft-guidelines/SKILL.md',
  'skills/pilee-final-check/SKILL.md',
  'docs/knowledge/ask-user-question-option-design.md',
  'docs/knowledge/decide-tradeoff-challenge.md',
  'docs/knowledge/atomic-evidence-workflow.md',
  'docs/knowledge/frame-verify-contract.md',
  'docs/knowledge/source-grounded-frame-planning.md',
  'docs/knowledge/tft-preference-regression-gate.md',
  'docs/knowledge/tft-visual-structure-renderer.md',
];

const negativeContextPattern = /금지|실패|나쁜|❌|돌아오면|막는다|제거|되돌아가면|의례화|통과용|directive|계열|아니다/;

const forbiddenDirectives = [
  {
    id: 'forced-implementation-decision-surface',
    files: ['skills/frame/SKILL.md', 'skills/frame-v2/SKILL.md', 'skills/decide/SKILL.md', 'skills/tft-guidelines/SKILL.md', 'skills/ask-user-question-rules/SKILL.md', 'extensions/frame-v2/index.ts', 'extensions/tft-commands/frame-worktree-fork.ts'],
    pattern: /^Pi UI와 `frame_studio`가 있으면 같은 work unit의 `tab=decide`를 사용한다|route material unresolved technical choices to \/decide|investigate missing facts or use \/decide|질문 본문을 채팅에 번호형 메뉴로 출력하는 것은.*때만 허용|구현 중.{0,30}(반드시|무조건).{0,30}(\/decide|웹뷰|Studio)/,
    allow: (line) => negativeContextPattern.test(line),
    message: '구현 중 추가 결정은 현재 대화가 기본입니다. 명시 /decide·웹뷰 요청만 별도 surface를 사용하세요.',
  },
  {
    id: 'mandatory-challenge',
    pattern: /Productive Resistance는 (항상 한다|독립 단계)|모든 결정에서 challenge를 수행|모든 결정에 tradeoff challenge를 수행|low.*(skip하지|짧게.*도전)|반드시 challenge|challenge skip은 없다|Deep Interview\/\(명백\)\/Productive Resistance/,
    allow: (line) => negativeContextPattern.test(line),
    message: '의무 반론 대신 선택 전 비용 비교와 새 근거가 생긴 경우의 재검토를 사용하세요.',
  },
  {
    id: 'verification-axis-ceremony',
    pattern: /질문( 제목)?:.*검증\s*축\s*선택|무엇을 가장 엄격히 볼까요|가장 엄격히 검증할 축|### Step \d+: AskUserQuestion — 검증\/리스크 초점 선택/,
    allow: (line) => negativeContextPattern.test(line),
    message: '필수 검증은 요구사항과 변경 위험에서 도출하며 검증축 선택 메뉴로 만들지 않습니다.',
  },
  {
    id: 'repeat-approval-ceremony',
    pattern: /없으면 `ok`|저장 확인만 짧게 받는다|명백해 보여도 (질문하고|묻고|묻는다)|가정 4~6개|렌즈 3~4개/,
    allow: (line) => negativeContextPattern.test(line),
    message: '고정 질문 횟수·ok·저장 재승인 대신 중요한 미해결 판단만 묻습니다.',
  },
  {
    id: 'one-line-question-rule',
    pattern: /(한\s*줄|한줄)\s*질문|질문이\s*한\s*줄|질문은\s*한\s*줄/,
    allow: (line) => negativeContextPattern.test(line),
    message: '질문 규칙이 “한 줄 질문”으로 되돌아가면 안 됩니다. “짧은 질문 제목 + 판단 맥락 카드”를 사용하세요.',
  },
  {
    id: 'one-line-objection-rule',
    pattern: /(한\s*줄|한줄)\s*반론/,
    allow: (line) => negativeContextPattern.test(line),
    message: '도전 질문은 “한 줄 반론”이 아니라 짧은 반론 카드 + 판단 맥락으로 작성해야 합니다.',
  },
  {
    id: 'ritual-sufficient-option',
    pattern: /충분하다\s*[—-]\s*(다음\s*단계|진행)/,
    allow: (line) => negativeContextPattern.test(line),
    message: '“충분하다 — 다음 단계로 진행” 같은 통과용 옵션은 의례화 신호입니다.',
  },
  {
    id: 'single-title-only-question',
    pattern: /질문\s*제목만\s*(으로|단독으로)\s*(묻|던지|출력)/,
    allow: (line) => negativeContextPattern.test(line),
    message: '질문 제목만 단독으로 묻는 흐름은 금지입니다. 판단 맥락 카드가 함께 있어야 합니다.',
  },
];

const requiredContracts = [
  {
    file: 'AGENTS.md',
    includes: ['AskUserQuestion 규칙', '짧은 질문 제목 + 충분한 판단 맥락 카드'],
  },
  {
    file: 'skills/ask-user-question-rules/SKILL.md',
    includes: ['짧은 질문 제목 + 판단 맥락 카드', '현재 이해', '막힌 결정', '왜 중요한가', '선택 후 달라지는 것'],
  },
  {
    file: 'skills/frame/SKILL.md',
    includes: [
      '판단 맥락 카드',
      '현재 이해',
      '막힌 결정',
      '왜 중요한가',
      '선택 후 달라지는 것',
      'Requirement Matrix',
      'Domain Work Map',
      'Backend Layer Map',
      'architecture_flow_map',
      'kind: "backend-layer-map"',
      'kind: "architecture-flow"',
      'source-grounded full frame에서는 필수 surface',
      '부트캠프 수강생도 알 수 있는 설명',
    ],
  },
  {
    file: 'skills/frame/references/source-grounded-planning.md',
    includes: ['Requirement Matrix', 'Domain Work Map', 'Backend Layer Map', 'Architecture/Data Flow Map', '기획 근거 원문', '`gap`', '`상태` 컬럼은 필수', 'requirement ID prefix', 'source-grounded full frame의 필수 surface'],
  },
  {
    file: 'skills/decide/SKILL.md',
    includes: ['질문 제목: 접근 선택', '선택 후 달라지는 것', '요구사항 추적성', 'Domain Work Map 영향', 'Architecture/Data Flow 영향', 'verifyHandoffHints', 'challenge?:', '설계 선택 승인은 운영 실행 승인이 아니다', '이미 비교하고 선택한 tradeoff는 기록만', '구현 중 추가 결정은 현재 대화가 기본 surface', '명시 `/decide`', '질문 전에 최신 canonical', 'stable ID', '명시 답변을 기다린다', '침묵·취소·모호한 답은 승인이 아니다', 'pending과 같은 ID', '다른 미결정과 다른 task blocker는 보존', 'work_context refresh', 'verify_plan', 'frame.json.tmp', 'provenance.canonicalHash', 'Frame 없는 즉석 결정', '채팅 결정의 state 저장만으로', '저장 확인이나 이미 공개한 비용의 재승인은 필요하지 않다'],
  },
  {
    file: 'skills/frame-v2/SKILL.md',
    includes: ['미확인 사실 / 미해결 선택 / 영향받는 slice / 다음 행동', '현재 대화에서 결정', '명시 `/decide`', '독립 slice 구현', '새 worktree·외부 실행 승인', '질문 0개도 정상'],
  },
  {
    file: 'extensions/frame-v2/index.ts',
    includes: ['compare material unresolved technical choices in the current conversation', 'A ready slice must not depend on an unresolved choice', 'preserve external-action authorization', 'Zero questions is valid', 'Before asking, persist a stable ID', 'Wait for an explicit answer', 'Preserve other decisions and task blockers', 'Studio update/finish/open merely to save an inline decision', 'explicit /decide or requested webview comparison'],
  },
  {
    file: 'extensions/tft-commands/frame-worktree-fork.ts',
    includes: ['현재 대화에서 처리', '질문 전에 decision_queue에 stable ID', '명시 답변을 기다린다', '같은 ID로 decisions[]', '다른 미결정과 다른 task blocker는 보존', 'work_context refresh', '명시 /decide·웹뷰 비교 요청 경로는 유지'],
  },
  {
    file: 'skills/verify/SKILL.md',
    includes: ['source-grounded requirement coverage 검증', 'Domain Work Map coverage', 'Architecture/Data Flow 검증', 'verifyReportHandoff', 'reuse/revise/add/drop/blocked'],
  },
  {
    file: 'skills/tft-guidelines/SKILL.md',
    includes: ['짧은 질문 제목과 충분한 판단 맥락 카드', '질문 승격 판단의 단일 원천', '공개 계약·보안 보장·운영 비용·되돌리기 비용·유지보수 비용', '미확인 사실을 사용자 선택으로 바꾸지 않는다', '설계 선택 승인은 운영 실행 승인과 다르며', '필수 검증은 AI가 요구사항·성공 기준·실제 변경 위험에서 도출'],
  },
  {
    file: 'skills/pilee-final-check/SKILL.md',
    includes: ['TFT Preference Regression Gate', 'npm run tft:regression-audit'],
  },
  {
    file: 'docs/knowledge/source-grounded-frame-planning.md',
    includes: ['Requirement Matrix', 'Domain Work Map', 'Backend Layer Map', 'Architecture/Data Flow Map', 'source-grounded frame', 'gap', '상태 없는 Requirement Matrix', 'requirement ID', 'kind: "backend-layer-map"', 'kind: "architecture-flow"', 'source-grounded full frame의 필수 surface'],
  },
  {
    file: 'docs/knowledge/tft-preference-regression-gate.md',
    includes: ['TFT Preference Regression Gate', 'preference inversion', 'regression gate'],
  },
  {
    file: 'docs/knowledge/tft-visual-structure-renderer.md',
    includes: ['kind: "backend-layer-map"', 'kind: "architecture-flow"', 'SVG rail + 카드형', '부트캠프 수강생', '요청 접수창', '업무 총괄자', 'PK', 'FK', 'source-of-truth'],
  },
];

export function auditTftContracts(root = process.cwd(), overrides = {}) {
  function readRelative(file) {
    return Object.hasOwn(overrides, file) ? overrides[file] : fs.readFileSync(path.join(root, file), 'utf8');
  }

  function existsRelative(file) {
    return Object.hasOwn(overrides, file) || fs.existsSync(path.join(root, file));
  }

const failures = [];

for (const file of targetFiles) {
  if (!existsRelative(file)) {
    failures.push({ file, line: 0, id: 'missing-target', message: 'TFT preference audit 대상 파일이 없습니다.' });
    continue;
  }

  const text = readRelative(file);
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of forbiddenDirectives) {
      if (rule.files && !rule.files.includes(file)) continue;
      if (rule.pattern.test(line) && !rule.allow?.(line)) {
        failures.push({ file, line: index + 1, id: rule.id, message: rule.message, excerpt: line.trim() });
      }
    }
  }
}

for (const contract of requiredContracts) {
  if (!existsRelative(contract.file)) {
    failures.push({ file: contract.file, line: 0, id: 'missing-contract-file', message: '필수 contract 파일이 없습니다.' });
    continue;
  }

  const text = readRelative(contract.file);
  for (const phrase of contract.includes) {
    if (!text.includes(phrase)) {
      failures.push({
        file: contract.file,
        line: 0,
        id: 'missing-contract-phrase',
        message: `필수 판단 계약 문구가 없습니다: ${phrase}`,
      });
    }
  }
}

return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
const failures = auditTftContracts();
if (failures.length > 0) {
  console.error('❌ TFT Preference Regression Gate failed');
  for (const failure of failures) {
    const location = failure.line ? `${failure.file}:${failure.line}` : failure.file;
    console.error(`- [${failure.id}] ${location} — ${failure.message}`);
    if (failure.excerpt) console.error(`  > ${failure.excerpt}`);
  }
  process.exit(1);
}

console.log('✅ TFT Preference Regression Gate passed');
console.log(`- scanned files: ${targetFiles.length}`);
console.log(`- forbidden directive checks: ${forbiddenDirectives.length}`);
console.log(`- required contract checks: ${requiredContracts.length}`);
}
