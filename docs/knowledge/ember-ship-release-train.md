---
title: Ember Ship은 knowledge 정합성을 release train으로 닫는다
tags:
  - ember
  - knowledge
  - release-train
  - freshness
  - merge-gate
category: knowledge
status: active
confidence: high
applies_to:
  - extensions/ember-ship
  - extensions/ember
  - skills/pilee-knowledge
  - skills/pilee-final-check
  - scripts/knowledge.mjs
source:
  - user-direction:2026-05-12-ember-ship
reviewed_at: 2026-06-02
reviewed_commit: 91c739fbe51a72bee9c2a27aa4e3923da9fd4c03
related:
  - ember-friendly-knowledge-entrypoint
  - pilee-knowledge-system
  - freshness-diagnosis-report
  - deterministic-vs-ai-actions
  - pilee-final-check-gate
  - private-journal-public-doctrine
---

# Ember Ship은 knowledge 정합성을 release train으로 닫는다

`/ember-ship`은 `Ember`의 후보 수집/작성 진입점이 아니라, 이미 반복 패턴이 된 knowledge maintenance를 한 번에 닫는 release train이다.

## 판단

Knowledge 정합성 갱신은 `check → resolve → generated sync → history/Notion → final-check → push/merge`가 매번 반복된다. 이 루틴은 사용자가 매번 worktree, batch size, generated artifact, Notion sync, merge gate를 기억해야 할 일이 아니다.

따라서 `/ember-ship`은 명시 실행 시 merge 의도가 있는 자동화로 해석한다. 단, 자동 merge는 SAFE gate를 통과한 경우에만 가능하다. 판단이 필요한 stale 문서, public/private boundary, README 철학 변경, validation 실패, Notion sync 실패는 BLOCKED 상태로 전환하고 PR URL을 남긴다.

## 노출 계층

`/ember-ship`만 사용자-facing command로 노출한다. 실행 계약은 `extensions/ember-ship/WORKFLOW.md`에 보관하고 extension shim이 직접 inline한다. 이 계약 파일은 Pi skill discovery 경로 밖에 있어야 하며, `/skill:ember-ship`처럼 같은 workflow가 두 진입점으로 보이지 않게 한다.

## Release train 계약

1. 별도 worktree와 short-lived branch에서 시작한다.
2. stale/review_needed 문서는 batch당 8개 이하로 처리한다.
3. 각 batch는 문서 수정 또는 confirm-only 근거를 갖고 commit 1개로 저장한다.
4. generated surfaces는 CLI로만 갱신한다.
   - `README.md`
   - `README.en.md`
   - `docs/knowledge/README.md`
   - `tmp/knowledge-map.ko.svg`
5. local pilee-history와 Notion sync까지 닫는다.
6. `pilee-final-check`로 diff, generated freshness, package lockstep, push 상태를 다시 본다.
7. SAFE이면 main merge/push까지 진행한다.
8. BLOCKED이면 branch를 push하고 PR URL을 사용자에게 준다.

## 왜 `/ember resolve`와 분리하나

`/ember resolve`는 stale 문서 해소를 위한 power-user entrypoint다. 한 batch의 resolver plan을 만들고, 문서를 읽고, 수정 또는 `--confirm`을 수행하는 데 집중한다.

반면 `/ember-ship`은 release orchestration이다. 여러 resolver batch를 반복하고, generated artifact와 기록/동기화/merge까지 포함한다. 즉 `resolve`는 작업 단위이고, `ship`은 배포 단위다.

## Guardrail

자동화가 강해질수록 merge actor와 판단 책임이 섞이기 쉽다. `/ember-ship`은 다음을 지킨다.

- 사용자 판단이 필요한 문서는 자동 confirm하지 않는다.
- private session path, raw history, local freshness JSON은 public PR/doc에 복사하지 않는다.
- README generated block은 자동 갱신 가능하지만, README 철학/브랜딩 narrative는 사용자 판단 영역이다.
- Notion/history sync가 이 workflow의 일부로 명시됐으므로 sync 실패는 SAFE merge 조건을 깨는 blocker다.
- BLOCKED 상태는 실패가 아니라 수동 merge를 위한 안전 정지다.

## Review triggers

이 문서는 다음 경우 다시 검토한다.

- `/ember-ship`이 deterministic runner로 바뀌어 agent prompt가 아닌 코드가 직접 batch를 수행할 때
- Notion/history sync가 public interface나 private overlay profile로 구조화될 때
- bot/GitHub Actions merge actor가 도입되어 개인 계정 merge와 자동 merge가 분리될 때
- knowledge freshness가 stale 후보를 줄이는 방식이나 generated exclusion 규칙을 바꿀 때
