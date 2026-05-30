---
title: Verify Report 전에는 PM-facing 계약과 readiness를 먼저 잠근다
tags:
  - verify-report
  - preflight
  - readiness
  - capture
  - data
  - account
  - report
  - pm-facing
  - requirement-mapping
  - subject-identity
  - setup-noise
  - technical-support
category: verification
status: active
confidence: high
applies_to:
  - skills/verify-report-preflight
  - skills/verify-report
source:
  - user-direction:2026-05-12-verify-report-preflight-skill
  - user-feedback:2026-05-30-pm-facing-capture-report-preflight
reviewed_at: 2026-05-30
reviewed_commit: 1a66b70d647237bb906d46aa0f0d5a6579a6fae1
related:
  - verify-report-workflow
  - evidence-first-verification-gate
  - private-overlay-package-boundary
  - live-artifact-preview-pattern
title_en: Verify Report starts after PM-facing contract and readiness are locked
---

## Overview

Verify Report는 PM·비개발자가 구현 핵심을 캡처/GIF로 이해하는 강한 검증 흐름입니다. 하지만 URL·계정·데이터·before 기준만 준비해도 부족합니다. 기획 근거가 어떤 사용자-facing 성공 기준으로 바뀌는지, 누가 어떤 화면에서 보는지, 같은 subject를 기준으로 상태 전환을 증명하는지, 어떤 캡처가 primary evidence인지가 잠기지 않으면 긴 캡처 루프가 엉뚱한 증거와 setup noise로 오염됩니다.

`/verify-report-preflight`는 full report에 들어가기 전 readiness와 작업 무게를 판단하는 얇은 gate이면서, 이제는 **PM-facing report contract를 사전에 고정하는 단계**입니다.

## PM-facing Contract Rule

Preflight는 각 검증 item을 아래 계약으로 바꿔야 합니다.

| 계약 필드 | 확인해야 할 것 |
|-----------|----------------|
| Requirement source | Jira/Notion/Slack/와이어프레임/PR test plan/frame/user instruction 중 무엇을 증명하는가 |
| PM-readable claim | PM·기획자가 읽을 한 문장 성공 기준 |
| Actor / role | 누가 조작하거나 보는가. 기능 대상 role과 검증 계정 role이 일치하는가 |
| Subject identity | 같은 row/order/review/user/item임을 무엇으로 보장하는가 |
| User-facing oracle | 화면에서 어떤 텍스트/상태/흐름이 보여야 성공인가 |
| Primary capture | focused crop/GIF/viewport 중 무엇이 상단 증거인가 |
| Technical support | API/DB/code/test/migration이 어떤 claim을 보조하는가 |
| Excluded setup noise | 로그인/빌드/bootstrap/selector 시행착오 중 report에서 숨길 것은 무엇인가 |

이 계약이 없으면 `/verify-report`는 시작할 수는 있어도 신뢰도 높은 PM-facing report가 되기 어렵습니다. 특히 before/after 또는 A→B state transition은 같은 subject identity가 없으면 PASS 후보가 아닙니다.

## Readiness Rule

캡처를 시작하기 전에 최소한 아래를 표로 잠급니다.

| 축 | 확인해야 할 것 |
|---|---|
| Requirement | 근거 출처와 PM-readable 성공 기준 |
| Target | local/dev/preview/prod URL과 route |
| Actor/Role | 계정 alias/session/role, 기능 대상과의 일치 |
| Subject/Data | subject id, fixture/data 상태, side effect 여부 |
| Before/Transition | before/after가 필요한지, 같은 조건으로 비교 가능한지 |
| Visual Evidence | UI_CAPTURE/GIF/crop이 어떤 oracle을 닫는지 |
| Technical Support | BE/API/DB/CODE_DIFF/CONSOLE/test가 왜 필요한지 |
| Setup Noise | report 본문에서 제외할 준비 과정과 blocked로 남길 조건 |
| Baseline | 반복 validation 실패가 자동 preflight 주석/known baseline인지 |
| Risk | 결제/알림/DB write/external API 같은 위험 action이 있는지 |

준비가 안 된 축이 있으면 report를 시작하지 않고 `blocked`로 남깁니다. Preflight는 PASS 증거가 아니므로, 준비가 끝난 뒤 실제 `/verify-report`나 `/verify` evidence로 최종 판정합니다.

## Weight Rule

- `light`: PM-facing item 1~2개인 단일 copy/style/hotfix면 focused crop/log/test 1~2개나 `/verify-report --no-workers`로 충분할 수 있습니다.
- `standard`: UI/BE/event 축이 몇 개 있으면 일반 `/verify-report`로 진행합니다.
- `full`: role/viewport/before-after/state transition/BE/event/정책이 섞이면 PM-facing contract와 worker fan-out을 명시합니다.
- `blocked`: target/account/data/subject/oracle/side-effect 승인이 없으면 capture-heavy 검증을 시작하지 않습니다.

반복 validation 실패는 사용자가 별도 preflight 명령을 직접 실행하는 책임이 아닙니다. Agent는 bash validation 결과의 preflight baseline 주석을 읽고, 새 unrelated baseline이라고 판단하면 `preflight_baseline` tool로 기록합니다. 사람이 cache를 확인·정리하고 싶으면 자연어로 요청하고, agent가 같은 tool로 처리합니다.

## Decision Shape

Preflight 결과는 `/verify-report`의 목차 초안이어야 합니다.

```markdown
### 판정
- light / standard / full / blocked

### PM-facing behavior contract
| V | 근거 출처 | PM-readable 성공 기준 | actor/role | subject identity | 화면 oracle | primary capture | 상태 |
|---|-----------|----------------------|------------|------------------|-------------|-----------------|------|

### Technical support candidates
| T | 보조 검증 | 왜 필요한가 | Evidence | 상태 |
|---|----------|------------|----------|------|

### 차단/주의
- unknown/blocked/side effect/setup noise

### 다음 액션
- 실행할 /verify-report 경로 또는 필요한 사용자 입력
```

## Why It Matters

좋은 리포트는 많은 캡처가 아니라 PM-facing claim이 닫힌 coverage입니다. Preflight는 검증을 줄이는 장치가 아니라, 긴 `/verify-report` 전에 실패할 조건과 scope drift를 먼저 찾아 검증 시간을 짧게 만들고 report의 신뢰도를 높입니다.
