# ember-ship

> 사용자에게 노출되는 진입점은 `/ember-ship` 하나다. 이 파일은 extension command shim이 inline하는 내부 workflow 계약이며, Pi skill discovery 대상이 아니다.

`/ember-ship`은 pilee knowledge 운영에서 반복되던 수동 루틴을 **하나의 maintenance release train**으로 묶는다.

> `/ember check` → stale/review_needed 해소 → generated README/SVG 갱신 → local history/Notion sync → final-check → push/merge

이 workflow는 `pilee-knowledge`를 대체하지 않는다. 여러 번의 `pilee-knowledge` batch와 `pilee-final-check`를 조립해 release 가능한 단위로 닫는다.

## 기본 실행 의미

사용자가 `/ember-ship`을 실행하면 merge 의도가 있다고 본다.

- 기본 batch limit: `8`
- 기본 종료 목표: freshness review_needed `0`, README/SVG/generated fresh, 검증 통과, history/Notion sync 완료
- SAFE이면 feature branch를 main에 merge하고 main을 push한다.
- BLOCKED이면 branch를 push하고 PR을 만든 뒤 PR URL과 차단 사유를 보고한다.

옵션:

| 옵션 | 의미 |
|---|---|
| `--limit N` | batch당 stale/review_needed 문서 수. 기본 8 |
| `--no-merge` | SAFE여도 main merge를 하지 않고 PR 링크로 종료 |
| `--dry-run` | worktree/branch 계획과 freshness 상태만 보고하고 파일을 쓰지 않음 |

## SAFE vs BLOCKED

### SAFE 조건

아래가 모두 참일 때만 main merge/push까지 진행한다.

1. 별도 ember-ship worktree에서 작업했다.
2. 각 batch가 8개 이하 stale/review_needed 문서를 실제 검토했다.
3. 각 batch는 문서 수정 또는 confirm-only 근거를 갖고, batch별 commit 1개로 저장됐다.
4. `node scripts/knowledge.mjs --graph --check`가 통과한다.
5. `node scripts/knowledge.mjs --validate`가 통과한다.
6. `node scripts/knowledge.mjs --freshness --json` 결과가 fresh다.
7. README/generated block, `docs/knowledge/README.md`, `README.en.md`, `tmp/knowledge-map.ko.svg`가 CLI 생성 결과와 일치한다.
8. merge/PR 생성 직전 최신 `origin/main`을 다시 fetch하고 branch를 최신 base에 맞춘 뒤 freshness를 다시 확인했다.
9. package version/lockstep이 변경 필요 없거나 일치한다.
10. pilee-history local 기록과 Notion sync가 완료됐다. 로컬 sync 환경이 없으면 SAFE가 아니라 BLOCKED다.
11. `pilee-final-check` 관점에서 요청 의도와 diff가 매핑되고, public/private boundary 문제가 없다.
12. branch가 push 가능하고 main merge 충돌이 없다.
13. 성공 후 기존 `auto/pilee-knowledge-sync` 검토 큐 PR이 남아 있으면 superseded로 닫거나 최신 상태에 맞게 갱신했다.

### BLOCKED 조건

하나라도 발생하면 main merge를 하지 않는다.

- public/private boundary가 애매하다.
- README 철학/브랜딩/public narrative 변경이 필요하다. generated block만 갱신하는 경우는 SAFE 가능하다.
- medium/low confidence 문서 승격에 사용자 판단이 필요하다.
- stale 문서의 현재 유효성을 확인할 근거가 부족하다.
- resolver plan이 private session path/raw text를 공개 산출물에 포함하려 한다.
- validation, freshness, graph, package lockstep, diff check 중 하나라도 실패한다.
- local history/Notion sync를 수행할 수 없다.
- merge conflict, push 실패, GitHub 인증 문제처럼 shared state 변경을 안전하게 끝낼 수 없다.
- `--no-merge`가 지정됐다.

BLOCKED이면:

1. 현재 branch를 push한다.
2. PR을 만든다. PR body에는 차단 사유, 완료된 batch, 검증 결과, 남은 사용자 판단 항목을 적는다.
3. 최종 응답은 PR URL과 수동 merge 기준으로 끝낸다.

## Workflow

### 0. 옵션과 repo 확인

1. 인자를 파싱한다.
   - `--limit` 기본 8, 1보다 작거나 숫자가 아니면 8로 둔다.
   - `--dry-run`, `--no-merge`를 확인한다.
2. 현재 cwd 또는 git root가 pilee repo인지 확인한다.
   ```bash
   git rev-parse --show-toplevel
   git remote get-url origin
   ```
3. 현재 main/package clone의 dirty state를 확인한다.
   ```bash
   git status --short --branch
   ```
   무관 dirty가 있어도 별도 worktree에서만 작업하면 계속할 수 있다. 단 main merge 직전에는 main working tree tracked 변경이 없어야 한다.

### 1. 별도 worktree 생성 또는 재사용

기본은 새 worktree다.

```bash
git fetch origin main
STAMP=$(date +%Y%m%d-%H%M%S)
BRANCH="chore/ember-ship-$STAMP"
WT="$HOME/.pi/worktrees/pilee/ember-ship-$STAMP"
git worktree add -b "$BRANCH" "$WT" origin/main
```

이미 `ember-ship-*` worktree/branch에서 실행 중이고 사용자가 이어서 하려는 맥락이면 재사용 가능하다. 그 외에는 기존 작업 tree를 오염시키지 않는다.

`--dry-run`이면 worktree를 만들지 말고 계획, freshness 요약, 예상 batch 수만 보고한다.

### 2. Freshness 진단

worktree에서 실행한다.

```bash
node scripts/knowledge.mjs --freshness --json --output .context/ember-ship/freshness-before.json
node scripts/knowledge.mjs --freshness
```

분리해서 본다.

- deterministic/generated action: `--graph`로 해결 가능한지
- AI/human review action: 문서 내용을 읽고 수정 또는 confirm해야 하는지
- medium/low confidence: 사용자 판단 없이 high 승격 금지

### 3. Stale 문서 batch 처리

freshness가 fresh가 될 때까지 반복한다. 한 commit은 한 batch다.

1. resolver plan 생성:
   ```bash
   node scripts/knowledge.mjs --resolve-stale --limit 8 --output .context/ember-ship/batch-01
   ```
   `--limit` 인자가 있으면 해당 값을 쓴다.
2. `resolve-plan.md`와 `prompt.md`를 읽는다.
3. 각 문서마다 관련 knowledge 문서와 관련 public 파일/commit diff를 확인한다.
4. 판정:
   - 내용이 틀리거나 부족함 → public/sanitized 문서 수정
   - 현재도 맞음 → 실제 근거 확인 후 `node scripts/knowledge.mjs --confirm <doc-id>`
   - 사용자 판단 필요 → BLOCKED 후보로 기록하고 더 이상 main merge하지 않는다
5. private history/session 원문, local freshness JSON, session path는 public 문서/PR body에 복사하지 않는다.
6. batch 검증:
   ```bash
   node scripts/knowledge.mjs --graph
   node scripts/knowledge.mjs --validate
   node scripts/knowledge.mjs --freshness --json --output .context/ember-ship/freshness-batch-01.json
   git diff --check
   ```
7. batch commit:
   ```bash
   git add docs/knowledge README.md README.en.md tmp/knowledge-map.ko.svg
   git commit -m "docs: ember ship knowledge batch 1"
   ```

Batch commit에는 해당 batch의 문서 수정/confirm/generated 갱신만 넣는다. unrelated 파일을 stage하지 않는다.

### 4. Generated sync 마무리

stale batch가 끝난 뒤 한 번 더 generated surface를 닫는다.

```bash
node scripts/knowledge.mjs --graph
node scripts/knowledge.mjs --graph --check
node scripts/knowledge.mjs --validate
node scripts/knowledge.mjs --freshness --json --output .context/ember-ship/freshness-final.json
```

변경이 남으면 별도 commit으로 둔다.

```bash
git add README.md README.en.md docs/knowledge/README.md tmp/knowledge-map.ko.svg
if ! git diff --cached --quiet; then
  git commit -m "docs: ember ship generated knowledge 갱신"
fi
```

README 철학/브랜딩 문구가 바뀌어야 한다면 generated sync로 처리하지 말고 BLOCKED로 전환한다.

### 5. pilee-history / Notion sync

작업 요약을 local pilee-history에 남기고 Notion을 동기화한다.

- `docs/pilee-history.md`가 worktree에 없으면 main package clone 또는 local history 저장 위치를 찾아 기록한다.
- local sync 규칙은 AGENTS.md와 local/private overlay를 따른다.
- public pilee code에 개인 Notion DB ID, private path, raw history를 새로 넣지 않는다.
- sync 명령을 찾지 못하면 SAFE가 아니므로 BLOCKED로 둔다.

일반적으로 기록에는 다음을 포함한다.

- `/ember-ship` 실행 시각과 branch/worktree
- 처리한 batch 수와 문서 수
- 수정/confirm-only/사용자 판단 필요 항목
- generated sync 결과
- validation 요약
- merge/push 또는 BLOCKED PR URL

### 6. Final check

`pilee-final-check` 절차를 적용한다.

필수 검증:

```bash
node --check scripts/knowledge.mjs
node --experimental-strip-types --check extensions/ember-ship/index.ts # 이 파일이 변경된 경우
node scripts/knowledge.mjs --graph --check
node scripts/knowledge.mjs --validate
node scripts/knowledge.mjs --freshness --json
node -e "const p=require('./package.json'); const l=require('./package-lock.json'); if (p.version!==l.version || p.version!==l.packages[''].version) process.exit(1)"
git diff --check
```

변경된 skill이 있으면 frontmatter도 확인한다.

- directory name = `name`
- description 1024자 이하
- 위험한 자동 merge 조건이 SAFE/BLOCKED gate 없이 쓰이지 않았는지

### 7. 최신 base 재확인

`/ember-ship`은 stale을 닫는 작업이므로 outdated base에서 confirm-only PR을 만들면 안 된다. push/merge 또는 BLOCKED PR 생성 직전에 최신 main을 다시 확인한다.

```bash
git fetch origin main
```

- `origin/main`이 ember-ship branch의 base 이후로 전진했다면 branch에 merge/rebase하고 Step 2~6 freshness/final-check를 다시 수행한다.
- 최신 base에 새 코드/문서 커밋이 있어 다시 review_needed가 생기면 추가 batch를 만든다.
- 최신 base를 반영할 수 없으면 BLOCKED로 멈추고, PR body에 “base advanced; rerun required”를 적는다.

### 8. 자동 검토 큐 PR 정리

`/ember-ship`이 freshness를 fresh로 닫았다면 기존 GitHub Actions 검토 큐 PR은 더 이상 source of truth가 아니다.

```bash
if gh pr view auto/pilee-knowledge-sync --json number >/tmp/knowledge-pr.json 2>/dev/null; then
  gh pr close <number> --delete-branch --comment "Superseded by /ember-ship freshness update."
fi
```

닫지 못하면 SAFE가 아니라 BLOCKED다. 열린 auto queue PR이 남아 있으면 사용자는 같은 stale 목록을 다시 보게 된다.

### 9. Push / merge

#### SAFE + merge 허용

```bash
git push -u origin "$BRANCH"
MAIN_ROOT=<canonical pilee package clone or main worktree>
git -C "$MAIN_ROOT" fetch origin main
git -C "$MAIN_ROOT" status --short --branch
# tracked dirty가 없을 때만
git -C "$MAIN_ROOT" merge --no-ff "$BRANCH" -m "chore: ember ship knowledge 정합성 갱신"
git -C "$MAIN_ROOT" push origin main
```

필요하고 안전하면 이후 `pi update`를 실행한다. `pi update` 실패는 main push를 되돌리지 말고 적용 gap으로 보고한다.

#### BLOCKED 또는 `--no-merge`

```bash
git push -u origin "$BRANCH"
gh pr create --base main --head "$BRANCH" --title "docs: ember ship knowledge 정합성 갱신" --body-file .context/ember-ship/pr-body.md
```

최종 응답에는 PR URL, 차단 사유, 사용자가 수동 merge 전에 확인할 항목을 적는다.

## Final response

SAFE로 끝난 경우:

```markdown
## Ember Ship 완료
- batch: N개 / 문서 M개
- generated sync: README, README.en, docs/knowledge README, SVG fresh
- Notion sync: 완료
- 검증: graph/validate/freshness/package/diff 통과
- merge/push: main <commit>
```

BLOCKED로 끝난 경우:

```markdown
## Ember Ship BLOCKED
- PR: <url>
- 차단 사유: ...
- 완료된 작업: ...
- 수동 merge 전 확인: ...
```

## Red flags

- 별도 worktree 없이 main package clone에서 stale batch를 직접 수정한다.
- 8개 초과 문서를 한 commit에 몰아넣는다.
- private session path나 raw history를 PR body/public docs에 붙인다.
- freshness가 stale인데 “generated만 갱신하면 됨”으로 오판한다.
- outdated base에서 confirm-only PR을 만든 뒤 최신 main 재확인을 하지 않는다.
- `/ember-ship`이 freshness를 닫았는데 기존 `auto/pilee-knowledge-sync` PR을 열어 둔다.
- Notion sync 실패를 무시하고 SAFE merge한다.
- `--no-merge`인데 main을 merge/push한다.
- BLOCKED인데 PR URL 없이 끝낸다.
