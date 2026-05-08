# Case Verifier Fan-out

Verify Report의 기본 검증 방식은 **main이 증거를 소유하고, case별 subagent가 독립 판정 의견을 내는 구조**다. Subagent는 증거 수집자가 아니라 증거 검토자다.

## 책임 경계

| 역할 | 책임 | 금지 |
|------|------|------|
| main agent | coverage 계획, 환경/로그인/캡처/증거 수집, evidence bundle 작성, subagent launch, 최종 adjudication, `verify_report_live` update/finish, 사용자 질문 | subagent 결과를 무검증 PASS로 복사 |
| case verifier subagent | 주어진 evidence bundle만 읽고 한 criterion 또는 밀접한 axis 묶음을 `PASS`/`FAIL`/`UNVERIFIED`로 판정 | 새 캡처, 로그인, DB/API side effect, 파일 수정, report update, 사용자 질문, 업로드 |

`FAIL`은 주어진 증거로 실패가 명확할 때 반환한다. `UNVERIFIED`는 증거 부족, 기준 애매함, 증거 충돌처럼 main이 처리해야 하는 escalation이다.

## Evidence bundle

경로는 기본적으로 `.context/work/{workspace}/captures/evidence-bundle/`를 사용한다.

```text
evidence-bundle/
├── criteria.json
├── evidence-index.md
└── worker-prompts/          # 선택: subagent별 긴 task prompt
```

큰 screenshot/GIF/log 원본은 bundle로 복사하지 말고 기존 capture/log path를 참조한다. 비밀번호, access token, 개인식별정보처럼 report에 남기면 안 되는 값은 evidence 저장 전 마스킹한다. Subagent session도 재오픈 가능한 local artifact이므로 secret 원문을 넘기지 않는다.

### `criteria.json` 최소 schema

```json
{
  "workspace": "<workspace>",
  "reportRunId": "<verify_report_live run id>",
  "generatedAt": "2026-05-08T00:00:00.000Z",
  "items": [
    {
      "id": "V1",
      "title": "신규 버튼 노출 — mobile 390px",
      "type": "UI_CAPTURE",
      "expected": "버튼이 fold 위에 보이고 기존 CTA와 겹치지 않는다.",
      "requiredAxes": ["after mobile crop", "before/after comparison"],
      "evidence": [
        {
          "path": ".context/work/demo/captures/v1-after-mobile.png",
          "kind": "image",
          "label": "After — mobile 390px",
          "notes": "route=/spots/foo, role=member, viewport=390x844"
        }
      ]
    }
  ]
}
```

### `evidence-index.md` 내용

각 evidence가 무엇인지 사람이 읽을 수 있게 적는다.

```markdown
# Verify Evidence Bundle

## V1 신규 버튼 노출 — mobile 390px
- Expected: 버튼이 fold 위에 보이고 기존 CTA와 겹치지 않는다.
- Evidence:
  - `../v1-after-mobile.png` — After crop, 390x844, member, route `/spots/foo`
  - `../v1-before-mobile.png` — Before crop, same route/role/viewport
- Action: reload → scroll top 유지 → screenshot crop
```

## Fan-out decision

기본은 fan-out이다. 단, 다음이면 main 직접 판정으로 충분하다.

- `--no-workers`가 명시됨
- 검증 항목이 1개이고 evidence/expected가 자명함
- subagent 도구를 사용할 수 없음
- evidence에 별도 subagent session으로 넘기면 안 되는 비밀이 포함됨

## Launch pattern

Subagent를 실제로 실행할 때는 현재 Pi subagent 규칙을 따른다.

1. 먼저 `subagent help`를 호출해 인터페이스를 확인한다.
2. task가 길면 `worker-prompts/v1.md`처럼 파일로 쓰고, subagent에게 그 파일을 읽게 한다.
3. 가능하면 `subagent batch --isolated`를 사용해 evidence bundle만으로 판정하게 한다. main 대화 맥락이 꼭 필요하면 task 안에 요약해서 넣는다.
4. launch 후에는 status/detail polling을 하지 말고 완료 follow-up을 기다린다.

예시:

```text
subagent batch --isolated \
  --agent verifier --task "Read .context/work/demo/captures/evidence-bundle/worker-prompts/v1.md and return only the JSON verdict." \
  --agent verifier --task "Read .context/work/demo/captures/evidence-bundle/worker-prompts/v2.md and return only the JSON verdict."
```

## Worker task template

```markdown
You are a Verify Report case verifier.

Read:
- criteria file: .context/work/{workspace}/captures/evidence-bundle/criteria.json
- evidence index: .context/work/{workspace}/captures/evidence-bundle/evidence-index.md

Verify only item: V1

Rules:
- Use only the listed evidence paths and readable code/log outputs.
- Do not capture new screenshots, log in, mutate data, edit files, update reports, upload artifacts, or ask the user.
- If evidence is missing or ambiguous, return UNVERIFIED with `main_action_required`.
- If evidence clearly contradicts expected behavior, return FAIL.
- Every PASS/FAIL must cite at least one evidence path.

Return JSON only:
{
  "itemId": "V1",
  "verdict": "PASS | FAIL | UNVERIFIED",
  "evidence_used": ["path"],
  "reason": "...",
  "gaps": [],
  "main_action_required": null
}
```

## Result schema

```ts
type CaseVerifierResult = {
  itemId: string;
  verdict: "PASS" | "FAIL" | "UNVERIFIED";
  evidence_used: string[];
  reason: string;
  gaps: string[];
  main_action_required: null | {
    type: "NEED_MORE_EVIDENCE" | "CRITERIA_AMBIGUOUS" | "CONFLICTING_EVIDENCE" | "ENVIRONMENT_BLOCKED";
    request: string;
    suggested_evidence?: string;
  };
};
```

## Main adjudication

Main은 subagent 결과를 그대로 report에 복사하지 않는다.

1. `evidence_used` 경로가 실제로 존재하는지 확인한다.
2. `reason`이 item의 `expected`와 `requiredAxes`를 닫는지 확인한다.
3. Verdict mapping:
   - `PASS`: 증거가 모든 필수 축을 닫을 때만 `verify_report_live update status=pass`.
   - `FAIL`: 증거가 기대 결과와 충돌하면 `status=fail`.
   - `UNVERIFIED`: 추가 evidence 수집, 기준 명확화 질문, 또는 Coverage Gap 기록 중 하나로 처리.
4. 추가 evidence를 수집했으면 해당 item만 재검증하거나, 자명하면 main이 직접 판정한다.
5. subagent 간 충돌이 있으면 main이 증거를 다시 읽고, 필요하면 challenger/reviewer를 별도로 호출한다. 충돌을 숨기고 PASS로 닫지 않는다.

## Report detail convention

Subagent를 사용한 항목의 detail에는 짧게 남긴다.

```markdown
Case verifier: PASS — verifier #12 used `v1-before-mobile.png`, `v1-after-mobile.png`.
Main adjudication: evidence paths exist and close mobile before/after axis.
```

`UNVERIFIED`를 coverage gap으로 남길 때:

```markdown
Case verifier: UNVERIFIED — after crop exists, but before baseline for same role/viewport is missing.
Main action: before recapture was skipped because base environment login was unavailable; left as Coverage Gap.
```
