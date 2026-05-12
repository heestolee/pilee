---
name: verify-report-preflight
description: /verify-report를 실행하기 전에 검증 축, 데이터/계정/환경 준비도, side effect 위험, baseline 실패를 빠르게 점검해 캡처-heavy 리포트로 바로 들어갈지·가벼운 검증으로 충분한지·차단 상태인지 판단할 때 사용한다. "verify-report 전에", "캡처 전 데이터 확인", "리포트 프리플라이트", "검증 준비도", "이거 full report 필요한가" 요청에 사용한다.
argument-hint: "[PR/branch/url] [--full-report] [--light]"
disable-model-invocation: false
---

# verify-report-preflight

`/verify-report`의 앞단에서 **검증 준비도와 작업 무게**를 점검한다. 목적은 검증을 생략하는 것이 아니라, 데이터/계정/환경이 안 된 상태로 긴 캡처 루프에 들어가거나, 작은 hotfix에 full report/fan-out을 과하게 적용하는 일을 막는 것이다.

## 원칙

- **Preflight는 PASS 증거가 아니다**: 최종 PASS는 `/verify`, `/verify-report`, 테스트, 캡처, 로그 같은 실제 evidence 뒤에만 온다.
- **Capture 전에 data readiness**: route, role/account, fixture/data, before 기준, local/preview URL이 없으면 먼저 막는다.
- **작업 무게는 비례해야 한다**: 작은 copy/hotfix는 focused evidence로 닫고, multi-axis UI/BE/event 변경만 full report로 보낸다.
- **Baseline 실패는 분리한다**: 반복되는 unrelated validation 실패는 자동 baseline cache나 기존 근거로 분류하고, 이번 변경의 실패처럼 재조사하지 않는다.
- **위험 side effect 금지**: 결제, 알림 발송, DB write, 외부 API 호출, production mutation은 preflight에서 차단하거나 사용자 확인을 받아야 한다.
- **Private context는 overlay로**: 계정 alias, preview URL 패턴, 회사별 DB/스토리지 규칙은 private/project overlay skill을 따른다.

## Workflow

### 1. 변경 범위와 검증 후보 수집

우선 read-only로 확인한다.

```bash
git status --short --branch
git diff --name-only origin/<base>...
gh pr view --json number,title,url,body,headRefName,baseRefName  # PR이 있으면
```

다음 소스를 우선순위로 읽는다.

1. 사용자 요청 / PR body / Test plan
2. `frame.json` success criteria, decisions, verify_plan
3. 변경 diff와 영향 파일
4. 기존 `/archive` report나 TFT Studio transcript reference

### 2. Workflow weight 결정

| 무게 | 조건 | 권장 경로 |
|---|---|---|
| **light** | 단일 copy/text/style hotfix, 영향 route 1개, side effect 없음 | focused screenshot/log/test 1~2개. `/verify-report --no-workers` 또는 `/verify`로 충분할 수 있음 |
| **standard** | UI 또는 BE 변경이 있고 검증 축 2~5개 | `/verify-report` 기본 흐름. 필요한 항목만 worker fan-out |
| **full** | responsive/role/before-after/event/BE가 섞이거나 PR 리뷰용 리포트 필요 | coverage plan 확정 후 full `/verify-report` |
| **blocked** | URL/계정/data/fixture/side-effect 승인 없음 | 캡처 시작 금지. 차단 조건과 필요한 입력만 보고 |

작은 변경이라도 화면에 보이는 사용자-facing 변화라면 가능한 실제 UI/TUI evidence를 남긴다. 단, full-page/tall capture 대신 focused viewport/element crop을 기본으로 한다.

### 3. Readiness matrix 작성

아래 표를 채운다. 모르는 값을 추측하지 말고 `unknown`/`blocked`로 둔다.

| 축 | 질문 | ready 기준 |
|---|---|---|
| Target | 어떤 URL/환경에서 볼 것인가? | local/dev/preview/prod 중 하나와 route가 확정 |
| Role/Data | 어떤 계정·데이터·상태가 필요한가? | alias/fixture/query가 확정, side effect 없음 |
| Before | before/after가 의미 있는가? | 같은 route/viewport/data/role로 비교 가능하거나 생략 사유 명확 |
| Evidence | 어떤 증거가 축을 닫는가? | UI_CAPTURE/NETWORK/CONSOLE/BE/CODE_DIFF 중 하나 이상 확정 |
| Validation baseline | 반복 baseline 실패가 있는가? | known baseline id/근거가 있거나 이번 변경 영향으로 재분류 |
| Risk | 결제/알림/DB write/external 호출 위험? | 없음, mock/stub, 또는 사용자 승인 필요 |

### 4. Baseline failure check

검증 명령을 돌리기 전후에 반복 실패를 자동으로 분리한다.

- Bash validation 결과에 `[preflight] Known baseline failure`가 붙으면 최종 보고에서 “이번 변경의 actionable failure 아님”으로 분리한다.
- 새 실패가 변경 파일/동작과 연결되면 baseline으로 넣지 않는다.
- 전체 에러를 읽고 unrelated baseline이라고 판단한 경우 agent가 `preflight_baseline` tool의 `action="add_last"`로 기록한다. 사용자에게 slash command 입력을 요구하지 않는다.
- 사용자가 baseline cache를 직접 점검하고 싶다고 말하면 agent가 `preflight_baseline` tool의 `list`/`clear`/`prune`으로 처리한다.
- baseline cache는 재조사 비용을 줄이는 도구이지, required check를 무시하는 면죄부가 아니다.

### 5. Decision gate

다음 중 하나로 결론을 낸다.

```markdown
## verify-report preflight 결과

판정: light | standard | full | blocked

| V | 검증 축 | Evidence | Target | Data/Role | 상태 | 메모 |
|---|---|---|---|---|---|---|
| V1 | ... | UI_CAPTURE | preview / 390px | member | ready | focused crop |
| V2 | ... | NETWORK | preview | anonymous | blocked | 이벤트 fixture 필요 |

### 다음 액션
1. `/verify-report --no-workers ...`로 focused report 진행
2. `/verify-report ...` full coverage 진행
3. 차단 조건 해결 후 재시도
4. report 없이 `/verify`/테스트 요약으로 닫기
```

사용자의 “full report 필요한가?” 요청에는 위 표로 판단을 보여준 뒤, 결과가 명확하면 바로 다음 액션을 제안한다. 위험하거나 product 판단이 갈리면 짧게 묻는다.

## Output format

최종 응답은 아래 네 섹션으로 짧게 낸다.

```markdown
### 판정
- light / standard / full / blocked

### 준비된 축
- ...

### 차단/주의
- ...

### 다음 액션
- 실행할 명령 또는 필요한 사용자 입력
```

## Edge cases

- **PR preview가 아직 없음**: local/dev evidence로 대체 가능한지 판단하고, preview-only면 blocked.
- **계정이 없음**: private overlay alias나 Keychain 경로를 찾고, 없으면 해당 role 축 blocked.
- **데이터 생성이 위험함**: DB write/결제/알림 side effect가 있으면 preflight에서 멈춘다.
- **before 기준이 비쌈**: 생략 가능하지만 `/verify-report` detail/Coverage Gap에 사유를 남긴다.
- **baseline 실패가 많음**: `preflight_baseline` tool로 기존 known failure를 확인하고, 새로운 failure만 분석한다.

## Validation

스킬 변경 후에는 다음을 확인한다.

```bash
npm run knowledge:validate
npm run knowledge:graph -- --check
```
