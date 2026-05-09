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
confidence: high
applies_to:
  - skills/verify
  - skills/verify-report
  - extensions/archive-to-html
source:
  - pilee-history:2026-05-01#4
  - pilee-history:2026-05-05#47
  - pilee-history:2026-05-05#48
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-09
reviewed_commit: bcad70f6b593d38cf4179e35c83c6f7510eceeed
related:
  - verify-report-workflow
  - frame-verify-contract
  - verification-invalidation-on-change
  - architecture-friction-tft-lens
---

## Judgment

“완료”, “Ready”, “문제없음”은 검증 증거가 있을 때만 말할 수 있습니다. 테스트 통과, 타입체크 통과, 코드 diff 확인은 각각 다른 주장에 대한 증거일 뿐이며, 요구사항 달성을 자동으로 증명하지 않습니다.

## Evidence Rule

UI 변화는 캡처, 이벤트/API는 네트워크나 콘솔 로그, 백엔드 동작은 쿼리/서버 검증, 구조 변경은 코드 diff·호출부 추적·테스트로 증명합니다. 화면 변화가 없다는 이유로 검증을 생략하지 않고, 적절한 evidence type을 고릅니다. UI 변경은 먼저 coverage axis를 정의하고, 의미 있는 경우 before/after를 같은 조건으로 비교합니다. 긴 full-page 이미지는 primary evidence가 아니라 접힌 supporting evidence로 둡니다.

## Gate

부분 달성, TODO, “시각 확인 필요”가 남아 있으면 PR-ready가 아닙니다. 미검증 항목은 숨기지 않고 blocked/unverified로 남겨 다음 행동을 분명히 합니다. 검증 산출물은 `/show-report`나 report archive로 다시 열 수 있어야 하며, 재오픈 가능한 위치 없이 완료 근거를 임시 파일에만 두지 않습니다.

## Reopen Evidence Rule

검증 리포트를 만들었다면 그것을 다시 여는 경로도 검증 대상입니다. report preview의 `이전`, `브라우저에서 열기`, `닫기` 같은 버튼이 깨져 있으면 evidence artifact의 회수성이 깨진 것이므로 “리포트 생성 완료”만으로는 충분하지 않습니다. 증거는 나중에 reviewer가 같은 artifact를 열어 재판단할 수 있을 때 더 강해집니다.

Raw capture group은 supporting evidence 탐색을 돕지만, 그 자체가 PASS 판정은 아닙니다. 검증 결론은 여전히 criterion별 report item과 coverage axis에 묶여야 하며, group label은 “찾기 쉬운 보관” 역할을 합니다.

Architecture side-effect도 같은 원칙을 따릅니다. “테스트 통과”만으로 구조 비용이 사라지지 않습니다. 변경이 module boundary/public interface/도메인 용어를 건드렸다면 `/verify`는 탐색성, 모듈 깊이, 용어 중복, decision mitigation 반영 여부를 근거와 함께 보고해야 합니다.
