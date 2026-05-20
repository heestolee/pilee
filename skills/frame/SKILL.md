---
name: frame
description: 작업 시작 전에 구체 질문으로 목표·성공 기준·범위·검증 초점을 함께 좁히고, 이후 /decide·/verify가 mechanically 읽을 수 있는 frame.json을 워크트리에 박제한다.
---

<PREREQUISITE>
이 스킬을 실행하기 전에 다음 두 스킬을 모두 읽었는지 확인하세요:
- `skills/tft-guidelines/SKILL.md` — 언제 묻고 언제 안 묻을지 (philosophy)
- `skills/ask-user-question-rules/SKILL.md` — 어떻게 물을지 (craft)
읽지 않았으면 먼저 읽고 오세요. 두 규칙 모두 frame 전체 과정에 적용됩니다.
</PREREQUISITE>

# Frame

`/frame`은 **구현 전 핵심 정렬**이자 **후속 TFT 사이클 setup**이다. 목표·범위·성공 기준을 사용자가 함께 검토하고, 그 결과를 `/decide`·`/verify`·`/verify-report`가 읽을 수 있는 canonical contract로 저장한다.

산출물의 단일 원천은 `frame.json`이다. markdown과 Studio transcript는 사람이 읽기 위한 mirror/provenance이지 canonical source가 아니다.

이 스킬이 끝나면 다음이 보장된다:

- 사용자가 핵심 목표·범위·검증 초점을 직접 확인했다.
- Productive Resistance로 성공 기준/제외 범위/롤백 비용의 빈틈을 한 번 흔들었다.
- `frame.json`에 검증 가능한 성공 기준과 verify plan이 박제됐다.
- `frame.md`는 `frame.json`에서 재생성 가능한 사람용 mirror다.
- 의사결정이 필요한 항목은 `kind="frame.decision"` 태스크로 큐잉됐다.
- work-unit scoped Working Context Card와 work-task board가 현재 slice/결정/검증 초점을 외부 기억장치로 갖는다.
- Non-delegable / Ask-first 영역이 명시됐다.

**핵심 원칙: frame.json이 없으면 /verify는 의미 있게 동작하지 못한다.**

---

## Invariants

### 0-0. 작업 무게 보정 게이트

`/frame`은 모든 작업을 full TFT로 키우는 명령이 아니다. 시작할 때 먼저 작업 무게를 가볍게 분류한다.

| 무게 | 신호 | frame 깊이 |
|---|---|---|
| light | 단일 hotfix/copy/style, 영향 파일·route가 작고 side effect 없음 | 목표/범위/검증 축 한 번만 잠그고 바로 실행 |
| standard | UI/BE/event 중 여러 축이 있음 | 기본 frame + 필요한 결정/verify plan |
| full | 정책·DB·다중 role/viewport/before-after·릴리즈 리스크 | 정책축/레이어맵/decide/verify-report까지 풍부하게 사용 |

사용자가 “간단한 hotfix”, “빨리”, “문구만”, “이거 하나만”처럼 좁은 의도를 주면, 먼저 light frame으로 시작한다. 진행 중 검증 축이나 위험이 늘어나면 standard/full로 승격하되, 승격 이유를 한 문장으로 적는다.

### 0-A. 정책축 스캔 게이트

`/frame`은 티켓의 개별 룰을 나열하기 전에, 그 룰들이 충돌하거나 확장될 **정책축**을 먼저 스캔한다. 다음 도메인이 보이면 Step 2에서 정책축 스캔을 반드시 수행하고, Step 3/4 질문 후보에 반영한다.

트리거:
- 혜택, 쿠폰, 캠페인, 멤버십, 포인트, 환급률, 가격, 정산, 예약, 영수증처럼 사용자/운영 결과가 정책에 의해 달라지는 작업
- 현재 시점과 생성/예약/구매 시점이 다를 수 있는 작업
- DEFAULT/fallback, override, multi-mapping, priority, merge, sum, block 같은 적용 규칙이 있는 작업
- Web/Admin/Slack/알림/예약 후 화면/API처럼 같은 정책을 여러 채널이 소비하는 작업
- migration/seed/runbook/cache identity가 정책 결과 재현성에 영향을 주는 작업

필수 스캔 축:
1. 시간 기준 — 현재 시점인가, 예약/구매/생성 시점 기준으로 과거 정책을 재현해야 하는가
2. 적용 대상 수 — 한 대상에 정책 1개만 붙는가, 여러 개면 우선순위/합산/병합/차단 중 무엇인가
3. DEFAULT/fallback — fallback인가, non-default와 병합되는가, non-default가 있으면 숨기는가
4. 소비 채널 — Web 목록/상세, Admin, 예약 후 화면, Slack/알림, 영수증/가이드/API의 기준 시간과 표시 규칙이 같은가
5. 데이터/마이그레이션 — 운영 이력 보존, seed 책임, idempotent 재실행, rollback/restore 조건이 있는가
6. API/cache identity — GraphQL id/cache key/loader key가 정책 조합과 기간을 안정적으로 표현하는가

규칙:
- 코드/문서/티켓으로 답할 수 있는 축은 먼저 직접 확인하고, 확인한 결론을 `정책축 스캔` 카드에 적는다.
- 남은 축 중 frame 계약을 바꾸는 가장 큰 불확실성 하나는 Step 3 또는 Step 4에서 AskUserQuestion으로 묻는다.
- 모든 축을 사용자에게 체크리스트처럼 묻지 않는다. **스캔은 AI의 의무, 질문은 미해결 정책 분기 하나만**이다.
- 스캔 결과는 `policy_axis_scan`에 구조화하거나, 최소한 `review_lenses`, `risk_register`, `success_criteria`, `verify_plan.manual_checks`에 반영한다.
- 세부 체크리스트와 채널 매트릭스 템플릿은 `references/policy-axis-scan.md`를 따른다.

### 0-B. 백엔드 레이어 맵 게이트

`/frame`은 backend 계층 구조가 작업 이해를 좌우하면 구현 plan 전에 **레이어 책임 지도**를 먼저 그린다. 사용자가 backend 세부 레이어에 익숙하지 않다고 밝혔거나, 작업이 resolver/usecase/service/repository/entity/VO/loader/cache/migration을 건드리면 이 게이트를 켠다.

트리거:
- GraphQL resolver, REST controller, usecase, service, repository, entity, VO/value object, loader/DataLoader, ORM relation, migration 중 2개 이상이 영향 범위에 보임
- “어디에 로직을 둬야 하는지”가 성공 기준이나 구조 비용을 바꿈
- 사용자가 해당 backend 구조를 잘 모른다고 말했거나, PR review에서 레이어 책임 질문이 나올 가능성이 있음
- API 응답 값이 여러 소비 채널(Web/Admin/Slack 등)로 흘러가거나, cache/loader가 기준 시간·권한·정책을 바꿀 수 있음

필수 맵:
1. Entry point — Resolver/Controller/Handler가 어떤 API field/action을 받는가
2. Application flow — Usecase/Service가 사용자 행동과 transaction/정책 선택을 조합하는가
3. Domain rule — VO/Domain service/Entity method가 어떤 계산·불변식을 소유하는가
4. Data access — Repository/ORM query가 어떤 where/include/order/lock 조건을 소유하는가
5. Cache/batching — Loader/cache key가 어떤 기준 값과 scope를 포함해야 하는가
6. Persistence — Entity/Migration/Schema가 어떤 source-of-truth와 제약을 소유하는가
7. Consumers — Web/Admin/Slack/job 등 결과를 소비하는 경로가 무엇인가

규칙:
- 모든 레이어를 억지로 채우지 않는다. 해당 없으면 `N/A`로 표시한다.
- 파일 목록 plan을 쓰기 전에 “어느 책임이 어느 레이어에 있어야 하는지”를 표나 call-flow로 먼저 보여준다.
- 구조 이해가 핵심이면 `tft-visual` 또는 간단한 ASCII flow를 함께 사용한다. 단, visual은 설명용이고 canonical 원천은 `backend_layer_map`이다.
- 레이어 책임이 미해결이면 Step 3/4에서 “repo 조건인가, usecase 정책인가, VO 불변식인가”처럼 한 가지 분기로 묻는다.
- 세부 템플릿은 `references/backend-layer-map.md`를 따른다.

### 0. Deep Interview 질문 규율

`/frame`은 Plan Mode나 구현 전에 사용자의 모호한 요청을 **실행 가능한 계약**으로 좁히는 인터뷰 단계다. 질문을 많이 하는 것이 목적이 아니라, 가장 큰 불확실성 하나를 골라 한 번에 하나씩 푼다.

질문 축은 아래 순서로 스캔한다.

1. 목표 — 무엇을 달성하려는가
2. 범위와 제외 범위 — 무엇을 포함/제외할 것인가
3. 제약 — 건드리면 안 되는 계약/권한/시간/운영 조건은 무엇인가
4. 완료 기준 — 무엇을 보면 끝났다고 판단할 수 있는가
5. 기존 맥락과 영향 범위 — 코드/문서/티켓/세션이 이미 말해주는 것은 무엇인가

규칙:
- 코드베이스, 문서, 티켓, 이전 frame, 세션 transcript로 확인 가능한 정보는 사용자에게 묻지 말고 직접 확인한다.
- 그래도 남는 핵심 불확실성 하나만 질문한다. 한 질문에서 목표+범위+검증을 동시에 묻지 않는다.
- 선택지가 도움이 되면 2~3개를 우선 제시하고, 복잡한 frame 결정에서만 최대 4개까지 허용한다. 항상 자유 입력/정정을 허용한다.
- 질문이 필요하면 기본적으로 아래 카드를 사용한다.

```markdown
질문 제목: {짧은 제목}

현재 이해:
- {코드/문서/사용자 발화로 확인한 사실}
- {아직 가정인 부분은 가정이라고 표시}

막힌 결정:
{지금 풀어야 하는 가장 중요한 불확실성 하나}

왜 중요한가:
{선택에 따라 달라지는 구현 범위, 검증 축, 위험, 롤백 비용}

추천 답안:
{있으면 이유와 함께 제시. 없으면 이 섹션을 생략}

선택 후 달라지는 것:
- {옵션 A를 고르면 달라지는 점}
- {옵션 B를 고르면 달라지는 점}

질문:
{한 가지 질문}
```

인터뷰는 다음이 정리되면 멈춘다: 목표, 포함 범위, 제외 범위, 제약, 완료 판단 기준, 아직 남은 열린 질문. 마지막에는 전체 대화록이 아니라 **결정사항과 열린 질문**만 frame draft/canonical에 반영한다.

`deep-interview`를 별도 명령으로 만들지 않는다. 이 규율은 `/frame`의 질문 품질을 높이는 내부 규칙이다.

### 0-C. Design-first는 문서 승인이 아니라 합의 축소다

`/frame`은 긴 설계 문서를 승인받는 절차가 아니다. 목표는 묵시적 합의를 줄이고, 구현 전에 결과가 달라지는 결정을 작게 확인하는 것이다.

규칙:
- 질문은 한 번에 하나만 하되, 짧은 제목만 던지지 말고 판단 맥락 카드를 함께 제공한다.
- 질문은 다음 행동이나 성공 기준을 실제로 바꾸는 경우에만 한다.
- light 작업은 2~3문장 design lock으로 충분하다.
- standard/full 작업은 claim/slice 단위로 나눠서 합의한다.
- 사용자가 이미 준 절차/제약이 있으면 일반론으로 덮지 말고 그 목적을 먼저 확인한다.
- 과한 명령·schema 확장이 필요해 보이면 1차 보류하고, 나머지 명확한 작업을 닫은 뒤 사용자에게 묻는다.

### 1. `(명백)` 질문 원칙

`/frame`의 목표·범위·성공 기준·검증 축은 후속 계약을 바꾸는 선택이다. AI가 보기에 추천안이 명백해도 **묻는다**. 대신 질문 앞에 `(명백: ...)`으로 왜 그렇게 보이는지 표시한다.

```markdown
(명백: 요청의 핵심은 버튼 노출 조건입니다. 다만 실패 메시지 포함 여부에 따라 검증 범위가 달라집니다.)
질문: 이번 범위를 어디까지 잡을까요?

1. 버튼 노출 조건만 수정 — 최소 범위
2. 버튼 조건 + 실패 메시지까지 수정 — 추천
3. 예약 상태 전환 전체 점검 — 넓은 범위
```

`(명백)`은 질문 생략 사유가 아니라 사용자가 “내가 놓친 게 있나?”라고 혼동하지 않게 하는 판단 근거다. 단, 사용자가 선택해도 이후 행동이 달라지지 않는 실행 세부는 질문하지 말고 `(명백)`으로 보고 후 진행한다.

### 2. Productive Resistance는 독립 단계

`/frame`은 AI가 계획을 예쁘게 써주는 단계가 아니다. 사용자가 놓쳤을 수 있는 질문을 1~2개 던져 계획의 빈틈을 찾는다.

Productive Resistance 질문은 반드시 행동형이어야 한다:

- 성공 기준에 추가한다
- 범위 밖으로 명시한다
- 먼저 탐색한다
- ask_first로 올린다

“괜찮나요?” 같은 확신 확인은 금지한다.

### 3. Architecture friction은 frame lens다

`/frame`은 기능 결과만 맞추는 계약이 아니라, 다음 사람/AI가 변경 지점을 다시 찾을 수 있는 구조인지도 한 번 보게 만든다. 코드 변경이 문서/카피 수준을 넘으면 사고 렌즈나 Productive Resistance에 다음 질문을 seed한다.

> 이번 변경이 작은 wrapper/분산 조건/shallow module을 늘리는가, 아니면 단순한 interface 뒤에 깊은 구현을 숨기는가?

이 질문은 리팩터링을 강제하지 않는다. 선택 결과는 `success_criteria`, `out_of_scope`, `risk_register`, `verify_plan.manual_checks`, 또는 follow-up으로 남긴다. 지금 작업의 목표가 빠른 복구라면 구조 개선을 범위 밖으로 명시할 수 있지만, 구조 비용 자체를 보지 않은 척하지 않는다.

### 4. Canonical-first 저장 원칙

저장 시점에는 항상 structured canonical을 먼저 갱신한다.

1. 사용자 답변과 draft patch로 `FrameDoc` 객체를 만든다.
2. 필수 필드와 schema를 점검한다.
3. `frame.json.tmp`에 쓰고 rename으로 atomic write한다.
4. `frame.md`는 `frame.json`을 읽어 재생성한다. 직접 편집 원천이 아니다.
5. `provenance.canonicalHash`를 제외한 canonical payload hash를 계산해 `provenance.canonicalHash`와 Studio transcript 마지막 markdown에 남긴다.
6. `worktree-meta.json`, `work_context refresh`, TaskCreate는 canonical write 성공 후 수행한다.

불일치가 발견되면 `frame.json`이 우선이다. `frame.md`/transcript는 mirror/provenance로 다시 생성하거나 경고한다.

---

## TFT Studio UI

Pi UI가 있고 `frame_studio` tool을 사용할 수 있으면, 번호형 텍스트만 출력하지 말고 Glimpse TFT Studio를 우선 사용한다. 도구 이름은 하위 호환을 위해 `frame_studio`지만, UI는 Frame/Decide/Verify/Verify Report 탭을 가진 TFT Studio shell이다.

- Step 1 직후: `frame_studio action=start tab=frame`으로 identity-bound TFT Studio를 연다.
- Step 2: 목표 fingerprint/가정/렌즈/정책축 스캔/백엔드 레이어 맵 markdown을 `frame_studio action=update tab=frame`으로 렌더링한 뒤, `frame_studio action=ask tab=frame`으로 `ok` 또는 정정 입력을 받는다. 버튼 없는 `ok` 문장을 markdown에만 남기지 않는다.
- Step 3/4/5/7/9: 선택이 필요한 지점은 `frame_studio action=ask tab=frame`을 호출해 버튼/체크박스/직접입력으로 답을 받는다. 긴 판단 맥락 카드는 직전 `update` 또는 같은 `ask`의 `markdown`에 넣고, `question` 필드는 **짧은 질문 제목 한 줄**만 넣는다.
- `ask.question`에 `현재 이해 / 막힌 결정 / 왜 중요한가 / 추천 답안 / 선택 후 달라지는 것 / 질문` 카드 전체를 넣지 않는다. 그런 호출은 Studio가 방어적으로 제목/본문을 분리하더라도 실패한 호출이다.
- Step 6/8: 현재 markdown을 `frame_studio action=update tab=frame`으로 렌더링한다. 구현 계획은 별도 Plan 탭이 아니라 Frame 탭 마지막의 `Implementation plan synthesis` 섹션으로 보여준다.
- 질문 본문을 채팅에 번호형 메뉴로 출력하는 것은 `frame_studio ask` 결과가 `unavailable`, `cancelled`, `timeout`일 때만 허용한다.
- tool 결과가 `unavailable`, `cancelled`, `timeout`이면 `ask-user-question-rules`의 번호형 text-mode fallback으로 이어간다.
- TFT Studio 제목과 identity는 command shim의 **Frame identity hint**를 따른다. P0/P1 panel label이 아니라 worktree/ticket/session planning identity에 귀속한다.
- `frame_studio` 결과는 선택값뿐 아니라 `contextDigest`, `tabSnapshot`, `transcriptRef.openCommand`(`/archive <transcriptPath>`)를 반환한다. 전문 전체를 LLM context에 주입하지 말고, 확정 의미는 canonical에 쓰고 전문은 reference/provenance로 연결한다.
- `transcriptPath`는 전체 markdown/update/question/answer 전문 저장 위치다. 사용자가 다시 보고 싶어 하면 같은 identity로 `action=open`을 호출하거나 `transcriptRef.openCommand`로 `/archive`에서 다시 연다.
- 현재 1차 shell은 Frame tab을 실제로 사용하고, Decide/Verify/Verify Report tab은 같은 work unit 안에서 후속 또는 선택 stage state를 보여줄 자리로 둔다.
- 단, 후속 stage라는 말은 순서 강제가 아니다. 명확한 핫픽스/소규모 검증은 `Frame → Verify`, `Frame → Verify Report`, `Frame only`, 또는 필요한 경우 `Verify Report only`도 정상 경로다.
- 각 탭은 UI shell일 뿐이고 canonical source는 stage별 structured data(`frame.json`, `frame.json.decisions[]`, `frame.json.verifications[]`, verify-report artifact refs)여야 한다. 전 단계 기록이 없다는 이유만으로 현재 탭 사용을 막지 않는다.
- Self-healing은 별도 TFT Studio tab이 아니다. 검증 실패/gap 이후 실행되는 repair loop이며, Studio에 표시한다면 Verify tab의 `Self-healing runs` / `Re-verify result` append section으로 남긴다.
- TFT Studio에는 generative-ui dependency를 붙이지 않는다. 대신 flat/compact, 표·diagram은 시각 보조로만, 질문/선택/전문 보존은 deterministic renderer가 책임진다.

---

## 실행 단계

### Step 1: 컨텍스트 자동 수집 + frame identity 결정 (질문 없이)

순서대로 수행:

1. command shim이 제공한 **Frame identity hint**를 먼저 읽는다.
2. cwd가 worktree인지 확인 → `<worktree>/.pi/worktree-meta.json` 읽기
3. worktree가 있으면 **worktree-bound frame**으로 진행한다.
   - 저장 위치: `<worktree>/.pi/frame.json`, `<worktree>/.pi/frame.md`
   - 표시 이름: `Frame · <worktreeName> · <ticket?>`
4. worktree가 없고 티켓이 있으면 **ticket-bound planning frame**으로 진행한다.
   - 저장 위치: `~/.pi/agent/frame-planning/planning-ticket-<TICKET>/frame.json`
   - 표시 이름: `Planning · <TICKET> · <sessionTitle?>`
5. worktree도 티켓도 없으면 **session-bound planning frame**으로 진행한다.
   - 저장 위치: `~/.pi/agent/frame-planning/planning-session-<sessionFileHash>/frame.json`
   - 표시 이름: `Planning · <하단 session title>`
   - 내부 key는 session file hash를 쓰고, 하단 타이틀은 사람이 보는 label로만 쓴다.
6. 홈 디렉토리 자체(`/Users/...`)는 identity로 쓰지 않는다. 홈은 여러 기획 탭이 공유하므로 충돌한다.
7. 메타/인자/하단 session title에서 `[A-Z]{2,}-\d+` 티켓 패턴을 추출한다. 발견되면 가능한 issue tracker 도구로 본문/acceptance/status를 가져온다.
8. `git status` + `git log --oneline -5`로 진행 상태 파악 (git repo가 아니면 planning mode로 생략 사유 기록)
9. 기존 frame이 있으면 **재진입 모드** — 덮어쓰기 전 사용자 확인
10. 워크트리에 결합된 이전 fork-panel summary가 있으면 짧게 인용

이 단계에선 **유저에게 묻지 않는다.** 출력은 단 하나: identity + 수집된 컨텍스트 요약 카드.

planning frame은 나중에 worktree가 만들어지면 해당 worktree의 `.pi/frame.json`으로 승격할 수 있어야 한다. 따라서 ticket, session title, 원래 session file, source cwd를 frame metadata에 남긴다.

### Step 2: 목표 fingerprint + 사고 초점 카드

수집한 컨텍스트로 AI가 아래를 먼저 보여준다. 코드/문서/티켓/이전 frame으로 확인 가능한 것은 먼저 확인하고, 확인하지 못한 추정만 가정으로 표시한다.

1. **내가 이해한 목표 fingerprint** — 사용자가 바로 정정할 수 있는 짧은 요약과 확인된 사실
2. **명백해 보이는 추천 범위/검증 초점** — `(명백: ...)` 근거 포함
3. **가정 4~6개** — 틀리면 사용자가 번호로 정정할 수 있는 문장
4. **같이 볼 렌즈 3~4개** — 사용자가 무엇을 신경 써야 하는지 알려주는 구체 항목
5. **정책축 스캔** — 트리거된 경우 시간 기준/적용 수/DEFAULT/채널/마이그레이션/cache 축의 확인값과 빈칸
6. **백엔드 레이어 맵** — 트리거된 경우 resolver/usecase/service/repository/entity/VO/loader/consumer 책임과 call-flow
7. **남은 불확실성 1개** — 다음 질문에서 풀 가장 큰 빈칸

예:

```markdown
내가 이해한 목표:
“파트너 예약 취소 흐름에서 권한별 버튼 노출과 실패 메시지를 정렬한다.”

(명백: 요청의 직접 증상은 버튼 미노출입니다. 다만 실패 메시지까지 포함할지에 따라 검증 범위가 달라집니다.)

가정:
1. 대상은 admin 예약 취소 UI다.
2. 성공 판정은 “취소 버튼 노출”이 아니라 “권한별 취소 가능/불가 흐름”이다.
3. DB 스키마 변경은 없다.
4. 검증은 admin UI 캡처 + 관련 mutation 테스트가 필요하다.

같이 볼 렌즈:
1. 권한 경계 — 누가 취소할 수 있고 누가 못 하는가
2. UX 실패 경로 — 취소 실패 시 메시지/복구가 보이는가
3. 검증 증거 — 테스트만으로 충분한가, 화면 캡처가 필요한가
4. 구조 경계 — 조건/모듈이 흩어져 다음 AI가 길을 잃을 구조인가

정책축 스캔:
- 트리거 없음 — 혜택/캠페인/가격/기간/DEFAULT/다중 채널 정책 변경이 아니다.

백엔드 레이어 맵:
- 트리거 없음 — backend resolver/usecase/repository/entity/VO/loader 책임 변경이 아니다.

틀린 가정이 있으면 번호로 정정해주세요. 없으면 `ok`.
```

이 단계는 자유 텍스트 정정 턴이다. TFT Studio를 쓰면 카드를 `update`로 보여준 뒤 `ask`로 `ok`/정정 입력을 받아야 한다. 아직 draft를 쓰지 않는다.

### Step 3: AskUserQuestion — 목표/범위 구체화

목표 확인 질문은 추상 카테고리가 아니라 **이번 작업의 실제 분기**를 옵션화한다. 추천안이 명백해 보여도 질문하고, 질문 앞에 `(명백: ...)`으로 근거를 쓴다. 단, 질문은 Deep Interview 카드처럼 한 번에 하나의 불확실성만 다룬다.

```markdown
현재 이해: “파트너 예약 취소 흐름에서 권한별 버튼 노출과 실패 메시지를 정렬한다.”
막힌 결정: 직접 증상만 고칠지, 실패 경로까지 성공 기준에 포함할지
추천 답안: 2번 — 사용자가 보는 실패 경로까지 닫아야 검증이 완결됩니다.
(명백: 요청은 “취소 버튼이 안 보임”이 핵심이라 1번이 최소 목표입니다. 다만 실패 메시지를 포함하면 검증 축이 하나 늘어납니다.)
질문: 목표를 어디까지로 잡을까요?

1. 최소 목표 — 취소 버튼 노출 조건만 수정
2. 표준 목표 — 버튼 조건 + 실패 메시지까지 수정
3. 넓은 목표 — 관련 예약 상태 전환 전체 점검
4. 먼저 탐색 — 기존 예약 상태 모델을 더 읽고 다시 결정

답은 번호로 주세요. 예: `2`
```

원칙:
- 옵션은 매번 도메인 구체어로 작성한다. `성공 기준 수정`, `범위 수정` 같은 메타 옵션만 쓰지 않는다.
- 가장 비싼 결정이 있으면 `막힌 결정` 또는 질문 앞 판단 맥락 카드에 표시한다.
- 코드/문서/티켓을 읽으면 답할 수 있는 선택지는 먼저 직접 확인하고, 남은 판단만 사용자에게 묻는다.
- Non-delegable 영역이면 이 단계에서 반드시 사용자 선택을 받는다.
- 사용자가 숫자로 답하면 해당 옵션을 선택한 것으로 보고 바로 진행한다.

### Step 4: AskUserQuestion — Productive Resistance

목표/범위 선택 후, draft 작성 전에 계획을 흔드는 질문을 1~2개 던진다. 단순한 반론 나열이 아니라 frame 계약을 바꾸는 행동 옵션이어야 한다. 여러 리스크가 보여도 한 질문에는 가장 큰 불확실성 하나만 담고, 나머지는 risk seed로 남긴다.

도출 기준:
1. 성공 기준이 아직 측정/관찰 가능하지 않은가?
2. 롤백 비용이 큰 선택(DB/API/상태 모델/외부 계약)이 숨어 있는가?
3. 이번 작업에서 명시적으로 제외해야 할 항목이 있는가?
4. 사용자가 나중에 “그건 당연히 포함이라고 생각했다”고 말할 수 있는 영역이 있는가?
5. 정책축 스캔에서 시간 기준/다중 적용/DEFAULT/채널별 표시/마이그레이션 책임이 미해결인가?
6. 백엔드 레이어 맵에서 책임 위치(repo/usecase/VO/service/loader)가 미해결인가?
7. 변경을 빠르게 붙이면 shallow module, 분산 조건, 복잡한 public interface가 늘어나는가?

예:

```markdown
현재 이해: “버튼 노출 조건 수정이 최소 목표로 선택됐다.”
막힌 결정: 실패 경로를 성공 기준에 넣을지, 이번 범위 밖으로 둘지
추천 답안: 1번 — 화면 증상 수정과 사용자 복구 가능성을 함께 검증합니다.
(명백: 버튼 노출만 고치면 직접 증상은 해결됩니다. 하지만 실패 메시지를 제외하면 사용자는 실패 원인을 모를 수 있습니다.)
질문: 실패 경로를 frame에 어떻게 반영할까요?

1. 성공 기준에 추가 — 실패 메시지/복구까지 확인
2. 범위 밖으로 명시 — 이번엔 버튼 노출만 검증
3. 먼저 탐색 — 기존 실패 처리 구조를 읽고 결정
```

또 다른 예:

```markdown
질문: 이번 작업에서 명시적으로 제외할 항목은?

1. 정산 상태 변경 제외 — UI/예약 상태만 다룸
2. 외부 알림 변경 제외 — 알림톡/메일은 건드리지 않음
3. 제외 없음 — 발견되는 연결 흐름까지 포함
4. 먼저 탐색 — 영향 범위를 더 읽고 제외 범위 결정
```

빈틈 질문을 억지로 만들지 않는다. 정말 아무런 frame 계약 변화가 없으면 `(명백: 추가 Productive Resistance 없음 — 목표/범위/검증축이 단일 경로)`라고 보고하고 다음 단계로 간다.

### Step 5: AskUserQuestion — 검증/리스크 초점 선택

사용자가 “뭘 신경 써야 하는지 모르겠다”는 상황을 막기 위해, draft 작성 전에 검증 초점을 좁힌다. 초점이 명백해도 계약을 바꾸는 선택이면 묻고 `(명백)` 근거를 붙인다. 이 단계도 `현재 이해 / 막힌 결정 / 추천 답안 / 질문` 구조를 우선 사용한다.

```markdown
현재 이해: “버튼 조건과 실패 메시지를 표준 목표로 잡았다.”
막힌 결정: draft에서 가장 엄격히 검증할 축 1~2개
추천 답안: 1,4번 — 사용자 흐름 증거와 기존 정상 흐름 회귀를 함께 닫습니다.
(명백: 이번 변경은 화면 노출 이슈라 사용자 흐름 캡처가 1순위입니다. 다만 권한 조건도 함께 바뀌면 회귀 방지가 중요합니다.)
질문: frame draft에서 무엇을 가장 엄격히 볼까요? (최대 2개)

1. 사용자 흐름 — 실제 화면/상태 변화 캡처
2. 데이터 정합성 — 저장값/API 응답/캐시 무효화
3. 권한·보안 — 접근 가능/불가 경계
4. 회귀 방지 — 기존 정상 흐름 유지
5. 구조 비용 — 모듈 경계/인터페이스 복잡도/다음 AI의 탐색 가능성
6. 정책축 — 기준 시간/다중 적용/DEFAULT/채널 매트릭스/마이그레이션 재현성
7. 백엔드 레이어 경계 — resolver/usecase/repository/VO/loader 중 책임 위치

답은 번호로 주세요. 예: `1,4`
```

선택 결과는 `assumptions`, `success_criteria`, `verify_plan`, `risk_register` 작성의 우선순위가 된다.

### Step 6: frame draft 작성 — 초반 plan 금지, 마지막 plan 합성 준비

AI가 frame draft를 작성한다. `/frame` 초반에는 구현 계획을 만들지 않는다. 목표·범위·성공 기준·필요한 결정이 정리된 뒤에만 Frame의 마지막 산출물로 implementation plan을 합성한다.

초반 draft에서 금지:
- 목표/범위/성공 기준이 닫히기 전 파일별 구현 순서 확정
- “이 파일을 이렇게 고친다” 수준의 premature plan
- 아직 확인하지 않은 세부 구현을 확정하는 말

작성할 것:
- `success_criteria[]`: 각 항목 `{ id, statement, evidence_locator, verify_command? }`
  - `evidence_locator`: 코드 경로/함수/엔드포인트/UI 셀렉터 등 **검증이 무엇을 가리켜야 하는지**
  - `verify_command`: 가능하면 실행 가능한 명령
- `out_of_scope[]`: Step 3/4에서 미룬 항목 + AI가 식별한 명시 제외
- `boundaries`: `{ always[], ask_first[], never[] }`
  - 결제·보안·PII·스키마·외부 연동·동시성·운영은 자동으로 `ask_first`에 시드
- `risk_register[]`: `{ risk, severity, mitigation, needs_decision }`
  - 롤백 비용 큰 결정 우선
  - 여러 파일/모듈에 걸친 변경이면 shallow module 증가, public interface 복잡도, 용어 분산 같은 architecture friction을 risk 또는 follow-up으로 기록
  - 정책축 스캔에서 미해결인 시간 기준/다중 적용/DEFAULT/채널별 표시/마이그레이션/cache identity는 `needs_decision` 또는 mitigation으로 남김
  - `needs_decision: true` 항목은 Step 8에서 task로 큐잉됨
- `policy_axis_scan`: 트리거된 작업이면 시간 기준, 적용 대상 수, DEFAULT/fallback, 소비 채널 매트릭스, 데이터/마이그레이션, API/cache identity의 결론과 열린 질문
- `backend_layer_map`: 트리거된 작업이면 entry point, application flow, domain rule, data access, cache/batching, persistence, consumers의 책임과 call-flow
- `edge_case_seeds[]`: Step 4/5 초점에 맞춘 3~5개
  - 구조 렌즈를 선택했다면 “다음 AI/사람이 변경 지점을 찾을 수 있는가” 같은 탐색성 edge도 포함
- `verify_plan`: `{ commands[], manual_checks[] }`
- `implementation_plan`: 이 시점에는 `blocked_by_decision` 또는 `draft` 상태의 **합성 준비 섹션**만 둔다.
  - decision queue가 남아 있으면 `status="blocked_by_decision"`으로 두고, 어떤 결정이 닫혀야 plan이 ready가 되는지 적는다.
  - 결정이 모두 닫혔고 사용자가 저장을 승인하면 Step 8에서 `ready`로 합성한다.
- `provenance`: Studio transcript path, 사용된 질문/답변 id, canonical hash placeholder

Draft를 보여줄 때 맨 위에 반드시 다음을 붙인다:

```markdown
검수할 때 볼 것:
1. 성공 기준이 실제 사용자/시스템 결과를 말하는가
2. 이번 작업에서 제외할 범위가 충분히 명시됐는가
3. 검증 증거가 테스트/캡처/로그 중 무엇인지 분명한가
4. claim/slice가 작게 닫히고, 각 slice의 evidence가 분명한가
5. 내가 선택한 답변이 frame 계약에 정확히 반영됐는가
6. 정책축 스캔이 필요한 작업인데 시간 기준/DEFAULT/다중 적용/채널별 규칙이 빠지지 않았는가
7. 백엔드 레이어 맵이 필요한 작업인데 resolver/usecase/repository/VO/loader 책임이 빠지지 않았는가
8. implementation plan이 frame/decide 결정에서 파생됐는가
```

### Step 7: AskUserQuestion — 구체 patch 메뉴

검수 질문은 카테고리 메뉴가 아니라 **draft에서 바로 고칠 수 있는 구체 항목**으로 만든다. Pi에서는 번호로 답할 수 있게 출력한다.

```markdown
질문: 저장 전에 무엇을 고칠까요? (복수 선택 가능)

1. SC-2에 “취소 실패 메시지 노출” 추가
2. out_of_scope에 “정산 상태 변경” 추가
3. ask_first에 “예약 상태 enum 변경” 추가
4. verify_plan에 admin 화면 캡처 추가
5. 이대로 저장

답은 번호로 주세요. 예: `1,4` 또는 `5`
```

원칙:
- 가능한 한 실제 draft 항목을 옵션으로 쓴다.
- 메타 옵션(`성공 기준 수정`)은 구체 항목을 만들 수 없을 때만 fallback으로 쓴다.
- `이대로 저장`은 통과 의례가 아니라 저장 action이다. 선택 시 Step 8로 진행한다.
- 선택된 항목만 자유 텍스트로 받아 patch한다. patch 후 같은 메뉴를 반복하지 말고, 변경 요약을 보여준 뒤 저장 확인만 짧게 받는다.

### Step 8: Canonical-first 영속화 + 의사결정 큐잉

저장은 반드시 아래 순서로 한다.

1. `FrameDoc` 객체를 완성한다.
2. `implementation_plan`을 frame/decide 결정에서 합성한다.
   - `decision_queue[]`가 남아 있으면 `status="blocked_by_decision"`으로 저장하고, Plan을 ready로 선언하지 않는다.
   - 닫힌 결정만으로 실행 방향이 충분하면 `status="ready"`로 두고 `slices`, `firstSafeStep`, `readiness`, `gates`를 채운다.
   - 각 slice는 최소한 `claim`, `scope`, `evidence_needed`, `done_when`이 읽히게 작성한다. 별도 schema 확장이 과하면 기존 slice description/acceptance에 이 네 가지를 넣는다.
   - 이 Plan은 frame contract를 대체하지 않고, `derivedFrom.frameHash`와 `derivedFrom.decisionIds`로 출처를 남긴다.
3. 필수 필드 점검:
   - `identity`, `goal`, `success_criteria`, `out_of_scope`, `boundaries`, `risk_register`, `verify_plan`, `implementation_plan`, `provenance`
   - 정책축 스캔 트리거 작업이면 `policy_axis_scan` 또는 이에 준하는 `review_lenses`/`risk_register`/`verify_plan` 반영 여부
   - 백엔드 레이어 맵 트리거 작업이면 `backend_layer_map` 또는 이에 준하는 `review_lenses`/`risk_register`/`verify_plan` 반영 여부
   - `decisions[]`는 없으면 빈 배열
   - `decision_queue[]`는 없으면 빈 배열
4. canonical JSON을 먼저 쓴다.
   - 대상: worktree mode면 `<worktree>/.pi/frame.json`, planning mode면 Step 1에서 정한 planning path
   - 쓰기 방식: `frame.json.tmp` → rename
5. `provenance.canonicalHash`를 비운 canonical payload의 SHA-256 hash를 계산한다.
6. 그 hash를 `provenance.canonicalHash`에 반영해 `frame.json`을 한 번 더 atomic write한다.
7. 이후 hash 검증은 `provenance.canonicalHash` 필드를 제외한 payload로 재계산한다.
8. `frame.md`를 `frame.json`에서 재생성한다.
   - 상단에 `Generated from frame.json. Do not edit as source.` 표시
   - `canonicalHash`, `updatedAt`, `transcriptPath` 표시
9. mirror sanity check:
   - `frame.md`의 SC 개수와 `frame.json.success_criteria.length`가 맞는지 확인
   - decision queue 개수가 맞는지 확인
   - `implementation_plan.status`와 남은 decision queue 상태가 모순되지 않는지 확인
10. `worktree-meta.json`에 `frame: { path, updatedAt, summary, canonicalHash }` 키 추가
11. `work_context action=refresh`로 work-unit scoped Working Context Card를 만든다.
   - 저장 위치: worktree면 `<worktree>/.pi/work-context.json`, planning/session이면 identity별 state dir
   - 내용: goal, currentSlice, mustKeep, mustNot, openQuestions, verifyFocus, frame/transcript/tasks refs
   - 원칙: 전체 transcript를 주입하지 않고 `transcriptRef`/`/archive`는 refs로만 남긴다.
12. `implementation_plan.slices[]` → 각 항목당 `TaskCreate`:
   - `kind: "slice"`, `owner: "agent"`
   - `acceptance`: slice validation
   - `refs: { sliceId, frame, successCriteria? }`
13. `risk_register` 중 `needs_decision: true` 항목 → 각 항목당 `TaskCreate`:
   - `kind: "decision"`, `owner: "user"`
   - `subject`: 결정 제목
   - `description`: 리스크 설명 + 후보 옵션
   - `metadata: { kind: "frame.decision", riskRef, frameVersion }`
14. `verify_plan.manual_checks` → 각 항목당 `TaskCreate`:
    - `kind: "verify"`, `owner: "agent"`
    - `metadata: { kind: "frame.verify_check" }`
15. TFT Studio를 쓰고 있으면 `frame_studio action=update tab=frame`으로 저장 결과와 Plan synthesis, Working Context Card 요약을 남긴다. Step 9의 다음 단계 질문까지 끝난 뒤 **반드시** `frame_studio action=finish tab=frame`으로 닫는다.
    - `frame.json` path
    - `frame.md` path
    - `canonicalHash`
    - work-context path
    - work-task board path
    - queued task count

TFT Studio finish invariant:
- canonical `frame.json`과 `frame.md` 저장이 성공한 뒤에만 finish한다.
- Step 9 다음 단계 선택을 받았으면 선택 결과를 final markdown에 포함하고 finish한다.
- Step 9 질문이 `unavailable`, `cancelled`, `timeout`이어도 frame 저장 자체가 끝났다면 “다음 단계 미선택”을 기록하고 finish한다.
- finish를 생략하면 Studio에서 해당 Frame run이 `running`으로 남으므로, `/frame` 완료 보고 전에 반드시 tool result를 확인한다.

실패 처리:
- canonical write가 실패하면 `frame.md`, task, worktree-meta를 만들지 않는다.
- `frame.md` 생성만 실패하면 canonical은 성공으로 보고, mirror 재생성 필요를 사용자에게 알린다.
- transcript와 canonical이 충돌하면 canonical이 우선이며, 충돌 내용을 `provenance.notes[]` 또는 사용자 보고에 남긴다.

### Step 9: AskUserQuestion — 다음 단계

```markdown
질문: <n>개 결정 큐잉 / verify 명령 <m>개 / plan 상태 <status>. 다음은?

1. /decide — 큐잉된 결정 처리
2. plan 보완 — Frame 안의 implementation_plan만 다듬기
3. /verify dry-run — 검증 계획만 먼저 점검
4. fork해서 시작 — worktree로 옮겨 같은 frame/plan으로 구현
5. 바로 구현 시작 — 현재 worktree에서 진행
6. 여기서 멈춤

답은 번호로 주세요. 예: `4`
```

사용자의 다음 단계 선택까지 transcript에 남긴 뒤 `frame_studio action=finish`를 호출한다. `fork해서 시작`을 선택하면 `worktree_fork` tool을 호출하지 말고 `frame_worktree_fork` tool을 호출한다. 이 도구는 `/frame` command shim이 저장한 command context로 실제 `/wt fork` 경로를 실행해 현재 패널을 forked worktree session으로 전환하고, 새 세션에서 구현 follow-up을 시작한다. tool이 `BLOCKED`를 반환하면 worktree를 만들지 않았다는 뜻이므로 현재 세션에서 절대경로로 이어가지 말고 중단해 사용자에게 이유를 보고한다. planning frame은 worktree 생성/전환 시 `.pi/frame.json`으로 자동 승격되어야 하며, 사용자는 승격 절차를 따로 의식하지 않는다.

---

## 합리화 차단

| 합리화 | 차단 |
|---|---|
| "frame.json까지 만들 정도는 아니야" | 작은 작업이면 success_criteria 1줄 + verify_command 1개로 30초 안에 끝난다. 그게 안 되는 작업은 작은 게 아니다. |
| "성공 기준은 코드 보면 알아" | verify는 코드를 다시 본다. frame.json은 verify가 코드를 보지 *않고도* PASS/FAIL을 정의할 수 있게 만든다. |
| "ticket은 머리에 있으니 메타 안 적어도 됨" | 다음 fork·세션에서 사라진다. 30초 적는 비용 vs 30분 재구성 비용. |
| "엣지 케이스는 verify에서 도출하면 됨" | verify 시점엔 구현이 끝났다. frame이 미리 시드를 박아야 구현 중 처리된다. |
| "명백한데 왜 물어?" | `/frame`에서는 목표·범위·검증축이 계약을 바꾸므로 묻는다. 대신 `(명백)` 근거를 보여줘 혼동을 줄인다. |
| "Productive Resistance는 시간 낭비" | 빈틈 질문 1개가 잘못된 성공 기준으로 1시간 구현하는 것을 막는다. |
| "테스트만 통과하면 구조 비용은 나중 문제" | AI가 다시 찾기 어려운 shallow module 증가는 다음 변경 비용이다. 지금 고치지 않아도 risk/out_of_scope/follow-up으로 남긴다. |
| "frame.md만 있으면 충분" | frame.md는 mirror다. `/verify`와 `/decide`가 읽는 단일 원천은 frame.json이다. |
| "tasks는 agent 내부 todo라 사용자가 안 봐도 됨" | work-task board는 현재 slice/사용자 결정/검증 대기 상태를 외부화하는 인지 도구다. 사용자에게 필요한 항목(owner=user, kind=decision/blocked)을 먼저 보이게 한다. |
| "Ask first 영역까지 매번 적는 건 과하다" | 결제/보안/PII가 ask_first에 없으면 합리화로 우회된다. 5초로 가장 비싼 사고를 막는다. |
| "AI가 draft를 잘 만들었으니 사용자는 OK만 누르면 됨" | TFT 실패다. draft 전에 사용자가 볼 렌즈와 실제 분기를 번호형 질문으로 좁힌다. |
| "모호하니 질문을 여러 개 한 번에 던지자" | Deep Interview 실패다. 가장 큰 불확실성 하나만 골라 `현재 이해 / 막힌 결정 / 왜 중요한가 / 추천 답안 / 선택 후 달라지는 것 / 질문` 카드로 묻는다. |
| "사용자에게 물으면 빠르다" | 코드/문서/티켓/이전 frame으로 확인 가능한 사실은 먼저 직접 확인한다. 남은 판단만 묻는다. |
| "처음부터 구현 계획까지 같이 주면 친절하다" | `/frame` 초반에는 plan을 만들지 않는다. 목표·범위·결정이 닫힌 뒤 Frame의 마지막 산출물로 implementation plan을 합성한다. |

---

## §5: frame.json 스키마

```ts
type FrameDoc = {
  version: 1;
  identity: {
    mode: "worktree" | "planning-ticket" | "planning-session";
    key: string;              // worktree:<hash> | planning:ticket:PROJ-123 | planning:session:<hash>
    displayTitle: string;     // Glimpse/보고서에 보여줄 이름
    sourceSessionFile?: string;
    sourceSessionTitle?: string;
    promotedToWorktree?: string;
  };
  workspace: string;          // worktree 이름 또는 planning label
  worktree?: string;          // worktree mode일 때 절대 경로
  ticket?: {
    key: string;
    url: string;
    summary: string;
    acceptance?: string;
  };
  goal: string;
  scope_size: "small" | "standard" | "risky";  // Non-delegable 감지 시 자동 risky
  assumptions: string[];
  review_lenses: string[];
  policy_axis_scan?: {
    triggered: boolean;
    triggerDomains: string[];
    axes: Array<{
      axis: "time_basis" | "application_cardinality" | "default_fallback" | "channel_matrix" | "data_migration" | "api_cache_identity";
      decision: string;
      source: "code" | "ticket" | "user" | "assumption" | "open_question";
      unresolved: boolean;
    }>;
    channel_matrix?: Array<{
      channel: string;
      timeBasis: string;
      campaignSelection?: string;
      defaultPolicy?: string;
      displayPolicy?: string;
      verification: string;
    }>;
  };
  backend_layer_map?: {
    triggered: boolean;
    triggerReason: string;
    callFlow: string[];
    layers: Array<{
      layer: "entry_point" | "application_flow" | "domain_rule" | "data_access" | "cache_batching" | "persistence" | "consumer" | "external";
      names: string[];
      responsibility: string;
      ownsDecision?: string;
      verification?: string;
      status: "confirmed" | "assumption" | "open_question" | "not_applicable";
    }>;
    openQuestions?: string[];
  };
  productive_resistance: Array<{
    question: string;
    selected: string;
    rationale?: string;
    frameImpact: string;      // success_criteria/out_of_scope/boundary/risk 중 무엇이 바뀌었는지
  }>;
  success_criteria: Array<{
    id: string;               // SC-1, SC-2 ...
    statement: string;
    evidence_locator: string; // 파일/엔드포인트/셀렉터/메트릭
    verify_command?: string;
  }>;
  out_of_scope: string[];
  boundaries: {
    always: string[];
    ask_first: string[];
    never: string[];
  };
  risk_register: Array<{
    id?: string;              // RISK-1 ...
    risk: string;
    severity: "low" | "med" | "high";
    mitigation: string;
    needs_decision: boolean;
  }>;
  edge_case_seeds: string[];
  verify_plan: {
    commands: string[];
    manual_checks: string[];
  };
  implementation_plan: {
    status: "blocked_by_decision" | "draft" | "ready";
    derivedFrom: {
      frameHash?: string;
      decisionIds: string[];
    };
    blockers?: string[];
    slices: Array<{
      id: string;             // SLICE-1 ...
      goal: string;
      expectedFiles?: string[];
      validation: string[];
    }>;
    firstSafeStep: string;
    readiness: {
      dependencies?: "unknown" | "running" | "ready" | "blocked";
      notes?: string[];
    };
    gates: string[];          // ask_first/deploy/manual gates that still constrain execution
  };
  decisions: Array<{
    id: string;               // DEC-1 ... (/decide가 추가)
    title: string;
    taskId?: string;
    alternatives_considered: string[];
    selected: string;
    rationale: string;
    tradeoffs_accepted: string;
    mitigations?: string[];
    challenge: {
      intensity: "low" | "medium" | "high" | "ask_first";
      objection: string;
      response: "accepted" | "accepted_with_mitigation" | "reconsidered" | "returned_to_frame";
      userSelection: string;
    };
    challenged: true;         // /decide는 항상 challenge 수행
    decidedAt: number;
  }>;
  decision_queue: Array<{
    taskId: string;
    title: string;
    riskRef?: string;
  }>;
  provenance: {
    transcriptPath?: string;
    sourceAnswerIds?: string[];
    canonicalHash?: string;
    generatedMirrors?: {
      frame_md?: string;
    };
    notes?: string[];
  };
  links: {
    jira?: string;
    slack_threads?: string[];
    notion?: string[];
  };
  createdAt: number;
  updatedAt: number;
};
```

`/verify`는 단 하나의 계약을 지킨다: **frame.json이 없으면 frame부터 하라고 차단; 있으면 success_criteria의 row 단위로 evidence를 집계.**

---

## §6: 실전 흐름 예시

```
USER: /frame 결제 취소 시 부분 환불 지원해줘

AI (Step 1, 질문 없음):
컨텍스트:
- worktree: atlanta-PROJ-123 (branch: feat/PROJ-123/partial-refund)
- ticket(자동): PROJ-123 — "부분 환불 지원"
- 변경 없음 (clean)

AI (Step 2):
내가 이해한 목표:
“주문 결제에서 부분 환불을 지원하고 정산/관리자 확인까지 검증한다.”

(명백: ticket acceptance에 정산과 관리자 UI가 함께 언급되어 있어 API만으로는 성공 기준이 닫히지 않습니다.)

가정:
1. 성공 판정은 “부분환불 API 호출 성공”이 아니라 “정산 반영까지 일치”다.
2. DB 스키마 변경 가능성이 있다.
3. 외부 PG는 Toss를 우선 확인한다.
4. 관리자 UI는 범위에 포함될 수 있다.

같이 볼 렌즈:
1. 정산 데이터 정합성 — 환불 금액이 리포트까지 일치하는가
2. 외부 PG 경계 — Toss만 할지, 다른 PG를 제외할지
3. 관리자 UX — 부분환불 상태가 사람이 확인 가능하게 보이는가

틀린 가정이 있으면 번호로 정정해주세요. 없으면 `ok`.

USER: 3번 — Toss만 범위에 포함, PayPal은 제외.

AI (Step 3):
(명백: acceptance가 정산과 관리자 UI까지 요구하므로 3번이 가장 자연스럽습니다. 다만 범위를 줄일 수 있습니다.)
질문: 목표를 어디까지로 잡을까요?

1. Toss 부분환불 API만 지원
2. Toss 부분환불 + 정산 반영까지 포함
3. Toss 부분환불 + 정산 + 관리자 UI까지 포함
4. 먼저 기존 환불 모델을 더 탐색

USER: 3

AI (Step 4 Productive Resistance):
질문: 이번 작업에서 명시적으로 제외할 항목은?

1. PayPal 부분환불 제외 — Toss만 frame에 포함
2. 모바일 앱 표시 제외 — admin UI만 검증
3. 제외 없음 — 연결 흐름 전체 포함
4. 먼저 탐색 — 영향 범위 확인 후 제외 결정

USER: 1,2

AI (Step 5):
질문: frame draft에서 무엇을 가장 엄격히 볼까요? (최대 2개)

1. 정산 데이터 정합성
2. Toss API 실패/재시도 경계
3. 관리자 UI 캡처
4. 기존 전액환불 회귀 방지

USER: 1,3

AI (Step 6 draft):
검수할 때 볼 것:
1. 성공 기준이 정산/관리자 결과까지 말하는가
2. PayPal/모바일 앱 제외 범위가 명확한가
3. 검증 증거가 테스트와 화면 캡처로 나뉘는가
4. 선택한 답변이 frame 계약에 정확히 반영됐는가

AI (Step 7):
질문: 저장 전에 무엇을 고칠까요? (복수 선택 가능)

1. SC-2에 “정산 리포트 금액 일치”를 더 명시
2. out_of_scope에 “PayPal 부분환불” 추가
3. verify_plan에 관리자 UI 캡처 추가
4. edge_case에 “부분환불 후 같은 결제 재시도” 추가
5. 이대로 저장

USER: 4

AI (Step 8):
- implementation_plan.status=`blocked_by_decision` 기록
- frame.json atomic write
- frame.md regenerated from frame.json
- canonicalHash 기록
- frame.decision task 2개 큐잉
- frame.verify_check task 2개 큐잉

AI (Step 9):
질문: 2개 결정 큐잉 / verify 명령 2개 / plan 상태 blocked_by_decision. 다음은?

1. /decide — 큐잉된 결정 처리
2. plan 보완 — Frame 안의 implementation_plan만 다듬기
3. /verify dry-run — 검증 계획만 먼저 점검
4. fork해서 시작 — worktree로 옮겨 같은 frame/plan으로 구현
5. 바로 구현 시작 — 현재 worktree에서 진행
6. 여기서 멈춤
```
