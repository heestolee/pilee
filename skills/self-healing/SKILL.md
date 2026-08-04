---
name: self-healing
description: Pi/Codex subagent로 stress-interview를 실행한 뒤 worker가 actionable item만 수정하고 재검토를 2사이클 반복하는 자가 치유 스킬. PR 머지 전 자동 안정화와 품질 개선 루프 때 사용.
argument-hint: "이 변경사항 자동으로 두 번 고쳐가며 안정화해줘 | 방금 만든 코드 self-healing 돌려줘"
---

<PREREQUISITE>
이 스킬을 실행하기 전에 다음을 모두 읽었는지 확인하세요:
- `skills/tft-guidelines/SKILL.md`
- `skills/ask-user-question-rules/SKILL.md`
- `skills/stress-interview/SKILL.md`
- `skills/test-boundary-refactor/SKILL.md`
- worker가 테스트를 추가·수정할 수 있으면 `skills/test-boundary-refactor/references/test-refine-runbook.md`
</PREREQUISITE>

# self-healing

`$ARGUMENTS`에 대해 아래 루프를 수행한다.

- **Cycle 1**: Pi/Codex `stress-interview` 실행 → actionable item만 `worker`가 수정
- **Cycle 2**: 다시 Pi/Codex `stress-interview` 실행 → 남은 actionable item만 `worker`가 수정

총 **2 사이클**만 수행한다. 무한 반복하지 않는다.

## 목적
- 초기 구현의 결함, 리스크, 미검증 영역을 빠르게 줄인다.
- `verifier`/`reviewer`/`challenger`의 관점을 `worker` 수정 루프에 반영한다.
- 짧은 자동 안정화 루틴으로 품질을 끌어올린다.

## Pi/Codex 실행 순서
1. 대상 범위를 1~2문장으로 고정한다.
2. 필요하면 긴 컨텍스트를 `/tmp/<task>-self-healing-context.md`에 저장한다.
   - 포함 권장: 목표, 변경 파일, 주요 diff 요약, 검증 명령, PR 링크/리뷰 링크.
3. worker 수정 전 현재 test/product diff와 변경 테스트 목록을 baseline으로 기록한다.
   - `git diff --numstat`, `git ls-files --others --exclude-standard`를 사용해 tracked/untracked 테스트를 모두 센다.
   - 기존 테스트 파일 수, 추가 test case 수, test/product churn을 컨텍스트에 남긴다.
   - 이전 커밋이나 현재 branch에서 같은 spec을 noise로 삭제한 기록이 있으면 worker 금지사항에 포함한다.
4. `subagent help`를 먼저 호출해 현재 CLI 인터페이스를 확인한다.
5. **Cycle 1 stress-interview**
   - `subagent batch --main`으로 `verifier` + `reviewer` + `challenger`를 병렬 실행한다.
   - batch 실행 후 즉시 중단하고 자동 완료 알림을 기다린다. 바로 polling하지 않는다.
6. Cycle 1 결과에서 수정이 필요한 actionable item만 추린다 (아래 분류 표 참조).
7. 수정할 항목이 있으면 **`worker`에게 구체적 수정 프롬프트를 전달**한다.

```bash
subagent run worker --main -- "read /tmp/<task>-self-healing-context.md. Cycle 1 stress-interview 결과 중 아래 actionable item만 최소 수정으로 반영해줘: <항목 목록>. 기존 spec을 우선 재사용하고 finding마다 테스트를 1:1로 추가하지 마. 신규 spec이 필요하면 닫히지 않은 contract와 기존 테스트로 대체할 수 없는 이유를 먼저 보고해. 범위 밖 리팩터링은 하지 말고, 수정 후 관련 검증 명령을 실행해 결과를 보고해줘."
```

8. worker 실행 후에는 즉시 중단하고 자동 완료 알림을 기다린다.
9. **Cycle 1 Test Change Gate**를 적용한다. gate가 걸리면 Cycle 2 전에 main agent가 같은 사이클에서 테스트를 직접 정리한다.
10. **Cycle 2 stress-interview**
   - Cycle 1 수정 결과와 Test Change Gate 판정을 컨텍스트 파일 또는 프롬프트에 추가한다.
   - 다시 `subagent batch --main`으로 `verifier` + `reviewer` + `challenger`를 병렬 실행한다.
11. Cycle 2 결과에서 남은 actionable item만 추린다.
12. 수정할 항목이 있으면 다시 `subagent run worker --main -- ...`으로 **남은 항목만** 수정 요청한다.
13. Cycle 2 worker 뒤에도 Test Change Gate를 다시 적용하고, 테스트 noise를 남긴 채 종료하지 않는다.
14. 2사이클 후 종료하고, 남은 리스크와 미해결 항목을 명시한다.
15. UI/responsive/nav/typography처럼 화면 회귀 가능성이 있는 수정이 포함되면 캡처를 직접 수행하지 말고 **`/verify-report` 권장 여부와 추천 검증 축**만 남긴다. 예: `mobile 390px + breakpoint 500px + desktop 1440px`, `collapsed/expanded nav`, `computed typography`.

## worker 프롬프트 필수 요소
`worker`에게는 절대 빈 요청을 보내지 않는다. 반드시 아래를 포함한다.

- 대상 저장소/작업 디렉터리
- 수정할 파일 또는 탐색 시작점
- stress-interview에서 나온 actionable item 목록
- 수정하지 말아야 할 범위
- 실행할 검증 명령
- 최종 보고 형식
- 테스트를 건드린다면 재사용할 기존 spec과 닫아야 할 contract
- 신규 spec 금지 여부, 허용할 신규 test case 수, 이전에 noise로 삭제한 테스트 유형
- 테스트 변경 파일·추가 case·test/product diff를 분리한 최종 보고

좋은 예:

```text
read /tmp/task-context.md. CWD는 /path/to/repo.
다음 2개만 수정해:
1. `foo.ts:123`에서 nullable guard 추가
2. `bar.tsx:45`에서 버튼 disabled 조건 수정
범위 밖 리팩터링/스타일 변경은 하지 마.
테스트는 기존 `foo.service.spec.ts`의 대표 계약 1개만 보강하고 신규 spec은 만들지 마.
수정 후 `pnpm test foo`를 실행하고 제품 코드와 테스트 diff를 분리해 보고해.
```

나쁜 예:

```text
무언가 해봐
고쳐줘
self-healing 이어서 해
```

## worker 지시 원칙
- stress-interview 결과 중 **구체적이고 재현 가능하며 수정 가치가 높은 항목만** 반영한다.
- 모호한 주장, 근거 부족 항목, 의도된 변경으로 보이는 항목은 자동 수정하지 않는다.
- 수정 범위를 불필요하게 넓히지 않는다.
- 각 사이클마다 가능한 최소 수정으로 진행한다.
- 회사/업무 레포 파일을 수정해야 하면 현재 세션이 적절한 worktree인지 확인한다. 새 worktree가 필요하면 해당 repo profile/project의 worktree 규칙을 따른다.

## Test Change Gate

self-healing의 테스트 비용은 사용자가 사후에 덜어내는 대상이 아니다. 각 worker 결과를 main agent가 Cycle 안에서 정리한다.

다음 중 하나면 gate가 걸린다.

- worker가 신규 spec/test 파일을 만들었다.
- 한 사이클에서 신규 test case를 3개 이상 추가했다.
- 한 사이클의 테스트 추가 줄이 제품 코드 추가 줄보다 많거나, 테스트 churn이 전체 worker churn의 절반을 넘었다.
- 같은 shared policy를 create/update/delete/resolver 등 여러 경로에서 반복 검증한다.
- `invocationCallOrder`, 정확한 mock 호출 횟수·중간 객체처럼 구현 세부 assertion을 여러 테스트에서 반복한다.
- git history나 작업 컨텍스트에서 noise로 삭제했던 spec 유형을 명시적 새 contract 없이 다시 만들었다.

Gate가 걸리면 다음 순서로 처리한다.

1. 각 테스트가 깨졌을 때 어떤 사용자/시스템 contract가 깨지는지 한 문장으로 적는다.
2. 기존 spec 보강 → table-driven/pure logic test → 작은 boundary contract test 순서로 대체 가능성을 본다.
3. shared policy는 대표 경로 1개만 남긴다. finding 하나당 테스트 하나를 추가하지 않는다.
4. lock/transaction 순서가 correctness contract여도 mock 순서 검증은 대표 1개로 제한한다. 실제 DB 동시성은 integration GAP으로 남기며 mock 테스트 수로 덮지 않는다.
5. contract가 중복되거나 구현 세부에 묶인 테스트는 main agent가 즉시 삭제·통합한다. 사용자에게 다이어트를 요청하지 않는다.
6. 신규 spec이 정말 필요하면 기존 테스트 레벨로 닫히지 않는 이유와 추가 line/case 비용을 최종 보고에 남긴다.

Gate는 테스트를 무조건 적게 만드는 규칙이 아니다. 결제·권한·데이터 무결성처럼 독립 contract가 여러 개면 테스트가 제품 코드보다 클 수 있지만, 그 경우에도 각 contract가 명시적으로 달라야 한다.

## 사이클별 분류 표
stress-interview 결과에서 `severity`/`priority`와 `fix_class`를 활용하여 분류한다.

| 분류 | 조건 | 처리 |
|------|------|------|
| **Must fix now (auto)** | Critical/P0/P1 + fix_class `AUTO_FIX` | worker가 즉시 수정 |
| **Must fix now (escalate)** | Critical/P0/P1 + fix_class `ASK` | 자동 수정하지 않고 사용자에게 에스컬레이션 |
| **Good to fix** | Important/Minor/P2/P3 + fix_class `AUTO_FIX` | maintainability / clarity / low-risk cleanup |
| **Report as remaining risk** | Important/Minor/P2/P3 + fix_class `ASK` | Remaining Risks에 기록만 |
| **Do not auto-fix** | fix_class `INFO`, 근거 부족, 대규모 설계 변경 | 무시 |

reviewer가 `fix_class`를 제공하지 않으면 기존 심각도(Critical/Important/Minor)로 폴백한다.

## 종료 조건
다음 중 하나면 종료한다.

- 2사이클 완료
- 수정할 actionable item이 더 이상 없음
- worker가 범위 초과/불명확성으로 중단함
- subagent 실행이 error/interrupted 상태로 끝나 원인 분석이 필요한 경우

## 최종 응답 형식

```markdown
## Cycle 1
- stress-interview 핵심 결과
- worker가 반영한 수정
- Test Change Gate 판정과 정리 결과

## Cycle 2
- stress-interview 핵심 결과
- worker가 반영한 수정
- Test Change Gate 판정과 정리 결과

## Test Diff
- baseline → final test files / cases / additions / deletions
- 제품 코드와 테스트 churn 비교

## Remaining Risks
- 여전히 남은 문제

## Recommendation
- 추가 수동 작업 필요 여부
- UI 변경이 있으면 `/verify-report` 권장 여부와 추천 coverage axis
```

## 주의
- 이 스킬은 자동 수정 루프이므로, 변경 범위 통제가 가장 중요하다.
- 사용자 요청 범위를 벗어나는 리팩터링/정리는 하지 않는다.
- 마지막 상태가 "완벽함"이라고 단정하지 말고, 2사이클 기준의 남은 리스크를 솔직히 적는다.
- frame.json이 있으면 `verify_plan.commands`를 verifier 검증 명령으로 우선 사용한다.
- Test Change Gate를 통과하거나 main agent가 noise를 정리하기 전에는 self-healing 완료로 보고하지 않는다.
- 테스트 다이어트 자체를 사용자 결정으로 에스컬레이션하지 않는다. 서로 다른 제품 contract 중 무엇을 보존할지 애매할 때만 묻는다.
- 이 스킬은 Pi/Codex subagent 기준이다. Claude Code 전용 agent 이름이나 내부 실행 문법을 사용하지 않는다.
