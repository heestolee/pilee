---
title: 변경 통합은 작은 단위와 검증을 요구한다
tags:
  - git
  - incremental
  - code-review
  - commit
  - revert
  - rollback
  - i18n
  - quality
  - 통합
category: workflow
status: active
confidence: high
applies_to:
  - skills/git-workflow-and-versioning
  - skills/incremental-implementation
  - skills/code-review-and-quality
source:
  - pilee-history:2026-05-01#7
  - pilee-history:2026-05-02#24
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-09-08-revert-and-i18n-atomicity
reviewed_at: 2026-09-08
reviewed_commit: ff01ad920e4a75d5b9a3ec263e47126ced48926c
related:
  - evidence-first-verification-gate
  - stress-interview-multi-axis-review
---

## Judgment

AI가 빠르게 많은 파일을 바꿀수록 변경 통합은 더 작은 단위와 명확한 검증을 요구합니다. 큰 diff를 한 번에 완성했다고 해서 review 가능하거나 되돌리기 쉬운 것은 아닙니다.

## Integration Rule

한 commit은 하나의 논리적 변경을 담고, formatting/behavior/doc 변경은 가능하면 분리합니다. 100줄 이상을 쓰기 전에 테스트나 타입체크처럼 빠른 검증을 실행합니다. 리뷰는 correctness뿐 아니라 readability, architecture, security, performance를 함께 봅니다.

파일 종류가 다르다는 이유만으로 하나의 기능을 인위적으로 나누지는 않습니다. i18n generator가 만든 언어별 locale snapshot, generated key/type, 관련 테스트, 실제 번역 키 소비 코드는 함께 있어야 사용자 기능이 완성되므로 하나의 companion set으로 커밋합니다. 언어권별·생성/적용별 분리는 독립 배포 근거가 있을 때만 선택합니다.

## Rollback Mode Rule

rollback은 **전체 리버트**, **선택적 롤백**, **커밋 역사 삭제**를 먼저 구분합니다. 전체 리버트는 대상 commit의 patch 전체를 역적용하고 관련 경로의 최종 상태를 확인합니다. 선택적 롤백은 제거·보존 범위를 명시하며 전체 리버트라고 기록하지 않습니다. history rewrite는 사용자가 commit 삭제를 명시한 경우에만 남길 commit과 remote head를 확인한 뒤 `--force-with-lease`로 수행합니다.

이 절차는 범용 하드 게이트가 아닙니다. 후속 정상 변경이 섞이면 부모 tree와 같을 수 없으므로, 검증은 선택한 rollback 모드와 명시한 최종 상태에 비례합니다. 리버트한 경로에서 CI가 실패하면 새 fix를 추가하기 전에 누락된 역적용부터 확인합니다.

## PR Gate Rule

PR 생성과 merge는 다른 통합 단계입니다. agent가 diff를 만들고 검증을 통과시켜도, 사용자가 초기 운영에서 직접 merge하고 싶다고 한 workflow라면 PR URL과 검증 결과를 보고하고 멈춥니다. 자동 merge를 하려면 별도 정책과 자동화 actor가 필요합니다.

## Dirty State Rule

작업 시작과 커밋 직전에는 `git status`를 확인합니다. 현재 작업과 무관한 dirty file은 보존하고, stage에는 관련 파일만 올립니다. local-only 산출물은 `.context/`처럼 명시적으로 ignore된 경로에 두고, PR에는 재현 가능한 코드/문서 변경과 sanitized 요약만 포함합니다.

## Failure Mode

구현 속도에 맞춰 commit discipline을 느슨하게 하면 나중에 어떤 판단이 어떤 변경을 만들었는지 추적할 수 없습니다. 작은 slice와 증거가 AI 변경의 안전한 통합 단위입니다.

반대로 파일 수만 보고 generated i18n companion을 언어권별로 쪼개면 한 기능의 생성물과 소비 코드가 분리되어 review와 revert가 더 어려워집니다. 전체 리버트를 수동 부분 원복으로 대체한 뒤 같은 경로의 CI 실패를 후속 fix로 덮는 것도 원래 변경 경계를 잃는 실패입니다.
