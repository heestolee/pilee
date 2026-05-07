---
title: 로컬 개발 서버 시작은 진단 가능한 절차여야 한다
tags:
  - local-dev
  - server
  - startup
  - diagnosis
  - dev
category: workflow
status: active
confidence: high
applies_to:
  - skills/start-local-dev
source:
  - pilee-history:2026-05-01#dev-server-analysis
  - session-backfill:2026-05-01#local-dev
reviewed_at: 2026-05-07
reviewed_commit: 264ea1727c5c7defa23e8452c8c4ccd801959235
related:
  - root-cause-before-fix
  - worktree-execution-boundary
  - private-overlay-package-boundary
---

## Judgment

로컬 개발 서버를 띄우는 작업은 단순히 명령을 실행하는 것이 아니라 실패했을 때 원인을 좁힐 수 있는 절차여야 합니다. 포트, env, workspace, package manager, generated schema가 섞이면 재시도만으로 해결되지 않습니다.

## Startup Rule

서버 시작 전 repo/worktree 위치, 의존성 설치 상태, 필요한 env, codegen/schema 상태, 이미 떠 있는 프로세스를 확인합니다. 실패하면 로그의 마지막 에러만 보지 말고 어떤 단계에서 멈췄는지 기록합니다.

고정 포트, 서비스 간 gRPC/REST host, repo별 start command처럼 특정 회사/프로젝트에 묶인 지식은 private/project overlay skill에 둡니다. Public `start-local-dev`는 진단 절차만 유지합니다.

## Failure Mode

“다시 start”를 반복하면 좀비 프로세스와 포트 충돌만 늘어납니다. start-local-dev는 실행 명령보다 진단 순서가 핵심입니다.
