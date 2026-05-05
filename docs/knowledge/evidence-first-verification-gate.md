---
title: 완료 선언은 증거 뒤에만 온다
tags:
  - verify
  - evidence
  - gate
  - done
  - ready
  - verification
  - 증거
  - 완료
category: verification
status: active
applies_to:
  - skills/verify
  - skills/verify-report
  - extensions/archive-to-html
source:
  - pilee-history:2026-05-01#4
  - pilee-history:2026-05-05#47
  - pilee-history:2026-05-05#48
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - verify-report-workflow
  - frame-verify-contract
  - verification-invalidation-on-change
---

## Judgment

“완료”, “Ready”, “문제없음”은 검증 증거가 있을 때만 말할 수 있습니다. 테스트 통과, 타입체크 통과, 코드 diff 확인은 각각 다른 주장에 대한 증거일 뿐이며, 요구사항 달성을 자동으로 증명하지 않습니다.

## Evidence Rule

UI 변화는 캡처, 이벤트/API는 네트워크나 콘솔 로그, 백엔드 동작은 쿼리/서버 검증, 구조 변경은 코드 diff와 테스트로 증명합니다. 화면 변화가 없다는 이유로 검증을 생략하지 않고, 적절한 evidence type을 고릅니다.

## Gate

부분 달성, TODO, “시각 확인 필요”가 남아 있으면 PR-ready가 아닙니다. 미검증 항목은 숨기지 않고 blocked/unverified로 남겨 다음 행동을 분명히 합니다.
