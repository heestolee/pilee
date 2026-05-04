---
name: self-healing
description: Pi/Codex subagent로 stress-interview를 실행한 뒤 worker가 actionable item만 수정하고 재검토를 2사이클 반복하는 자가 치유 스킬. PR 머지 전 자동 안정화, self-review, 품질 개선 루프 때 사용.
argument-hint: "이 변경사항 자동으로 두 번 고쳐가며 안정화해줘 | 방금 만든 코드 self-healing 돌려줘"
---

<PREREQUISITE>
이 스킬을 실행하기 전에 다음을 모두 읽었는지 확인하세요:
- `skills/tft-guidelines/SKILL.md`
- `skills/ask-user-question-rules/SKILL.md`
- `skills/stress-interview/SKILL.md`
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
3. `subagent help`를 먼저 호출해 현재 CLI 인터페이스를 확인한다.
4. **Cycle 1 stress-interview**
   - `subagent batch --main`으로 `verifier` + `reviewer` + `challenger`를 병렬 실행한다.
   - batch 실행 후 즉시 중단하고 자동 완료 알림을 기다린다. 바로 polling하지 않는다.
5. Cycle 1 결과에서 수정이 필요한 actionable item만 추린다 (아래 분류 표 참조).
6. 수정할 항목이 있으면 **`worker`에게 구체적 수정 프롬프트를 전달**한다.

```bash
subagent run worker --main -- "read /tmp/<task>-self-healing-context.md. Cycle 1 stress-interview 결과 중 아래 actionable item만 최소 수정으로 반영해줘: <항목 목록>. 범위 밖 리팩터링은 하지 말고, 수정 후 관련 검증 명령을 실행해 결과를 보고해줘."
```

7. worker 실행 후에는 즉시 중단하고 자동 완료 알림을 기다린다.
8. **Cycle 2 stress-interview**
   - Cycle 1 수정 결과를 컨텍스트 파일 또는 프롬프트에 추가한다.
   - 다시 `subagent batch --main`으로 `verifier` + `reviewer` + `challenger`를 병렬 실행한다.
9. Cycle 2 결과에서 남은 actionable item만 추린다.
10. 수정할 항목이 있으면 다시 `subagent run worker --main -- ...`으로 **남은 항목만** 수정 요청한다.
11. 2사이클 후 종료하고, 남은 리스크와 미해결 항목을 명시한다.

## worker 프롬프트 필수 요소
`worker`에게는 절대 빈 요청을 보내지 않는다. 반드시 아래를 포함한다.

- 대상 저장소/작업 디렉터리
- 수정할 파일 또는 탐색 시작점
- stress-interview에서 나온 actionable item 목록
- 수정하지 말아야 할 범위
- 실행할 검증 명령
- 최종 보고 형식

좋은 예:

```text
read /tmp/task-context.md. CWD는 /path/to/repo.
다음 2개만 수정해:
1. `foo.ts:123`에서 nullable guard 추가
2. `bar.tsx:45`에서 버튼 disabled 조건 수정
범위 밖 리팩터링/스타일 변경은 하지 마.
수정 후 `pnpm test foo`를 실행하고 결과를 보고해.
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
- 회사 product/lambda 레포 파일을 수정해야 하면 현재 세션이 적절한 worktree인지 확인한다. 새 worktree가 필요하면 프로젝트의 worktree 규칙을 따른다.

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

## Cycle 2
- stress-interview 핵심 결과
- worker가 반영한 수정

## Remaining Risks
- 여전히 남은 문제

## Recommendation
- 추가 수동 작업 필요 여부
```

## 주의
- 이 스킬은 자동 수정 루프이므로, 변경 범위 통제가 가장 중요하다.
- 사용자 요청 범위를 벗어나는 리팩터링/정리는 하지 않는다.
- 마지막 상태가 "완벽함"이라고 단정하지 말고, 2사이클 기준의 남은 리스크를 솔직히 적는다.
- frame.json이 있으면 `verify_plan.commands`를 verifier 검증 명령으로 우선 사용한다.
- 이 스킬은 Pi/Codex subagent 기준이다. Claude Code 전용 agent 이름이나 내부 실행 문법을 사용하지 않는다.

## /self-review 별칭

`/self-review`로 호출되면 이 스킬과 동일하게 동작 (창희님 익숙한 명령).
