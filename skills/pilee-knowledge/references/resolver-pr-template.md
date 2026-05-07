# Knowledge Resolver PR Template

로컬 knowledge resolver가 만든 stale/review_needed 해소 PR은 사용자가 GitHub에서 바로 판단할 수 있게 **무엇을 검토했고, 무엇을 바꿨고, 무엇은 confirm-only였는지**를 분리해 적는다.

## 기본 구조

```markdown
## 개요
로컬 knowledge resolver로 <N>차 stale/review_needed 배치를 실제 검토해 해소합니다.

<이번 PR의 의미를 1-2문장으로 설명합니다. 예: public/private split 이후 핵심 boundary doctrine을 갱신합니다.>

## 대상 문서
- [x] doc-id-1
- [x] doc-id-2

## 해소 결과

### 내용 수정
- `doc-id-1`: 어떤 판단/원칙을 추가·수정했는지 한 줄로 설명

### confirm-only
- `doc-id-2`: 관련 변경을 검토했으나 기존 판단이 여전히 유효함을 확인

### 사용자 판단 필요/보류
- 없음
```

## Privacy 섹션

모든 resolver PR에 포함한다.

```markdown
## Privacy
- `.context/knowledge-resolver/...` 산출물은 PR에 포함하지 않았습니다.
- `freshness.local.json`, session hint, private history 원문/제목은 PR body와 public docs에 복사하지 않았습니다.
- PR에는 sanitized 판단과 문서 수정 결과만 포함했습니다.
```

## 검증 섹션

```markdown
## 검증
- [x] `npm run knowledge:validate`
- [x] `npm run knowledge:graph -- --check`
- [x] `node scripts/knowledge.mjs --freshness --json`
- [x] `git diff --check`
```

필요하면 추가한다.

```markdown
- [x] `npm run knowledge:resolver-log -- --limit 5`
- [x] SVG XML parse check
```

## Freshness 섹션

선택된 batch 결과와 전체 결과를 구분한다.

```markdown
## Freshness
이 PR은 선택된 <N>개 문서를 fresh로 전환합니다.

전체 freshness는 아직 남은 batch가 있으면 stale일 수 있습니다.
```

마지막 batch라면 최종 상태를 적는다.

```markdown
## Freshness
PR merge 후 `origin/main` 기준:

```text
status=fresh
active_docs=59
doctrine_stale=0
missing_coverage=0
broken_links=0
ai_review_candidates=0
coverage=61/61
```
```

## Merge policy 섹션

```markdown
## Merge policy
stale resolver PR입니다. 사용자가 명시적으로 auto-merge/merge를 허용한 경우에만 병합합니다.
```

README/SVG/public narrative PR은 별도 정책을 적는다.

```markdown
## Merge policy
README visual/narrative artifact 변경이므로 사용자 review 후 merge합니다. 자동 merge하지 않습니다.
```

## 작성 규칙

- `내용 수정`에는 실제 doctrine 문장 변화나 판단 변화를 적는다.
- `confirm-only`에는 왜 수정 없이 유효한지 문서별로 적는다.
- `사용자 판단 필요/보류`가 없으면 `없음`이라고 적는다.
- PR body에는 private session path, private history 제목/원문, local-only freshness JSON 내용을 붙이지 않는다.
- README/SVG처럼 사용자가 보는 narrative/visual artifact는 resolver batch와 분리된 PR로 만들고 open 상태로 보고한다.
