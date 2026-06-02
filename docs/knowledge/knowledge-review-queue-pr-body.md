---
title: Knowledge review queue는 PR body에 남긴다
tags:
  - knowledge
  - review-queue
  - github-actions
  - pr-body
  - ember-ship
category: knowledge
status: active
confidence: high
applies_to:
  - .github/workflows/knowledge-review-sync.yml
  - extensions/ember-ship
  - skills/pilee-knowledge
  - scripts/knowledge.mjs
source:
  - user-direction:2026-05-13-knowledge-review-pr-body
reviewed_at: 2026-06-02
reviewed_commit: e19936a187aacbbe593bc6ea335a231049a296d1
related:
  - ember-ship-release-train
  - pilee-knowledge-system
  - deterministic-vs-ai-actions
  - freshness-diagnosis-report
  - reviewed-commit-freshness
---

# Knowledge review queue는 PR body에 남긴다

GitHub Actions의 knowledge review queue는 repository doctrine이 아니라 **현재 HEAD 기준으로 다시 읽어야 할 목록**이다. 이 목록을 `docs/knowledge-review.md` 같은 tracked markdown으로 커밋하면 PR diff가 “문서 변경”처럼 보이고, 사용자는 실제 doctrine 변경과 검토 큐 알림을 구분하기 어렵다.

## 판단

Review queue는 PR body에 렌더링한다. Repository에 남기는 파일은 실제 source-of-truth만이어야 한다.

- 실제 doctrine: `docs/knowledge/*.md`
- generated source surfaces: `README.md`, `README.en.md`, `docs/knowledge/README.md`, `tmp/knowledge-map.ko.svg`
- 검토 큐 알림: PR body 또는 GitHub Actions summary

`docs/knowledge-review.md`는 public doctrine도 generated source surface도 아니다. 따라서 자동 workflow가 이 파일을 만들어 PR diff에 넣지 않는다.

## Ember Ship과의 관계

`/ember-ship`은 review queue를 소비하는 release train이다. 성공하면 stale/review_needed 문서가 fresh가 되므로 기존 `auto/pilee-knowledge-sync` PR은 superseded 상태가 된다. `/ember-ship`은 최신 `origin/main`을 다시 확인한 뒤 freshness를 닫고, 열려 있는 auto review queue PR이 있으면 닫거나 최신 상태로 정리해야 한다.

Outdated base에서 confirm-only PR을 만들면, 이후 main에 다른 기능 커밋이 합쳐질 때 review queue가 다시 나타난다. 그래서 `/ember-ship`은 push/merge 직전에 최신 base 반영과 freshness 재검증을 SAFE 조건으로 둔다.

## PR body 규칙

자동 review queue PR body에는 다음을 넣는다.

1. freshness summary
2. deterministic action 수
3. AI/human review action 수
4. stale/review_needed 문서 목록
5. 관련 커밋/히스토리 근거 요약
6. `/ember resolve` 또는 `/ember-ship`으로 해소하는 방법

본문이 길어져도 PR body가 맞다. diff는 실제 repository state 변경만 보여야 한다.

## Review triggers

이 문서는 다음 경우 다시 검토한다.

- knowledge review workflow가 PR 대신 issue/comment/check summary로 바뀔 때
- GitHub Actions가 body-only PR 대신 다른 알림 채널을 쓰게 될 때
- `/ember-ship`이 deterministic runner가 되어 auto queue PR close/update까지 직접 구현할 때
