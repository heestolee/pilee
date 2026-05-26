---
title: Codex fast mode는 출력 verbosity와 priority tier만 줄인다
tags:
  - codex
  - model
  - speed
  - provider
  - extension
category: runtime
status: active
confidence: high
applies_to:
  - extensions/codex-fast-mode
  - extensions/custom-style
source:
  - user-direction:2026-05-26-codex-fast-mode-benchmark
reviewed_at: 2026-05-26
reviewed_commit: c1cfb502e93cda203db69509772ee87feed9f7c6
related:
  - editor-affordance-not-context
  - subagent-model-policy
  - workflow-guard-enforced-flow
title_en: Codex fast mode only reduces output verbosity and priority tier
---

## Overview

`/codex-fast`는 `openai-codex/gpt-5.4`와 `openai-codex/gpt-5.5` 요청 payload에 작은 runtime hint를 추가하는 경량 확장입니다. 목적은 “모델을 더 똑똑하게”가 아니라, 사용자가 체감하는 대기와 장황함을 줄이는 것입니다.

## Runtime Contract

- 지원 provider/model은 정확히 `openai-codex` + `gpt-5.4` 또는 `gpt-5.5`입니다.
- `/codex-fast on` 상태에서 지원 모델에 `text.verbosity = "low"`를 적용합니다.
- `/codex-fast off`는 payload hint를 적용하지 않는 완전 비활성 상태입니다.
- `service_tier = "priority"`는 `/codex-fast priority-on`으로 별도 opt-in할 때만 적용합니다. 네 환경의 초기 benchmark에서 priority tier가 180초 timeout을 만들 수 있었기 때문에 기본 fast path에서 분리합니다.
- 상태는 `~/.pi/agent/state/codex-fast-mode.json`에 저장하고 custom footer는 같은 파일의 `enabled`를 읽어 fast badge를 표시합니다.

## Non-goals

Fast mode는 thinking level을 낮추지 않습니다. `gpt-5.5:xhigh`가 내부 사고를 오래 하는 경우, 이 확장만으로 reasoning gap이 사라진다고 보장하지 않습니다. 속도 비교는 반드시 적용 전후 같은 prompt/model/options로 wall time과 출력 길이를 기록해 판단합니다. Priority tier는 provider side scheduling hint일 뿐이며, 실제 환경에서 timeout이 관측되면 끄고 low verbosity만 사용합니다.

## Large Context Boundary

Fast mode와 large context metadata 조작은 분리합니다. context window를 실제 API 한계보다 크게 보이게 하면 footer와 compaction 판단을 왜곡할 수 있습니다. Codex effective context는 관측된 provider 한계와 model registry clamp를 우선하고, fast mode는 payload hint만 담당합니다.

## Review Trigger

- OpenAI Codex payload schema가 바뀔 때
- Pi provider registration API가 바뀔 때
- `@mariozechner/pi-ai`의 `streamSimpleOpenAICodexResponses` export가 바뀔 때
- 사용자 체감 지연이 여전히 `tool_result → 다음 action` reasoning gap에 집중될 때
