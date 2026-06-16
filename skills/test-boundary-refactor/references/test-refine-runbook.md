# Test Refine Runbook

`test-boundary-refactor`를 실제 코드에 적용할 때 쓰는 실행 런북이다. 핵심 판단은 `SKILL.md`의 Test Boundary Matrix가 source of truth이고, 이 문서는 project-agnostic 적용 순서를 정리한다.

구체 회사/레포/세션/PR 사례는 public pilee에 두지 않는다. 필요한 경우 설치된 private overlay의 테스트 경계 casebook을 함께 읽고, public 런북에는 sanitizable 판단과 절차만 남긴다.

## 0. 목적 고정

먼저 이번 요청이 무엇인지 한 문장으로 고정한다.

| 요청 유형 | 기본 행동 |
|---|---|
| “테스트가 과한지 봐줘” | audit 결과와 수정 후보를 먼저 제시한다. |
| “모킹 기준 맞게 고쳐줘” | mock/fixture/assertion을 경계별로 분류하고 좁은 수정까지 진행한다. |
| “내부 메서드는 직접 테스트하게 해줘” | 내부 로직 추출 필요성을 판단하고, 추출한다면 직접 unit test를 붙인다. |
| “외부 API만 mock해줘” | API/DB/OAuth/router/webview/SDK boundary만 fake/mock으로 남긴다. |
| PR review 대응 | 리뷰어 요구를 그대로 따르기보다 어떤 책임 경계를 닫는지 먼저 매핑한다. |

금지: 테스트 일반론을 이유로 현재 요구와 무관한 architecture refactor나 full-suite 정비를 시작하지 않는다.

## 1. Diff에서 테스트 지형 만들기

anchor가 있으면 anchor부터, 없으면 현재 diff부터 본다.

```bash
git status --short --branch
git diff --name-only
git diff --cached --name-only
```

다음 표를 짧게 만든다.

| 파일/블록 | 현재 테스트 의도 | 실제 assertion | mock/fixture | 1차 분류 |
|---|---|---|---|---|
| `*.test.*` | 무엇을 막으려는가 | 무엇을 보고 있는가 | 무엇을 fake했는가 | behavior/logic/boundary/contract/noise |

## 2. 경계 분류 체크리스트

### A. Behavior test

사용자-facing 기능 테스트라면 아래 질문을 통과해야 한다.

- 사용자가 실제로 관찰하는 결과를 assert하는가?
- 내부 함수 호출 여부, hook state, helper branch를 직접 보고 있지 않은가?
- 테스트 이름이 “사용자가 무엇을 할 때 무엇을 본다”로 읽히는가?
- mock/provider가 사용자 행동 검증에 꼭 필요한 외부 boundary만 남았는가?

좋은 assertion 예:

- dropdown option이 보인다/사라진다.
- 버튼 클릭 후 CTA label, disabled state, 안내 문구가 바뀐다.
- navigation link, webview open request, tracking payload 같은 사용자-facing effect가 expected contract를 가진다.

피해야 할 assertion 예:

- 내부 helper가 몇 번 호출됐는지.
- private state 값이 특정 순서로 변했는지.
- 사용자 결과와 무관한 provider/i18n/router/membership fixture 전체 shape.

### B. Internal logic test

내부 로직이 복잡하다면 behavior test에서 억지로 보지 않는다.

- 계산/분기/mapper/parser/helper/hook policy를 순수 함수나 작은 service로 분리할 수 있는가?
- 분리한 로직을 mock 없이 입력→출력으로 직접 테스트할 수 있는가?
- public behavior만으로 충분히 닫히는 단순 로직을 과하게 추출하고 있지는 않은가?

분리 기준:

| 분리 필요 | 그대로 둬도 됨 |
|---|---|
| branch가 많고 edge case가 기능 테스트 fixture를 크게 만든다 | UI behavior 1~2개로 충분히 설명된다 |
| 같은 로직이 여러 surface에서 재사용된다 | 단일 컴포넌트의 단순 display condition이다 |
| 외부 dependency 없이 순수 입력/출력으로 닫힌다 | DOM/user event와 강하게 결합되어 있다 |

### C. External boundary mock

mock은 내 코드 밖의 효과를 막기 위해 쓴다.

mock 후보:

- HTTP/GraphQL/API client
- DB/repository/storage
- OAuth/provider SDK
- router/navigation/webview/native bridge
- third-party SDK, clock/randomness when deterministic contract가 필요할 때

mock하지 말아야 할 것:

- 내가 작성한 내부 helper/service의 핵심 정책
- behavior test에서 사용자가 관찰할 결과를 만드는 내부 상태 전이
- 단순 format/mapper를 우회하기 위한 spy

### D. Contract test

unit test만으로 값 전달 누락이 반복될 수 있으면 작은 contract test를 추가한다.

- 외부 boundary는 fake/mock으로 둔다.
- 내 코드 경로는 가능한 real path로 통과시킨다.
- assertion은 “어떤 값이 외부 boundary로 전달되는가” 또는 “어떤 response가 내 domain result로 변환되는가”에 둔다.
- 전체 app/bootstrap/e2e까지 넓히지 않는다.

## 3. 수정 순서

1. **삭제 후보 먼저 표시**
   - 목적 없는 mock
   - 너무 큰 fixture
   - 내부 구현 호출 assertion
   - 중복 setup
2. **behavior assertion으로 치환**
   - 내부 구현 대신 화면/결과/contract를 본다.
3. **내부 로직 직접 테스트 여부 판단**
   - 복잡하면 helper/hook/service로 분리하고 unit test를 추가한다.
   - 단순하면 추출하지 않는다.
4. **외부 boundary mock 정리**
   - API/DB/OAuth/router/webview/SDK만 남긴다.
5. **contract gap 확인**
   - 계층 사이 값 전달 누락 위험이 있으면 작은 contract test를 추가한다.
6. **가까운 검증 실행**
   - test file 직접 실행을 우선한다.
   - wrapper가 broad suite면 fan-out을 보고하고 baseline과 분리한다.

## 4. Decision table

| 발견한 냄새 | 해석 | 수정 |
|---|---|---|
| 컴포넌트 테스트가 내부 helper를 spy | behavior test가 logic test 역할까지 함 | helper 직접 테스트 + component는 사용자 결과만 assert |
| fixture가 domain object 전체를 복사 | 테스트 의도보다 데이터가 큼 | 필요한 필드만 남긴 factory/builder로 축소 |
| router/i18n/provider mock이 많은데 assertion과 무관 | setup noise | assertion에 필요한 boundary만 남김 |
| API 성공/실패를 실제 호출에 의존 | 외부 effect가 테스트를 흔듦 | API client mock + request/response contract 검증 |
| unit test는 통과하지만 service→repository 변수 누락 가능 | contract gap | 외부 repository만 fake하고 service path를 통과 |
| 리뷰어가 “이 함수 호출 assert 추가” 요구 | 구현 세부 고정 위험 | 사용자-visible 결과나 boundary contract로 대체 가능한지 제안 |

## 5. 검증 runbook

검증 전 한 줄로 fan-out을 밝힌다.

```text
검증 fan-out: 변경된 spec 1개만 직접 실행합니다.
```

우선순위:

1. 변경한 test file 직접 실행
2. 해당 package의 nearest unit test
3. 관련 lint/typecheck direct executable
4. wrapper script는 narrow 인자를 실제로 받는지 확인한 뒤 사용
5. 전체 suite/build는 diff가 그 범위를 정당화할 때만

같은 family가 두 번 실패하면 멈추고 정리한다.

```markdown
실패 원인: ...
시도한 수정: ...
이번 diff와 관련성: related / unrelated baseline / unclear
다음 선택지: 1) ... 2) ...
```

## 6. 최종 보고 템플릿

```markdown
## test-refine 결과

### 경계 분류
| 테스트/블록 | 분류 | 판단 |
|---|---|---|
| ... | behavior/logic/boundary/contract/noise | ... |

### 수정
- behavior test: 내부 구현 assertion 제거, 사용자 결과 assert로 치환
- logic test: `...` 직접 테스트 추가
- boundary mock: `...`만 유지

### 검증
- `...` 통과

### 남은 gap
- 없음 / baseline / 별도 integration 후보
```

## 7. Red flags

- “mock을 줄인다”면서 외부 API/DB를 실제 호출하게 만든다.
- “내부 로직 직접 테스트”를 이유로 public behavior가 깨졌는지 확인하지 않는다.
- 리뷰 코멘트 대응에서 리뷰어 표현을 literal로만 따라가고 테스트 책임 경계를 설명하지 않는다.
- broad suite 실패를 이번 테스트 리팩터링 실패처럼 보고한다.
- 테스트를 줄이기만 하고 contract gap을 남긴다.
