#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const skillPath = path.join(repoRoot, 'skills/pr-ship/SKILL.md');
const text = fs.readFileSync(skillPath, 'utf8');

const requiredSnippets = [
  '답글 payload는 파일 경로 literal이 GitHub에 올라가지 않도록 안전하게 전송한다.',
  'gh api ... -f body=@/tmp/reply.md',
  'jq -n --arg body "$body"',
  '--input -',
  '게시/수정 직후 응답의 `.body`를 확인한다.',
  '성공으로 보고하지 말고 즉시 `PATCH repos/<owner>/<repo>/pulls/comments/<reply_id>`',
  '최종 보고의 답글 URL은 body 검증이 끝난 뒤에만 적는다.',
  '반드시 `리뷰 대응 평가`를 함께 포함한다.',
  '그 리뷰가 대응할 만했는가, 대응이 과하지 않았는가',
  '판정: <대응이 필요한 리뷰였는지 + 전체 대응이 과하지 않았는지 한 문장>',
  '| 리뷰 | 대응 필요성 | 평가 |',
  '### 과하지 않았나?',
  '### 아쉬운 점',
  '### 남은 후속 후보',
  '실행 중 실수도 숨기지 않는다.',
];

const missing = requiredSnippets.filter((snippet) => !text.includes(snippet));
if (missing.length) {
  console.error('pr-ship reply guidance is missing required snippets:');
  for (const snippet of missing) {
    console.error(`- ${snippet}`);
  }
  process.exit(1);
}

const forbiddenGuidance = [
  '- 답글 작성: `gh api repos/<owner>/<repo>/pulls/<pr>/comments/<comment_id>/replies --method POST -f body=...`',
];

const presentForbidden = forbiddenGuidance.filter((snippet) => text.includes(snippet));
if (presentForbidden.length) {
  console.error('pr-ship reply guidance still contains unsafe GitHub API guidance:');
  for (const snippet of presentForbidden) {
    console.error(`- ${snippet}`);
  }
  process.exit(1);
}

console.log('pr-ship reply guidance check passed');
