---
title: Task overlay는 작업 맵을 보존한다
tags:
  - tasks
  - overlay
  - work-map
  - soft-delete
  - provenance
  - ui
category: ui
status: active
confidence: high
applies_to:
  - extensions/tasks
  - extensions/work-context
  - extensions/frame-studio
source:
  - user-direction:2026-05-19-task-work-map-overlay
  - user-direction:2026-05-20-task-overlay-toggle-shortcut
reviewed_at: 2026-06-02
reviewed_commit: 83617e9544615d818e6a7a17fa807f029a7db835
related:
  - work-context-card-task-board
  - ambient-status-surfaces
  - backlog-source-session-provenance
---

## Judgment

사용자가 작업 중 다시 화면을 볼 때 필요한 것은 역할별 운영판보다 “현재 어떤 구현·대응 항목들이 어느 영역에 매핑됐고, 각 항목이 어디까지 진행됐는가”입니다. Task UI는 agent 내부 todo가 아니라 설계·대화·검증 중 생긴 작업 맵을 잃지 않게 보여주는 ambient surface여야 합니다.

## Work Map Rule

Task overlay는 flat list보다 영역별 작업 맵을 기본 표현으로 삼습니다.

```text
-(FE)
  ✓ 요구사항 정리
  ⠹ 기존 코드 확인 중
  ○ 수정 후 검증
-(DB)
  ~~○ 신규 테이블 추가~~ (반려: 기존 테이블 재사용)
```

영역은 `area` 또는 `metadata.area/group/scope`에서 읽고, 명시값이 없으면 task kind에서 `검증`, `판단`, `Blocked`, `기타`로 추론합니다. `FE`, `BE`, `DB`, `UI`, `UX`, `검증`, `리뷰`, `문서`, `인프라`처럼 사용자가 작업을 이해하는 축을 우선합니다.

## Soft Disposition Rule

일반 작업 항목은 기본적으로 hard delete하지 않습니다. 잘못 잡힌 항목, 범위에서 빠진 항목, 우선순위가 밀린 항목도 사라지면 사용자의 판단과 agent의 오판이 나중에 복구되지 않습니다.

따라서 task removal은 terminal disposition으로 남깁니다.

- `deleted` → `(삭제: reason)`
- `rejected` → `(반려: reason)`
- `deprioritized` → `(우선순위밀림: reason)`
- `superseded` → `(대체: reason)`
- `misread` → `(오독: reason)`

Overlay와 `/tasks` 상세 UI는 이런 항목을 취소선과 설명으로 보여줍니다. 실제 물리 삭제가 필요하다면 별도 purge 성격의 명시 작업으로 다뤄야 합니다.

## Source Rule

Task는 TFT frame에서만 내려오는 것이 아닙니다. 사용자의 중간 입력, agent의 구현 중 발견, subagent 결과, verify 실패, PR review 대응도 모두 work map에 매핑될 수 있습니다.

Task에는 가능한 한 다음 정보를 남깁니다.

- `area` — 사용자가 한눈에 보는 영역 헤더
- `source` — `frame`, `user`, `agent`, `subagent`, `verify`, `review`, `manual`
- `disposition.reason` — 빠지거나 반려된 이유
- `refs/evidence` — frame, 검증, 커밋, 리포트 링크

## Shortcut Rule

Task UI는 두 표면을 분리합니다.

- `Ctrl+Shift+T` — 중앙 `/tasks` interactive overlay를 즉시 열어 상태 토글, 새 task 추가, soft delete, backlog 이동을 수행합니다. 입력창에 `/tasks`를 대신 채워 넣는 prefill fallback이 아니어야 합니다.
- `Ctrl+Shift+O` — 우상단 passive work-map overlay만 show/hide 토글합니다. 사용자가 화면을 넓게 보고 싶을 때 work map을 잠시 숨기되, task 데이터와 `/tasks` 조작 흐름은 그대로 보존합니다.
- `/tasks show|hide|status` — 같은 passive overlay visibility 상태를 명령으로 제어합니다.

토글 단축키는 hidden flag와 실제 overlay handle close/open을 함께 갱신해야 합니다. 단축키 회귀는 `npm run test:tasks`가 보장하며, `Ctrl+Shift+T`가 editor text를 바꾸지 않고 overlay를 직접 여는 계약도 포함합니다.

## Boundary

Task overlay는 TFT Studio나 frame.json을 대체하지 않습니다. TFT Studio는 판단·설계·검증 계약의 전문과 provenance를 보존하고, task overlay는 현재 실행 중인 작업 맵을 ambient하게 보여줍니다. 둘이 충돌하면 canonical frame/decision/verify 기록을 먼저 고친 뒤 task map을 갱신합니다.
