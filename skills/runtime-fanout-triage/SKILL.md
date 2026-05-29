---
name: runtime-fanout-triage
description: Runtime/preview/deployment healthcheck, 5xx, timeout, CI deploy, worker, orchestrator, queue, load balancer, federation compose처럼 마지막 증상 뒤에 여러 실행 주체가 fan-out 되는 실패를 분석할 때 사용한다. "프리뷰가 안 떠", "헬스체크 실패", "내 PR만 배포 실패", "upstream이 안 붙어", "AWS/ECS/Lambda/ALB/GraphQL compose 원인 봐줘" 요청에서 마지막 증상 대신 fan-out map과 최소 재현으로 root cause를 좁힌다.
argument-hint: "[PR/check URL | endpoint | run id | symptom]"
disable-model-invocation: false
---

# Runtime Fan-out Triage

Healthcheck 실패, 5xx, timeout, preview/deploy 실패를 “마지막 증상”으로만 보지 않고, 실제 실행 주체들이 어떻게 fan-out 되었는지 재구성해 root cause를 좁힌다.

## Core rule

**마지막 probe 실패는 root cause가 아니다.** 먼저 어떤 trigger가 어떤 orchestrator/runner/runtime/upstream/contract로 fan-out 되었는지 표로 만든 뒤, 가장 작은 관찰 가능한 실패로 재현한다.

## When to use

사용자가 아래처럼 말하면 이 스킬을 사용한다.

- PR preview/backend preview/frontend preview가 안 뜬다.
- 배포는 됐는데 healthcheck만 실패한다.
- endpoint가 503/502/timeout인데 원인을 모르겠다.
- 내 PR/branch에서만 runtime이 안 뜬다.
- GitHub Actions, ECS, Lambda, ALB, queue, worker, Apollo Router/Federation, schema/codegen 조합이 얽혀 있다.
- AWS CLI, cloud logs, GitHub Actions logs, local reproduction 중 어디부터 볼지 정해야 한다.

## Non-goals

- 바로 코드 수정부터 하지 않는다.
- CI rerun, deploy rerun, preview 삭제/재생성, force push 같은 write side effect는 사용자가 명시하지 않으면 하지 않는다.
- cloud tool list, broad log stream, repo-wide history scan으로 시작하지 않는다.

## Workflow

### 1. Capture the failing probe

먼저 실패 표면을 좁게 고정한다.

| Field | Examples |
|---|---|
| Trigger | PR number, run/job URL, deployment id, branch, commit |
| Probe | healthcheck command, endpoint, payload, expected status |
| Observed | HTTP status/body, timeout, DNS, CI step line, error text |
| Time window | failed-at, deploy-at, first bad attempt |

직접 probe할 수 있으면 같은 payload로 1회만 재현한다. 예: `curl -i`, GraphQL `{ __typename }`, queue status query.

### 2. Build the fan-out map

아래 표를 반드시 작성한다. 모르는 칸은 `unknown`으로 표시하고, 그 unknown을 다음 조회 대상으로 삼는다.

| Layer | Question |
|---|---|
| Trigger | 어떤 workflow/job/deploy가 시작했나? |
| Fan-out | 변경/입력에 따라 어떤 service/package/matrix/queue shard가 선택됐나? |
| Delegation | 실제 배포/실행을 위임받은 orchestrator가 있나? |
| Runtime | 최종 endpoint/request는 어느 process/container/function/router로 가나? |
| Infra | DNS/LB/target/task/log group/queue consumer는 살아 있나? |
| Contract | local vs upstream, schema, env, version, generated artifact 조합이 맞나? |
| Reproduction | infra 밖에서 더 작은 실패로 재현할 수 있나? |

### 3. Read from outside to inside

권장 순서:

1. CI/job log에서 fan-out 변수 추출: changed service, image tag, environment, endpoint, matrix axis.
2. endpoint를 직접 probe해 HTTP/DNS/TLS/LB 단계인지 확인.
3. infra read-only 조회로 routing boundary를 분리: LB target health, task/function status, log group existence.
4. orchestrator contract 확인: entrypoint, task payload, worker route, queue binding, router compose input.
5. runtime contract를 최소 재현: schema compose, version pair, env-derived URL, generated artifact diff, queue message shape.

Cloud/AWS/GitHub CLI는 **도구 레이어**다. 원인은 보통 “cloud가 실패했다”가 아니라 fan-out contract 중 한 축의 불일치다.

### 4. Reproduce the contract, not the whole deploy

가능하면 전체 deploy를 다시 돌리지 말고 contract만 재현한다.

Examples:

- Federation/router: changed subgraph schema + upstream subgraph SDL로 compose.
- Matrix build: failing package의 exact command와 same env/matrix axis만 실행.
- Worker/queue: sample message shape + consumer entrypoint parse/validation.
- LB 503: LB target health가 healthy이면 upstream app/router/container contract로 이동.
- Lambda: event fixture + deployed env/version alias 확인 후 handler-level repro.

### 5. Stop lines

아래 중 하나에 도달하면 멈추고 보고한다.

- Root cause가 재현 가능한 에러로 닫힘.
- Infra는 정상이고 orchestrator 내부 로그 접근 권한이 없어 blocked.
- fan-out map의 핵심 unknown이 남아 사용자/권한/담당자 입력이 필요함.
- 같은 log family나 cloud surface를 2회 봐도 새 정보가 없음.

## Tool guidance

- GitHub Actions: `gh run view --log`에서 failed step만 보되, fan-out 변수는 전체 step env/log에서 추출한다.
- AWS/cloud: read-only로 `sts`, DNS, LB target health, task/function status, log groups를 먼저 본다. SSH/SSM/exec/delete/rerun은 명시 승인 없이는 하지 않는다.
- Local repo: workflow/entrypoint/config 파일을 읽어 delegation contract를 확인한다.
- Reproduction: direct executable/CLI를 선호한다. wrapper script가 fan-out을 숨기면 먼저 wrapper를 읽는다.
- Subagents: GitHub log, cloud routing, contract reproduction을 병렬 소유할 때만 사용한다. 표준 단건 triage에는 기본 사용하지 않는다.

## Output format

```markdown
## 결론
- <마지막 증상이 아니라 root cause 또는 blocked boundary>

## Fan-out map
| Layer | Finding | Evidence |
|---|---|---|
| Trigger | ... | ... |
| Fan-out | ... | ... |
| Delegation | ... | ... |
| Runtime | ... | ... |
| Infra | ... | ... |
| Contract | ... | ... |
| Reproduction | ... | ... |

## 근거
- <command/log/probe 결과 요약>

## 다음 조치
- <fix, rerun, 권한 요청, 담당자 escalation 중 하나>
```

## Edge cases

- **Only my PR fails**: 먼저 base/latest successful run과 다른 fan-out axis를 찾는다. 코드 diff보다 changed service/matrix/upstream version 조합이 원인일 수 있다.
- **Healthcheck all attempts failed**: attempt count 자체보다 첫 probe의 status/body와 runtime target existence를 본다.
- **Cloud access limited**: 접근 불가를 root cause로 말하지 말고, 어디까지 확인했고 어느 boundary 이후가 blocked인지 표시한다.
- **Local repro passes**: local이 실제 fan-out 조합과 같은지 확인한다. local all-services와 preview changed-only 조합은 다를 수 있다.
- **Generated/schema mismatch**: generated file 수정을 손으로 하지 말고 source-of-truth와 generator/compose contract를 확인한다.

## Validation checklist

최종 보고 전에 확인한다.

- [ ] 마지막 증상과 root cause를 분리했다.
- [ ] fan-out map 7개 layer 중 unknown을 숨기지 않았다.
- [ ] 최소 하나의 직접 probe 또는 log evidence가 있다.
- [ ] cloud/AWS/GitHub CLI 결과를 원인으로 단정하지 않고 contract와 연결했다.
- [ ] write side effect를 실행하지 않았다. 실행했다면 사용자 명시 요청이 있었다.
