---
name: pilee-final-check
description: pilee 레포 개선 작업을 마무리하기 전 마지막 게이트로 사용한다. 사용자가 “구현 다 했으면 구멍 없는지 다시 검증”, “의도한대로 잘 동작하게 해줘”, “마지막으로 한 번 더 봐줘”, “pilee 작업 마무리”처럼 말하거나 AGENTS.md의 pilee 변경 마무리 단계에 도달하면 사용한다. 구현 구멍을 찾으면 수정·재검증하고, 없으면 개선 내용과 검증 근거를 정리한다.
argument-hint: "검토할 변경 범위 또는 브랜치"
disable-model-invocation: false
---

# pilee-final-check

pilee 변경을 끝내기 전에 **요청 의도 → 실제 diff → 동작 구멍 → 검증 → 기록/푸시 상태**를 한 번 더 닫는 final gate다.

이 스킬은 일반적인 완료 보고가 아니다. “문제없음”을 말하기 전에 실제로 구멍을 찾고, 찾으면 고치고, 다시 검증한다.

## 언제 사용하나

- pilee repo의 extension/skill/prompt/theme/knowledge/README/AGENTS 변경이 끝났을 때
- 사용자가 “구현 다 했으면 구멍 없는지”, “의도한대로 잘 동작하게”, “마지막 스텝으로 검증”, “파이리 작업 마무리”라고 말할 때
- 다른 스킬(`skill-creator`, `pilee-knowledge`, `verify-report`, `ship` 등)로 pilee를 수정한 뒤 최종 보고 직전

pilee가 아닌 product/lambda/외부 프로젝트 변경에는 해당 프로젝트의 `/verify`, `ship`, `pr-ship`, `ci-ship`을 우선한다.

## 핵심 원칙

1. **완료 선언 전 구멍 찾기**
   - diff를 읽고 실제 failure mode를 상상한다.
   - “검증 명령 통과”만으로 끝내지 않는다.
2. **요청 추적성**
   - 모든 변경은 사용자 요청, frame/decision, 검증 실패, 또는 pilee 운영 규칙과 연결되어야 한다.
   - adjacent cleanup, 취향 refactor, unrelated generated drift는 섞지 않는다.
3. **고치고 다시 검증**
   - 구멍을 찾으면 수정한다.
   - 수정 후 같은 검증 세트를 다시 실행한다.
4. **pilee 운영 산출물까지 닫기**
   - package version, generated README/knowledge artifacts, knowledge freshness, local history/Notion, push 상태까지 확인한다.
5. **무의미한 확인 질문 금지**
   - 결과가 정해진 “충분할까요?” 질문은 하지 않는다.
   - 사용자의 선택이 다음 행동을 바꾸는 경우에만 묻는다.
6. **Claim/evidence 최종 대조**
   - 완료 보고 전에 이번 변경의 claim을 나열한다.
   - 각 claim마다 실제 증거를 붙인다.
   - 증거 없는 claim은 PASS가 아니라 GAP이다.
7. **도구 성공과 사용자 성공 분리**
   - TypeScript syntax check, Studio update, HTML 생성 성공은 중간 증거일 뿐이다.
   - 사용자가 보는 화면/리포트/동작이 핵심이면 실제 렌더 결과를 확인한다.

## Workflow

### 1. 작업 범위와 git 상태 확인

```bash
git status --short --branch
git log --oneline --decorate -5
git diff --stat origin/main...HEAD
```

확인한다.

- 현재 branch/worktree가 의도한 작업용인가?
- unrelated dirty file이 있는가?
- push해야 하는 커밋이 남았는가?
- main/package clone에서 작업한 경우, 사용자가 별도 worktree를 원했는지 어겼는가?

### 2. 요청 의도와 diff 매핑

사용자 요청을 1~3개 bullet로 다시 쓴다. 그 다음 diff를 읽고 매핑한다.

| 요청/의도 | 관련 파일 | 충족 여부 | 메모 |
|---|---|---|---|
| 명시 요구 | `path` | PASS/GAP | 근거 |

다음이면 수정 또는 보고한다.

- 요청과 연결되지 않는 파일 변경
- README/knowledge/generated artifact만 남고 실제 구현이 빠짐
- package version만 바꾸고 package-lock을 놓침
- public/private boundary 위반

### 2.5 Claim inventory 작성

완료 주장 전에 이번 변경이 참이어야 하는 문장을 작게 나눈다.

| Claim | 관련 파일 | 필요한 증거 | 현재 증거 | 판정 |
|---|---|---|---|---|
| 예: Frame Studio에서 그림이 보인다 | `extensions/frame-studio/index.ts` | 실제 WebView 캡처 | 없음 | GAP |

규칙:
- claim은 요청 의도, diff, README/skill 설명, 사용자-facing 동작에서 뽑는다.
- 각 claim은 test/build/syntax/runtime/capture/artifact 중 하나 이상의 증거와 연결한다.
- 코드 독해만으로 user-facing claim을 PASS 처리하지 않는다.
- 증거가 과하거나 비용이 크면 일단 GAP/보류로 표시하고, 다른 작업을 닫은 뒤 사용자에게 묻는다.

### 3. pilee-specific 구멍 리뷰

변경 유형별로 최소 하나 이상의 실제 failure mode를 확인한다.

| 변경 유형 | 꼭 볼 구멍 |
|---|---|
| extension/slash command | command args, alias, no-UI/headless fallback, session/cwd/source-of-truth, stale ctx |
| worktree/session/revive/archive | 중복 세션, wrong cwd, panel label/P0/P1, source provenance, raw file mutation |
| Glimpse/WebView | embedded script escape, native host shortcut, stdout/stderr protocol, browser fallback |
| skill/prompt | trigger description, prerequisite, output contract, near-miss 오작동 |
| knowledge/README | graph freshness, coverage TODO, generated block 수동 편집, reviewed_commit 의미 |
| automation/local history | local-only 파일 위치, Notion sync, raw private text public 유출 |

### 4. 동작 smoke를 만든다

가능하면 “파일을 읽었다”가 아니라 작은 재현을 만든다.

예시:

- parser/helper는 temp fixture로 실행
- generated HTML/WebView script는 `new Function` 또는 문법 smoke
- session 변환은 임시 JSONL로 중복/metadata/timestamp 확인
- command shim은 등록 문자열/args parsing smoke
- knowledge 변경은 `knowledge:graph -- --check`, `knowledge:validate`

실제 UI/host 동작이 핵심이면 가능한 범위에서 실제 capture/smoke를 수행하고, 불가능하면 왜 불가능한지 gap으로 남긴다.

#### verifier lens 적용

light 변경은 main이 claim/evidence 표를 직접 닫는다. standard/full 변경, UI/WebView/render/tool contract 변경, 또는 완료 주장이 많아진 변경은 read-only `verifier` subagent를 병렬로 호출해 독립 증거 수집을 맡긴다.

- subagent에게는 현재 `HEAD`, `git status --short`, 변경 파일, claim inventory, 정확한 검증 명령, read-only 금지선을 넘긴다.
- verifier 결과는 최종 판정이 아니라 evidence input이다. main은 결과의 command output/artifact를 읽고 PASS/FAIL/PARTIAL을 다시 판정한다.
- verifier가 증거를 못 만들면 해당 claim은 PASS가 아니라 GAP이다.

### 5. 표준 검증 세트

변경 파일에 맞게 실행하되, 메인 세션을 오래 막지 않도록 먼저 검증을 분리한다.

| 구분 | 예시 | 원칙 |
|---|---|---|
| foreground | `git diff --check`, 변경 TS 파일 `node --experimental-strip-types --check`, skill frontmatter smoke | 빠르고 final-check 판정에 즉시 필요한 것은 메인 세션에서 실행 |
| parallel | `npm run knowledge:freshness`, 전체 knowledge graph/validate, 여러 extension syntax check, 오래 걸리는 package build/test | 순수 검증이고 파일을 바꾸지 않는 명령은 `>> verifier ...`로 병렬 위임하거나 background artifact로 남김 |
| deferred | 외부 CI/수동 UI 확인이 더 적합하거나 비용이 큰 검증 | `남은 gap`에 조건과 재개 방법을 명시 |

parallel 검증을 위임할 때는 subagent에게 현재 `HEAD`, `git status --short`, 정확한 명령, read-only 금지선, 보고 형식을 넘긴다. 완료 전에는 “parallel 검증 진행 중”이지 “문제없음”이 아니다. 완료 follow-up이 오면 main이 결과를 읽고 PASS/FAIL/PARTIAL을 다시 판정한다.

기본:

```bash
git diff --check
```

TypeScript extension 변경:

```bash
node --experimental-strip-types --check extensions/<target>/index.ts
```

여러 TS 파일이면 모두 확인한다.

Knowledge/README/frontmatter 변경:

```bash
npm run knowledge:graph -- --check
npm run knowledge:validate
npm run knowledge:freshness -- --json
```

package version 변경:

```bash
node -e "const p=require('./package.json'); const l=require('./package-lock.json'); if (p.version!==l.version || p.version!==l.packages[''].version) process.exit(1)"
```

Skill 변경:

- `SKILL.md` 존재
- directory name = frontmatter `name`
- `description` 1024자 이하
- near-miss trigger가 과도하게 넓지 않음
- 위험한 자동화/권한 상승 지시 없음

### 6. 수정 루프

구멍을 발견하면 다음 순서로 처리한다.

1. 문제를 한 줄로 적는다.
2. 최소 수정으로 고친다.
3. 관련 smoke/검증을 다시 실행한다.
4. 필요하면 별도 commit으로 남긴다.
5. knowledge/history도 수정 내용에 맞게 갱신한다.

### 7. pilee 운영 마무리

- 관련 변경만 stage/commit한다.
- 명시적 push 보류 지시가 없으면 push한다.
- `docs/pilee-history.md` 로컬 기록을 추가/보정한다.
- 가능한 경우 automation script로 Notion code block/why page sync를 수행한다.
- `pi update`는 사용자가 지금 적용을 원하거나 이 세션의 적용 단계일 때만 실행한다. 별도 feature branch 작업이면 보통 push까지만 한다.

## Final output

최종 응답은 아래 구조로 짧게 쓴다.

```markdown
## 최종 점검 결과
- 발견/수정: <없음 또는 수정한 구멍>
- 검증: <명령 요약>
- push: <branch/commit>

## 개선 내용
- ...
```

미검증 gap이 있으면 “문제없음”이라고 하지 말고 별도 `남은 gap`으로 남긴다.

## Red flags

- `git diff --check`나 syntax check 없이 완료 보고한다.
- `npm run knowledge:graph`를 돌렸는데 generated artifact를 커밋하지 않는다.
- freshness가 stale인데 이번 변경 대상 doc만 fresh인지 확인하지 않는다.
- local history/Notion sync를 잊는다.
- 구멍을 발견했는데 수정하지 않고 “추후 개선”으로 넘긴다.
- 사용자가 별도 worktree를 요청했는데 package clone main에서 직접 작업한다.
- public pilee에 회사명/계정/로컬 private path를 추가한다.
