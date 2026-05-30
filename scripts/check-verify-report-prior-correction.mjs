#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const checks = [
  {
    file: 'skills/verify-report/SKILL.md',
    patterns: [
      'Frame은 requirement source, report는 evidence adjudicator',
      'reuse',
      'revise',
      'drop',
      'blocked',
      '과거 교정은 intent로 재해석',
      '핵심 사용자 행동(primary action)',
      '교정 literal과 intent를 분리',
      'equivalent path',
      'primary action happy path',
    ],
  },
  {
    file: 'skills/verify-report-preflight/SKILL.md',
    patterns: [
      'Frame은 requirement source, preflight는 handoff adjudicator',
      'Frame/TFT plan이 있으면 먼저 handoff 판정을 만든다',
      'reuse',
      'revise',
      'add',
      'drop',
      'Primary action 먼저',
      'Correction literal',
      'Correction intent',
      'Feasibility',
      'Equivalent path',
      '생성 기능이면 생성 happy path',
    ],
  },
  {
    file: 'skills/verify-report/references/coverage-and-capture-quality.md',
    patterns: [
      'Frame handoff adjudication rule',
      'Frame은 requirement source이고 verify-report는 evidence adjudicator다',
      'reuse',
      'revise',
      'drop',
      'Prior correction intent rule',
      'Primary feature verb',
      'Correction literal',
      'Correction intent',
      '과거 교정 literal이 비현실적인데 primary action과 correction intent를 재해석하지 않고 blocked/pass로 처리했다',
    ],
  },
  {
    file: 'docs/knowledge/verify-report-workflow.md',
    patterns: [
      'Frame handoff adjudication',
      'Frame은 requirement source이고 verify-report는 evidence adjudicator입니다',
      'reuse',
      'revise',
      'drop',
      'primary feature verb',
      '과거 사용자 교정이나 실패 회고는 literal 요구가 아니라 intent 보존 제약',
      'equivalent core feature path',
    ],
  },
  {
    file: 'docs/knowledge/verify-report-preflight-readiness.md',
    patterns: [
      'Frame Handoff Adjudication Rule',
      'Frame은 requirement source이고 preflight는 handoff adjudicator입니다',
      'reuse',
      'revise',
      'drop',
      'Prior Correction Intent Rule',
      'Primary action',
      'Correction literal',
      'Equivalent path',
      'blocked는 literal 실행이 불가능하다는 이유만으로 쓰지 않습니다',
    ],
  },
];

const failures = [];
for (const check of checks) {
  const absolutePath = resolve(root, check.file);
  const text = readFileSync(absolutePath, 'utf8');
  for (const pattern of check.patterns) {
    if (!text.includes(pattern)) {
      failures.push(`${relative(root, absolutePath)}: missing ${JSON.stringify(pattern)}`);
    }
  }
}

if (failures.length > 0) {
  console.error('verify-report prior-correction/frame-handoff contract check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`verify-report prior-correction/frame-handoff contract check passed (${checks.length} files).`);
