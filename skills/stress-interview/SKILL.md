---
name: stress-interview
description: Pi/Codex subagent의 verifier + reviewer + challenger를 병렬 호출해 동일 변경사항을 다각도로 검토받는 스킬. PR 전 점검, self-healing 전 검토, 코드 변경 스트레스 테스트 때 사용.
argument-hint: "이 변경사항 검토해줘 | 방금 수정한 코드 스트레스 테스트 | PR 전 점검"
---

<PREREQUISITE>
이 스킬을 실행하기 전에 다음을 모두 읽었는지 확인하세요:
- `skills/tft-guidelines/SKILL.md` — 언제 묻고 언제 안 묻을지
- `skills/ask-user-question-rules/SKILL.md` — 어떻게 물을지
</PREREQUISITE>

# stress-interview

`$ARGUMENTS`에 대해 **Pi/Codex subagent `verifier` + `reviewer` + `challenger`를 병렬 호출**해 교차 검토한다.

## 목적
- 구현/수정 사항을 배포 전 관점에서 압박 검토한다.
- 실행 증거, 코드 리뷰, 반론/리스크를 동시에 수집한다.
- 한 에이전트의 편향을 줄이고, 겹치는 지적과 상충 지적을 비교한다.

## Pi/Codex 실행 규칙
1. 먼저 검토 대상을 1~2문장으로 재정의한다.
2. 필요하면 긴 컨텍스트를 `/tmp/<task>-stress-context.md`에 저장한다.
   - 포함 권장: 목표, 변경 파일, 주요 diff 요약, 검증 명령, PR 링크/리뷰 링크.
3. `subagent help`를 먼저 호출해 현재 CLI 인터페이스를 확인한다.
4. 아래 형식으로 **한 번의 batch**를 실행한다.

```bash
subagent batch --main \
  --agent verifier --task "read /tmp/<task>-stress-context.md. <검증 요청>" \
  --agent reviewer --task "read /tmp/<task>-stress-context.md. <코드 리뷰 요청>" \
  --agent challenger --task "read /tmp/<task>-stress-context.md. <리스크 검토 요청>"
```

5. batch 실행 후에는 즉시 중단하고 자동 완료 알림을 기다린다. 바로 `runs/status/detail`로 polling하지 않는다.
6. 결과가 돌아오면 아래 기준으로 정리한다.
   - 공통 지적: 둘 이상이 비슷하게 지적한 항목
   - 독립 지적: 한 에이전트만 찾은 항목이지만 타당한 항목
   - 상충 지적: 서로 결론이 다른 부분
7. 에이전트 결과를 **있는 그대로 요약**하고, 근거 없이 임의 판정하지 않는다.

## 권장 subagent 프롬프트
- `verifier`: "$ARGUMENTS 를 검증해줘. 가능하면 테스트/타입체크/빌드/재현 가능한 증거를 수집해줘. 실행한 명령과 결과를 PASS/FAIL로 정리해줘."
- `reviewer`: "$ARGUMENTS 를 코드 리뷰해줘. correctness, regression, maintainability 위주로 봐줘. 각 이슈에 severity와 fix_class(AUTO_FIX/ASK/INFO)를 붙여줘."
- `challenger`: "$ARGUMENTS 에 대해 숨은 가정, 실패 시나리오, 취약한 결정 포인트를 최대 5개로 압박 검토해줘. 각 리스크에 severity와 fix_class(AUTO_FIX/ASK/INFO)를 붙여줘."

## 종합 응답 형식
최종 응답은 아래 순서로 간단히 정리한다.

1. `Overall`
   - Ready | Needs changes | Blocked
2. `Common Findings`
   - 공통 지적만 추림
3. `Verifier`
   - 핵심 검증 결과와 실행 증거
4. `Reviewer`
   - 핵심 리뷰 결과
5. `Challenger`
   - 핵심 질문/리스크
6. `Severity Classification`
   - 🔴 Must-fix: blocker, correctness 오류, 재현 가능한 버그
   - 🟡 Should-fix: maintainability, clarity, 저위험 개선
   - ⚪ Won't-fix: 근거 부족, 의도된 설계, 대규모 변경 필요
7. `Recommended Next Step`
   - 수정 필요 시 가장 먼저 할 일 1~3개

## 2-Pass 리뷰 모드

`$ARGUMENTS`에 `--2pass` 또는 "2단계 리뷰"가 포함되면 아래 순서를 따른다.

### Pass 1: Spec Compliance (명세 적합성)
목적: 구현이 요구사항/계획/명세를 **정확히** 충족하는지 확인.

1. `subagent batch --main`으로 `verifier` + `reviewer`만 병렬 호출한다.
   - `verifier`: 명세 대비 구현 일치 여부 검증
   - `reviewer`: 요구사항 누락/초과 구현 집중 리뷰
2. 판정:
   - **누락(Under-built)**: 명세에 있는데 구현에 없는 것
   - **초과(Over-built)**: 명세에 없는데 구현에 있는 것 → YAGNI 위반
3. 누락/초과가 있으면 수정 후 Pass 1을 재실행한다.

### Pass 2: Code Quality (코드 품질)
**Pass 1 통과 후에만** 진행한다.

1. `subagent batch --main`으로 `reviewer` + `challenger`를 병렬 호출한다.
   - `reviewer`: correctness, regressions, maintainability 리뷰
   - `challenger`: 숨은 가정, 실패 시나리오 압박 검토
2. Critical/Important 이슈는 수정 후 Pass 2를 재실행한다.
3. Minor 이슈는 기록만 하고 통과할 수 있다.

**주의: Pass 1 전에 Pass 2를 시작하지 않는다.** 명세 미충족 상태에서 코드 품질을 논하는 것은 무의미하다.

## 주의
- 3개 결과가 모두 오기 전 성급히 결론 내리지 않는다.
- `verifier`가 실행 증거를 못 모으면 그 사실을 명시한다.
- `challenger`의 질문은 가설일 수 있으므로, 검증된 사실과 구분해서 표시한다.
- 사용자가 단순 요약만 원하면 장황하게 재서술하지 말고 핵심만 정리한다.
- 이 스킬은 Pi/Codex subagent 기준이다. Claude Code 전용 agent 이름이나 내부 실행 문법을 사용하지 않는다.
