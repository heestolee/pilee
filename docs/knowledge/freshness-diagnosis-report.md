---
title: Freshness는 진단서다
tags:
  - knowledge
  - freshness
  - diagnosis
  - review
  - candidate
  - 정합성
category: knowledge
status: active
confidence: high
applies_to:
  - scripts/knowledge.mjs
  - docs/knowledge
  - skills/pilee-knowledge
source:
  - pilee-history:2026-05-05#50
  - pilee-history:2026-05-05#52
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-12
reviewed_commit: 4d1ff268e27626a227ef1f2e25f2871278918e25
related:
  - judgment-doc-unit
  - readme-coverage-map
  - deterministic-vs-ai-actions
---

## Judgment

Knowledge freshness는 단순히 “문서가 낡았다”는 경고가 아니라 자동화, AI rewrite, human review가 공유하는 진단서입니다. 같은 report가 README 재생성, 문서 검토, coverage backfill의 입력이 되어야 합니다.

## Report Shape

진단서는 base, summary, doctrine, readme, reasons, severity, deterministic_actions, ai_actions, candidates를 분리합니다. 문서 자체의 stale, README generated block stale, missing coverage, medium/low confidence review는 서로 다른 문제이므로 같은 실패로 취급하지 않습니다.

## Review Rule

freshness가 제안한 후보는 자동 수정 명령이 아닙니다. 문서를 실제로 읽고 현재 판단이 맞는지 확인한 뒤 수정하거나 `--confirm`으로 reviewed 기준을 갱신합니다. confidence review 후보를 받아들이는 경우에는 `--confirm <doc-id> --confidence high`로 승격합니다.

## Generated Artifact Rule

README의 generated block, `docs/knowledge/README.md`, `tmp/knowledge-map.ko.svg`, legacy `docs/knowledge-review.md` 같은 review queue 산출물은 doctrine의 근거 파일이 아니라 진단 결과입니다. 이 파일들이 바뀌었다는 이유만으로 모든 knowledge doc을 다시 stale 처리하면 검토 큐가 자기 자신을 증폭합니다. freshness는 generated artifact 변경을 deterministic/generated 문제로 분리하고, doctrine stale 사유에서는 제외해야 합니다. 현재 review queue의 상세 목록은 repo markdown이 아니라 PR body나 workflow summary에 둡니다.

## Local Resolver Shape

`--resolve-stale`은 freshness 진단서를 실제 로컬 작업 단위로 바꾸는 보조 명령입니다. 이 명령은 `.context/knowledge-resolver/<timestamp>/` 아래에 `freshness.local.json`, `freshness.public-redacted.json`, `resolve-plan.md`, `prompt.md`, `pr-body.md`를 생성합니다. plan에는 stale/review_needed 문서, 관련 커밋 근거, 가능한 로컬 Pi session path hint, 판정 체크리스트가 들어갑니다. 실제 수정과 confirm은 agent/human이 plan을 읽고 private 맥락을 확인한 뒤 수행합니다.

resolver batch가 끝났다는 것은 선택된 문서가 fresh로 닫혔다는 뜻이지 전체 doctrine이 fresh가 됐다는 뜻은 아닙니다. resolver 자체나 skill 정책을 수정하면 그 변경이 다른 knowledge 문서를 새 review 후보로 만들 수 있으므로, PR body에는 “선택된 문서 결과”와 “전체 freshness 결과”를 분리해 적습니다.

`freshness.local.json`과 session hint는 민감 정보를 포함할 수 있으므로 PR에 첨부하지 않습니다. 공개 PR에는 `pr-body.md`의 sanitized 구조와 문서 수정 결과만 사용합니다. `freshness.public-redacted.json`은 private history 근거를 숨긴 참고용 산출물입니다. 로컬 실행 이력은 `.context/knowledge-resolver/runs.jsonl`에 요약되며, `node scripts/knowledge.mjs --resolver-log`로 확인합니다.
