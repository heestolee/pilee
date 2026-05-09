---
title: Session export는 원본을 보존하는 adapter를 거친다
tags:
  - session-export
  - source-preservation
  - jsonl
  - conductor
  - normalize
  - show-report
  - backlog
  - provenance
  - 세션
  - 원본보존
category: workflow
status: active
confidence: high
applies_to:
  - extensions/utils/session-export
  - extensions/archive-to-html
  - extensions/backlog
  - docs/knowledge
source:
  - pilee-history:2026-05-07#84
  - pilee-history:2026-05-07#85
  - user-direction:2026-05-09-ember-backfill
reviewed_at: 2026-05-09
reviewed_commit: b390940095ad5a543b757f54e9799aeceddcf26e
related:
  - artifact-archive-reopenability
  - backlog-source-session-provenance
  - session-identity-over-filenames
  - deterministic-fallbacks-preserve-workflow
---

## Judgment

Session export는 원본 JSONL을 직접 렌더러에 던지는 작업이 아니라, 원본을 보존하는 adapter 경계를 통과해야 합니다. Pi session JSONL과 외부/legacy session JSONL은 같은 파일 확장자를 쓰더라도 schema와 header 계약이 다릅니다. exporter가 기대하지 않는 raw JSONL을 직접 열면 preview 실패를 넘어 원본 파일이 다른 형식으로 덮일 수 있습니다.

따라서 session reopen 기능은 “열 수 있게 한다”보다 먼저 “원본을 바꾸지 않는다”를 보장해야 합니다.

## Adapter Rule

Session export helper는 입력을 먼저 분류합니다.

1. Pi session header가 있는 JSONL은 공식 exporter 입력으로 사용할 수 있습니다.
2. Conductor/Claude/legacy JSONL처럼 Pi session header가 없는 원본은 직접 export하지 않습니다.
3. 외부 원본은 local cache/normalized directory에 Pi-compatible JSONL 사본을 만들고, 그 사본만 exporter에 넘깁니다.
4. 원본 realpath, size, mtime, cache version을 기록해 반복 export는 cache hit로 처리합니다.
5. exporter UI나 post-process 규칙이 바뀌면 cache version을 올려 stale HTML을 폐기합니다.

이 규칙은 [검토 산출물은 다시 열 수 있어야 한다](./artifact-archive-reopenability.md)의 session reopenability를 안전하게 만드는 하위 계약입니다. Reopenability는 원본 변경을 정당화하지 않습니다.

## Source Preservation Guard

공유 helper는 첫 non-empty line이 Pi session header인지 확인하고, 아니면 export를 거부해야 합니다. 거부는 실패가 아니라 안전 장치입니다. 외부 원본을 지원하고 싶다면 call site가 normalization adapter를 명시적으로 선택해야 합니다.

Normalization은 공개 문서나 PR body에 private session path/raw text를 남기지 않습니다. 원본 path와 raw transcript는 local provenance이고, public knowledge에는 “외부 세션은 normalized 사본을 거쳐 exporter에 전달한다”는 판단만 남깁니다.

## UX Rule

사용자는 session JSONL 파일 자체를 보고 싶은 것이 아니라 대화 전문을 읽고 싶어 합니다. Export HTML은 기본적으로 tool noise가 적은 view를 먼저 보여주고, 필요할 때만 tool result를 확장할 수 있어야 합니다. 또한 `브라우저에서 열기`는 OS file association에 의존하지 않고 export된 HTML 또는 hosted preview URL을 열어야 합니다.

## Failure Mode

- Raw JSONL을 직접 `open`해서 기본 앱 없음 오류가 납니다.
- 외부 JSONL을 Pi exporter에 직접 넘겨 원본이 header만 있는 Pi session처럼 clobber됩니다.
- Source path만 저장하고 session title, cwd, leaf prompt 같은 사람이 찾을 수 있는 metadata를 잃습니다.
- Cache key 없이 매번 export해 대형 session reopen이 느려지고, 사용자가 session view를 피하게 됩니다.

## Review Trigger

다음 변경이 있으면 이 doctrine을 다시 검토합니다.

- Pi exporter 입력 schema가 바뀔 때
- Conductor/Claude/legacy session normalization rule이 바뀔 때
- `/show-report` 또는 `/backlog`가 session open 방식을 바꿀 때
- session export cache version 또는 default filter policy가 바뀔 때
