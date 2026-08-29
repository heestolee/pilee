# Meta Review 설명·ReviewCard 계약

Meta Review는 먼저 모든 changed line을 설명한 뒤, 실제로 작성자에게 남길 리뷰 포인트만 ReviewCard로 분리한다.

## File guide와 explanation hunk

모든 변경 파일은 `path`, `role`, `changeReason`, `flow`, 선택적 `impact`를 갖는다. 모든 addition/deletion `D...` evidence는 정확히 하나의 `E-...` hunk에 포함한다.

```json
{
  "path": "src/policy.ts",
  "role": "이 파일이 소유한 책임",
  "changeReason": "이 작업에서 변경된 이유",
  "flow": "entry → layer → consumer",
  "impact": "사용자·운영·후속 consumer 영향",
  "hunks": [{
    "id": "E-01",
    "title": "의미 단위 제목",
    "evidenceIds": ["D000123", "D000124"],
    "whatChanged": "무엇이 바뀌었는지",
    "why": "왜 바뀌었는지",
    "evidence": "코드·타입·schema·test·ticket 근거",
    "responsibility": "이 레이어가 맡는 책임",
    "concepts": ["사용된 개념"],
    "flowImpact": "호출·데이터 흐름과 결과",
    "uncertainty": "코드만으로 확정할 수 없는 가정"
  }]
}
```

같은 의도의 연속 줄은 한 hunk로 묶되 설명 없는 changed evidence를 남기지 않는다. 중립 설명을 review finding처럼 표현하지 않는다.

## ReviewCard

각 카드는 독립적으로 읽히고, GitHub에 남길 문장과 사용자의 판단 근거를 분리해야 한다.

## 필수 구조

```json
{
  "id": "R-01",
  "title": "리뷰 포인트 제목",
  "strength": "required | question | optional",
  "confidence": "high | medium | low",
  "evidenceIds": ["D000123"],
  "reviewDraft": "작성자에게 바로 전달할 리뷰 문장",
  "explanation": "문제가 발생하는 조건과 영향",
  "meta": {
    "summary": "LLM 재발 방지 관점의 결론",
    "existingGuard": "기존 skill·guide·lint·test 적용 여부 또는 확인 질문",
    "structuralPrevention": "타입·API·구조로 막는 후보",
    "machinePrevention": "lint·test·CI로 탐지하는 후보",
    "scope": "current-pr | follow-up | both | none"
  },
  "precedents": [
    {
      "id": "human-review-case-id",
      "url": "https://github.com/...",
      "label": "사례 이름",
      "similarity": "현재 finding과 닮은 점",
      "difference": "현재 PR에는 적용되지 않을 수 있는 차이",
      "lane": "supporting | contrasting | cross-repo"
    }
  ]
}
```

## 코드 블록

`code`는 agent 입력 필드가 아니다. `evidenceIds`가 가리키는 immutable source diff에서 extension이 파생한다.

- 한 카드는 한 파일만 가리킨다.
- 주변 2줄을 포함한다.
- 추가·삭제·문맥 prefix를 보존한다.
- head SHA와 실제 old/new line을 run source에 보존한다.

## 리뷰 초안

- 작성자-facing 문장만 쓴다.
- 문제 조건과 영향을 먼저 설명한다.
- 확정할 수 없는 내용은 질문으로 쓴다.
- 내부 confidence, agent, corpus, workflow 용어를 노출하지 않는다.

## 설명

- 왜 문제인지 사용자가 검산할 수 있게 쓴다.
- 코드가 현재 하는 일 → 발생 조건 → 결과 순서를 유지한다.
- `reviewDraft`를 길게 반복하지 않는다.

## 메타적 관점

- LLM이 같은 패턴을 다시 만들지 않게 할 방법만 다룬다.
- 기존 가드 사용 증거가 없으면 `미사용`으로 단정하지 않는다.
- lint는 구문적으로 정확한 탐지가 가능할 때만 제안한다.
- 큰 migration·공통화는 current PR에 억지로 넣지 않고 follow-up으로 분리한다.
- 시스템 개선 근거가 부족하면 `scope: none`이 좋은 결과다.

## 인간 precedent

- 과거 코멘트 문장을 정답처럼 복사하지 않는다.
- 닮은 점과 다른 점을 함께 기록한다.
- human-authored source URL을 보존한다.
- machine-draft annotation은 인간 검토 사실처럼 표현하지 않는다.

## 인간 결정

Study Hard의 코드 리뷰 탭은 원본 카드를 보존한 채 다음 결정을 별도로 기록한다.

- `review-only`
- `review-with-meta`
- `edit`
- `follow-up`
- `hold`
- `dismiss`

사람이 편집한 문장은 `editedReviewDraft`에 저장하고 원래 `reviewDraft`를 덮어쓰지 않는다.
