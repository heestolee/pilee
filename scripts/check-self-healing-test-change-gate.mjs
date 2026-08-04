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

if (failures.length > 0) {
  console.error('Self-healing test change gate contract failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Self-healing test change gate contract passed.');
console.log(`- checked ${contracts.length} skill files`);
console.log(`- checked ${contracts.reduce((sum, contract) => sum + contract.includes.length, 0)} required rules`);
