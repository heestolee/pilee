---
title: Runtime fan-out은 healthcheck 뒤의 실행 계약이다
tags:
  - runtime
  - fanout
  - healthcheck
  - deployment
  - triage
  - root-cause
category: runtime
status: active
confidence: high
applies_to:
  - skills/runtime-fanout-triage
  - skills/ci-ship
  - skills/systematic-debugging
source:
  - user-direction:2026-05-28-runtime-fanout-triage
reviewed_at: 2026-06-02
reviewed_commit: 91c739fbe51a72bee9c2a27aa4e3923da9fd4c03
related:
  - root-cause-before-fix
  - deterministic-fallbacks-preserve-workflow
  - private-overlay-package-boundary
---

## Judgment

Runtime healthcheck 실패는 대부분 마지막 probe의 실패이지 root cause가 아닙니다. 배포·preview·worker·queue·router가 여러 실행 주체로 fan-out 되는 구조에서는 “endpoint가 안 뜬다”보다 “어떤 trigger가 어떤 runner/orchestrator/upstream/contract 조합을 만들었는가”를 먼저 복원해야 합니다.

## Fan-out Rule

진단은 final symptom에서 시작하되, 곧바로 fan-out map을 작성합니다.

| Layer | 판단 질문 |
|---|---|
| Trigger | 어떤 PR, workflow, deploy, event, queue message가 시작점인가? |
| Fan-out | 변경 파일, matrix, service detection, routing rule이 무엇을 선택했는가? |
| Delegation | 실제 실행을 위임받은 preview server, scheduler, orchestrator, router가 있는가? |
| Runtime | 요청은 어느 container, function, process, worker, router로 가야 하는가? |
| Infra | DNS, load balancer, target, task, function alias, queue consumer는 살아 있는가? |
| Contract | local/upstream schema, env, generated artifact, version pair가 호환되는가? |
| Reproduction | 전체 deploy 없이 더 작은 contract failure로 재현할 수 있는가? |

이 표가 없으면 cloud log와 코드 검색을 많이 해도 같은 증상 주변만 맴돌기 쉽습니다.

## Reproduction Rule

가능하면 전체 배포를 다시 돌리지 않고 contract만 재현합니다.

- Federation/router 실패는 changed subgraph와 upstream subgraph SDL로 compose합니다.
- Matrix/monorepo build 실패는 wrapper가 선택한 exact package/axis만 실행합니다.
- Worker 실패는 event/message shape와 consumer entrypoint validation으로 줄입니다.
- Load balancer 503은 target health가 healthy인지 먼저 분리한 뒤, upstream app/router/container 계약으로 이동합니다.

이 접근은 cloud provider, CI vendor, preview server의 종류와 무관합니다. AWS CLI나 GitHub CLI는 fan-out map을 채우는 도구일 뿐, 원인 레이어 자체가 아닙니다.

## Private Profile Boundary

Public pilee에는 generic fan-out 절차만 둡니다. 회사별 workflow 이름, endpoint 패턴, AWS account/region, ALB 이름, schema fetch URL, repository path는 private overlay profile에서 제공합니다.

Generic skill은 private profile이 있으면 읽어 적용하되, profile이 없더라도 fan-out map과 최소 재현 원칙은 유지해야 합니다.

## Failure Mode

Healthcheck step의 attempt count만 반복해서 보면 “왜 안 떴는지”가 아니라 “언제까지 안 떴는지”만 알게 됩니다. 반대로 fan-out map과 contract reproduction을 먼저 만들면 runtime 로그 접근 권한이 없어도 compose mismatch, routing target absence, generated artifact staleness 같은 원인을 작게 확정할 수 있습니다.
