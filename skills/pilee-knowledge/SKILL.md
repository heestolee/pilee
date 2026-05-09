---
name: pilee-knowledge
description: pilee-history/private journal에서 공개 가능한 설계 지식을 추출하거나 docs/knowledge 문서를 검색·작성·갱신·검증할 때 사용한다. 사용자가 "pilee knowledge", "히스토리를 지식으로", "지식 정합성", "stale 해소", "README 그래프", "reviewed_at 갱신", "add-knowledge처럼"이라고 말하면 사용한다.
argument-hint: "검색어 또는 정리할 주제"
disable-model-invocation: false
---

# pilee-knowledge

pilee의 private journal과 public knowledge를 분리해, 개인적 서사는 로컬에 두고 현재 유효한 설계 지식만 `docs/knowledge/`에 남긴다.

## 핵심 원칙

1. **일기와 지식 분리**
   - `docs/pilee-history.md` / Notion why log: private/local 원본 서사.
   - `docs/knowledge/*.md`: public/sanitized 설계 지식.
2. **원문 복붙 금지**
   - 회사명, 내부 업무 맥락, 개인적 감정, 민감 경로, 티켓/고객/파트너 정보는 그대로 옮기지 않는다.
   - 공개 가능한 기능 목적, 판단 기준, 현재 구조, 대체된 결정으로 재작성한다.
3. **문서 단위는 판단 단위**
   - 기능 하나가 아니라, 그 기능을 만들게 한 재사용 가능한 판단 하나를 문서 단위로 삼는다.
4. **새 문서보다 기존 문서 갱신 우선**
   - 먼저 CLI 검색으로 같은 주제가 있는지 확인한다.
5. **README 그래프는 생성물**
   - 문서/링크/frontmatter 변경 후 `node scripts/knowledge.mjs --graph`로 갱신한다.
6. **검토 기준은 의미 있게 갱신**
   - 내용을 실제로 읽고 현재 유효성을 확인한 뒤에만 `--confirm <doc-id>`를 실행해 `reviewed_at`과 `reviewed_commit`을 함께 갱신한다.
7. **README 철학은 사용자 판단 영역**
   - generated coverage block은 CLI로 갱신하지만, README의 철학·포지셔닝·public narrative를 바꾸려면 사용자에게 묻거나 명시 지시가 있어야 한다.
8. **초기 운영은 confidence를 예민하게**
   - 근거가 약하거나 취향/철학 확인이 필요한 문서는 `confidence: medium|low`를 붙여 정합성 PR review queue에 남긴다.

## Workflow

### 0. 사전 상태 점검

파일을 쓰기 전에 `git status --short --branch`를 확인한다. 충돌, 무관 WIP, generated file drift가 있어 현재 작업과 안전하게 분리할 수 없으면 중단하고 보고한다. pilee 개선은 단일 working tree를 기본으로 쓰지만, 관련 path만 stage/commit하고 무관 변경을 섞지 않는다.

### 1. 주제 정규화 + 기존 지식 검색

먼저 다음을 한 줄씩 정리한다.

- 핵심 judgment 1문장
- 검색어 3~6개
- 예상 `applies_to` surface

그 다음 반드시 검색한다.

```bash
node scripts/knowledge.mjs "<검색어>"
```

확인할 것:
- 이미 같은 질문에 답하는 문서가 있는가?
- 기존 문서의 `related` 링크로 연결하는 편이 자연스러운가?
- private journal에서 승격할 내용이 공개 가능한가?

### 2. 근거 수집

필요한 범위만 읽는다.

- public 쪽: `docs/knowledge/README.md`, 관련 `docs/knowledge/*.md`, 관련 skill/extension 파일
- private 쪽: `docs/pilee-history.md`, `docs/pilee-history.sync.local.md`는 로컬 근거로만 사용하고 원문을 공개 문서에 복사하지 않는다.
- freshness report: `node scripts/knowledge.mjs --freshness`
- 자동 후보: `node scripts/knowledge.mjs --review-candidates`
- 후보 수집/선택 진입점: `/ember <topic>`
- 신규/갱신 작성 진입점: `/ember add <topic>`
- 상태 점검 진입점: `/ember check` — freshness/confidence를 보고 필요 action(refresh/resolve)을 제안
- generated surface 갱신 진입점: `/ember refresh` — `node scripts/knowledge.mjs --graph` 기반 README table/docs knowledge README/SVG map 재생성·검증
- stale 해소용 로컬 plan: `node scripts/knowledge.mjs --resolve-stale` 또는 advanced direct `/ember resolve`

### 3. 작성/수정 결정

- 기존 문서가 현재 질문에 답하면 기존 문서를 수정한다.
- 새 기능/원칙이 독립적으로 검색될 주제면 새 문서를 만든다.
- `/ember add`는 product식 `/add-knowledge`처럼 git 상태 점검 → 기존 문서 검색 → 판단/범위 정렬 → 작성 계획 → 작성 → graph/validate/freshness 검증 순서를 따른다. 단 pilee 문서 단위는 코드 scope가 아니라 public/sanitized reusable judgment다.
- 의미 있는 분기(신규 vs 기존 갱신, 문서 분할, confidence)가 있으면 파일 쓰기 전에 번호형 작성 계획을 사용자에게 확인한다.
- 직전 `/ember` 후보를 사용자가 명시적으로 추가하라고 했고 전략이 하나로 명백하면 `(명백: /ember에서 확인된 단일 후보)`처럼 근거를 보고하고 진행할 수 있다.
- 문서가 분리되면 `related`와 본문 inline link로 그래프를 연결한다.

### 4. 문서 작성 형식

각 topic 문서는 아래 frontmatter를 가진다. 확신이 낮은 문서는 `confidence: medium` 또는 `confidence: low`를 추가한다. 기본값은 `high`로 간주한다.

```yaml
---
title: 문서 제목
tags: [검색어, keyword]
category: verification | web-access | agent | workflow | knowledge
status: active | experimental | deprecated | draft
confidence: high | medium | low # optional; high가 기본값
applies_to:
  - skills/verify-report
source:
  - pilee-history:YYYY-MM-DD#N
reviewed_at: YYYY-MM-DD
reviewed_commit: <git commit hash>
related:
  - other-doc-id
supersedes:
  - previous decision label
---
```

Confidence 기준:
- `high`: 사용자의 명시 판단이 있거나 여러 세션/구현에서 반복 확인됨.
- `medium`: public/sanitized로는 안전하지만 사용자 취향이나 운영 철학 확인이 있으면 좋음.
- `low`: 문서화는 해두되, 정합성 PR에서 반드시 사용자 review를 받아야 함.

본문은 구현 파일 나열보다 다음을 우선한다.
- 왜 이 기능/원칙이 존재하는가
- 현재 유효한 판단 기준은 무엇인가
- 이전 결정이 무엇으로 대체되었는가
- 다음에 다시 검토해야 하는 trigger는 무엇인가

### 5. 검증

```bash
node scripts/knowledge.mjs --graph
node scripts/knowledge.mjs --validate
node scripts/knowledge.mjs --freshness
node scripts/knowledge.mjs --freshness --json --output .context/knowledge-freshness.json
node scripts/knowledge.mjs --resolve-stale --limit 8 # /ember resolve 내부 진입점
node scripts/knowledge.mjs --resolver-log
node scripts/knowledge.mjs --confirm <doc-id>
node scripts/knowledge.mjs --confirm <doc-id> --confidence high
```

`--resolve-stale`은 GitHub Actions의 검토 큐를 실제 로컬 작업 단위로 바꾸는 준비 명령이다. 생성된 `.context/knowledge-resolver/.../resolve-plan.md`와 session hint를 읽고, 문서가 틀리면 수정하고 여전히 맞으면 `--confirm`한다. `freshness.local.json`, session hint, private history 제목/원문은 민감할 수 있으므로 PR이나 public knowledge 문서에 복사하지 않는다.

Resolver PR body는 `skills/pilee-knowledge/references/resolver-pr-template.md`의 구조를 따른다. 특히 `내용 수정`, `confirm-only`, `사용자 판단 필요/보류`, `Privacy`, `검증`, `Freshness`, `Merge policy`를 분리해 적는다. README/SVG/public narrative PR은 resolver batch와 분리하고 사용자 review용 open PR로 남긴다.

초기 운영 중 local resolver PR은 생성까지만 하고 merge하지 않는다. 사용자가 `머지해줘`처럼 명시 요청했을 때만 병합한다. 나중에 자동 병합을 도입하더라도 `heestolee` 개인 계정으로 `gh pr merge`하지 않고, GitHub Actions/GitHub App/bot처럼 자동화 actor가 GitHub UI에 드러나는 경로를 사용한다.

`--resolver-log`는 로컬 resolver 실행 이력을 요약해서 보여준다. 이 로그도 local-only이며 session path/private text를 저장하지 않고, 실행 시각·대상 문서·카운트·산출물 디렉터리만 남긴다.

`--confirm`은 문서 내용과 관련 기능/히스토리를 실제로 확인한 뒤 실행한다. 단순 날짜/커밋 갱신 용도로 남발하지 않는다. `confidence: medium|low` 문서를 사용자가 받아들이면 `--confidence high`로 승격한다.

## Output format

완료 보고는 짧게 한다.

```markdown
## Knowledge Update Summary
- 주제: ...
- 전략: 기존 문서 수정 / 신규 문서 생성
- 수정 파일: `docs/knowledge/...`
- 연결: A → B
- 검증: `node scripts/knowledge.mjs --validate` 통과
- reviewed_at: 갱신함 / 보류함
```

## Red flags

- private journal 문장을 공개 문서에 그대로 붙여넣고 있다.
- 회사/업무/개인 맥락을 익명화하지 않았다.
- README generated block을 수동으로 편집하고 있다.
- README의 철학/포지셔닝 문구를 사용자 확인 없이 바꾸고 있다.
- 확신이 낮은 문서를 `confidence` 없이 확정 doctrine처럼 추가하고 있다.
- `related` 없이 독립 문서를 계속 만들고 있다.
- 실제 검토 없이 `reviewed_at`만 갱신하고 있다.
- local resolver PR body에 내용 수정/confirm-only/보류를 구분하지 않고 뭉뚱그려 적고 있다.
- README/SVG/public narrative PR을 resolver batch와 섞거나 사용자 review 없이 merge하고 있다.
- local resolver PR을 사용자 명시 요청 없이 바로 merge하고 있다.
- 자동 병합인데 GitHub UI에는 개인 계정이 merge한 것처럼 남긴다.
