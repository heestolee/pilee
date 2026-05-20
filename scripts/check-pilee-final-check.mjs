#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skillPath = path.join(root, 'skills', 'pilee-final-check', 'SKILL.md');
const packagePath = path.join(root, 'package.json');

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sectionBetween(text, startHeading, nextHeadingPattern) {
  const start = text.indexOf(startHeading);
  if (start === -1) return '';
  const rest = text.slice(start);
  const next = rest.slice(startHeading.length).search(nextHeadingPattern);
  if (next === -1) return rest;
  return rest.slice(0, startHeading.length + next);
}

const failures = [];
const skill = read(skillPath);
const pkg = JSON.parse(read(packagePath));

function requireIncludes(id, text, phrase, context = phrase) {
  if (!text.includes(phrase)) {
    failures.push({ id, message: `필수 문구가 없습니다: ${context}` });
  }
}

function requireRegex(id, text, pattern, message) {
  if (!pattern.test(text)) failures.push({ id, message });
}

const requiredGlobalPhrases = [
  ['core-principle-test-claim', '테스트 코드도 claim으로 다룬다'],
  ['test-is-decision', '테스트를 안 쓰는 것도 결정이다'],
  ['meaningless-test-ban', '통과용 snapshot, 구현 세부 복제, 명령만 실행하는 smoke'],
  ['test-code-gate-heading', '### 2.7 Test Code Gate'],
  ['final-output-test-decision', '- 테스트 결정: <추가한 테스트 또는 생략 사유>'],
  ['pilee-final-check-script-command', 'npm run test:pilee-final-check'],
];

for (const [id, phrase] of requiredGlobalPhrases) {
  requireIncludes(id, skill, phrase);
}

const gate = sectionBetween(skill, '### 2.7 Test Code Gate', /^###\s+3\./m);
if (!gate) {
  failures.push({ id: 'missing-test-code-gate-section', message: 'Test Code Gate section을 찾을 수 없습니다.' });
} else {
  const requiredGatePhrases = [
    ['gate-default', '테스트 코드가 기본값이다'],
    ['gate-required-column', '테스트 추가/보강 Required'],
    ['gate-extension-row', 'extension/tool/slash command'],
    ['gate-webview-render-row', 'Glimpse/WebView/render UX'],
    ['gate-webview-scroll-reload', 'scroll/reload/focus/shortcut/window reuse'],
    ['gate-webview-test-examples', 'scroll preservation fixture + mock companion no-reload/window reuse assert'],
    ['gate-parser-row', 'parser/serializer/generator'],
    ['gate-bugfix-row', 'bug fix/regression'],
    ['gate-skill-row', 'skill/prompt/contract'],
    ['gate-docs-exception-row', 'docs/knowledge/generated-only'],
    ['gate-no-test-exception', '테스트를 추가하지 않아도 되는 경우는 명시한다'],
    ['gate-meaningless-ban', '의미 없는 테스트는 금지한다'],
    ['gate-claim-inventory', 'Claim inventory에 `테스트 결정`을 붙인다'],
  ];
  for (const [id, phrase] of requiredGatePhrases) requireIncludes(id, gate, phrase);

  const requiredBanPatterns = [
    ['ban-no-assert-smoke', /assert\s+없이\s+명령만\s+실행/u, 'assert 없는 smoke 금지 기준이 필요합니다.'],
    ['ban-snapshot-drift', /snapshot\s+대량\s+갱신/u, '계약과 무관한 snapshot 갱신 금지 기준이 필요합니다.'],
    ['ban-expectation-weakening', /기대값\s+완화/u, '실패 원인과 무관한 기대값 완화 금지 기준이 필요합니다.'],
  ];
  for (const [id, pattern, message] of requiredBanPatterns) requireRegex(id, gate, pattern, message);
}

const smokeSection = sectionBetween(skill, '### 4. 동작 smoke를 만든다', /^####\s+verifier lens 적용/m);
for (const phrase of [
  'tool/command 변경은 mock Pi context로 state transition과 user-facing render text assert',
  'skill/prompt 계약 변경은 deterministic script로 필수 문구와 금지 패턴 assert',
]) {
  requireIncludes(`smoke-${phrase}`, smokeSection, phrase);
}

const skillValidationSection = sectionBetween(skill, 'Skill 변경:', /^###\s+6\./m);
requireIncludes('skill-validation-runs-test', skillValidationSection, '`pilee-final-check` 변경은 반드시 `npm run test:pilee-final-check`를 실행한다.');
requireIncludes('webview-hole-review-scroll-reload', skill, 'scroll/reload/focus preservation');

const tftScrollTestPath = path.join(root, 'extensions', 'frame-studio', 'scroll-preservation.test.ts');
const companionTestPath = path.join(root, 'extensions', 'utils', 'companion-window.test.ts');
const tftScrollTest = fs.existsSync(tftScrollTestPath) ? read(tftScrollTestPath) : '';
const companionTest = fs.existsSync(companionTestPath) ? read(companionTestPath) : '';
for (const [id, phrase] of [
  ['tft-scroll-test-pending-question', 'pending question section'],
  ['tft-scroll-test-non-question-sections', 'non-question sections'],
  ['tft-scroll-test-answer-card', 'answer card'],
  ['tft-scroll-test-work-context-logs', 'work context and logs'],
]) {
  requireIncludes(id, tftScrollTest, phrase, `extensions/frame-studio/scroll-preservation.test.ts must cover ${phrase}`);
}
for (const [id, phrase] of [
  ['companion-no-rewrite-same-html', 'same companion HTML should be shown without rewriting/reloading the WebView'],
  ['companion-no-rewrite-same-url', 'same URL redirect shell should not be rewritten because it reloads the live page and resets scroll'],
]) {
  requireIncludes(id, companionTest, phrase, `extensions/utils/companion-window.test.ts must cover ${phrase}`);
}

if (pkg.scripts?.['test:pilee-final-check'] !== 'node scripts/check-pilee-final-check.mjs') {
  failures.push({
    id: 'missing-package-script',
    message: 'package.json scripts.test:pilee-final-check must be "node scripts/check-pilee-final-check.mjs"',
  });
}

// Guard against accidental weakening of the test gate wording.
const forbiddenPositivePatterns = [
  {
    id: 'test-optional-by-default',
    pattern: /테스트(는|를)?\s*(항상\s*)?(선택|옵션|나중)/u,
    allowIfNearby: /순수 문서|generated|예외|비용이 과도|생략 가능/u,
    message: '테스트를 기본 옵션/나중으로 미루는 표현은 예외 맥락에서만 허용됩니다.',
  },
];

for (const rule of forbiddenPositivePatterns) {
  for (const match of skill.matchAll(new RegExp(rule.pattern, 'gu'))) {
    const start = Math.max(0, match.index - 80);
    const end = Math.min(skill.length, match.index + match[0].length + 80);
    const nearby = skill.slice(start, end);
    if (!rule.allowIfNearby.test(nearby)) {
      failures.push({ id: rule.id, message: rule.message, excerpt: nearby.replace(/\s+/g, ' ').trim() });
    }
  }
}

if (failures.length > 0) {
  console.error('❌ pilee-final-check test gate contract failed');
  for (const failure of failures) {
    console.error(`- [${failure.id}] ${failure.message}`);
    if (failure.excerpt) console.error(`  > ${failure.excerpt}`);
  }
  process.exit(1);
}

console.log('✅ pilee-final-check test gate contract passed');
console.log('- checked: SKILL.md Test Code Gate section');
console.log('- checked: smoke/test validation instructions');
console.log('- checked: WebView scroll/reload regression test coverage');
console.log('- checked: package script test:pilee-final-check');
