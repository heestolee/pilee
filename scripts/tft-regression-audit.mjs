#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const targetFiles = [
  'AGENTS.md',
  'skills/ask-user-question-rules/SKILL.md',
  'skills/frame/SKILL.md',
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
];

const negativeContextPattern = /금지|실패|나쁜|❌|돌아오면|막는다|제거|되돌아가면|의례화|통과용|directive|계열|아니다/;

const forbiddenDirectives = [
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
    ],
  },
  {
    file: 'skills/frame/references/source-grounded-planning.md',
    includes: ['Requirement Matrix', 'Domain Work Map', 'Backend Layer Map', '기획 근거 원문', '`gap`', '`상태` 컬럼은 필수', 'requirement ID prefix'],
  },
  {
    file: 'skills/decide/SKILL.md',
    includes: ['짧은 반론 카드', '질문 제목: 접근 선택', '선택 후 달라지는 것'],
  },
  {
    file: 'skills/tft-guidelines/SKILL.md',
    includes: ['짧은 질문 제목과 충분한 판단 맥락 카드'],
  },
  {
    file: 'skills/pilee-final-check/SKILL.md',
    includes: ['TFT Preference Regression Gate', 'npm run tft:regression-audit'],
  },
  {
    file: 'docs/knowledge/source-grounded-frame-planning.md',
    includes: ['Requirement Matrix', 'Domain Work Map', 'Backend Layer Map', 'source-grounded frame', 'gap', '상태 없는 Requirement Matrix', 'requirement ID'],
  },
  {
    file: 'docs/knowledge/tft-preference-regression-gate.md',
    includes: ['TFT Preference Regression Gate', 'preference inversion', 'regression gate'],
  },
];

function readRelative(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function existsRelative(file) {
  return fs.existsSync(path.join(root, file));
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
