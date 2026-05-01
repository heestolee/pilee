---
name: self-review
description: self-healing의 별칭 — verifier/reviewer/challenger 3축 압박 검토 + 자동 수정 2사이클.
argument-hint: "변경사항 검토하고 고쳐줘 | self-review 돌려줘"
---

# self-review

`/skill:self-healing $ARGUMENTS`을 호출한다.

`/self-review`는 `/self-healing`의 별칭으로 제공되는 친숙한 이름이다. 실제 동작은 동일하다:

1. `verifier` + `reviewer` + `challenger` 병렬 압박 검토 (stress-interview)
2. 결과 기반으로 worker 자동 수정
3. 2사이클 반복 후 종료

상세 동작은 `skills/self-healing/SKILL.md` 참조.
