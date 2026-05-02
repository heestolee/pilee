# pilee 🔥

> 파이리(Charmander) + pi + Lee

Personal [pi](https://github.com/badlogic/pi-mono) coding agent setup.
Conductor 705세션에서 쌓은 경험을 기반으로, 내 워크플로에 맞게 처음부터 직접 구현.

## Install

```bash
pi install https://github.com/heestolee/pilee
```

## Extensions

| 이름 | 설명 |
|------|------|
| **claude-code-ui** | Read/Write/Edit/Bash 도구 렌더링 + 커스텀 푸터 |
| **fork-panel** | Ghostty 패널 분할 세션 포크 (`Ctrl+Shift+Arrow`) + handoff/recall/revive |
| **subagent** | 병렬 서브에이전트 (hang 감지 5min, auto-retry 3x, `ask_master` 에스컬레이션) |
| **supervisor** | 대화 방향 감시 + 자동 스티어링 |
| **diff-overlay** | `/diff` TUI — 커밋 모드, 파일 트리, 구문 하이라이팅, 리뷰 코멘트 |
| **worktree** | Git worktree 관리 — 포켓몬 1세대 한글 이름 자동 부여, 멀티 레포 |
| **tasks** | 태스크 생성/추적 (`Ctrl+Shift+T`) |
| **mcp-bridge** | `~/.claude.json` mcpServers 프록시 (figma/github/sentry 등) |
| **web-access** | Perplexity/Exa 웹 검색 |
| **timestamp** | `/timestamp` TUI — 대화 타임라인 (시각 + 경과 시간) |
| **retro** | `/retro` 일간/주간/월간 회고 불러오기 + Notion 연동 저장 |
| **idle-screensaver** | 5분 비활성 → 포켓몬 도트 스프라이트 + 마지막 대화 맥락 표시 |
| **spinner** | 스트리밍 중 애니메이션 |
| **working-text** | 작업 상태 텍스트 표시 |
| **session-title** | 세션 제목 자동 설정 |
| **preflight** | 커밋 전 자동 lint/type-check |
| **queued-messages** | 메시지 큐 시각화 + idle watchdog |
| **usage-analytics** | 토큰/도구 사용량 추적 |
| **usage-reporter** | 사용량 리포트 |
| **claude-hooks-bridge** | Claude hooks 이벤트 브릿지 |
| **memory-layer** | 장기 기억 저장/검색 |
| **backlog** | `/backlog` TUI — 작업 백로그 관리 |
| **notify** | 작업 완료 시스템 알림 |

## Skills

### 핵심 사이클

```
/frame  →  /decide  →  (구현)  →  /verify
```

| 스킬 | 역할 |
|------|------|
| **tft-guidelines** | TFT 4 철칙 — `(명백)` 표기 패턴, 양방향 합리화 차단 |
| **ask-user-question-rules** | 질문 작성 규칙 (공통 prerequisite) |
| **frame** | 구조화된 frame.json 생성 (성공 기준, 검증 계획, 리스크) |
| **decide** | frame.decision 큐 처리 |
| **verify** | frame.json mechanical reader — 행 단위 PASS/FAIL |

### 리뷰 사이클

| 스킬 | 역할 |
|------|------|
| **stress-interview** | 3 병렬 에이전트 (verifier/reviewer/challenger) 코드 리뷰 |
| **self-healing** | stress-interview + 자동 수정 2사이클 |

### 워크플로

| 스킬 | 역할 |
|------|------|
| **db-write** | DB 직접 쓰기 가이드 |
| **db-write-migration** | 마이그레이션 작성 가이드 |
| **jira-issue-management** | Jira 이슈 생성/업데이트 |
| **make-report** | PR 리포트 자동 생성 |
| **start-local-dev** | 로컬 dev 서버 구동 |
| **code-review-and-quality** | 코드 리뷰 품질 기준 |
| **debugging-and-error-recovery** | 디버깅 패턴 |
| **git-workflow-and-versioning** | Git 워크플로 |
| **incremental-implementation** | 점진적 구현 패턴 |

## Agents

| 에이전트 | 모델 | 역할 |
|---------|------|------|
| **verifier** | claude-opus-4-6 | 구현 정확성 검증 |
| **reviewer** | claude-opus-4-6 | 코드 품질/패턴 리뷰 |
| **challenger** | claude-opus-4-6 | 반론/엣지 케이스 제기 |

## Theme

**claude-code-dark** — 파이리 오렌지 (`#d77757`) 액센트 🔥

## Prompts

- `fix-bug` — 버그 수정 프롬프트 템플릿
- `jira-format` — Jira 이슈 포맷

## Structure

```
pilee/
├── extensions/     # TypeScript 익스텐션 (24개)
├── skills/         # 스킬 정의 (16개)
├── agents/         # 서브에이전트 (3개)
├── themes/         # 테마 (1개)
├── prompts/        # 프롬프트 템플릿 (2개)
└── scripts/        # 빌드/동기화 스크립트
```
