---
title: 최종 검증은 메인 세션을 막지 않고 병렬화한다
tags:
  - verification
  - ship
  - final-check
  - subagent
  - background
  - parallel
category: workflow
status: active
confidence: high
applies_to:
  - skills/ship
  - skills/pilee-final-check
  - extensions/subagent
source:
  - user-direction:2026-05-13-final-verification-parallel
reviewed_at: 2026-06-02
reviewed_commit: c6cd06fdfbd276127b92c33ecbf9d12d71fb8a41
related:
  - ai-worker-readiness-orchestrator
  - subagent-prompt-specificity
  - subagent-skill-delegation
  - evidence-first-verification-gate
  - change-integration-discipline
---

## Judgment

최종 확인은 증거가 필요하지만, 모든 검증을 메인 세션에서 순차 실행해야 한다는 뜻은 아닙니다. 사용자가 다음 판단을 이어갈 수 있는데도 전체 lint/build/test를 메인 턴에서 붙잡아 두면 workflow 품질이 떨어집니다.

검증은 **foreground / parallel / deferred**로 분리합니다.

## Split Rule

- **foreground**: 커밋 전후 즉시 판단에 필요한 짧은 검증입니다. 예: `git diff --check`, 변경 파일 대상 unit test, 변경 TS 파일 syntax check.
- **parallel**: 오래 걸리지만 순수 검증인 명령입니다. 예: 전체 lint, 전체 build, 전체 test, 여러 package 검증. 기본은 `verifier` subagent 또는 명시적 background artifact로 위임합니다.
- **deferred**: 로컬 비용이 과도하거나 CI/수동 환경이 더 강한 검증입니다. 완료처럼 포장하지 않고 조건과 재개 방법을 남깁니다.

## Delegation Contract

병렬 검증을 위임할 때 main agent는 다음을 반드시 넘깁니다.

1. 기준 `HEAD` SHA와 `git status --short` 결과
2. 정확한 검증 명령과 cwd
3. read-only 경계: 코드 수정, formatter, codegen, commit, push 금지
4. 기대 산출물: PASS/FAIL/PARTIAL, 명령별 exit code, 핵심 로그, unrelated baseline 여부
5. 완료 후 main이 다시 읽고 최종 판정한다는 ownership

Subagent launch 자체는 PASS가 아닙니다. 완료 follow-up 또는 artifact를 읽기 전에는 “parallel 검증 진행 중”으로만 보고합니다.

## Failure Mode

긴 검증을 습관적으로 메인 세션에서 실행하면 사용자가 다음 질문을 못 하고, agent는 기다리는 동안 workflow ownership을 잃습니다. 반대로 검증을 전부 생략하면 evidence-first gate가 깨집니다. 병렬화는 검증을 줄이는 장치가 아니라, 증거 수집의 blocking cost를 낮추는 장치입니다.
