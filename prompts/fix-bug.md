---
description: 버그를 재현·분석·수정하고 검증까지 주도
argument-hint: "[이슈/로그/링크/추가 지시사항]"
---
먼저 `start_supervision` 도구를 사용해 아래 목표로 supervisor를 활성화해줘.

outcome:
아래 자료와 지시사항을 모두 반영해 버그를 재현하고, 근본 원인을 특정해 수정하고, 관련 테스트와 검증을 통과시키고, 변경사항을 커밋·푸시하고, PR을 생성한다. 초기 리뷰 요청은 직접 하지 않는다. PR의 GitHub Action이 자동으로 처리한다. 다만 changes requested 이후 수정 커밋을 푸시했는데 re-review request가 자동으로 걸리지 않으면, 필요한 경우 직접 re-request review까지 진행한다. 리뷰 대응 시에는 각 GitHub review conversation마다 해당 thread에 답글 또는 후속 코멘트를 남겨야 하며, 전체 PR comment나 단일 review summary로 여러 conversation을 한 번에 대체하지 않는다. 라인별 지적은 가능한 한 해당 파일/라인의 conversation에 직접 연결되도록 처리한다. PR 생성 직후에는 CI, 체크런, mergeability와 이후 들어오는 리뷰 상태를 계속 확인하고, pending·failed·changes requested·merge conflict 등 머지를 막는 이슈가 생기면 즉시 대응한다. 이 과정을 반복해 PR이 실제로 mergeable 상태가 될 때까지 진행하되, merge 자체와 관련된 최종 실행은 하지 않는다. 직접 merge 하지 않고, merge queue에 넣지 않으며, `enable auto-merge`를 포함한 auto-merge 관련 동작도 하지 않는다. 최종 머지는 사용자가 하거나 별도 승인된 자동화에 맡긴다. 직접 해결할 수 없는 경우에만 필요한 사용자 액션을 즉시 요청한다.

자료 및 지시사항:
$@

그 다음 아래 원칙으로 작업해줘.

- 내가 제공한 이슈, 에러 로그, 스크린샷, 링크, 재현 방법을 먼저 모두 읽고 사실과 가설을 구분해 정리한다.
- 바로 수정하지 말고 재현 가능 여부, 영향 범위, 근본 원인을 먼저 확인한다.
- 해결책은 최소 변경으로 정확하게 적용하고, 필요한 테스트나 회귀 방지 검증을 추가한다.
- 실행한 검증 명령과 결과를 짧고 명확하게 공유한다.
- 현재 작업 브랜치에서 변경사항을 커밋·푸시하고, PR 생성까지 진행한다.
- PR을 연 직후 작업을 끝내지 말고 CI, 체크런, mergeability와 이후 들어오는 리뷰 상태를 계속 확인한다.
- 직접 merge 하지 않고, merge queue에 넣지 않으며, auto-merge 관련 동작도 하지 않는다.
- pending 상태면 완료될 때까지 추적하고, 실패나 리뷰 지적이 생기면 원인을 확인해 수정·재검증·추가 푸시까지 이어서 진행한다.
- 직접 실행할 수 없는 단계가 있으면 막힌 원인과 내가 해야 할 액션을 즉시 구체적으로 요청한다.
