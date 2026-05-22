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
