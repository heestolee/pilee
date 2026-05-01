---
name: make-report
description: PR 검증 후 스크린샷/GIF 캡처 리포트를 생성한다. 기본은 로컬 확인용. 업로드는 명시 요청 시만.
argument-hint: "[base-url] [--upload] [--update] [--ask-before]"
---

# Make Report

캡처 대상을 수집하고, 브라우저 자동화로 스크린샷/GIF를 캡처한 뒤, HTML 리포트로 유저 리뷰를 거친다.

## 모드 (default: confirm-only)

| 모드 | 설명 | 트리거 |
|------|------|--------|
| **confirm** (default) | 로컬 캡처 + HTML 프리뷰만. 업로드 X | 기본 |
| **upload** | confirm + agent-storage 업로드 + PR 본문 갱신 | `--upload` 인자 또는 사용자가 명시 요청 |
| **update** | 기존 리포트에 항목 append (전체 재작성 X) | `--update` 인자 또는 "추가" 키워드 감지 |
| **ask-before** | 캡처 실행 전 항목별 확인 단계 추가 | `--ask-before` 인자 또는 사용자가 요구 |

> **default가 confirm**인 이유: 분석 결과 사용자가 "업로드 목적이 아니고 확인용"으로 우회 호출하는 빈도가 가장 높음. 업로드는 opt-in.

## 실행 단계 개요

| Step | 설명 | confirm | upload | update |
|------|------|:---:|:---:|:---:|
| 1 | 캡처 대상 수집 + **분류** | ✓ | ✓ | ✓ (신규만) |
| 2 | 환경 확인 | ✓ | ✓ | ✓ |
| 3 | 로그인 Credential 확보 | ✓ | ✓ | ✓ |
| 4 | 캡처 계획 수립 → 유저 확인 | ✓ | ✓ | ✓ |
| 4-B | (ask-before 모드만) 항목별 사전 확인 | opt | opt | opt |
| 5 | 브라우저 자동화 실행 | ✓ | ✓ | ✓ |
| 6 | HTML 리포트 생성 → 유저 리뷰 | ✓ | ✓ | ✓ (병합) |
| 7 | agent-storage 업로드 |  | ✓ | ✓ |
| 8 | context.md + PR 본문 업데이트 |  | ✓ | ✓ |
| 9 | 후속 단계 AskUserQuestion | ✓ | ✓ | ✓ |

> 각 Step 상세: 
> - [references/capture-commands.md](references/capture-commands.md) — agent-browser 명령, ffmpeg GIF 합성 (고화질 설정)
> - [references/upload-scripts.md](references/upload-scripts.md) — agent-storage 업로드
> - [references/report-templates.md](references/report-templates.md) — HTML/context.md/PR 템플릿
> - [references/troubleshooting.md](references/troubleshooting.md) — agent-browser daemon 복구, 자주 깨지는 케이스

## Step 1: 캡처 대상 수집 + 분류

소스 우선순위:
1. **PR test plan** — `gh pr view` body의 `## Test plan`
2. **Verify 체크리스트** — `.context/work/{workspace}/context.md`의 `## Verifications`
3. **자체 케이스 도출** — Frame 성공 기준 + 구현 코드 분석

수집 직후 **반드시 분류** 수행 (이전 스킬엔 없던 단계 — 사용자가 매번 "범위가 맞는지" 확인했음):

| 분류 | 설명 | 처리 |
|------|------|------|
| **UI** | 화면에 보이는 동작/상태 | 캡처 대상 |
| **BE** | API/권한/DB만 영향 (UI 무변화) | 캡처 SKIP — CODE_DIFF로 대체 권장 |
| **CODE_DIFF** | 코드 변경만 보여주는 게 적합 | git diff 첨부 또는 SKIP |
| **SKIP** | 사용자 결정 — 명시적으로 제외 | 결과 표에만 기록 |

분류 결과를 사용자에게 표로 보여주고 AskUserQuestion으로 확인:
```
다음 항목들을 캡처 대상으로 분류했습니다. 수정할 게 있으신가요?

| # | 항목 | 분류 | 이유 |
|---|------|------|------|
| A1 | 리뷰답글 권한 토글 노출 | UI | admin 메뉴에서 보임 |
| A2 | 권한 가드 mutation 차단 | BE | UI 변화 없음 → CODE_DIFF 권장 |
| A3 | ... | UI | ... |
```

## Step 2: 환경 확인

```bash
which agent-browser  # 미설치 시: npm install -g agent-browser && agent-browser install
which ffmpeg          # GIF 항목이 있을 때만. 미설치 시: brew install ffmpeg
```

대상 URL: `$ARGUMENTS` > Preview URL (PR 감지) > 로컬 서버 순으로 자동 감지 후 AskUserQuestion으로 확인.

## Step 3: 로그인 Credential 확보

UI 분류 항목에서 필요한 역할 판별 → 역할별 AskUserQuestion. 추가 계정 거부 시 해당 항목 SKIP 표시.

## Step 4: 캡처 계획 수립

| 판단 기준 | 캡처 형태 |
|-----------|----------|
| 단일 상태 확인 | **PNG** 1장 |
| 다단계 플로우 | **GIF** (프레임 합성, 고화질) |

**파일 경로**: `.context/work/{workspace}/captures/` 안에 저장 — Edit 도구 샌드박스 OK + 워크스페이스 머지 시 자동 정리.

> ⚠️ **`/tmp/`는 사용 금지** — Edit 도구가 차단함 + 휘발됨 (이전 스킬의 가장 큰 마찰점).

파일명: kebab-case `{항목번호}-{설명}.{png|gif}`

AskUserQuestion으로 계획 확인.

## Step 4-B: (옵션) 사전 항목별 확인

`--ask-before` 모드 또는 사용자가 "사전 확인하자" 요청한 경우:

각 캡처 시작 전마다:
```
[A1] 리뷰답글 권한 토글 노출 — PNG
URL: {url}
액션: 페이지 진입 → 권한 메뉴 클릭 → 스크린샷

진행할까요?
```

옵션: 진행 / 건너뛰기 / 다른 액션으로

## Step 5: 캡처 실행

[references/capture-commands.md](references/capture-commands.md) 참조. 

핵심 변경:
- **GIF 고화질 설정** — `lanczos` 스케일링 + `sierra2_4a` 디더링 + 256색 (이전: bayer + 저화질)
- **Daemon 실패 시 복구 절차** — [troubleshooting.md](references/troubleshooting.md)의 표준 절차 따라 재시작 (이전엔 매번 즉흥 처리)

## Step 6: HTML 리포트 생성 → 유저 리뷰

`.context/work/{workspace}/captures/report.html` 생성 후 로컬 프리뷰. 

**update 모드**: 기존 report.html 읽어서 새 항목만 append. 기존 항목 보존.

유저 리뷰: "괜찮습니다 / 재캡처 필요 / 항목 추가" AskUserQuestion.

## Step 7: agent-storage 업로드 (upload 모드만)

[references/upload-scripts.md](references/upload-scripts.md) 참조.

기본 confirm 모드에선 이 단계 스킵 — 사용자가 만족하면 그대로 종료. 업로드 원하면 `/make-report --upload`로 재실행.

## Step 8: context.md + PR 본문 업데이트 (upload 모드만)

[references/report-templates.md](references/report-templates.md) 참조. 

**update 모드**: 기존 섹션 보존 + 새 항목 append.

## Step 9: 후속 단계

```json
{
  "questions": [{
    "question": "리포트 생성 완료. 다음 단계를 선택해주세요.",
    "options": [
      "/create-pr — PR 생성 (이 리포트 포함)",
      "/reflect — 학습 캡처",
      "/make-report --upload — 업로드 (현재 confirm 모드인 경우)",
      "/make-report --update — 추가 캡처 항목 처리",
      "일단 멈춤"
    ]
  }]
}
```

## 자주 마주치는 케이스 — 빠른 처리

| 케이스 | 해결 |
|--------|------|
| 사용자가 "추가로 X도 캡처해줘" | `update` 모드로 자동 전환. 기존 항목 보존 + X만 추가. |
| 사용자가 "BE는 빼" | 분류 단계에서 BE/CODE_DIFF 항목 SKIP 표시. |
| 사용자가 "여러 번 다시 했는데 또" | troubleshooting.md 확인 + daemon 표준 재시작 절차. |
| 사용자가 "업로드는 나중에" | confirm 모드로 종료. /make-report --upload 안내. |
