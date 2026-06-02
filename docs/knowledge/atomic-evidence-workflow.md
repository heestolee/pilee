---
title: Atomic evidence workflow는 작은 claim을 증거로 닫는다
tags:
  - atomic
  - evidence
  - claim
  - slice
  - verification
  - frame
  - worker
  - final-check
  - 렌더링
  - 검증
category: workflow
status: active
confidence: high
applies_to:
  - AGENTS.md
  - agents/worker
  - agents/verifier
  - skills/frame
  - skills/verify
  - skills/verify-report
  - skills/pilee-final-check
  - skills/incremental-implementation
source:
  - user-direction:2026-05-13-atomic-evidence-workflow
reviewed_at: 2026-06-02
reviewed_commit: ce5e875d9e49a3a0b93215894e525b1933c6a145
related:
  - frame-verify-contract
  - verify-report-workflow
  - frame-studio-interactive-decision-ui
  - worktree-session-continuity
  - evidence-first-verification-gate
---

## Judgment

컨텍스트를 많이 보존하는 것보다, 현재 작업을 작은 claim으로 쪼개고 각 claim을 evidence로 닫는 편이 더 안정적입니다. 긴 transcript와 handoff pack은 참고 자료일 뿐이고, 현재 truth는 `claim`, `scope`, `evidence`, `gap`입니다.

이 판단은 “context를 버린다”가 아닙니다. context는 출발점을 빠르게 회복하게 해주지만, 완료 판정을 대신할 수 없습니다. 오래된 맥락이 많을수록 agent는 묵시적 합의나 이전 결론을 현재 사실처럼 오해하기 쉽기 때문에, 실행 단위는 오히려 더 작아져야 합니다.

## Workflow Shape

- **Frame**: 목표를 긴 설계 문서로 키우기보다, 결과가 달라지는 불확실성 하나를 묻고 claim/slice 단위로 scope와 evidence를 잠급니다.
- **Worker**: 큰 요청을 가장 작은 검증 가능한 claim으로 나눈 뒤, 한 slice만 읽고 수정하고 검증합니다.
- **Verify**: frame success criteria와 diff에서 claim inventory를 만들고, 각 claim을 test/build/runtime/capture/artifact evidence와 연결합니다.
- **Verify Report**: user-facing 또는 rendered artifact claim은 실제 화면·preview·capture로 닫습니다. Source text, Mermaid codeblock, raw inline SVG, HTML 생성 성공만으로 PASS 처리하지 않습니다.
- **pilee-final-check**: 완료 보고 직전에 claim/evidence 표를 다시 만들고, 증거 없는 완료 주장은 GAP으로 내립니다.

## Minimum Slice Contract

각 slice는 다음 네 가지를 가져야 합니다.

| Field | Meaning |
|---|---|
| Claim | 무엇이 true여야 하는가 |
| Scope | 어떤 파일·경로·동작만 건드리는가 |
| Evidence | 어떤 명령·캡처·로그·artifact로 닫는가 |
| Gap | 지금 닫지 못한 것은 무엇인가 |

이 네 가지가 없으면 다음 slice로 넘어가지 않습니다. 단, schema 확장이 과하면 별도 구조를 만들기보다 기존 frame `implementation_plan.slices[]`, task acceptance, final-check 표 안에 이 네 가지가 읽히도록 작성합니다.

## Design-first Interpretation

Design-first는 모든 작업을 긴 설계 승인으로 키우는 절차가 아닙니다. 묵시적 합의가 생기는 지점을 작게 드러내고, 사용자의 답이 실제 구현·검증을 바꾸는 경우에만 묻는 것입니다.

- light 작업은 2~3문장 scope/evidence lock으로 충분합니다.
- standard/full 작업은 claim/slice 단위로 합의합니다.
- 질문은 한 번에 하나만 묻습니다.
- 사용자가 이미 준 절차나 제약은 일반론으로 덮지 말고, 현재 목적에 맞는지 먼저 확인합니다.
- 과한 schema, 명령, 지침은 1차 보류하고 나머지 명확한 작업을 먼저 닫습니다.

## Anti-patterns

- 오래된 transcript를 현재 truth로 취급합니다.
- 도구 호출 성공을 사용자-facing 성공으로 간주합니다.
- 렌더링 claim을 markdown/source/HTML 파일 생성으로 PASS 처리합니다.
- 큰 context pack을 만들었으니 검증 기준도 닫혔다고 착각합니다.
- refactor, 기능 변경, generated artifact 갱신을 한 slice에 섞습니다.

## Verification Rule

완료 판정은 claim/evidence 매핑으로만 합니다. Evidence가 없으면 완료가 아니라 `PARTIAL`, `GAP`, 또는 `blocked`입니다. UI/TUI/WebView/diagram/report처럼 “보인다”가 성공 기준인 작업은 실제 렌더 결과를 열고 확인해야 합니다.
