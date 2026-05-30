---
name: verify-report-preflight
description: /verify-report를 실행하기 전에 PM-facing 캡처 리포트 계약을 고정한다. Jira/Notion/Slack/와이어프레임/PR test plan 같은 기획 근거를 성공 기준·actor/role·subject identity·화면 oracle·primary capture로 매핑하고, 데이터/계정/환경/side effect 준비도를 점검해 긴 /verify-report의 정확도를 높인다. "verify-report 전에", "캡처 전 데이터 확인", "리포트 프리플라이트", "검증 준비도", "이거 full report 필요한가" 요청에 사용한다.
argument-hint: "[PR/branch/url] [--full-report] [--light]"
disable-model-invocation: false
---

# verify-report-preflight

`/verify-report`의 앞단에서 **PM-facing 리포트 계약과 검증 준비도**를 잠근다. 목적은 검증을 생략하는 것이 아니라, 긴 캡처 루프에 들어가기 전에 “무엇을, 누구의 시점에서, 어떤 화면 증거로, 같은 subject 기준으로 증명할지”를 확정해 `/verify-report`의 정확도를 높이는 것이다.

## 원칙

- **Preflight는 PASS 증거가 아니다**: 최종 PASS는 `/verify-report`, `/verify`, 테스트, 캡처, 로그 같은 실제 evidence 뒤에만 온다.
- **PM-facing 계약 먼저**: 기술 diff보다 기획 근거와 사용자-facing 성공 기준을 먼저 정한다. 리포트 상단은 PM·기획자·디자이너가 캡처/GIF로 이해할 동작이어야 한다.
- **Capture 전에 subject/role/data readiness**: route, actor/role/account, subject identity, fixture/data, before 기준, local/preview URL이 없으면 먼저 막는다.
- **기술 검증은 하단 후보로 분리**: API/DB/code diff/test/migration은 PM-facing 캡처를 보조하거나 비가시 정책을 닫는 `Technical support checks` 후보로 둔다.
- **작업 무게는 비례해야 한다**: 작은 copy/hotfix는 focused evidence로 닫고, multi-axis UI/role/before-after/BE/event 변경만 full report로 보낸다.
- **Setup noise는 report 본문에서 배제**: 로그인 실패, bootstrap, dev-server, selector 시행착오 같은 준비 과정은 기능 evidence가 아니다. 실제 검증을 막을 때만 blocked 사유로 짧게 남긴다.
- **Baseline 실패는 분리한다**: 반복되는 unrelated validation 실패는 자동 baseline cache나 기존 근거로 분류하고, 이번 변경의 실패처럼 재조사하지 않는다.
- **위험 side effect 금지**: 결제, 알림 발송, DB write, 외부 API 호출, production mutation은 preflight에서 차단하거나 사용자 확인을 받아야 한다.
- **Private context는 overlay로**: 계정 alias, preview URL 패턴, 회사별 DB/스토리지 규칙은 private/project overlay skill을 따른다.

## Workflow

### 1. 근거와 변경 범위 수집

우선 read-only로 확인한다. 단, 사용자가 이미 Jira/Notion/Slack/와이어프레임/URL/PR을 줬으면 그 anchor부터 본다.

```bash
git status --short --branch
git diff --name-only origin/<base>...
gh pr view --json number,title,url,body,headRefName,baseRefName  # PR이 있으면
```

소스 우선순위:

1. 사용자의 최신 검증 지시
2. Jira / Notion / Slack / 와이어프레임 / 디자인 시안 / 요구사항 문서
3. PR body / Test plan
4. `frame.json` success criteria, decisions, verify_plan
5. 변경 diff와 영향 파일
6. 기존 `/archive` report나 TFT Studio transcript reference

### 2. PM-facing report contract 작성

각 요구를 아래 계약으로 바꾼다. 모르는 값은 추측하지 말고 `unknown`/`blocked`로 둔다.

| V | 근거 출처 | PM-readable 성공 기준 | actor/role | subject identity | 화면 oracle | primary capture | 상태 |
|---|-----------|----------------------|------------|------------------|-------------|-----------------|------|
| V1 | Jira/Notion/Slack/PR/user | 비개발자가 이해할 한 문장 | admin/member/partner/anonymous | 같은 row/order/review/item/user를 보장하는 id | 화면에 보여야 하는 텍스트/상태/흐름 | focused crop/GIF/viewport | ready/unknown/blocked |

작성 규칙:

- **근거 출처**는 “diff에서 봄”만으로 끝내지 않는다. 외부 기획 근거가 없으면 `사용자 지시`, `PR test plan`, `frame success criteria` 중 하나로 명시한다.
- **PM-readable 성공 기준**은 “mutation 성공”이 아니라 “관리자가 X를 선택하면 사용자 화면에서 Y로 보인다”처럼 쓴다.
- **actor/role**은 기능 소유자와 실제 검증 계정을 분리해 적는다. Admin 기능이면 admin 검증이 기본이며, partner/test 계정은 별도 권한 축일 때만 둔다.
- **subject identity**는 state transition/before-after claim의 핵심이다. 같은 주문/리뷰/유저/row를 증명할 수 없으면 해당 item은 `blocked` 또는 `unverified 예정`이다.
- **화면 oracle**은 캡처 안에서 리뷰어가 무엇을 봐야 하는지다. expected text/label/state가 없으면 캡처가 있어도 PASS가 어렵다.
- **primary capture**는 static 상태면 focused crop/viewport, 흐름·전환·클릭이면 GIF/짧은 영상 + final PNG다.

### 3. Technical support candidates 분리

PM-facing behavior를 보조하거나 비가시 정책 자체를 닫아야 하는 항목만 하단 후보로 분리한다.

| T | 보조 검증 | 왜 필요한가 | Evidence | 상태 |
|---|----------|------------|----------|------|
| T1 | API/DB/code/test/migration/GraphQL | 화면 동작을 뒷받침하거나 비가시 정책을 닫음 | BE/NETWORK/CODE_DIFF/CONSOLE | ready/unknown/blocked |

규칙:

- 기술 검증은 중요하지만 상단 PM-facing PASS를 대체하지 않는다.
- 화면 동작이 핵심인 기능에서 code/test만 ready이면 `/verify-report`는 아직 ready가 아니다.
- 반대로 화면 변화가 없는 정책/권한/이벤트는 처음부터 하단 기술 검증이 primary일 수 있다. 이 경우 PM-facing item에 억지 UI 캡처를 만들지 않는다.

### 4. Readiness matrix 작성

아래 표로 `/verify-report` 시작 가능 여부를 판단한다.

| 축 | 질문 | ready 기준 |
|---|---|---|
| Requirement | 무엇을 증명하는가? | 근거 출처와 PM-readable 성공 기준 확정 |
| Target | 어떤 URL/환경에서 볼 것인가? | local/dev/preview/prod 중 하나와 route 확정 |
| Actor/Role | 누가 조작하거나 보는가? | alias/session/role 확정, 기능 대상과 일치 |
| Subject/Data | 어떤 데이터/상태를 쓸 것인가? | subject id/fixture/query 확정, side effect 없음 |
| Before/Transition | before/after 또는 A→B가 의미 있는가? | 같은 subject/route/viewport/role로 비교 가능하거나 생략 사유 명확 |
| Visual Evidence | 어떤 캡처가 상단 claim을 닫는가? | focused crop/GIF/viewport와 expected UI 확정 |
| Technical Support | 어떤 하단 근거가 필요한가? | API/DB/code/test/log 중 필요한 후보 확정 |
| Setup Noise | report에 넣지 않을 준비 과정은? | 제외할 noise와 blocked에 남길 조건 분리 |
| Validation baseline | 반복 baseline 실패가 있는가? | known baseline id/근거가 있거나 이번 변경 영향으로 재분류 |
| Risk | 결제/알림/DB write/external 호출 위험? | 없음, mock/stub, 또는 사용자 승인 필요 |

### 5. Workflow weight 결정

| 무게 | 조건 | 권장 경로 |
|---|---|---|
| **light** | 단일 copy/text/style hotfix, 영향 route 1개, side effect 없음, PM-facing item 1~2개 | focused screenshot/log/test 1~2개. `/verify-report --no-workers` 또는 `/verify`로 충분할 수 있음 |
| **standard** | UI 또는 BE 변경이 있고 PM-facing item 2~5개 | `/verify-report` 기본 흐름. 필요한 항목만 worker fan-out |
| **full** | responsive/role/before-after/state transition/event/BE가 섞이거나 PR 리뷰용 리포트 필요 | PM-facing contract 확정 후 full `/verify-report` |
| **blocked** | target/account/data/subject/side-effect 승인 없음, 또는 expected UI oracle이 불명확 | 캡처 시작 금지. 차단 조건과 필요한 입력만 보고 |

작은 변경이라도 화면에 보이는 사용자-facing 변화라면 가능한 실제 UI/TUI evidence를 남긴다. 단, full-page/tall capture 대신 focused viewport/element crop을 기본으로 한다.

### 6. Baseline failure check

검증 명령을 돌리기 전후에 반복 실패를 자동으로 분리한다.

- Bash validation 결과에 `[preflight] Known baseline failure`가 붙으면 최종 보고에서 “이번 변경의 actionable failure 아님”으로 분리한다.
- 새 실패가 변경 파일/동작과 연결되면 baseline으로 넣지 않는다.
- 전체 에러를 읽고 unrelated baseline이라고 판단한 경우 agent가 `preflight_baseline` tool의 `action="add_last"`로 기록한다. 사용자에게 slash command 입력을 요구하지 않는다.
- 사용자가 baseline cache를 직접 점검하고 싶다고 말하면 agent가 `preflight_baseline` tool의 `list`/`clear`/`prune`으로 처리한다.
- baseline cache는 재조사 비용을 줄이는 도구이지, required check를 무시하는 면죄부가 아니다.

### 7. Decision gate

다음 중 하나로 결론을 낸다. 명확하면 바로 다음 액션을 제안하고, target/role/subject/oracle 중 하나가 product 판단을 바꾸면 짧게 묻는다.

```markdown
## verify-report preflight 결과

판정: light | standard | full | blocked

### PM-facing behavior contract
| V | 근거 출처 | PM-readable 성공 기준 | actor/role | subject identity | 화면 oracle | primary capture | 상태 |
|---|-----------|----------------------|------------|------------------|-------------|-----------------|------|
| V1 | ... | ... | ... | ... | ... | focused crop/GIF | ready |

### Technical support candidates
| T | 보조 검증 | 왜 필요한가 | Evidence | 상태 |
|---|----------|------------|----------|------|
| T1 | ... | ... | BE/API/CODE_DIFF | ready |

### Excluded setup noise
- report 본문에 넣지 않을 준비 과정/실패

### 차단/주의
- blocked/unknown과 필요한 입력

### 다음 액션
1. `/verify-report --no-workers ...`로 focused report 진행
2. `/verify-report ...` full PM-facing report 진행
3. 차단 조건 해결 후 재시도
4. report 없이 `/verify`/테스트 요약으로 닫기
```

## Output format

최종 응답은 아래 다섯 섹션으로 짧게 낸다.

```markdown
### 판정
- light / standard / full / blocked

### PM-facing behavior contract
- V 항목 요약

### Technical support candidates
- T 항목 요약

### 차단/주의
- unknown/blocked/side effect/setup noise

### 다음 액션
- 실행할 명령 또는 필요한 사용자 입력
```

## Edge cases

- **기획 근거가 없는 경우**: 사용자 최신 지시, PR test plan, frame success criteria를 근거 출처로 삼는다. 그래도 PM-readable 성공 기준을 만들 수 없으면 질문한다.
- **PR preview가 아직 없음**: local/dev evidence로 대체 가능한지 판단하고, preview-only면 blocked.
- **계정이 없음**: private overlay alias나 Keychain 경로를 찾고, 없으면 해당 role 축 blocked.
- **actor가 헷갈리는 경우**: 기능 소유 actor와 검증 계정 actor를 분리한다. Admin 기능이면 admin이 기본이고, partner/test 계정은 권한 축일 때만 쓴다.
- **subject identity가 없는 state transition**: 다른 후보를 새로 찾지 말고 blocked/unverified로 둔다. 같은 subject를 잡을 방법을 먼저 묻거나 찾는다.
- **데이터 생성이 위험함**: DB write/결제/알림 side effect가 있으면 preflight에서 멈춘다.
- **before 기준이 비쌈**: 생략 가능하지만 `/verify-report` detail/Coverage Gap에 사유를 남긴다.
- **baseline 실패가 많음**: `preflight_baseline` tool로 기존 known failure를 확인하고, 새로운 failure만 분석한다.

## Validation

스킬 변경 후에는 다음을 확인한다.

```bash
npm run knowledge:validate
npm run knowledge:graph -- --check
```
