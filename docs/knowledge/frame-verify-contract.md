---
title: Frame과 Verify는 구조화 계약이다
tags:
  - frame
  - verify
  - frame-json
  - success-criteria
  - contract
  - verification
  - 계약
  - 검증
category: verification
status: active
confidence: high
applies_to:
  - skills/frame
  - skills/decide
  - skills/verify
  - .pi/frame.json
source:
  - pilee-history:2026-05-01#6
  - pilee-history:2026-05-06#65
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-10-deep-interview-frame
reviewed_at: 2026-05-11
reviewed_commit: 55766aa7231850e0c715240fe796224a9dac843c
related:
  - ask-user-question-decision-gates
  - evidence-first-verification-gate
  - verification-invalidation-on-change
  - architecture-friction-tft-lens
  - verify-risk-lens-overlay
  - frame-plan-synthesis-continuity
supersedes:
  - freeform-context-md-verification
---

## Judgment

Frame은 구현 전 자연어 메모가 아니라, Verify가 기계적으로 읽을 수 있는 계약을 만드는 단계입니다. 동시에 사용자가 목표·범위·검증 초점을 함께 정렬하는 co-thinking 단계입니다. 자유서술 context만 남기면 검증 단계에서 목표를 다시 해석하게 되고, 그 해석 오차가 완료 판단을 흐립니다.

## Contract Shape

`frame.json`에는 성공 기준, 검증 계획, 범위 밖 항목, 엣지 케이스 seed, 위험 register, decision queue, `/decide`가 추가하는 `decisions[]`, provenance가 구조화되어야 합니다. Verify는 이 계약의 `success_criteria`를 행 단위로 PASS/FAIL 판정합니다. 새 의사결정이 필요하면 `/decide`로 분리하고, 결정 결과를 다시 계약에 반영합니다.

`decisions[]`는 선택지만 저장하지 않습니다. `/decide`는 항상 tradeoff challenge를 수행하고, `challenge.intensity`, `challenge.objection`, 사용자 응답, 수용한 tradeoff와 완화책을 함께 저장합니다. 그래야 Verify가 “선택한 대안이 구현됐는가”뿐 아니라 “수용한 비용/완화책이 실제 구현과 맞는가”까지 대조할 수 있습니다.

`frame.md`는 사람이 읽기 위한 mirror이고, TFT Studio transcript는 계약을 만든 대화 전문입니다. 둘 다 canonical source가 아닙니다. transcript는 사용자가 어떤 질문과 선택을 거쳤는지 다시 열어보는 provenance이고, Verify가 기계적으로 판정할 기준은 여전히 최신 `frame.json`입니다. Studio tool result는 전체 전문 대신 `contextDigest`, `tabSnapshot`, `transcriptRef.openCommand`(`/archive <transcriptPath>`)를 반환해 현재 Pi turn의 working context와 전문 reopen link를 함께 제공합니다.

Frame, Decide, Verify는 각각 canonical write가 성공한 뒤 TFT Studio stage run을 `finish`로 닫아야 합니다. Transcript가 `running`으로 남아 있으면 canonical에는 기록이 있어도 UI/provenance 상 그 stage가 아직 진행 중처럼 보입니다. 같은 작업에서 stage를 다시 실행하는 것은 새 trigger이며, 같은 transcript 안의 다음 run 카드로 이어집니다.

코드 구조를 건드리는 작업에서는 architecture friction도 계약의 일부가 됩니다. 별도 schema가 없더라도 `review_lenses`, `risk_register`, `verify_plan.manual_checks`, decision tradeoff에 “다음 사람/AI가 길을 잃을 구조인가”를 남기면 Verify가 구조 side-effect를 확인할 수 있습니다.

Verify는 frame의 success criteria뿐 아니라 diff가 유발한 failure mode도 읽어야 합니다. [verify-risk-lens-overlay](./verify-risk-lens-overlay.md)는 public generic lens와 project/private overlay를 나눠, schema/cache/API/runbook 같은 고위험 변경을 단순 코드 위치 확인만으로 PASS 처리하지 않게 합니다.

## Co-thinking Boundary

Frame은 초반부터 구현 plan을 대신 만들지 않습니다. 먼저 사용자가 볼 사고 렌즈와 실제 목표/범위 분기를 드러내고, 그 선택을 바탕으로 검증 계약을 작성합니다. 다만 목표·범위·성공 기준과 필요한 decisions가 닫힌 뒤에는 같은 Frame의 마지막 산출물로 `implementation_plan`을 합성할 수 있습니다. 이 plan은 frame contract를 대체하지 않고, `frame + decisions`에서 파생된 실행 지도입니다.

`/frame`에서 목표·범위·성공 기준·검증 축은 명백해 보여도 묻고, `(명백: ...)`으로 AI 판단 근거를 표시합니다. 사용자가 검수해야 할 초점이 보이지 않으면 frame은 정교한 문서여도 TFT로는 실패입니다.

Frame의 질문 규율은 deep-interview식입니다. 질문을 많이 하는 것이 아니라 목표, 포함/제외 범위, 제약, 완료 기준, 기존 맥락/영향 범위 중 가장 큰 불확실성 하나만 골라 `현재 이해 / 막힌 결정 / 추천 답안 / 질문` 카드로 묻습니다. 코드베이스·문서·티켓·이전 frame으로 확인 가능한 사실은 사용자에게 묻지 않고 먼저 확인해야 합니다. 인터뷰는 계약에 반영할 결정사항과 열린 질문이 정리되면 멈춥니다.

Productive Resistance는 독립 단계입니다. 성공 기준이 모호한지, 롤백 비용 큰 선택이 숨어 있는지, 이번 작업에서 무엇을 안 할지, 빠른 구현이 shallow module/분산 조건을 늘리는지 1~2개의 행동형 질문으로 흔든 뒤 draft를 작성합니다. 이때도 한 질문에는 가장 큰 불확실성 하나만 담고, 나머지 리스크는 risk seed나 follow-up으로 남깁니다.

## Canonical-first Rule

저장 시점에는 canonical JSON을 먼저 갱신합니다. `frame.json.tmp`를 쓰고 rename한 뒤, `provenance.canonicalHash` 필드를 제외한 canonical payload hash를 계산해 `provenance.canonicalHash`에 남깁니다. `frame.md`는 그 JSON에서 재생성합니다. `frame.md`와 transcript가 JSON과 불일치하면 JSON이 우선이며 mirror/provenance를 다시 생성하거나 충돌을 기록합니다.

이 규칙 때문에 product식 단일 markdown보다 파일은 늘어나지만, 원천은 하나입니다. markdown은 사람이 읽는 view이고, transcript는 감사 로그이며, 후속 자동화는 구조화된 canonical만 읽습니다.

## Review Trigger

작업 중 목표나 범위가 바뀌면 frame은 갱신되어야 합니다. 검증은 “처음 들은 요구사항”이 아니라 “최신 계약”에 대해 수행됩니다.
