---
name: pilee-knowledge
description: pilee-history/private journal에서 공개 가능한 설계 지식을 추출하거나 docs/knowledge 문서를 검색·작성·갱신·검증할 때 사용한다. 사용자가 "pilee knowledge", "히스토리를 지식으로", "지식 정합성", "README 그래프", "reviewed_at 갱신", "add-knowledge처럼"이라고 말하면 사용한다.
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

## Workflow

### 1. 기존 지식 검색

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

### 3. 작성/수정 결정

- 기존 문서가 현재 질문에 답하면 기존 문서를 수정한다.
- 새 기능/원칙이 독립적으로 검색될 주제면 새 문서를 만든다.
- 문서가 분리되면 `related`와 본문 inline link로 그래프를 연결한다.

### 4. 문서 작성 형식

각 topic 문서는 아래 frontmatter를 가진다.

```yaml
---
title: 문서 제목
tags: [검색어, keyword]
category: verification | web-access | agent | workflow | knowledge
status: active | experimental | deprecated | draft
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
node scripts/knowledge.mjs --confirm <doc-id>
```

`--confirm`은 문서 내용과 관련 기능/히스토리를 실제로 확인한 뒤 실행한다. 단순 날짜/커밋 갱신 용도로 남발하지 않는다.

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
- `related` 없이 독립 문서를 계속 만들고 있다.
- 실제 검토 없이 `reviewed_at`만 갱신하고 있다.
