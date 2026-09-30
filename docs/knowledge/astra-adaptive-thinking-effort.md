---
title: Astra는 xhigh 기본에서 필요한 turn만 max로 승격한다
title_en: Astra defaults to xhigh and escalates only high-risk turns to max
tags:
  - astra
  - reasoning
  - thinking
  - xhigh
  - max
  - workflow-guard
  - adaptive-effort
category: agent
status: active
confidence: high
applies_to:
  - extensions/workflow-guard
source:
  - user-direction:2026-09-30-astra-adaptive-effort
  - runtime-evidence:2026-09-30-astra-xhigh-max-sample
reviewed_at: 2026-09-30
reviewed_commit: 72429887fa9988bfe2ae14c248b77acdaa7303ca
related:
  - subagent-model-policy
  - workflow-guard-enforced-flow
  - ultra-proactive-delegation-mode
---

## Judgment

GPT-6 Astra 메인 세션은 `xhigh`를 기본값으로 사용하고, 더 많은 reasoning이 실제로 필요한 turn만 `max`로 승격합니다. `max`는 품질 보장 스위치가 아니라 더 많은 가설과 경로를 검토할 수 있게 하는 비용 높은 effort이므로 모든 요청에 고정하지 않습니다.

로컬 Pi 기본 설정은 `xhigh`를 선택합니다. public pilee는 사용자의 전역 설정을 강제로 덮어쓰지 않고, 현재 세션이 Astra `xhigh`일 때만 `workflow-guard`가 turn-level 승격을 적용합니다.

## Escalation Triggers

자동 승격은 보수적인 명시 신호에만 반응합니다.

| Trigger | 예 | Reason |
|---|---|---|
| 명시적 max 요청 | `max로 올려서 처리해줘` | 사용자가 해당 turn의 비용 증가를 직접 선택 |
| 아키텍처 결정 | 구조 비교, trade-off, 재구성 결정 | 넓은 대안 공간과 장기 비용 판단 |
| 보안 민감 분석 | 인증·인가·권한 모델·취약점에 분석·설계·위협·근본원인 신호가 함께 있음 | false negative의 실패 비용이 큼 |
| 동시성 분석 | race condition, deadlock, transaction, idempotency에 분석·재현·디버그·방지 신호가 함께 있음 | interleaving과 불변조건을 동시에 검토해야 함 |
| 어려운 장애 | 반복·간헐 5xx/timeout/crash의 root cause | 여러 실행 경로와 반증을 오래 유지해야 함 |
| xhigh 실패 후 재시도 | `xhigh로 해결되지 않았어. 다시 재시도해줘` | 이미 낮은 effort 경로가 충분하지 않았다는 직접 증거 |

보안·동시성 명사만으로는 승격하지 않습니다. 주석·오타·문구·줄바꿈·링크·테스트 이름·상수 값·TODO 같은 trivial artifact edit 신호가 있으면 `xhigh`를 유지합니다. 일반 구현, 보통 수준의 리뷰, `workflow-guard`가 `status_note`로 판정한 노트도 마찬가지입니다. `full` workflow라는 이유만으로 자동 max가 되지 않으며, 비-Astra 모델에도 이 정책을 적용하지 않습니다.

## State Machine

1. `before_agent_start`에서 현재 모델과 thinking level을 읽습니다.
2. 모델이 OpenAI Codex Astra이고 현재 level이 정확히 `xhigh`이며 trigger가 있을 때만 `setThinkingLevel("max")`를 호출합니다.
3. 승격 기록은 session-local 메모리에 두고 retry, compaction retry, queued continuation이 끝날 때까지 유지합니다.
4. `agent_settled`에서 현재 level이 여전히 자동 승격된 `max`이면 원래 `xhigh`로 복귀합니다.
5. run 도중 session이 종료되거나 reload될 때도 `session_shutdown`에서 같은 복귀를 시도합니다.

사용자가 turn 시작 전에 `/thinking max`로 직접 고정한 경우에는 자동 승격 기록을 만들지 않습니다. 따라서 guard가 이를 `xhigh`로 되돌리지 않습니다. 자동 승격 중 사용자가 다른 level로 바꿨다면 현재 선택을 존중하고 강제 복귀하지 않습니다.

## Safety Boundary

Reasoning effort 승격은 실행 권한 승격이 아닙니다. max가 되어도 다음 계약은 그대로 유지합니다.

- 사용자 요청 범위와 mutation gate
- light/standard/full workflow 무게
- 외부 write와 worktree 승인
- 검증 evidence와 false PASS 기준
- subagent writer ownership

`workflow-guard`의 기존 classifier가 `status_note`로 판정한 메시지는 사용자 task가 아니므로 보안·장애 키워드가 포함돼도 승격하지 않습니다. 임의의 대괄호 prefix를 모두 상태 노트로 추정하지는 않습니다.

## Subagent Boundary

이 정책은 메인 Pi 세션의 adaptive effort를 다룹니다. `agents/*.md`의 고정 role mapping은 [Hybrid subagent 모델 운용 정책](./subagent-model-policy.md)이 source of truth입니다. 특히 false PASS 비용이 큰 verifier/challenger의 `max`는 그대로 유지하며, main의 turn-level 승격을 subagent 기본값으로 자동 전파하지 않습니다.

## Evidence Boundary

동일한 TypeScript 동시성 리뷰를 각 effort로 한 번 실행한 로컬 표본에서 `xhigh`는 34.0초·reasoning 707 tokens, `max`는 50.5초·reasoning 1,304 tokens를 사용했고 최종 문제 판정과 수정안은 같았습니다. 이 표본은 고정 배수나 일반 품질 우위를 증명하지 않습니다. 다만 쉬운 문제에서 max의 추가 비용이 답 개선으로 이어지지 않을 수 있다는 운영 근거로만 사용합니다.

## Review Trigger

다음 변화가 생기면 이 문서를 다시 검토합니다.

- Astra의 지원 effort나 API mapping이 바뀔 때
- trigger의 false positive/false negative가 반복될 때
- `agent_settled`의 retry·follow-up lifecycle 계약이 바뀔 때
- main과 subagent effort 정책을 통합하거나 분리하는 기준이 바뀔 때
