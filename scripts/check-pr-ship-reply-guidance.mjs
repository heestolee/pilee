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
  'HiCreatrip',
];
const forbidden = forbiddenSkillSnippets.filter((snippet) => skill.includes(snippet));
if (forbidden.length) {
  console.error('pr-ship guidance contains forbidden human/generic write guidance or private actor data:');
  for (const snippet of forbidden) console.error(`- ${snippet}`);
  process.exit(1);
}

console.log('pr-ship reviewer boundary check passed');
