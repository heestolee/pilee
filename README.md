# pilee 🔥

> 파이리(Charmander) + pi + Lee

[pi](https://github.com/badlogic/pi-mono) coding agent를 위한 개인 설정 패키지.
Conductor 1852세션에서 쌓은 경험을 기반으로, 포크나 래핑 없이 **처음부터 직접 구현**.

## Install

```bash
pi install https://github.com/heestolee/pilee
```

---

## 목차

- [설계 철학](#설계-철학)
- [핵심 워크플로](#핵심-워크플로)
- [Extensions](#extensions)
- [Skills](#skills)
- [Agents](#agents)
- [Theme & Prompts](#theme--prompts)
- [토큰 최적화](#토큰-최적화)
- [단축키](#단축키)
- [구조](#구조)

---

## 설계 철학

### 왜 직접 만들었는가

[Conductor](https://www.conductor.build/)는 잘 만든 프로덕트였다. 워크트리 자동 관리, 다중 세션 병렬 실행, MCP 연결, 시스템 프롬프트 — 하나의 앱 안에서 다 해결해줬다.

하지만 1852세션, 185개 워크스페이스를 운용하면서 **제품의 구조적 한계**가 체감되기 시작했다.

### Conductor의 한계

**1. 커스텀하지 못한다 — 제품이 제공하는 기능만 사용 가능**

`repos` 테이블에 `custom_prompt_code_review` 등 커스텀 프롬프트 컬럼이 존재하지만, 이것이 전부다. 스킬 추가, 익스텐션 개발, 에이전트 정의, 도구 출력 렌더링 변경 — 제품이 허용하지 않은 동작은 확장할 수 없다. 개인적으로 ISP는 잘 준수되어 보이지만 OCP에서 탈락이라고 느꼈다.

**2. 워크트리를 늘릴수록 늘어나는 부하**

Git worktree 기반이지만, setup 시 node_modules를 심볼릭 링크가 아닌 물리 복사한다.

```
워크스페이스당 평균:  5.4GB (상위 10개 기준)
35개 워크스페이스 총: 123GB
conductor.db:       1.8GB (315K 메시지, 단일 SQLite)
```

워크스페이스를 스케일 아웃했더니 디스크가 스케일 업 됐다.

**3. 워크스페이스 복제 메커니즘의 불투명성과 메모리 과사용**

[공식 문서](https://www.conductor.build/docs/concepts/workspaces-and-branches)에는 워크스페이스의 **개념과 사용법**은 설명되어 있지만, 내부 복제 메커니즘(어떤 파일이 물리 복사되고 어떤 것이 링크되는지, `initialization_files_copied`나 `symlinks_pending_deletion`의 동작 방식)은 문서화되어 있지 않다. 복제 과정에서 MCP 설정(`.mcp.json`)이 누락되거나, 불필요한 파일이 생성되는 사례가 반복됐다.

앱 자체도 네이티브 바이너리(91MB) 상주에, 세션당 Claude Code 프로세스 ~220MB, 현재 24개 프로세스 합산 **1.6GB 메모리** 점유. 캡슐화가 잘 되어 있어서 문제가 생겨도 캡슐 안을 볼 수 없었다.

**4. 내부에서 제약을 걸어놓은 동작은 절대 실행하지 못함**

- 글로벌 MCP 설정이 외부 터미널에서는 동작하지만 Conductor 내부에서는 인식 안 됨
- 내장 터미널 한글 자모 분리 입력
- 외부에서 생성한 Git 브랜치에 워크스페이스 연결 불가

이런 제약이 의도된 것인지, 버그인지 판단할 수 없고 우회 방법도 없다. 방어적 프로그래밍이 사용자한테도 적용된 느낌이었다.

### pi가 커버하는 것

| Conductor 한계 | pi + pilee 대응 |
|---------------|----------------|
| 워크스페이스 복제 시 물리 파일 복사 → 디스크 선형 증가 | Git worktree만 생성, node_modules는 setup script에서 심볼릭 링크 또는 `npm install` 선택 가능. 워크스페이스 구조를 직접 제어 |
| 단일 SQLite 1.8GB 누적 | 세션별 개별 JSONL 파일 (`~/.pi/agent/sessions/`). 세션 간 I/O 간섭 없음, 필요 없는 세션은 삭제해도 다른 세션에 영향 없음 |
| 스킬/익스텐션 추가 불가 | 익스텐션 API (`registerCommand`, `registerTool`, `registerShortcut`, `ui.custom` TUI 등)로 자유롭게 확장 |
| 내부 제약 우회 불가 | 모든 동작이 TypeScript 코드로 열려 있음. 동작 변경이 필요하면 코드를 수정하고 `pi update` |
| 프롬프트 커스텀 컬럼 몇 개가 전부 | TFT 4 철칙, `(명백)` 패턴, frame→decide→verify 사이클, 14개 어색함 패턴 차단 등 워크플로 자체를 재설계 |
| 워크스페이스 복제 방식 불투명 | worktree 생성부터 대시보드 관리까지 전 과정이 `extensions/worktree/index.ts`에 명시적으로 정의 |
| 앱 91MB 상주 + 세션당 ~220MB | 터미널 프로세스만 존재 (세션당 ~60MB), OS 레벨 프로세스 격리 |

정리하면, Conductor는 **"잘 만든 기본값"** 이고, pilee는 **"내 워크플로에 맞춘 커스텀"** 이다. 1852세션의 경험이 있었기에 "뭐가 필요하고 뭐가 부족한지" 정확히 알고 만들 수 있었다.

---

## 핵심 워크플로

### frame → decide → verify 사이클

```
/frame    구조화된 계획 수립 (frame.json 생성)
  ↓         - success_criteria (행 단위 검증 가능)
  ↓         - verify_plan, risk_register, edge_case_seeds
/decide   frame에서 발생한 결정 사항 처리
  ↓         - TaskCreate(kind="frame.decision") 큐
  ↓
(구현)
  ↓
/verify   frame.json의 mechanical reader
            - success_criteria 행 단위 PASS/FAIL
            - 14개 어색함 패턴 차단 (의례적 질문, 범위 밖 가상 시나리오 등)
            - 미검증 항목 있으면 PR 진행 차단
```

### subagent 위임 패턴

```
>> 커밋해줘              → worker가 백그라운드 자율 실행
>>/ 파일 찾아줘          → finder (read/grep/find only)
>>? 이 라이브러리 조사해  → searcher (웹 리서치)
>># 구현 계획 세워줘      → planner (opus + thinking:high)
>>! 이 계획 검증해줘      → challenger (반론/엣지케이스)
>>@ E2E 테스트 돌려줘     → browser (playwright)
>>> 히든 작업             → 결과가 LLM 컨텍스트에 안 들어감

/subagents              → 실행 중인 에이전트 목록
<>N                     → #N 에이전트 마지막 응답 미리보기
/sub:open N             → #N 세션 리플레이 오버레이
/sub:abort N            → #N 중단
```

`>>` 는 "보내고 결과만 받는" 단방향 위임. 실행 중 개입이 필요하면 fork-panel.

### worktree 대시보드

```
Ctrl+W                  → 전체 워크트리 오버레이
/wt new                 → 새 워크트리 (포켓몬 이름 자동 생성)
/wt resume <name>       → Conductor 워크스페이스 복원
/wt switch              → 워크트리 전환 (세션 + cwd 자동 변경)
```

대시보드 상태: `backlog` / `active` / `done` / `archive`
- `Space`: backlog → active → done 순환
- `a`: 아카이브 ↔ 메인 양방향 이동
- `Tab`: 메인 탭 ↔ 아카이브 탭 전환
- `t`: 태그 편집, `/`: 필터

### stress-interview → self-healing

```
/stress-interview   3 병렬 에이전트가 코드 리뷰
                      - verifier: 구현 정확성
                      - reviewer: 코드 품질/패턴
                      - challenger: 반론/엣지 케이스
  ↓
/self-healing       stress-interview 결과 기반 자동 수정 (2사이클)
                      - fix_class 분류: AUTO_FIX / ASK / INFO
```

### TFT 4 철칙

모든 스킬과 에이전트가 따르는 행동 원칙:

| # | 철칙 | 핵심 |
|---|------|------|
| 1 | **분기점 질문 의무** | 결과가 달라지는 선택지에서는 반드시 묻는다. 확실한 건 `(명백: 근거)` 표기 후 진행 |
| 2 | **위험 결정 단독 금지** | 되돌리기 어려운 작업은 혼자 판단하지 않는다 |
| 3 | **근거 없는 완료 금지** | "다 됐다"는 증거 기반이어야 한다 |
| 4 | **결과 정해진 질문 금지** | "(처리됨)" 같은 선택지로 동의만 구하는 의례적 질문을 하지 않는다 |

**`(명백)` 패턴**: "묻기 vs 안 묻기" 이분법의 제3의 길.
가정을 본문에 `(명백: 저장소 컨벤션)` 형태로 명시하고 진행. 사용자 침묵 = 동의, 틀리면 교정.

---

## Extensions

34개. 도구를 등록하지 않는 익스텐션(spinner, session-title 등)은 토큰 영향 0.

### 인프라

| 이름 | 설명 |
|------|------|
| **subagent** | `>>` 백그라운드 에이전트 위임 — hang 감지 5min, auto-retry 3x, `ask_master` 에스컬레이션, `/subagents` TUI |
| **claude-code-ui** | Read/Write/Edit/Bash 렌더링 커스텀 |
| **supervisor** | 대화 방향 감시 + 자동 스티어링 |
| **claude-hooks-bridge** | Claude hooks 이벤트 브릿지 |
| **mcp-bridge** | `~/.claude.json` mcpServers 프록시 (figma/github/sentry 등) |
| **dynamic-agents-md** | 파일 탐색 결과에 AGENTS.md 자동 주입 |
| **tool-group-renderer** | 관련 도구 출력 그룹/축소 |

### 세션 관리

| 이름 | 설명 |
|------|------|
| **worktree** | Git worktree 대시보드 — backlog/active/done/archive, 태그, 필터, `Ctrl+W` |
| **fork-panel** | Ghostty 패널 분할 포크 + handoff(자동/수동) + `/revive` TUI |
| **session-title** | 세션 제목 자동 설정 |

### UI / UX

| 이름 | 설명 |
|------|------|
| **footer** | 커스텀 푸터 — 브랜치, 모델, thinking 레벨, 컨텍스트 바 |
| **custom-style** | PolishedEditor — `>>` 모드 표시, 에디터 테두리, ghost text |
| **prompt-suggest-lite** | 입력 중 프롬프트 자동완성 제안 |
| **notify** | 작업 완료 시 widget 바 표시 + macOS 알림 (입력 시 자동 해제) |
| **idle-screensaver** | 5분 비활성 → 포켓몬 스프라이트 + 마지막 맥락 표시 |
| **spinner** | 스트리밍 중 애니메이션 |
| **working-text** | 작업 상태 텍스트 |
| **queued-messages** | 메시지 큐 시각화 + idle watchdog |
| **diff-overlay** | `/diff` TUI — 커밋 모드, 파일 트리, 구문 하이라이팅 |
| **timestamp** | `/timestamp` TUI — 대화 타임라인 |
| **archive-to-html** | Verify/Web Search HTML 아카이브 + `/show-report` Glimpse viewer |

### 도구

| 이름 | 설명 |
|------|------|
| **tasks** | 태스크 CRUD + `Ctrl+Shift+T` |
| **web-access** | Tavily 웹 검색 + URL 콘텐츠 추출 |
| **memory-layer** | 장기 기억 저장/검색 |
| **backlog** | `/backlog` TUI — 작업 백로그 관리 |
| **preflight** | 커밋 전 자동 lint/type-check |
| **pr-comments** | PR 코멘트 관리 |
| **until** | 반복 작업 추적 |
| **usage-analytics** | 에이전트/스킬 사용량 통계 |
| **usage-reporter** | 사용량 리포트 |
| **retro** | 일간/주간/월간 회고 Notion 연동 |

---

## Skills

18개. 글로벌 워크플로 스킬만 pilee에 포함. 프로젝트 고유 스킬(create-pr, self-review)은 해당 레포에 위치.

### 핵심 사이클

| 스킬 | 역할 |
|------|------|
| **tft-guidelines** | TFT 4 철칙 + `(명백)` 패턴 + 양방향 합리화 차단 |
| **ask-user-question-rules** | 질문 작성 규칙 — 50자 이내, 옵션에 결론 금지, 자가 점검 8개 (공통 prerequisite) |
| **frame** | 구조화된 frame.json 생성 |
| **decide** | frame.decision 큐 처리 |
| **verify** | frame.json mechanical reader — 14개 어색함 패턴 차단 |

### 리뷰

| 스킬 | 역할 |
|------|------|
| **stress-interview** | 3 병렬 에이전트 코드 리뷰 (verifier + reviewer + challenger) |
| **self-healing** | stress-interview + 자동 수정 2사이클 |
| **code-review-and-quality** | 코드 리뷰 품질 기준 |

### 워크플로

| 스킬 | 역할 |
|------|------|
| **systematic-debugging** | 버그 근본원인 파악 → 수정 프로세스 |
| **skill-creator** | 스킬 생성/개선/평가 워크플로 |
| **db-write / db-write-migration** | DB 쓰기 + 마이그레이션 가이드 |
| **jira-issue-management** | Jira 이슈 CRUD |
| **verify-report** | PR 캡처/검증 리포트 + Glimpse 프리뷰 |
| **start-local-dev** | 로컬 dev 서버 구동 |
| **debugging-and-error-recovery** | 디버깅 패턴 |
| **git-workflow-and-versioning** | Git 워크플로 |
| **incremental-implementation** | 점진적 구현 패턴 |

---

## Agents

8개. `scripts/sync-agents.mjs` (postinstall)로 `~/.pi/agent/agents/`에 자동 동기화.

### 서브에이전트 (`>>` 심볼)

| 에이전트 | 심볼 | 모델 | 역할 |
|---------|------|------|------|
| **worker** | `>>` (기본) | openai-codex/gpt-5.5 | 범용 구현/수정 |
| **finder** | `>>/` | openai-codex/gpt-5.4 | 파일/코드 탐색 (read/grep/find only) |
| **searcher** | `>>?` | openai-codex/gpt-5.4 | 웹 리서치/문서 조사 |
| **planner** | `>>#` | openai-codex/gpt-5.5 (thinking:high) | 구현 계획 설계 |
| **challenger** | `>>!` | openai-codex/gpt-5.5 | 계획/코드 검증, 구멍 찾기 |
| **browser** | `>>@` | openai-codex/gpt-5.5 | playwright E2E, UI 확인 |

### 리뷰 (`/stress-interview`)

| 에이전트 | 관점 |
|---------|------|
| **verifier** | 구현이 요구사항을 충족하는가 (openai-codex/gpt-5.5) |
| **reviewer** | 코드 품질, 패턴, 유지보수성 (openai-codex/gpt-5.5) |

---

## Theme & Prompts

**claude-code-dark** — 파이리 오렌지 `#d77757` 액센트 🔥

**Prompts:**
- `fix-bug` — 버그 수정 템플릿
- `jira-format` — Jira 이슈 작성 포맷

---

## 토큰 최적화

Conductor 대비 pi + pilee는 매 턴 ~6K 토큰 추가 오버헤드가 있었다. 원인과 대응:

| 원인 | 영향 | 대응 |
|------|------|------|
| cc-system-prompt + pi 시스템 프롬프트 이중 적재 | +2K/턴 | **cc-system-prompt 최소화** — 핵심만 남기고 tft-guidelines로 이관 |
| 도구 25개+ JSON 스키마 매 턴 전송 | +3.4K/턴 | subagent/supervisor/web-access → **`pi config`로 필요할 때만 활성화** |
| 미사용 범용 스킬 16개 | +480/턴 | **제거** |

---

## 단축키

| 키 | 동작 |
|----|------|
| `Ctrl+W` | 워크트리 대시보드 |
| `Ctrl+Shift+→←↑↓` | fork-panel 방향별 분할 |
| `Ctrl+Shift+N` | fork-panel 새 탭 |
| `Ctrl+Shift+T` | tasks 열기 |

---

## 구조

```
pilee/
├── extensions/     # 34개
├── skills/         # 18개
├── agents/         # 8개
├── themes/         # claude-code-dark
├── prompts/        # fix-bug, jira-format
├── scripts/        # sync-agents.mjs
└── AGENTS.md       # 핵심 원칙
```
