---
name: test-boundary-refactor
description: 테스트가 과하게 mock/fixture/구현세부 assertion에 묶였는지 점검하고, 기능 테스트·내부 로직 테스트·외부 의존성 mock 경계를 기준으로 실용적으로 다듬을 때 사용한다. "테스트가 과하지 않은지", "모킹 기준", "내부 메서드는 직접 테스트", "외부 API만 mock", "unit/contract test 어디까지" 같은 요청에 사용한다.
argument-hint: "[파일/디렉터리/PR/diff] [--apply] [--staged]"
disable-model-invocation: false
---

# test-boundary-refactor

테스트를 “많이 쓰는 것”이 아니라 **책임 경계에 맞게 납득 가능하게 쓰는 것**으로 다듬는다.

## 핵심 원칙

> 테스트는 책임 경계에 맞춰 쓴다.  
> 기능 단위 테스트는 유저 관점의 행동과 결과만 검증한다.  
> 내부 메서드/로직은 mock하지 않고 분리해서 직접 테스트한다.  
> API, DB, OAuth, router, webview, third-party SDK 같은 외부 의존성만 mock으로 격리한다.

## Test Boundary Matrix

| 범주 | 무엇을 검증하나 | 좋은 테스트 | 피해야 할 냄새 |
|---|---|---|---|
| 사용자-facing 기능 테스트 | 사용자가 보는 행동과 결과 | “드롭다운이 열린다”, “버튼 클릭 후 상태 문구가 바뀐다”, “CTA가 올바른 링크를 가진다” | 내부 함수 호출 여부, 구현 상태 변수, 불필요한 provider/mock 세팅 |
| 내부 로직 테스트 | 계산, 분기, mapper, helper, hook/service 순수 책임 | 로직을 분리해 입력→출력을 직접 검증 | 컴포넌트 테스트에서 내부 메서드를 mock/spy로 우회 |
| 외부 의존성 boundary | API, DB, OAuth, router, webview, third-party SDK | mock/stub/fake recorder로 외부 효과를 차단하고 내 코드가 넘기는 contract를 검증 | 실제 외부 호출, 과한 e2e, 외부 성공을 내 테스트 책임으로 삼기 |
| contract/integration | 내 코드 계층 사이에서 값이 누락되지 않는지 | 작은 범위의 real path + 외부 boundary만 fake | 전체 app suite fan-out, broad fixture, flaky environment 의존 |

## Workflow

### 1. 범위 확인

먼저 현재 요청이 분석인지 수정인지 분리한다.

- 명시적 `/test-refine` 또는 “고쳐줘/정리해줘/다듬어줘”면 수정 후보까지 진행한다.
- “봐줘/어떤가”면 우선 audit 결과와 수정 계획을 제시한다.
- `--apply`가 있으면 경계가 명확한 안전한 수정은 바로 적용할 수 있다.
- 결제, 알림, 외부 API 호출, DB write 같은 side effect가 있으면 mock/stub 경계를 먼저 잡고 실제 호출은 막는다.

### 2. 테스트와 대상 코드 읽기

사용자가 준 파일/디렉터리/PR/diff anchor부터 본다. anchor가 없으면 현재 git diff에서 시작한다.

확인할 것:

- 변경된 test/spec 파일
- 테스트 대상 source 파일
- mock/fixture/provider setup
- wrapper script가 전체 suite로 fan-out되는지 여부
- 기존 프로젝트 테스트 컨벤션 문서가 있으면 가까운 범위만

### 3. 테스트를 책임 경계로 분류

각 테스트 또는 describe block마다 아래 라벨을 붙인다.

```text
[behavior] 사용자 행동/결과 검증
[logic] 내부 순수 로직 직접 검증
[boundary] 외부 의존성 mock/stub/fake
[contract] 내 코드 계층 간 값 전달/호출 contract
[noise] 목적 대비 과한 mock/fixture/assertion
```

### 4. 과한 테스트 냄새 찾기

다음이 보이면 수정 후보로 표시한다.

- 사용자 행동 테스트인데 내부 hook/helper 함수 호출을 assert한다.
- 컴포넌트 테스트가 내부 메서드를 mock/spy한다.
- 테스트 목적과 무관한 i18n/router/membership/provider mock이 많다.
- fixture가 실제 검증 대상보다 훨씬 크다.
- “없어도 되는 필드”를 넣고 다시 “보이지 않음”을 검증한다.
- 외부 API/OAuth/DB 성공을 내 코드 테스트 책임처럼 다룬다.
- 전체 app/workspace test를 돌려 baseline failure와 섞는다.

### 5. 수정 전략 선택

| 냄새 | 우선 수정 |
|---|---|
| behavior test가 내부 구현을 봄 | assertion을 사용자-visible 결과로 바꾼다 |
| 내부 로직이 컴포넌트 안에 묻힘 | 순수 함수/hook/service로 분리해 직접 테스트한다 |
| 외부 의존성이 실제 호출됨 | 외부 boundary만 mock/stub/fake로 격리한다 |
| mock이 너무 많음 | 테스트 목적에 필요한 외부 boundary mock만 남긴다 |
| fixture가 너무 큼 | 검증 대상 필드만 남긴 최소 fixture로 줄인다 |
| unit만으로 contract 누락 위험 | 외부 boundary만 fake인 작은 contract test를 추가한다 |
| wrapper test가 broad fan-out | 가까운 spec 직접 실행 또는 fan-out 사실을 명시하고 baseline 분리 |

### 6. 수정 실행 규칙

수정할 때는 작게 간다.

1. 불필요한 mock/fixture/assertion 제거
2. 필요한 내부 로직만 분리
3. 분리한 로직의 직접 테스트 추가
4. 외부 boundary mock/fake 정리
5. 가까운 테스트만 실행
6. 변경이 크면 커밋 단위를 테스트 정리 / 로직 분리 / contract 추가로 나눈다

금지:

- 테스트를 핑계로 대규모 아키텍처 리팩터링을 시작하지 않는다.
- 사용자-facing behavior가 그대로인지 확인 없이 내부 구조만 바꾸지 않는다.
- “좋은 테스트 일반론”을 이유로 현재 버그/요구와 무관한 테스트를 추가하지 않는다.

## Output format

분석만 할 때:

```markdown
## test-refine 결과

### 경계 분류
| 테스트/블록 | 분류 | 판단 |
|---|---|---|

### 과한 부분
- ...

### 권장 수정
1. ...

### 가까운 검증
- 실행할 테스트/린트와 fan-out 예상
```

수정까지 했을 때:

```markdown
완료했습니다.
- 정리: behavior test는 사용자 결과만 남김 / 내부 로직 직접 테스트 / 외부 boundary mock 정리
- 변경: `path...`
- 검증: `command` 통과
- 주의: baseline 또는 남은 gap
```

## Validation guidance

검증 명령은 현재 diff와 가장 가까운 범위만 선택한다.

- Jest/Vitest면 가능하면 직접 test file 경로를 넘긴다.
- `pnpm <script> -- <path>`가 실제로 좁혀지는지 package script를 모르면 먼저 확인한다.
- wrapper가 전체 suite를 돌리면 그 사실을 보고하고 baseline failure와 분리한다.
- 같은 test/lint family가 두 번 실패하면 무작정 넓히지 말고 원인·시도·다음 선택지를 보고한다.

## Edge cases

- **외부 라이브러리 wrapper가 이미 있음**: wrapper contract를 테스트하고 raw library는 mock하지 않아도 된다.
- **UI library 동작 자체가 요구사항**: 사용자-visible behavior이면 behavior test로 검증하고, library 내부를 assert하지 않는다.
- **internal method가 private라 직접 테스트하기 어렵다**: public behavior로 충분하면 그대로 두고, 복잡한 정책이면 순수 helper/hook/service로 추출한다.
- **DB/API contract가 핵심인 BE 작업**: 실제 DB/API 호출 대신 repository/client boundary를 fake하고 service/usecase policy를 직접 테스트한다. 필요한 경우 dev integration은 별도 검증으로 분리한다.
- **리뷰 코멘트 대응**: 리뷰어가 요구한 assertion 의도와 이 matrix를 매핑하고, 과한 요구라면 대체 테스트 근거를 답글에 남긴다.
