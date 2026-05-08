# Case Worker Fan-out

Verify Report의 기본 가속 구조는 **main이 검증 계약을 정하고, case별 subagent가 계획된 증거 수집과 1차 검증을 병렬 수행하는 구조**다. Subagent는 단순 판정자만이 아니라, 주어진 case brief 안에서 브라우저/명령 자동화로 planned evidence를 만들 수 있다.

## 책임 경계

| 역할 | 책임 | 금지 |
|------|------|------|
| main agent | coverage 계획, 환경/계정/URL 결정, case별 허용 액션 정의, live report start, subagent launch, 결과 adjudication, 추가 증거/사용자 질문, `verify_report_live` update/finish | 모든 플로우를 직접 타야 한다고 가정하기, subagent 결과를 무검증 PASS로 복사 |
| case worker subagent | assigned case의 planned capture/log/test/API read를 실행하고 evidence file + verdict manifest 작성 | 계획 밖 새 시나리오/재캡처 추가, 임의 로그인/계정 변경, DB/API write, 파일 수정, report update, 업로드, 사용자 질문 |

핵심은 **planned capture는 worker가 수행 가능**하지만, **unplanned new capture/recapture는 main escalation**이라는 점이다. 예를 들어 worker가 mobile screenshot을 찍으라는 brief를 받았다면 직접 찍는다. 하지만 “tablet도 봐야 할 것 같다”, “다른 계정으로 다시 로그인해야 할 것 같다”, “before 기준이 모호하다”는 판단은 `UNVERIFIED` + `main_action_required`로 올린다.

## Work package

경로는 기본적으로 `.context/work/{workspace}/captures/verify-workers/`를 사용한다.

```text
verify-workers/
├── plan.json
├── evidence-index.md
├── briefs/
│   ├── v1.md
│   └── v2.md
└── results/
    ├── v1.result.json
    └── v2.result.json
```

생성되는 screenshot/GIF/log/txt/json evidence는 기존 capture root(`.context/work/{workspace}/captures/`) 아래에 저장한다. Work package에는 경로와 메타데이터를 남긴다. 비밀번호, access token, 개인식별정보처럼 report에 남기면 안 되는 값은 저장 전에 마스킹한다. Subagent session도 재오픈 가능한 local artifact이므로 secret 원문을 넘기지 않는다.

### `plan.json` 최소 schema

```json
{
  "workspace": "<workspace>",
  "captureRoot": ".context/work/demo/captures",
  "reportRunId": "<verify_report_live run id>",
  "generatedAt": "2026-05-08T00:00:00.000Z",
  "items": [
    {
      "id": "V1",
      "title": "신규 버튼 노출 — mobile 390px",
      "type": "UI_CAPTURE",
      "expected": "버튼이 fold 위에 보이고 기존 CTA와 겹치지 않는다.",
      "requiredAxes": ["after mobile crop", "before/after comparison"],
      "environment": {
        "afterUrl": "https://preview.example/path",
        "beforeUrl": "https://base.example/path",
        "viewport": "390x844",
        "role": "member"
      },
      "allowedActions": [
        "open beforeUrl and capture primary crop",
        "open afterUrl and capture primary crop",
        "record console errors during load"
      ],
      "output": {
        "evidencePrefix": ".context/work/demo/captures/v1-mobile",
        "resultPath": ".context/work/demo/captures/verify-workers/results/v1.result.json"
      }
    }
  ]
}
```

### `evidence-index.md` 내용

main이 이미 가진 공유 증거와 worker가 만들어야 할 planned evidence를 구분한다.

```markdown
# Verify Worker Plan

## Shared evidence
- `diff-summary.txt` — changed files and relevant diff summary

## V1 신규 버튼 노출 — mobile 390px
- Expected: 버튼이 fold 위에 보이고 기존 CTA와 겹치지 않는다.
- Planned evidence:
  - `v1-mobile-before.png` — before crop, 390x844, member
  - `v1-mobile-after.png` — after crop, 390x844, member
  - `v1-mobile-console.txt` — console error excerpt
- Allowed actions: open URL, capture screenshot/crop, read console, no login/account mutation unless role session is already provided.
```

## Fan-out decision

기본은 fan-out이다. 단, 다음이면 main 직접 판정으로 충분하다.

- `--no-workers`가 명시됨
- 검증 항목이 1개이고 실행 플로우가 짧고 자명함
- subagent 도구를 사용할 수 없음
- evidence나 계정 상태를 별도 subagent session으로 넘기면 안 됨
- 결제/알림/외부 write처럼 worker가 실수하면 side effect가 생기는 플로우

## Launch pattern

Subagent를 실제로 실행할 때는 현재 Pi subagent 규칙을 따른다.

1. 먼저 `subagent help`를 호출해 인터페이스를 확인한다.
2. case별 brief가 길면 `briefs/v1.md`처럼 파일로 쓰고, subagent에게 그 파일을 읽게 한다.
3. UI/browser evidence는 `browser` agent를 우선 사용하고, test/lint/diff/API read 중심은 `verifier` agent를 사용한다.
4. 가능하면 `subagent batch --isolated`를 사용해 case별 병렬 실행한다. main 대화 맥락이 꼭 필요하면 brief에 필요한 요약만 넣는다.
5. launch 후에는 status/detail polling을 하지 말고 완료 follow-up을 기다린다.

예시:

```text
subagent batch --isolated \
  --agent browser --task "Read .context/work/demo/captures/verify-workers/briefs/v1.md, create planned evidence, write the result JSON." \
  --agent verifier --task "Read .context/work/demo/captures/verify-workers/briefs/v2.md, run the planned command checks, write the result JSON."
```

## Worker brief template

```markdown
You are a Verify Report case worker.

Read:
- plan file: .context/work/{workspace}/captures/verify-workers/plan.json
- evidence index: .context/work/{workspace}/captures/verify-workers/evidence-index.md

Work only on item: V1

Allowed actions:
- Open the specified beforeUrl/afterUrl.
- Use the specified viewport/role/session only.
- Capture the planned screenshots/logs and save them under the requested evidencePrefix.
- Write the result JSON to the requested resultPath.

Forbidden:
- Do not invent additional viewports/routes/accounts.
- Do not recapture with a different scenario unless the brief explicitly says so.
- Do not log in with new credentials, mutate data, perform DB/API writes, edit source files, update reports, upload artifacts, or ask the user.
- If planned evidence is insufficient, blocked, or ambiguous, return UNVERIFIED with `main_action_required` instead of improvising.

Return and write JSON:
{
  "itemId": "V1",
  "verdict": "PASS | FAIL | UNVERIFIED",
  "evidence_created": [
    { "path": "...", "kind": "image|json|text|network|console", "label": "..." }
  ],
  "evidence_used": ["path"],
  "reason": "...",
  "gaps": [],
  "main_action_required": null
}
```

## Result schema

```ts
type CaseWorkerResult = {
  itemId: string;
  verdict: "PASS" | "FAIL" | "UNVERIFIED";
  evidence_created: Array<{
    path: string;
    kind: "image" | "gif" | "json" | "text" | "network" | "console" | "diff" | "link";
    label: string;
  }>;
  evidence_used: string[];
  reason: string;
  gaps: string[];
  main_action_required: null | {
    type: "NEED_MORE_EVIDENCE" | "CRITERIA_AMBIGUOUS" | "CONFLICTING_EVIDENCE" | "ENVIRONMENT_BLOCKED" | "UNPLANNED_RECAPTURE_NEEDED";
    request: string;
    suggested_evidence?: string;
  };
};
```

## Main adjudication

Main은 worker 결과를 그대로 report에 복사하지 않는다.

1. `resultPath`를 읽고 JSON이 schema를 만족하는지 확인한다.
2. `evidence_created`/`evidence_used` 경로가 실제로 존재하는지 확인한다.
3. evidence가 item의 `expected`와 `requiredAxes`를 닫는지 spot-check한다. 이미지면 열어보거나 crop/metadata를 확인하고, text/json이면 핵심 excerpt를 확인한다.
4. Verdict mapping:
   - `PASS`: planned evidence가 모든 필수 축을 닫을 때만 `verify_report_live update status=pass`.
   - `FAIL`: planned evidence가 기대 결과와 충돌하면 `status=fail`.
   - `UNVERIFIED`: main이 추가 evidence 수집, brief 수정 후 재위임, 기준 명확화 질문, 또는 Coverage Gap 기록 중 하나로 처리.
5. worker 간 충돌이 있으면 main이 증거를 다시 읽고, 필요하면 challenger/reviewer를 별도로 호출한다. 충돌을 숨기고 PASS로 닫지 않는다.

## Report detail convention

Worker를 사용한 항목의 detail에는 짧게 남긴다.

```markdown
Case worker: PASS — browser #12 created `v1-mobile-before.png`, `v1-mobile-after.png`.
Main adjudication: evidence paths exist and close mobile before/after axis.
```

`UNVERIFIED`를 coverage gap으로 남길 때:

```markdown
Case worker: UNVERIFIED — after crop was created, but before URL required a login state not provided in the brief.
Main action: before recapture was skipped because base environment login was unavailable; left as Coverage Gap.
```
