---
title: Frame v2는 작업·학습 lane을 양방향으로 연결한다
tags:
  - frame-v2
  - frame
  - study-hard
  - learning-note
  - worktree
category: workflow
status: active
confidence: high
applies_to:
  - extensions/frame-v2
  - skills/frame-v2
  - extensions/study-hard
source:
  - user-direction:2026-07-17-frame-v2-bidirectional-lanes
reviewed_at: 2026-07-18
reviewed_commit: 88b560c62683ba149cbaf91ecca9487b65c973c9
related:
  - frame-verify-contract
  - frame-studio-interactive-decision-ui
  - tft-visual-structure-renderer
  - source-grounded-frame-planning
  - worktree-session-continuity
  - study-hard-public-engine-private-publisher
  - learning-note-companion-artifact
---

## Judgment

Frame v2는 “학습을 마쳐야 Frame과 구현으로 갈 수 있는” 직렬 pipeline이 아닙니다. Frame, Study Hard, 구현을 같은 work unit에 두되 **각 lane을 독립적으로 시작·이동·병행할 수 있게 연결하는 coordinator**입니다.

```text
같은 work unit
├─ Frame       작업 기획 canonical
├─ Study Hard  학습 canonical
└─ Work        코드·검증 canonical
```

## Entry Choice Rule

`/frame-v2 <주제>`는 flag 암기 대신 시작 UI를 엽니다.

1. Frame 먼저
2. Study Hard 먼저

선택은 `frame-v2.json.entryMode`에 보존합니다. 이후 순서는 고정하지 않습니다.

```text
Frame 먼저       → 구현 | Study Hard | 둘 다
Study Hard 먼저  → 학습 | Frame | 구현 | 둘 다
```

단순 작업이나 hotfix는 Frame/Study Hard를 끝까지 기다리지 않고 작업을 시작할 수 있습니다. 학습은 같은 panel이나 별도 panel에서 병행할 수 있습니다. 기존 ask-first·worktree·DB·운영 안전 규칙은 유지하지만, Frame v2가 학습 완료를 새 hard gate로 추가하지 않습니다.

## Canonical Separation Rule

- `frame.json`: 목표·범위·결정·성공 기준·검증·구현 slice
- Study Hard state: Mental Model·Before/After·데이터 흐름·코드 읽기·Q&A·이해 확인
- `learning-companion.json`: 두 canonical의 stable pointer와 의미 있는 transition
- `frame-v2.json`: entry mode와 runtime refs만 담는 coordinator manifest

Frame 내용을 Study Hard 본문에 복사하면 두 문서가 동시에 stale해집니다. 따라서 학습 본문은 학습자용 서사로 변환하고, 전체 Frame은 별도 read-only view로 둡니다.

## Full Frame View Rule

Study Hard를 열 때 연결된 Frame이 있는지 확인합니다.

1. companion의 frame path
2. current worktree `.pi/frame.json`

Frame이 있으면 학습노트 최상단에 다음 기본 접힘 view를 표시합니다.

```text
▶ 작업 기획 전체 보기 · Frame title/hash
```

- `frame.md` 또는 `frame.json` 전체를 lazy load
- noteDocument에 복제하지 않음
- Frame이 없으면 dropdown도 없음
- HTML export는 같은 details view를 export 시점에 파생
- Notion payload는 work contract를 noteDocument와 분리

이 구조는 사용자가 학습 설명을 읽다가도 원래 기획 전체를 잃지 않게 하면서, Frame과 학습노트가 서로를 덮어쓰지 않게 합니다.

## Study Hard-first Promotion Rule

Standalone `/study-hard`로 시작한 학습도 나중에 같은 run으로 Frame lane을 추가할 수 있습니다.

```text
study_hard_board status
  → frame_v2_state adopt-study-hard(runId)
  → 현재 학습 내용을 바탕으로 Frame 작성·보완
  → frame_v2_state ready
  → companion 연결
```

Adopt는 새 Study Hard run을 만들지 않습니다. runId, noteDocument, Q&A, revision sequence를 유지합니다. Companion 연결은 기존 sequence에 metadata revision을 추가할 수 있지만 과거 학습 history를 초기화하지 않습니다.

## Learning Document Rule

Study Hard 본문은 Frame schema 순서를 그대로 옮기지 않습니다.

```text
왜 필요한가
→ 먼저 알아야 할 개념
→ 핵심 Mental Model
→ Before / After
→ 데이터·실행 흐름
→ 코드 읽는 순서
→ 재사용할 원칙
→ 한계·오해
→ 이해 확인
```

Requirement Matrix, decisions, success criteria, verify plan, implementation slices의 전체 원문은 work contract dropdown에서 보고, 본문에는 이해에 필요한 사례·트레이드오프·코드 연결만 흡수합니다.

## Learning-to-Work Amendment Rule

Study Hard에서 새 방향이 발견됐다고 해서 최초 Frame이 실패한 것은 아닙니다. 당시 Frame은 구현 가능한 versioned contract였고, 학습이 추가 보완을 발견한 것입니다.

```text
학습 인사이트
  → proposal
  → 사용자 수락
  → 기존 /decide · work context · task · verify · 구현으로 적용
  → concrete refs
  → applied
```

제안이나 수락 상태만으로 Frame·task·코드를 자동 수정하지 않습니다.

## Dedicated Fork Boundary

`frame_v2_worktree_fork`는 Frame promotion을 포함하는 전용 경로이므로 valid frame과 ready manifest를 요구합니다. 이 precondition은 전용 tool에만 적용합니다. Frame이 없거나 promotion이 필요하지 않은 구현은 기존 worktree·현재 worktree 흐름을 사용하며, Frame v2가 별도 차단을 만들지 않습니다.

## Boundary

Frame v2는 pilot입니다. 기존 `/frame`, `/decide`, `/study-hard`의 identity와 canonical을 대체하지 않습니다. 재사용하는 것은 각 기능의 검증된 규칙이고, 새로 추가하는 것은 시작 선택·양방향 adoption·전체 Frame read-only view·companion 연결뿐입니다.
