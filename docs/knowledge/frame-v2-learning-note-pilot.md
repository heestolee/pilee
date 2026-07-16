---
title: Frame v2는 이해를 학습노트로 만든 뒤 작업 계약으로 승격한다
tags:
  - frame-v2
  - frame
  - study-hard
  - learning-note
  - tft-studio
  - worktree
category: workflow
status: active
confidence: high
applies_to:
  - extensions/frame-v2
  - skills/frame-v2
  - extensions/frame-studio
  - extensions/study-hard
source:
  - user-direction:2026-07-17-frame-v2-learning-note-pilot
reviewed_at: 2026-07-17
reviewed_commit: 79dc80b3cf3fe9f4560c66ad973c087a0504e8fb
related:
  - frame-verify-contract
  - frame-studio-interactive-decision-ui
  - tft-visual-structure-renderer
  - source-grounded-frame-planning
  - worktree-session-continuity
  - study-hard-public-engine-private-publisher
---

## Judgment

Frame와 Study Hard를 하나의 거대한 새 UI로 합치지 않습니다. Frame v2는 기존 두 기능을 그대로 보존하면서, **최초 이해 자료를 만드는 단계와 그 자료를 사용자가 소화하며 다듬는 단계를 연결하는 독립 pilot**입니다.

```text
초안 먼저 | 질문하며 만들기
        ↓
TFT Studio의 현재 Frame 시각화로 최초 학습노트 작성
        ↓
Study Hard board에서 질문·답변·revision으로 다듬기
        ↓
HTML / optional Notion export
        ↓
표준 frame.json으로 승격하고 구현 시작
```

## Two Entry Modes

두 모드는 최종 산출물 품질이 아니라 **사용자가 개입하는 시점**만 다릅니다.

- `--draft`: source와 코드를 조사한 최초 학습노트를 먼저 보여줍니다. 확인되지 않은 값은 가정·열린 질문으로 남기고, 사용자는 완성된 초안을 보며 정정합니다.
- guided: 현재 `/frame`의 Deep Interview, `(명백)` 근거, Productive Resistance 규율로 질문하며 최초 노트를 만듭니다.

기존 Frame에서 질문을 의도적으로 남긴 이유는 단계를 길게 만들기 위해서가 아니라, AI가 당연해 보이는 계약을 몰래 확정하지 못하게 하기 위해서였습니다. 따라서 guided mode는 이를 “질문을 줄인다”로 재해석하지 않습니다. 한 번에 하나의 계약 분기를 묻고, source로 닫히는 사실은 AI가 직접 확인합니다.

## Two-stage Surface Rule

TFT Studio와 Study Hard board는 동시에 유지되는 두 canonical이 아닙니다.

1. TFT Studio는 최초 구조화와 시각화 surface입니다. 현재 `tft-visual` renderer의 backend layer, architecture flow, data model/migration map을 그대로 사용합니다.
2. 최초 노트가 정리되면 이를 구조화된 `noteDocument`, concept hierarchy, runtime flow, Mermaid ERD로 Study Hard board에 넘깁니다.
3. 전환 뒤에는 Study Hard state가 refinement 원천입니다. TFT markdown 복사본을 계속 수동 동기화하지 않습니다.
4. 사용자가 이해 완료를 명시하면 표준 `frame.json`이 작업 canonical로 승격됩니다.

이 순서 덕분에 Frame의 직관적인 ERD·flow 표현과 Study Hard의 문단 선택·Tutor/Editor/Coach·revision 흐름을 둘 다 보존할 수 있습니다.

## Understanding Gate

Artifact 생성, 질문 정답, AI의 coach 판정은 사용자의 이해 완료 증거가 아닙니다. 사용자가 “충분히 이해했다”, “작업하자”처럼 명시하기 전에는 `frame.json`을 ready로 만들거나 구현을 시작하지 않습니다.

반대로 사용자가 준비됐다고 하면 refinement를 끝없이 이어가지 않습니다. 최신 Study Hard revision에서 목표, 성공 기준, 열린 질문, decision queue, verify plan, implementation slices를 합성해 현재 Frame schema로 저장합니다.

## Canonical Transition

- `frame-v2.json`: identity, mode, Study Hard run, lifecycle만 담는 runtime manifest
- Study Hard state: refinement 중 학습노트 canonical
- `frame.json`: 작업 준비 완료 후 `/decide`, `/verify`, worktree promotion이 읽는 canonical
- `frame.md`, TFT transcript, HTML/Notion: mirror 또는 provenance

Frame v2 전용 축약 `frame.json` schema를 만들지 않습니다. 현재 `skills/frame/SKILL.md`의 atomic write, canonical hash, mirror sanity, implementation plan 규칙을 그대로 사용합니다.

## Worktree Continuation Rule

`frame_v2_worktree_fork`는 일반 `worktree_fork`를 직접 호출하는 대신 `/frame-v2` command context를 보존한 실제 `/wt fork` 경로를 사용합니다.

- standard `frame.json`이 없거나 manifest가 `ready`가 아니면 fork를 차단합니다.
- planning frame은 target worktree `.pi/frame.json`으로 승격됩니다.
- 새 세션은 promoted frame을 읽고 첫 ready slice부터 시작합니다.
- BLOCKED이면 절대경로 구현으로 우회하지 않습니다.

## Boundary

Frame v2는 pilot입니다. 기존 `/frame`, `/decide`, `/study-hard` command나 저장 구조를 자동 교체하지 않습니다. 실제 사용에서 두-stage 전환이 더 낫다는 증거가 쌓인 뒤에만 기존 Frame으로의 흡수 여부를 다시 결정합니다.
