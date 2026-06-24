---
title: Bash tool override는 명령 의도와 출력 노이즈를 분리한다
tags:
  - bash
  - tool
  - override
  - ui
  - output
  - title
  - context
  - noise
  - validation
  - fan-out
category: workflow
status: active
confidence: high
applies_to:
  - extensions/bash-tool-override
  - package.json
source:
  - user-direction:2026-05-14-my-pi-bash-tool-override
  - user-direction:2026-06-24-validation-fanout-guard
  - github:jonghakseo/my-pi/extensions/bash-tool-override
reviewed_at: 2026-06-24
reviewed_commit: fae9aa375e31fdb76544f256fcae6f692565c991
related:
  - tool-output-noise-management
  - korean-first-user-facing-output
  - atomic-evidence-workflow
---

## Judgment

Bash 도구 출력은 대화 흐름을 쉽게 압도합니다. 사용자가 보는 기본 화면에서는 “무슨 명령을 왜 실행했는가”가 먼저 보여야 하고, 원시 stdout/stderr는 필요할 때만 펼쳐서 확인하는 편이 더 간결합니다.

따라서 pilee는 built-in bash 실행 동작은 유지하되, UI contract만 override합니다.

## Contract

- bash tool은 `title` 인자를 받습니다.
- `title`은 명령 의도를 설명하는 짧은 한국어 문장입니다.
- call preview는 `bash <title>`과 짧은 command preview만 보여줍니다.
- 실행 중에는 경과 시간만 간결하게 보여줍니다.
- 결과가 접혀 있으면 stdout/stderr를 대화에 펼치지 않습니다.
- 결과를 펼치면 tail 중심으로 일부 출력과 truncation warning을 보여줍니다.
- 실제 실행은 `createBashToolDefinition(ctx.cwd)`로 built-in bash에 위임합니다.
- 실행 전 validation fan-out guard를 적용합니다.
  - `pnpm test -- <path>`, `npm test -- <path>`, `yarn test -- <path>`처럼 package script wrapper 뒤에 path를 붙인 명령은 targeted evidence로 믿지 않고 차단합니다.
  - 파일 단위 검증은 package cwd에서 `pnpm exec vitest run <spec>`, `pnpm exec jest <spec>`, `pnpm exec eslint <file>`처럼 direct executable을 호출해야 합니다.
  - path/filter가 없는 broad `test`/`lint`/`type-check`/`build` script와 filter 없는 `turbo run <validation>`은 기본 차단합니다.
  - 실제 cross-cutting 위험 때문에 넓은 검증이 필요하면, 먼저 이유를 사용자에게 밝히고 같은 명령에 `ALLOW_BROAD_VALIDATION=1`을 붙여 명시적으로 우회합니다.

## Non-goals

- shell 실행 방식, cwd, timeout, cancel 동작을 새로 구현하지 않습니다.
- interactive shell 기능을 bash override에 섞지 않습니다.
- 검증이나 디버깅에 필요한 원시 출력 접근을 막지 않습니다. 필요하면 tool result를 펼치거나 전체 로그 파일을 확인합니다.
- 필요한 넓은 검증을 영구 금지하지 않습니다. 다만 broad validation은 현재 diff와 연결된 이유가 있는 의식적 선택이어야 합니다.

## Why not just prompt discipline?

프롬프트로 “간결하게 말하라”고만 하면 도구 UI는 여전히 긴 출력 중심으로 보입니다. 이 override는 모델이 실행 이유를 `title`로 명시하게 하고, 화면 기본값은 의도 중심으로 접어 둬서 사용자의 인지 부하를 줄입니다.

같은 이유로 validation fan-out도 프롬프트 규칙만으로는 충분하지 않습니다. 모델이 `pnpm test -- <file>` 같은 wrapper 명령을 targeted라고 착각하면 이미 전체 suite가 시작된 뒤에야 실수를 알 수 있습니다. 알려진 위험 패턴은 bash 실행 직전 guard가 막고, agent는 가장 가까운 direct validation으로 다시 좁혀야 합니다.
