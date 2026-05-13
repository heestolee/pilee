---
title: Read/Edit tool override는 필요한 증거만 펼친다
tags:
  - read
  - edit
  - tool
  - override
  - diff
  - preview
  - output
  - noise
category: workflow
status: active
confidence: high
applies_to:
  - extensions/read-tool-override
  - extensions/edit-tool-override
  - extensions/utils/read-tool-ui.ts
  - extensions/utils/edit-tool-ui.ts
  - extensions/utils/edit-override.ts
  - extensions/utils/edit-side-by-side.ts
  - extensions/utils/file-kind.ts
source:
  - user-direction:2026-05-14-my-pi-tool-overrides
  - github:jonghakseo/my-pi/extensions/read-tool-override
  - github:jonghakseo/my-pi/extensions/edit-tool-override
reviewed_at: 2026-05-13
reviewed_commit: f3fe380f771c905d12d52a53fdf9a37e55ee6b7a
related:
  - bash-tool-title-output-override
  - tool-output-noise-management
  - atomic-evidence-workflow
---

## Judgment

Read/Edit 도구는 원시 파일 내용이나 성공 문구를 대화에 길게 펼치기보다, 사용자가 판단해야 하는 증거만 보여줘야 합니다. 기본 화면은 조용해야 하고, 필요한 경우에만 preview/diff를 펼쳐 볼 수 있어야 합니다.

이 판단은 my-pi의 read/edit tool override에서 가져온 원칙입니다. pilee는 실행 backend를 새로 만들지 않고 built-in read/edit에 위임하되, 렌더링과 preview 품질만 조정합니다.

## Read Contract

- 접힌 결과는 비웁니다.
- 펼친 결과는 최대 10줄 preview만 보여줍니다.
- 남은 줄 수와 `파일명:start-end` footer를 표시합니다.
- truncation warning은 유지합니다.
- 실제 read 실행은 `createReadToolDefinition(ctx.cwd)`에 위임합니다.

## Edit Contract

- 실행 전 call rendering에서 가능한 경우 diff preview를 계산합니다.
- edit 결과에 diff details가 있으면 side-by-side diff를 보여줍니다.
- 일반 성공 문구는 diff가 있으면 반복 노출하지 않습니다.
- binary/image/directory는 preview 단계에서 명확한 오류로 표시합니다.
- 실제 edit 실행은 `createEditToolDefinition(ctx.cwd)`에 위임합니다.

## Matching Helper Contract

edit preview는 다음 완화 matching을 지원합니다.

- exact match
- trailing whitespace trim match
- special quote/dash/space normalization match
- line ending/BOM preservation
- overlap detection
- `replaceAll` 제한

이 helper는 preview 품질을 높이기 위한 것이며, 사용자가 요청하지 않은 임의 수정이나 formatting rewrite를 허용하는 근거가 아닙니다.

## Non-goals

- read/edit의 파일 접근 권한, cwd, abort/cancel 의미를 새로 정의하지 않습니다.
- write tool까지 함께 바꾸지 않습니다.
- 모든 diff를 대화에 항상 펼치지 않습니다. 기본은 compact이고, 필요한 경우 펼칩니다.
