---
title: 백엔드 레이어 맵은 Frame의 초기 이해 게이트다
tags:
  - frame
  - tft
  - backend
  - resolver
  - usecase
  - service
  - repository
  - value-object
  - loader
  - architecture
category: frame
status: active
confidence: high
applies_to:
  - skills/frame
  - skills/decide
  - skills/verify
  - skills/verify-report
  - skills/tft-guidelines
  - .pi/frame.json
  - frame-studio
source:
  - user-direction:2026-05-12-backend-layer-map
reviewed_at: 2026-05-13
reviewed_commit: ca6dec9d7f8a3eeda24ee5b0d35c64752d02a76a
related:
  - architecture-friction-tft-lens
  - frame-verify-contract
  - tft-visual-structure-renderer
  - policy-axis-frame-gate
---

## Judgment

사용자가 backend 레이어를 잘 모르는 상태에서 agent가 바로 파일별 구현 plan을 쓰면, 사용자는 계획을 검수하기 어렵습니다. Resolver, usecase, service, repository, entity, VO, loader 같은 이름은 구현 파일명이 아니라 책임 경계입니다. 따라서 backend 작업에서는 구현 순서 전에 **레이어 책임 지도와 call-flow**를 먼저 보여줘야 합니다.

이 지도는 “어느 파일을 고칠지”가 아니라 “어느 레이어가 어떤 결정을 소유해야 하는지”를 검수하는 표면입니다. 예를 들어 기준 시간 선택은 usecase/resolver input의 책임인지, repository 내부 기본값인지, VO 필터링인지에 따라 API shape, query, cache key, 테스트 위치가 모두 달라집니다.

## Frame Rule

`/frame`은 다음 트리거가 보이면 Step 2에 `백엔드 레이어 맵`을 포함합니다.

- Resolver/Controller, Usecase, Service, Repository, Entity, VO, Loader/DataLoader, Migration 중 2개 이상이 영향 범위에 있음
- API 응답 값이 Web/Admin/Slack/job 등 여러 소비 채널로 흘러감
- cache key, loader scope, transaction boundary, ORM include/where/order가 결과 의미를 바꿈
- 사용자가 backend 구조에 익숙하지 않다고 밝힘

필수 레이어는 다음입니다.

1. Entry point — Resolver/Controller/Handler
2. Application flow — Usecase/Application service
3. Domain rule — VO/Domain service/Entity method
4. Data access — Repository/ORM query
5. Cache/batching — Loader/DataLoader/cache
6. Persistence — Entity/Migration/Schema
7. Consumers — Web/Admin/Slack/job/API clients

없는 레이어는 억지로 만들지 않고 `N/A`로 표시합니다. 중요한 것은 모든 레이어를 채우는 것이 아니라, 이번 변경의 책임이 어디에 있어야 하는지 사용자가 볼 수 있게 하는 것입니다.

## Ask Rule

레이어 맵 전체를 질문하지 않습니다. 질문은 아래 조건을 만족하는 책임 위치 하나만 승격합니다.

- 책임 위치에 따라 API shape, DB query, cache key, 테스트 위치가 달라진다.
- 코드 패턴만으로 어느 레이어가 책임져야 하는지 확정하기 어렵다.
- 후반 PR review에서 “repo가 아니라 usecase 정책”, “VO 불변식이어야 함”, “loader key 누락” 같은 구조 질문이 나올 가능성이 있다.

질문은 `현재 이해 / 막힌 결정 / 추천 답안 / 질문` 카드로 작성합니다.

## Decide Rule

`/decide`에서 backend 레이어 선택이 핵심이면 비교표에 `레이어 책임` 행을 포함합니다. 각 대안이 resolver/usecase/service/repository/VO/loader/entity 중 어디에 책임을 두는지, 그 결과로 생기는 테스트 위치·cache key·transaction boundary·source-of-truth 비용을 비교합니다.

레이어 책임 선택이 API/cache/transaction/source-of-truth를 바꾸면 challenge intensity는 최소 `high`입니다. 수용한 비용은 `tradeoffs_accepted`나 `mitigations`에 남깁니다.

## Verify Rule

`/verify`는 `backend_layer_map`이 있으면 실제 diff가 맵과 일치하는지 확인합니다.

- Resolver/Controller가 복잡한 정책·DB 조건을 소유하지 않는가
- Usecase/Service가 사용자 행동, 기준 시간, 권한, transaction 조합을 소유하는가
- VO/Domain service가 계산·불변식을 소유하고 IO를 하지 않는가
- Repository가 조회/저장 조건을 소유하되 표시 포맷·사용자 정책을 소유하지 않는가
- Loader/cache key가 기준 값, 권한, request scope를 빠뜨리지 않는가
- Entity/Migration/Schema가 source-of-truth와 제약을 표현하는가
- Consumer가 받은 결과를 표시/전달하고 source-of-truth를 재계산하지 않는가

불일치는 자동 리팩터링 명령이 아닙니다. frame 계약 위반 또는 decision mitigation 누락이면 `부분`/`GAP`으로 연결하고, 범위 밖 구조 개선이면 follow-up/backlog로 남깁니다.

## Verify Report Rule

`/verify-report`는 backend_layer_map이 있으면 UI 캡처만으로 끝내지 않습니다. 레이어 책임은 CODE_DIFF/BE evidence로 닫습니다. 예를 들어 “repo는 조회 조건만 소유”, “VO가 중복 방어를 소유”, “loader key에 basis 값 포함” 같은 항목은 코드 diff, unit test, generated schema, query result로 co-located evidence를 남깁니다.

## Boundary

백엔드 레이어 맵은 구현 plan이 아닙니다. 파일 순서와 작업 slice는 이 맵에서 파생될 수 있지만, 맵을 대체하면 안 됩니다. 사용자가 backend를 몰라도 “이 책임이 왜 repository가 아니라 usecase인가?”를 질문할 수 있게 만드는 것이 목적입니다.

## Review Trigger

다음 변화가 생기면 다시 검토합니다.

- `/frame`이 backend 레이어 맵을 너무 자주 켜 단순 작업까지 무겁게 만들 때
- backend 작업에서 여전히 레이어 책임 문제가 PR 후반에 발견될 때
- `tft-visual` renderer가 call-flow/layer map 전용 schema를 지원하게 될 때
