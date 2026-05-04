---
name: workspace-workflow
description: 구현 작업 시작 전 올바른 작업 위치를 보장한다. 파일을 수정/생성하려는 시점에 반드시 실행. "작업해줘", "구현해줘", "만들어줘", "수정해줘" 등 실제 변경이 수반되는 요청이 트리거.
---

# Workspace-First 워크플로우

## 핵심 원칙

기획/분석은 어디서든 OK. **코드를 쓰기 시작하는 순간**부터 위치를 따진다.

---

## Step 1: 현재 위치 분류

`pwd`를 확인하고 아래 4가지 중 하나로 분류한다.

| 분류 | 경로 패턴 | 다음 행동 |
|---|---|---|
| **A. 워크스페이스** | `~/conductor/workspaces/<repo>/<name>/`<br>`~/pilee-workspaces/<repo>/<name>/` | → Step 4: 바로 진행 |
| **B. pilee 레포** | `~/.pi/agent/git/github.com/heestolee/pilee/` | → Step 4: 바로 진행 (pilee는 직접 커밋) |
| **C. 특정 레포 메인** | `~/desktop/creatrip/product/`<br>`~/desktop/creatrip/lambda/` 등 | → Step 3: 해당 레포에서 `/wt new` 안내 |
| **D. 홈 또는 기타** | `~/` 또는 그 외 | → Step 2: 어떤 레포에서 작업할지 질문 |

---

## Step 2: 레포 선택 (D 케이스만)

현재 위치가 홈 디렉토리이거나 특정 레포를 특정할 수 없을 때:

```
어떤 레포에서 작업할까요?
```

옵션:
- `pilee` — 개인 설정 레포 (`~/.pi/agent/git/.../pilee/`), 바로 진행
- `product` — creatrip/product, Conductor에서 `/wt new` 필요
- `lambda` — creatrip/lambda, Conductor에서 `/wt new` 필요
- 기타 레포 (직접 입력)

→ pilee 선택 시: Step 4로
→ 나머지: Step 3로

---

## Step 3: 워크스페이스 생성 안내 (B·C 케이스 및 Step 2 결과)

코드 수정을 시작하지 않고 다음을 안내한다:

```
구현 전에 워크스페이스가 필요합니다.
Conductor에서 `/wt new`로 새 워크스페이스를 열고,
그 워크스페이스 세션에서 이어서 요청해주세요.
```

워크스페이스 이름은 도시 이름 컨벤션을 따른다 (예: `berlin`, `osaka-v1`).

---

## Step 4: 진행

위치가 확인되면 추가 확인 없이 작업을 진행한다.

---

## 합리화 차단

| 합리화 | 현실 |
|---|---|
| "간단한 수정이라 메인에서 해도 돼" | 워크스페이스 만드는 데 10초다. |
| "기획 중이라 아직 괜찮아" | 기획은 괜찮다. **파일을 열어 수정하는 순간**이 기준이다. |
| "빨리 해야 해서" | 브랜치 없는 직접 수정이 더 오래 걸린다 — 추후 diff, 리뷰, 롤백 전부 비용. |
