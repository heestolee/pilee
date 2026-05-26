# pilee Knowledge

pilee knowledge는 private journal에서 뽑아낸 **public/sanitized 설계 지식**입니다. 개인적인 동기, 시행착오, 회사 맥락은 로컬 `docs/pilee-history.md`와 Notion why log에 남기고, 여기에는 현재도 유효한 구조·판단 기준·운영 규칙만 정리합니다.

## Journal vs Knowledge

| Layer | Visibility | Purpose |
|---|---|---|
| `docs/pilee-history.md` / Notion why log | private/local | 개인적 이유, 시행착오, 감정, 회사 맥락까지 포함한 원본 서사 |
| `docs/knowledge/*.md` | public/sanitized | 현재 pilee 기능을 이해하고 유지하는 데 필요한 범용 설계 지식 |
| generated README graph | public/sanitized | 지식 문서의 검색·탐색·링크 관계를 한눈에 확인 |

## Metadata schema

각 topic 문서는 아래 frontmatter를 가집니다.

```yaml
---
title: 문서 제목
tags: [search, keywords]
category: verification | web-access | agent | workflow | knowledge
status: active | experimental | deprecated | draft
applies_to:
  - skills/verify-report
  - extensions/archive-to-html
source:
  - pilee-history:2026-05-05#48
reviewed_at: 2026-05-05
reviewed_commit: abc1234
related:
  - other-doc-id
supersedes:
  - previous decision or concept label
---
```

`applies_to`는 product knowledge의 code scope처럼 강한 유지보수 경계가 아니라, 이 지식이 설명하는 기능/스킬/확장 영역을 나타냅니다. 실제 코드 path일 수도 있고, `pilee-history`, `automation`, `subagent policy` 같은 concern label일 수도 있습니다.

## CLI

```bash
node scripts/knowledge.mjs --help
node scripts/knowledge.mjs verify-report
node scripts/knowledge.mjs --validate
node scripts/knowledge.mjs --graph
node scripts/knowledge.mjs --freshness --json
node scripts/knowledge.mjs --review-candidates
node scripts/knowledge.mjs --confirm verify-report-workflow
```

운영 원칙:

1. 새 지식을 쓰기 전 기존 문서를 검색합니다.
2. 문서 단위는 “기능 하나”가 아니라 “그 기능을 만들게 한 재사용 가능한 판단 하나”입니다.
3. private journal 내용을 그대로 복붙하지 않고, 공개 가능한 설계 판단으로 재작성합니다.
4. 새 문서나 링크 변경 뒤 `--graph`로 knowledge README와 루트 README의 generated block을 재생성합니다.
5. 내용 검토가 끝난 문서는 `--confirm <doc-id>`로 `reviewed_at`과 `reviewed_commit`을 갱신합니다.
6. 주기적 정합성 점검은 `--freshness` report와 `--review-candidates` 출력, GitHub workflow를 함께 사용합니다.

<!-- PILEE_KNOWLEDGE_GRAPH_START -->
> Source docs drive this generated block; refresh with `node scripts/knowledge.mjs --graph` after changes.

## Topic Index

### agent

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [Worker는 readiness ownership을 가진다](./ai-worker-readiness-orchestrator.md) | active | high | 2026-05-12 | a2019c2 | worker, subagent, orchestrator, readiness, bootstrap, diagnosis |
| [Self-healing은 actionable item만 수정한다](./self-healing-actionable-loop.md) | active | high | 2026-05-13 | e0dc999 | self-healing, actionable, worker, fix-class, subagent, 자동수정 |
| [Stress Interview는 다축 검토다](./stress-interview-multi-axis-review.md) | active | high | 2026-05-13 | 74c8c28 | stress-interview, review, verifier, reviewer, challenger, subagent |
| [Codex-first subagent 모델 운용 정책](./subagent-model-policy.md) | active | high | 2026-05-12 | c82cbb0 | subagent, codex, model-policy, worker, finder, searcher |
| [Subagent 위임은 구체 프롬프트를 요구한다](./subagent-prompt-specificity.md) | active | high | 2026-05-13 | 10e0874 | subagent, prompt, delegation, worker, context, 위임 |
| [Subagent는 slash command가 아니라 skill prompt를 위임받는다](./subagent-skill-delegation.md) | active | high | 2026-05-13 | 10e0874 | subagent, skill, slash-command, delegation, ship, ci-ship |
| [Supervisor는 outcome guardrail이다](./supervisor-outcome-guardrail.md) | active | high | 2026-05-12 | c82cbb0 | supervisor, outcome, guardrail, steering, agent |

### architecture

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [Architecture friction은 TFT의 검증 축이다](./architecture-friction-tft-lens.md) | active | high | 2026-05-13 | e0dc999 | architecture, frame, decide, verify, deep-module, shallow-module |
| [Utils surface는 사용자 계약을 만들지 않는다](./utility-surface-stays-invisible.md) | active | high | 2026-05-13 | 10e0874 | utils, internal, surface, abstraction, extension |

### database

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [DB write는 인간 실행 게이트를 가진다](./database-write-human-execution-gate.md) | active | high | 2026-05-13 | 49eb5f7 | db-write, migration, sql, approval, transaction, database |

### debugging

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [수정 전에 근본 원인을 좁힌다](./root-cause-before-fix.md) | active | high | 2026-05-26 | fca5f1d | debugging, root-cause, triage, error-recovery, systematic, 디버깅 |

### frame

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [백엔드 레이어 맵은 Frame의 초기 이해 게이트다](./backend-layer-map-frame-gate.md) | active | high | 2026-05-13 | e0dc999 | frame, tft, backend, resolver, usecase, service |
| [정책축 스캔은 Frame의 초기 게이트다](./policy-axis-frame-gate.md) | active | high | 2026-05-13 | e0dc999 | frame, tft, policy-axis, campaign, benefits, time-basis |

### knowledge

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [낮은 confidence 판단은 정합성 PR로 올린다](./confidence-sensitive-review.md) | active | high | 2026-05-13 | 49eb5f7 | confidence, review, freshness, ai-actions, user-review, 정합성 |
| [Deterministic action과 AI review action은 분리한다](./deterministic-vs-ai-actions.md) | active | high | 2026-05-13 | 49eb5f7 | knowledge, deterministic, ai-actions, review, automation, 정합성 |
| [Ember는 knowledge의 친근한 입구다](./ember-friendly-knowledge-entrypoint.md) | active | high | 2026-05-13 | f89a0f6 | ember, branding, command, knowledge |
| [Ember Ship은 knowledge 정합성을 release train으로 닫는다](./ember-ship-release-train.md) | active | high | 2026-05-13 | f89a0f6 | ember, knowledge, release-train, freshness, merge-gate |
| [Freshness는 진단서다](./freshness-diagnosis-report.md) | active | high | 2026-05-13 | 1f5c3ac | knowledge, freshness, diagnosis, review, candidate, 정합성 |
| [Knowledge 문서 단위는 판단 하나다](./judgment-doc-unit.md) | active | high | 2026-05-13 | 1f5c3ac | knowledge, judgment, granularity, documentation, coverage, 문서 |
| [Knowledge review queue는 PR body에 남긴다](./knowledge-review-queue-pr-body.md) | active | high | 2026-05-13 | 1f5c3ac | knowledge, review-queue, github-actions, pr-body, ember-ship |
| [pilee 지식 계층과 정합성 갱신](./pilee-knowledge-system.md) | active | high | 2026-05-13 | 1a6aa93 | pilee, knowledge, history, journal, sanitized, reviewed-at |
| [Private journal과 public doctrine은 분리한다](./private-journal-public-doctrine.md) | active | high | 2026-05-13 | 1a6aa93 | knowledge, journal, privacy, sanitized, doctrine, history |
| [README는 knowledge coverage map이다](./readme-coverage-map.md) | active | high | 2026-05-13 | 1a6aa93 | knowledge, readme, coverage, graph, surface, todo |
| [README 철학 변경은 사용자 판단 게이트를 지난다](./readme-philosophy-user-gate.md) | active | high | 2026-05-13 | 1a6aa93 | readme, philosophy, user-gate, public-facing, documentation, 판단 |
| [Retro는 private reflection이다](./retro-private-reflection-boundary.md) | active | high | 2026-05-13 | 74c8c28 | retro, notion, reflection, private, journal, 회고 |
| [reviewed_commit은 날짜 freshness의 빈틈을 막는다](./reviewed-commit-freshness.md) | active | high | 2026-05-13 | 74c8c28 | knowledge, reviewed-commit, reviewed-at, freshness, commit, 정합성 |

### review

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [Diff review draft는 PR 코멘트 전 단계다](./diff-review-draft-handoff.md) | active | high | 2026-05-13 | f89a0f6 | diff-overlay, review-draft, pr-comments, code-review, handoff |

### runtime

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [Codex fast mode는 출력 verbosity와 priority tier만 줄인다](./codex-fast-mode-runtime.md) | active | high | 2026-05-26 | c1cfb50 | codex, model, speed, provider, extension |
| [Deterministic fallback은 workflow를 보존한다](./deterministic-fallbacks-preserve-workflow.md) | active | high | 2026-05-12 | b01add4 | fallback, deterministic, model-failure, resilience, web-search, report |
| [Embedded WebView script는 escape 경계를 보존한다](./embedded-webview-script-escape-boundary.md) | active | high | 2026-05-13 | f89a0f6 | webview, embedded-script, escape, string-raw, regex, glimpse |
| [MCP 결과는 큰 출력만 digest-first로 다룬다](./mcp-digest-first-artifacts.md) | active | high | 2026-05-12 | d98008a | mcp, digest-first, artifact, tool-output, lazy-retrieval |
| [MCP stderr는 TUI 출력이 아니다](./mcp-stderr-isolation.md) | active | high | 2026-05-13 | 1a6aa93 | mcp, stderr, stdio, terminal, tui, noise |
| [터미널 연동은 host adapter로 다룬다](./terminal-host-integration.md) | active | high | 2026-05-13 | e0dc999 | terminal, ghostty, applescript, notify, host, integration |
| [터미널 workspace 복원은 snapshot과 host adapter를 분리한다](./terminal-workspace-restore.md) | active | high | 2026-05-19 | 753d75b | workspace, terminal, ghostty, snapshot, restore, session |

### ui

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [Idle UI는 장식이 아니라 ambient status다](./ambient-status-surfaces.md) | active | high | 2026-05-26 | 285562a | idle-screensaver, tasks, spinner, status, ambient, ui |
| [Editor affordance는 숨은 컨텍스트가 아니다](./editor-affordance-not-context.md) | active | high | 2026-05-13 | dea80b9 | editor, footer, prompt-suggest, working-text, affordance, ui |
| [User-facing 출력은 한국어를 기본으로 한다](./korean-first-user-facing-output.md) | active | high | 2026-05-26 | ae8152b | korean-output, localization, web-search, ui, rewrite, 한국어 |
| [Shortcut Atlas는 단축키 표면을 한 번에 검토한다](./shortcut-atlas-conflict-audit.md) | active | high | 2026-05-20 | 7ea10e4 | shortcuts, keybindings, overlay, collision, audit, ui |
| [Task overlay는 작업 맵을 보존한다](./task-work-map-overlay.md) | active | high | 2026-05-20 | 7ea10e4 | tasks, overlay, work-map, soft-delete, provenance, ui |
| [색상은 정보 위계다](./theme-information-hierarchy.md) | active | high | 2026-05-21 | fcd3b87 | theme, color, dim, muted, border, accent |
| [도구 출력은 대화 흐름을 침범하지 않는다](./tool-output-noise-management.md) | active | high | 2026-05-11 | ce3a598 | tool-output, collapse, noise, ui, usage, renderer |
| [TUI 렌더링 경계에서는 문자열을 신뢰하지 않는다](./tui-rendering-sanitization.md) | active | high | 2026-05-12 | fc6ffa9 | tui, rendering, newline, ansi, sanitize, terminal |

### verification

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [완료 선언은 증거 뒤에만 온다](./evidence-first-verification-gate.md) | active | high | 2026-05-13 | f89a0f6 | verify, evidence, gate, done, ready, verification |
| [Frame과 Verify는 구조화 계약이다](./frame-verify-contract.md) | active | high | 2026-05-13 | e0dc999 | frame, verify, frame-json, success-criteria, contract, verification |
| [반복 검증 실패는 baseline cache로 분리한다](./validation-baseline-failure-cache.md) | active | high | 2026-05-13 | 062f9f2 | preflight, validation, baseline, failure, cache, verification |
| [검증 중 코드 변경은 이전 검증을 무효화한다](./verification-invalidation-on-change.md) | active | high | 2026-05-13 | 062f9f2 | verify, invalidation, code-change, freshness, gate, 검증 |
| [Verify Report 전에는 readiness를 먼저 잠근다](./verify-report-preflight-readiness.md) | active | high | 2026-05-12 | fc6ffa9 | verify-report, preflight, readiness, capture, data, account |
| [Verify Report와 coverage-aware 증거 검증 흐름](./verify-report-workflow.md) | active | high | 2026-05-19 | 7b4b325 | verify-report, verification, evidence, coverage, capture, crop |
| [Verify risk lens는 generic core와 private overlay로 나눈다](./verify-risk-lens-overlay.md) | active | high | 2026-05-12 | fc6ffa9 | verify, risk-lens, overlay, private-overlay, verification, domain-check |

### web-access

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [웹 검색은 승인된 출처 선택을 거친다](./curator-approved-source-selection.md) | active | high | 2026-05-13 | 49eb5f7 | web-search, curator, source-selection, approval, tavily, 검색 |
| [Web Search curator와 승인형 요약 흐름](./web-search-curator.md) | active | high | 2026-05-13 | 062f9f2 | web-search, tavily, curator, glimpse, summary-review, korean-output |

### workflow

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [검토 산출물은 다시 열 수 있어야 한다](./artifact-archive-reopenability.md) | active | high | 2026-05-26 | 2b30eb5 | artifact, archive, show-report, archive-command, history, html |
| [AskUserQuestion은 의사결정 게이트다](./ask-user-question-decision-gates.md) | active | high | 2026-05-13 | ca6dec9 | ask-user-question, tft, decision-gate, question, non-delegable, 질문 |
| [AskUserQuestion 옵션은 행동 분기를 표현한다](./ask-user-question-option-design.md) | active | high | 2026-05-13 | 9152c35 | ask-user-question, option, wording, ceremony, tft, 질문 |
| [Atomic evidence workflow는 작은 claim을 증거로 닫는다](./atomic-evidence-workflow.md) | active | high | 2026-05-13 | e6c131d | atomic, evidence, claim, slice, verification, frame |
| [Auto-commit은 명시 계획만 실행한다](./auto-commit-explicit-plan-gate.md) | active | high | 2026-05-26 | 668415d | auto-commit, git, commit, plan, safety |
| [Backlog는 원 세션 출처를 보존한다](./backlog-source-session-provenance.md) | active | high | 2026-05-13 | ca6dec9 | backlog, tasks, provenance, source-session, session, 맥락 |
| [Bash tool override는 명령 의도와 출력 노이즈를 분리한다](./bash-tool-title-output-override.md) | active | high | 2026-05-13 | 62d55bb | bash, tool, override, ui, output, title |
| [변경 통합은 작은 단위와 검증을 요구한다](./change-integration-discipline.md) | active | high | 2026-05-13 | 49eb5f7 | git, incremental, code-review, commit, quality, 통합 |
| [CI-Ship은 PR 후 검증 실패 대응 단계다](./ci-ship-failure-response-boundary.md) | active | high | 2026-05-20 | 7662f0a | ci-ship, ci, github-actions, pull-request, failure-analysis, ship |
| [Clean handoff는 compact와 새 세션 사이의 전환 계약이다](./clean-handoff-session-continuation.md) | active | high | 2026-05-14 | ae89856 | session, handoff, compact, context, archive, continue-clean |
| [자동 로드 컨텍스트는 최소 surface만 가진다](./context-loading-minimal-surface.md) | active | high | 2026-05-13 | 49eb5f7 | context, agents-md, memory, system-prompt, token, autoload |
| [Decide는 선택을 한 번 공격한다](./decide-tradeoff-challenge.md) | active | high | 2026-05-13 | 9152c35 | decide, tradeoff, challenge, productive-resistance, frame-json, decision |
| [외부 이슈 업데이트는 preview gate를 지난다](./external-issue-preview-gate.md) | active | high | 2026-05-13 | f89a0f6 | jira, issue, preview, wiki-markup, external-update, approval |
| [최종 검증은 메인 세션을 막지 않고 병렬화한다](./final-verification-parallelization.md) | active | high | 2026-05-13 | cdaedbd | verification, ship, final-check, subagent, background, parallel |
| [Fork-panel handoff는 parent inbox로 들어간다](./fork-panel-parent-inbox.md) | active | high | 2026-05-12 | 4d1ff26 | fork-panel, handoff, inbox, inject, parent, panel |
| [Fork-panel 위치는 작업 맥락의 일부다](./fork-panel-spatial-continuity.md) | active | high | 2026-05-20 | f2e7cec | fork-panel, revive, repanel, ghostty, spatial, panel |
| [Frame은 마지막에 Plan을 합성한다](./frame-plan-synthesis-continuity.md) | active | high | 2026-05-20 | 32d1aed | frame, implementation-plan, tft-studio, worktree, continuity, planning |
| [Frame identity는 cwd보다 작업 의도를 우선한다](./frame-planning-identity.md) | active | high | 2026-05-13 | 1f5c3ac | frame, planning, identity, home-directory, ticket, session-title |
| [TFT Studio는 TFT 단계를 작업 단위 UI로 묶는다](./frame-studio-interactive-decision-ui.md) | active | high | 2026-05-20 | 44ae158 | tft-studio, frame-studio, frame, glimpse, ask-user-question, decision-ui |
| [Interactive shell은 bash가 아닌 터미널 세션이다](./interactive-shell-overlay-tool.md) | active | high | 2026-05-13 | f3fe380 | interactive-shell, shell, tui, dev-server, overlay, dispatch |
| [Live artifact는 local preview first다](./live-artifact-preview-pattern.md) | active | high | 2026-05-13 | 1f5c3ac | artifact, glimpse, preview, sse, upload, local-first |
| [로컬 개발 서버 시작은 진단 가능한 절차여야 한다](./local-dev-startup-diagnosis.md) | active | high | 2026-05-07 | 264ea17 | local-dev, server, startup, diagnosis, dev |
| [pilee 변경은 final-check gate로 닫는다](./pilee-final-check-gate.md) | active | high | 2026-05-20 | 0a58e59 | pilee, final-check, verification, skill, workflow, 마무리 |
| [Private overlay package는 회사·개인 실행 맥락을 담는다](./private-overlay-package-boundary.md) | active | high | 2026-05-13 | e0dc999 | privacy, package, overlay, skill, company-context |
| [Queued command는 실행 보장이 아니다](./queued-command-prefill-boundary.md) | active | high | 2026-05-20 | 32d1aed | queued-messages, slash-command, prefill, worktree, session, boundary |
| [Read/Edit tool override는 필요한 증거만 펼친다](./read-edit-tool-output-override.md) | active | high | 2026-05-13 | f3fe380 | read, edit, tool, override, diff, preview |
| [변경된 줄은 요청으로 추적 가능해야 한다](./request-traceability-surgical-changes.md) | active | high | 2026-05-13 | 74c8c28 | request-traceability, surgical-change, karpathy, diff, scope, review |
| [종료된 포크는 transcript 주입보다 revive가 우선이다](./revive-over-transcript-recall.md) | active | high | 2026-05-12 | ca8ae9e | revive, recall, fork-panel, session, continuity, 세션 |
| [세션 분류는 원본 위의 sidecar다](./session-classification-sidecar.md) | active | high | 2026-05-25 | 77307ef | archive, show-report, session-classification, sidecar, session, ai-suggestion |
| [Session export는 원본을 보존하는 adapter를 거친다](./session-export-source-preservation.md) | active | high | 2026-05-13 | 74c8c28 | session-export, source-preservation, jsonl, conductor, normalize, show-report |
| [세션 식별자는 파일명이 아니라 사람이 본 이름이다](./session-identity-over-filenames.md) | active | high | 2026-05-12 | b3d4dce | session, title, identity, session_info, worktree, revive |
| [Ship과 PR-Ship은 서로 다른 통합 단계다](./ship-pr-ship-review-boundary.md) | active | high | 2026-05-13 | 74c8c28 | ship, pr-ship, pr-review, github, commit, push |
| [Skill은 재사용 가능한 절차다](./skills-as-portable-procedures.md) | active | high | 2026-05-12 | b3d4dce | skill, skill-creator, procedure, porting, workflow, 스킬 |
| [Slice 완료는 commit 후보를 만든다](./slice-auto-commit-rhythm.md) | active | high | 2026-05-26 | 668415d | frame, slice, auto-commit, work-context, git |
| [Command shim은 skill source of truth를 지킨다](./tft-command-shim-skill-routing.md) | active | high | 2026-05-13 | 10e0874 | command-shim, skill, tft, frame, slash-command, routing |
| [TFT Preference Regression Gate는 사용자 선호 역전을 막는다](./tft-preference-regression-gate.md) | active | high | 2026-05-13 | 9152c35 | tft, frame, decide, verify, ask-user-question, regression |
| [TFT visual은 구조 변화를 학습 가능한 그림으로 보여준다](./tft-visual-structure-renderer.md) | active | high | 2026-05-13 | 10e0874 | tft-studio, tft-visual, elkjs, schema-diff, database, diagram |
| [To-production은 source-preserving hotfix 이식이다](./to-production-source-preserving-hotfix.md) | active | high | 2026-05-20 | 1dc3eae | to-production, hotfix, production, git, worktree, source-preserving |
| [TUI 질문은 작은 의사결정 게이트다](./tui-ask-decision-overlay.md) | active | high | 2026-05-21 | fcd3b87 | tui, ask-user-question, decision-gate, tool, overlay |
| [Until loop는 종료 조건을 명시 보고한다](./until-loop-explicit-reporting.md) | active | high | 2026-05-05 | 059f445 | until, loop, report, condition, automation |
| [Working Context Card는 큰 맥락을 현재 slice로 압축한다](./work-context-card-task-board.md) | active | high | 2026-05-20 | db0d715 | work-context, tasks, workflow, context, guard |
| [반복 워크플로 실패는 guard/flow로 고정한다](./workflow-guard-enforced-flow.md) | active | high | 2026-05-26 | b434c00 | workflow, guard, intent, audit, hotfix, continuation |
| [작업 절차의 무게는 변경 리스크에 비례해야 한다](./workflow-weight-proportionality.md) | active | high | 2026-05-24 | fbc6771 | workflow, frame, tft, hotfix, scope, incremental |
| [Worktree 생성은 현재 패널 대화가 source다](./worktree-creation-parent-gate.md) | active | high | 2026-05-19 | 6564ee3 | worktree, fork-panel, current-panel, hotfix, context, profile-driven |
| [Worktree 의존성 준비는 조건부 worker가 맡는다](./worktree-dependency-bootstrap-worker.md) | active | high | 2026-05-19 | cd625b8 | worktree, dependencies, bootstrap, profile-driven, worker, subagent |
| [Worktree는 실행 경계다](./worktree-execution-boundary.md) | active | high | 2026-05-20 | 32d1aed | worktree, workspace, repo, branch, execution-boundary, cwd-binding |
| [Worktree 세션 연속성과 식별성 원칙](./worktree-session-continuity.md) | active | high | 2026-05-20 | 57bf4c5 | worktree, session, revive, fork-panel, panel-inbox, handoff |

## Knowledge Map

```mermaid
graph TD
  doc_ai_worker_readiness_orchestrator["Worker는 readiness ownership을 가진다"]
  doc_self_healing_actionable_loop["Self-healing은 actionable item만 수정한다"]
  doc_stress_interview_multi_axis_review["Stress Interview는 다축 검토다"]
  doc_subagent_model_policy["Codex-first subagent 모델 운용 정책"]
  doc_subagent_prompt_specificity["Subagent 위임은 구체 프롬프트를 요구한다"]
  doc_subagent_skill_delegation["Subagent는 slash command가 아니라 skill prompt를 위임받는다"]
  doc_supervisor_outcome_guardrail["Supervisor는 outcome guardrail이다"]
  doc_architecture_friction_tft_lens["Architecture friction은 TFT의 검증 축이다"]
  doc_utility_surface_stays_invisible["Utils surface는 사용자 계약을 만들지 않는다"]
  doc_database_write_human_execution_gate["DB write는 인간 실행 게이트를 가진다"]
  doc_root_cause_before_fix["수정 전에 근본 원인을 좁힌다"]
  doc_backend_layer_map_frame_gate["백엔드 레이어 맵은 Frame의 초기 이해 게이트다"]
  doc_policy_axis_frame_gate["정책축 스캔은 Frame의 초기 게이트다"]
  doc_confidence_sensitive_review["낮은 confidence 판단은 정합성 PR로 올린다"]
  doc_deterministic_vs_ai_actions["Deterministic action과 AI review action은 분리한다"]
  doc_ember_friendly_knowledge_entrypoint["Ember는 knowledge의 친근한 입구다"]
  doc_ember_ship_release_train["Ember Ship은 knowledge 정합성을 release train으로 닫는다"]
  doc_freshness_diagnosis_report["Freshness는 진단서다"]
  doc_judgment_doc_unit["Knowledge 문서 단위는 판단 하나다"]
  doc_knowledge_review_queue_pr_body["Knowledge review queue는 PR body에 남긴다"]
  doc_pilee_knowledge_system["pilee 지식 계층과 정합성 갱신"]
  doc_private_journal_public_doctrine["Private journal과 public doctrine은 분리한다"]
  doc_readme_coverage_map["README는 knowledge coverage map이다"]
  doc_readme_philosophy_user_gate["README 철학 변경은 사용자 판단 게이트를 지난다"]
  doc_retro_private_reflection_boundary["Retro는 private reflection이다"]
  doc_reviewed_commit_freshness["reviewed_commit은 날짜 freshness의 빈틈을 막는다"]
  doc_diff_review_draft_handoff["Diff review draft는 PR 코멘트 전 단계다"]
  doc_codex_fast_mode_runtime["Codex fast mode는 출력 verbosity와 priority tier만 줄인다"]
  doc_deterministic_fallbacks_preserve_workflow["Deterministic fallback은 workflow를 보존한다"]
  doc_embedded_webview_script_escape_boundary["Embedded WebView script는 escape 경계를 보존한다"]
  doc_mcp_digest_first_artifacts["MCP 결과는 큰 출력만 digest-first로 다룬다"]
  doc_mcp_stderr_isolation["MCP stderr는 TUI 출력이 아니다"]
  doc_terminal_host_integration["터미널 연동은 host adapter로 다룬다"]
  doc_terminal_workspace_restore["터미널 workspace 복원은 snapshot과 host adapter를 분리한다"]
  doc_ambient_status_surfaces["Idle UI는 장식이 아니라 ambient status다"]
  doc_editor_affordance_not_context["Editor affordance는 숨은 컨텍스트가 아니다"]
  doc_korean_first_user_facing_output["User-facing 출력은 한국어를 기본으로 한다"]
  doc_shortcut_atlas_conflict_audit["Shortcut Atlas는 단축키 표면을 한 번에 검토한다"]
  doc_task_work_map_overlay["Task overlay는 작업 맵을 보존한다"]
  doc_theme_information_hierarchy["색상은 정보 위계다"]
  doc_tool_output_noise_management["도구 출력은 대화 흐름을 침범하지 않는다"]
  doc_tui_rendering_sanitization["TUI 렌더링 경계에서는 문자열을 신뢰하지 않는다"]
  doc_evidence_first_verification_gate["완료 선언은 증거 뒤에만 온다"]
  doc_frame_verify_contract["Frame과 Verify는 구조화 계약이다"]
  doc_validation_baseline_failure_cache["반복 검증 실패는 baseline cache로 분리한다"]
  doc_verification_invalidation_on_change["검증 중 코드 변경은 이전 검증을 무효화한다"]
  doc_verify_report_preflight_readiness["Verify Report 전에는 readiness를 먼저 잠근다"]
  doc_verify_report_workflow["Verify Report와 coverage-aware 증거 검증 흐름"]
  doc_verify_risk_lens_overlay["Verify risk lens는 generic core와 private overlay로 나눈다"]
  doc_curator_approved_source_selection["웹 검색은 승인된 출처 선택을 거친다"]
  doc_web_search_curator["Web Search curator와 승인형 요약 흐름"]
  doc_artifact_archive_reopenability["검토 산출물은 다시 열 수 있어야 한다"]
  doc_ask_user_question_decision_gates["AskUserQuestion은 의사결정 게이트다"]
  doc_ask_user_question_option_design["AskUserQuestion 옵션은 행동 분기를 표현한다"]
  doc_atomic_evidence_workflow["Atomic evidence workflow는 작은 claim을 증거로 닫는다"]
  doc_auto_commit_explicit_plan_gate["Auto-commit은 명시 계획만 실행한다"]
  doc_backlog_source_session_provenance["Backlog는 원 세션 출처를 보존한다"]
  doc_bash_tool_title_output_override["Bash tool override는 명령 의도와 출력 노이즈를 분리한다"]
  doc_change_integration_discipline["변경 통합은 작은 단위와 검증을 요구한다"]
  doc_ci_ship_failure_response_boundary["CI-Ship은 PR 후 검증 실패 대응 단계다"]
  doc_clean_handoff_session_continuation["Clean handoff는 compact와 새 세션 사이의 전환 계약이다"]
  doc_context_loading_minimal_surface["자동 로드 컨텍스트는 최소 surface만 가진다"]
  doc_decide_tradeoff_challenge["Decide는 선택을 한 번 공격한다"]
  doc_external_issue_preview_gate["외부 이슈 업데이트는 preview gate를 지난다"]
  doc_final_verification_parallelization["최종 검증은 메인 세션을 막지 않고 병렬화한다"]
  doc_fork_panel_parent_inbox["Fork-panel handoff는 parent inbox로 들어간다"]
  doc_fork_panel_spatial_continuity["Fork-panel 위치는 작업 맥락의 일부다"]
  doc_frame_plan_synthesis_continuity["Frame은 마지막에 Plan을 합성한다"]
  doc_frame_planning_identity["Frame identity는 cwd보다 작업 의도를 우선한다"]
  doc_frame_studio_interactive_decision_ui["TFT Studio는 TFT 단계를 작업 단위 UI로 묶는다"]
  doc_interactive_shell_overlay_tool["Interactive shell은 bash가 아닌 터미널 세션이다"]
  doc_live_artifact_preview_pattern["Live artifact는 local preview first다"]
  doc_local_dev_startup_diagnosis["로컬 개발 서버 시작은 진단 가능한 절차여야 한다"]
  doc_pilee_final_check_gate["pilee 변경은 final-check gate로 닫는다"]
  doc_private_overlay_package_boundary["Private overlay package는 회사·개인 실행 맥락을 담는다"]
  doc_queued_command_prefill_boundary["Queued command는 실행 보장이 아니다"]
  doc_read_edit_tool_output_override["Read/Edit tool override는 필요한 증거만 펼친다"]
  doc_request_traceability_surgical_changes["변경된 줄은 요청으로 추적 가능해야 한다"]
  doc_revive_over_transcript_recall["종료된 포크는 transcript 주입보다 revive가 우선이다"]
  doc_session_classification_sidecar["세션 분류는 원본 위의 sidecar다"]
  doc_session_export_source_preservation["Session export는 원본을 보존하는 adapter를 거친다"]
  doc_session_identity_over_filenames["세션 식별자는 파일명이 아니라 사람이 본 이름이다"]
  doc_ship_pr_ship_review_boundary["Ship과 PR-Ship은 서로 다른 통합 단계다"]
  doc_skills_as_portable_procedures["Skill은 재사용 가능한 절차다"]
  doc_slice_auto_commit_rhythm["Slice 완료는 commit 후보를 만든다"]
  doc_tft_command_shim_skill_routing["Command shim은 skill source of truth를 지킨다"]
  doc_tft_preference_regression_gate["TFT Preference Regression Gate는 사용자 선호 역전을 막는다"]
  doc_tft_visual_structure_renderer["TFT visual은 구조 변화를 학습 가능한 그림으로 보여준다"]
  doc_to_production_source_preserving_hotfix["To-production은 source-preserving hotfix 이식이다"]
  doc_tui_ask_decision_overlay["TUI 질문은 작은 의사결정 게이트다"]
  doc_until_loop_explicit_reporting["Until loop는 종료 조건을 명시 보고한다"]
  doc_work_context_card_task_board["Working Context Card는 큰 맥락을 현재 slice로 압축한다"]
  doc_workflow_guard_enforced_flow["반복 워크플로 실패는 guard/flow로 고정한다"]
  doc_workflow_weight_proportionality["작업 절차의 무게는 변경 리스크에 비례해야 한다"]
  doc_worktree_creation_parent_gate["Worktree 생성은 현재 패널 대화가 source다"]
  doc_worktree_dependency_bootstrap_worker["Worktree 의존성 준비는 조건부 worker가 맡는다"]
  doc_worktree_execution_boundary["Worktree는 실행 경계다"]
  doc_worktree_session_continuity["Worktree 세션 연속성과 식별성 원칙"]
  doc_ai_worker_readiness_orchestrator --> doc_self_healing_actionable_loop
  doc_ai_worker_readiness_orchestrator --> doc_stress_interview_multi_axis_review
  doc_ai_worker_readiness_orchestrator --> doc_subagent_model_policy
  doc_ai_worker_readiness_orchestrator --> doc_subagent_prompt_specificity
  doc_ai_worker_readiness_orchestrator --> doc_worktree_dependency_bootstrap_worker
  doc_self_healing_actionable_loop --> doc_stress_interview_multi_axis_review
  doc_self_healing_actionable_loop --> doc_subagent_model_policy
  doc_self_healing_actionable_loop --> doc_verification_invalidation_on_change
  doc_stress_interview_multi_axis_review --> doc_evidence_first_verification_gate
  doc_stress_interview_multi_axis_review --> doc_self_healing_actionable_loop
  doc_stress_interview_multi_axis_review --> doc_subagent_model_policy
  doc_subagent_model_policy --> doc_pilee_knowledge_system
  doc_subagent_model_policy --> doc_worktree_session_continuity
  doc_subagent_prompt_specificity --> doc_self_healing_actionable_loop
  doc_subagent_prompt_specificity --> doc_subagent_model_policy
  doc_subagent_prompt_specificity --> doc_worktree_session_continuity
  doc_subagent_skill_delegation --> doc_ci_ship_failure_response_boundary
  doc_subagent_skill_delegation --> doc_queued_command_prefill_boundary
  doc_subagent_skill_delegation --> doc_ship_pr_ship_review_boundary
  doc_subagent_skill_delegation --> doc_subagent_prompt_specificity
  doc_supervisor_outcome_guardrail --> doc_ask_user_question_decision_gates
  doc_supervisor_outcome_guardrail --> doc_subagent_prompt_specificity
  doc_architecture_friction_tft_lens --> doc_decide_tradeoff_challenge
  doc_architecture_friction_tft_lens --> doc_evidence_first_verification_gate
  doc_architecture_friction_tft_lens --> doc_frame_verify_contract
  doc_utility_surface_stays_invisible --> doc_deterministic_fallbacks_preserve_workflow
  doc_utility_surface_stays_invisible --> doc_terminal_host_integration
  doc_database_write_human_execution_gate --> doc_ask_user_question_decision_gates
  doc_database_write_human_execution_gate --> doc_evidence_first_verification_gate
  doc_database_write_human_execution_gate --> doc_private_overlay_package_boundary
  doc_root_cause_before_fix --> doc_evidence_first_verification_gate
  doc_root_cause_before_fix --> doc_verification_invalidation_on_change
  doc_backend_layer_map_frame_gate --> doc_architecture_friction_tft_lens
  doc_backend_layer_map_frame_gate --> doc_frame_verify_contract
  doc_backend_layer_map_frame_gate --> doc_policy_axis_frame_gate
  doc_backend_layer_map_frame_gate --> doc_tft_visual_structure_renderer
  doc_policy_axis_frame_gate --> doc_architecture_friction_tft_lens
  doc_policy_axis_frame_gate --> doc_frame_verify_contract
  doc_policy_axis_frame_gate --> doc_tft_visual_structure_renderer
  doc_confidence_sensitive_review --> doc_deterministic_vs_ai_actions
  doc_confidence_sensitive_review --> doc_freshness_diagnosis_report
  doc_confidence_sensitive_review --> doc_readme_philosophy_user_gate
  doc_deterministic_vs_ai_actions --> doc_freshness_diagnosis_report
  doc_deterministic_vs_ai_actions --> doc_readme_coverage_map
  doc_ember_friendly_knowledge_entrypoint --> doc_judgment_doc_unit
  doc_ember_friendly_knowledge_entrypoint --> doc_pilee_knowledge_system
  doc_ember_friendly_knowledge_entrypoint --> doc_private_journal_public_doctrine
  doc_ember_friendly_knowledge_entrypoint --> doc_readme_philosophy_user_gate
  doc_ember_ship_release_train --> doc_deterministic_vs_ai_actions
  doc_ember_ship_release_train --> doc_ember_friendly_knowledge_entrypoint
  doc_ember_ship_release_train --> doc_freshness_diagnosis_report
  doc_ember_ship_release_train --> doc_pilee_final_check_gate
  doc_ember_ship_release_train --> doc_pilee_knowledge_system
  doc_ember_ship_release_train --> doc_private_journal_public_doctrine
  doc_freshness_diagnosis_report --> doc_deterministic_vs_ai_actions
  doc_freshness_diagnosis_report --> doc_judgment_doc_unit
  doc_freshness_diagnosis_report --> doc_readme_coverage_map
  doc_judgment_doc_unit --> doc_freshness_diagnosis_report
  doc_judgment_doc_unit --> doc_private_journal_public_doctrine
  doc_judgment_doc_unit --> doc_readme_coverage_map
  doc_knowledge_review_queue_pr_body --> doc_deterministic_vs_ai_actions
  doc_knowledge_review_queue_pr_body --> doc_ember_ship_release_train
  doc_knowledge_review_queue_pr_body --> doc_freshness_diagnosis_report
  doc_knowledge_review_queue_pr_body --> doc_pilee_knowledge_system
  doc_knowledge_review_queue_pr_body --> doc_reviewed_commit_freshness
  doc_pilee_knowledge_system --> doc_subagent_model_policy
  doc_pilee_knowledge_system --> doc_verify_report_workflow
  doc_pilee_knowledge_system --> doc_web_search_curator
  doc_private_journal_public_doctrine --> doc_freshness_diagnosis_report
  doc_private_journal_public_doctrine --> doc_judgment_doc_unit
  doc_private_journal_public_doctrine --> doc_pilee_knowledge_system
  doc_readme_coverage_map --> doc_freshness_diagnosis_report
  doc_readme_coverage_map --> doc_judgment_doc_unit
  doc_readme_philosophy_user_gate --> doc_ask_user_question_decision_gates
  doc_readme_philosophy_user_gate --> doc_deterministic_vs_ai_actions
  doc_readme_philosophy_user_gate --> doc_readme_coverage_map
  doc_retro_private_reflection_boundary --> doc_artifact_archive_reopenability
  doc_retro_private_reflection_boundary --> doc_private_journal_public_doctrine
  doc_reviewed_commit_freshness --> doc_deterministic_vs_ai_actions
  doc_reviewed_commit_freshness --> doc_freshness_diagnosis_report
  doc_diff_review_draft_handoff --> doc_change_integration_discipline
  doc_diff_review_draft_handoff --> doc_tool_output_noise_management
  doc_codex_fast_mode_runtime --> doc_editor_affordance_not_context
  doc_codex_fast_mode_runtime --> doc_subagent_model_policy
  doc_codex_fast_mode_runtime --> doc_workflow_guard_enforced_flow
  doc_deterministic_fallbacks_preserve_workflow --> doc_curator_approved_source_selection
  doc_deterministic_fallbacks_preserve_workflow --> doc_live_artifact_preview_pattern
  doc_embedded_webview_script_escape_boundary --> doc_artifact_archive_reopenability
  doc_embedded_webview_script_escape_boundary --> doc_deterministic_fallbacks_preserve_workflow
  doc_embedded_webview_script_escape_boundary --> doc_frame_studio_interactive_decision_ui
  doc_embedded_webview_script_escape_boundary --> doc_live_artifact_preview_pattern
  doc_embedded_webview_script_escape_boundary --> doc_tui_rendering_sanitization
  doc_mcp_digest_first_artifacts --> doc_artifact_archive_reopenability
  doc_mcp_digest_first_artifacts --> doc_mcp_stderr_isolation
  doc_mcp_digest_first_artifacts --> doc_tool_output_noise_management
  doc_mcp_digest_first_artifacts --> doc_web_search_curator
  doc_mcp_stderr_isolation --> doc_terminal_host_integration
  doc_mcp_stderr_isolation --> doc_tui_rendering_sanitization
  doc_terminal_host_integration --> doc_fork_panel_spatial_continuity
  doc_terminal_host_integration --> doc_mcp_stderr_isolation
  doc_terminal_host_integration --> doc_terminal_workspace_restore
  doc_terminal_host_integration --> doc_theme_information_hierarchy
  doc_terminal_workspace_restore --> doc_fork_panel_spatial_continuity
  doc_terminal_workspace_restore --> doc_session_identity_over_filenames
  doc_terminal_workspace_restore --> doc_terminal_host_integration
  doc_ambient_status_surfaces --> doc_backlog_source_session_provenance
  doc_ambient_status_surfaces --> doc_tool_output_noise_management
  doc_editor_affordance_not_context --> doc_context_loading_minimal_surface
  doc_editor_affordance_not_context --> doc_theme_information_hierarchy
  doc_editor_affordance_not_context --> doc_tool_output_noise_management
  doc_korean_first_user_facing_output --> doc_curator_approved_source_selection
  doc_korean_first_user_facing_output --> doc_theme_information_hierarchy
  doc_korean_first_user_facing_output --> doc_web_search_curator
  doc_shortcut_atlas_conflict_audit --> doc_readme_coverage_map
  doc_shortcut_atlas_conflict_audit --> doc_task_work_map_overlay
  doc_shortcut_atlas_conflict_audit --> doc_terminal_host_integration
  doc_shortcut_atlas_conflict_audit --> doc_theme_information_hierarchy
  doc_task_work_map_overlay --> doc_ambient_status_surfaces
  doc_task_work_map_overlay --> doc_backlog_source_session_provenance
  doc_task_work_map_overlay --> doc_work_context_card_task_board
  doc_theme_information_hierarchy --> doc_terminal_host_integration
  doc_theme_information_hierarchy --> doc_tui_rendering_sanitization
  doc_tool_output_noise_management --> doc_ambient_status_surfaces
  doc_tool_output_noise_management --> doc_mcp_stderr_isolation
  doc_tool_output_noise_management --> doc_tui_rendering_sanitization
  doc_tui_rendering_sanitization --> doc_mcp_stderr_isolation
  doc_tui_rendering_sanitization --> doc_terminal_host_integration
  doc_tui_rendering_sanitization --> doc_theme_information_hierarchy
  doc_evidence_first_verification_gate --> doc_architecture_friction_tft_lens
  doc_evidence_first_verification_gate --> doc_frame_verify_contract
  doc_evidence_first_verification_gate --> doc_verification_invalidation_on_change
  doc_evidence_first_verification_gate --> doc_verify_report_workflow
  doc_frame_verify_contract --> doc_architecture_friction_tft_lens
  doc_frame_verify_contract --> doc_ask_user_question_decision_gates
  doc_frame_verify_contract --> doc_evidence_first_verification_gate
  doc_frame_verify_contract --> doc_frame_plan_synthesis_continuity
  doc_frame_verify_contract --> doc_verification_invalidation_on_change
  doc_frame_verify_contract --> doc_verify_risk_lens_overlay
  doc_validation_baseline_failure_cache --> doc_deterministic_fallbacks_preserve_workflow
  doc_validation_baseline_failure_cache --> doc_evidence_first_verification_gate
  doc_validation_baseline_failure_cache --> doc_root_cause_before_fix
  doc_validation_baseline_failure_cache --> doc_worktree_session_continuity
  doc_verification_invalidation_on_change --> doc_evidence_first_verification_gate
  doc_verification_invalidation_on_change --> doc_frame_verify_contract
  doc_verify_report_preflight_readiness --> doc_evidence_first_verification_gate
  doc_verify_report_preflight_readiness --> doc_live_artifact_preview_pattern
  doc_verify_report_preflight_readiness --> doc_private_overlay_package_boundary
  doc_verify_report_preflight_readiness --> doc_verify_report_workflow
  doc_verify_report_workflow --> doc_artifact_archive_reopenability
  doc_verify_report_workflow --> doc_evidence_first_verification_gate
  doc_verify_report_workflow --> doc_live_artifact_preview_pattern
  doc_verify_report_workflow --> doc_pilee_knowledge_system
  doc_verify_report_workflow --> doc_private_overlay_package_boundary
  doc_verify_report_workflow --> doc_web_search_curator
  doc_verify_risk_lens_overlay --> doc_evidence_first_verification_gate
  doc_verify_risk_lens_overlay --> doc_frame_verify_contract
  doc_verify_risk_lens_overlay --> doc_private_overlay_package_boundary
  doc_verify_risk_lens_overlay --> doc_verification_invalidation_on_change
  doc_verify_risk_lens_overlay --> doc_verify_report_workflow
  doc_curator_approved_source_selection --> doc_deterministic_fallbacks_preserve_workflow
  doc_curator_approved_source_selection --> doc_live_artifact_preview_pattern
  doc_curator_approved_source_selection --> doc_web_search_curator
  doc_web_search_curator --> doc_pilee_knowledge_system
  doc_web_search_curator --> doc_verify_report_workflow
  doc_artifact_archive_reopenability --> doc_backlog_source_session_provenance
  doc_artifact_archive_reopenability --> doc_frame_studio_interactive_decision_ui
  doc_artifact_archive_reopenability --> doc_live_artifact_preview_pattern
  doc_artifact_archive_reopenability --> doc_verify_report_workflow
  doc_ask_user_question_decision_gates --> doc_ask_user_question_option_design
  doc_ask_user_question_decision_gates --> doc_evidence_first_verification_gate
  doc_ask_user_question_decision_gates --> doc_frame_verify_contract
  doc_ask_user_question_option_design --> doc_ask_user_question_decision_gates
  doc_ask_user_question_option_design --> doc_atomic_evidence_workflow
  doc_ask_user_question_option_design --> doc_evidence_first_verification_gate
  doc_ask_user_question_option_design --> doc_tft_preference_regression_gate
  doc_atomic_evidence_workflow --> doc_evidence_first_verification_gate
  doc_atomic_evidence_workflow --> doc_frame_studio_interactive_decision_ui
  doc_atomic_evidence_workflow --> doc_frame_verify_contract
  doc_atomic_evidence_workflow --> doc_verify_report_workflow
  doc_atomic_evidence_workflow --> doc_worktree_session_continuity
  doc_auto_commit_explicit_plan_gate --> doc_change_integration_discipline
  doc_auto_commit_explicit_plan_gate --> doc_deterministic_vs_ai_actions
  doc_auto_commit_explicit_plan_gate --> doc_request_traceability_surgical_changes
  doc_auto_commit_explicit_plan_gate --> doc_slice_auto_commit_rhythm
  doc_backlog_source_session_provenance --> doc_artifact_archive_reopenability
  doc_backlog_source_session_provenance --> doc_session_identity_over_filenames
  doc_bash_tool_title_output_override --> doc_atomic_evidence_workflow
  doc_bash_tool_title_output_override --> doc_korean_first_user_facing_output
  doc_bash_tool_title_output_override --> doc_tool_output_noise_management
  doc_change_integration_discipline --> doc_evidence_first_verification_gate
  doc_change_integration_discipline --> doc_stress_interview_multi_axis_review
  doc_ci_ship_failure_response_boundary --> doc_change_integration_discipline
  doc_ci_ship_failure_response_boundary --> doc_evidence_first_verification_gate
  doc_ci_ship_failure_response_boundary --> doc_root_cause_before_fix
  doc_ci_ship_failure_response_boundary --> doc_ship_pr_ship_review_boundary
  doc_clean_handoff_session_continuation --> doc_artifact_archive_reopenability
  doc_clean_handoff_session_continuation --> doc_session_identity_over_filenames
  doc_clean_handoff_session_continuation --> doc_worktree_session_continuity
  doc_context_loading_minimal_surface --> doc_private_journal_public_doctrine
  doc_context_loading_minimal_surface --> doc_tool_output_noise_management
  doc_decide_tradeoff_challenge --> doc_architecture_friction_tft_lens
  doc_decide_tradeoff_challenge --> doc_ask_user_question_decision_gates
  doc_decide_tradeoff_challenge --> doc_ask_user_question_option_design
  doc_decide_tradeoff_challenge --> doc_atomic_evidence_workflow
  doc_decide_tradeoff_challenge --> doc_evidence_first_verification_gate
  doc_decide_tradeoff_challenge --> doc_frame_studio_interactive_decision_ui
  doc_decide_tradeoff_challenge --> doc_frame_verify_contract
  doc_decide_tradeoff_challenge --> doc_tft_preference_regression_gate
  doc_external_issue_preview_gate --> doc_ask_user_question_decision_gates
  doc_external_issue_preview_gate --> doc_live_artifact_preview_pattern
  doc_external_issue_preview_gate --> doc_private_overlay_package_boundary
  doc_final_verification_parallelization --> doc_ai_worker_readiness_orchestrator
  doc_final_verification_parallelization --> doc_change_integration_discipline
  doc_final_verification_parallelization --> doc_evidence_first_verification_gate
  doc_final_verification_parallelization --> doc_subagent_prompt_specificity
  doc_final_verification_parallelization --> doc_subagent_skill_delegation
  doc_fork_panel_parent_inbox --> doc_revive_over_transcript_recall
  doc_fork_panel_parent_inbox --> doc_session_identity_over_filenames
  doc_fork_panel_parent_inbox --> doc_subagent_prompt_specificity
  doc_fork_panel_spatial_continuity --> doc_revive_over_transcript_recall
  doc_fork_panel_spatial_continuity --> doc_session_identity_over_filenames
  doc_fork_panel_spatial_continuity --> doc_terminal_host_integration
  doc_frame_plan_synthesis_continuity --> doc_frame_planning_identity
  doc_frame_plan_synthesis_continuity --> doc_frame_studio_interactive_decision_ui
  doc_frame_plan_synthesis_continuity --> doc_frame_verify_contract
  doc_frame_plan_synthesis_continuity --> doc_worktree_session_continuity
  doc_frame_planning_identity --> doc_frame_plan_synthesis_continuity
  doc_frame_planning_identity --> doc_frame_verify_contract
  doc_frame_planning_identity --> doc_session_identity_over_filenames
  doc_frame_planning_identity --> doc_worktree_session_continuity
  doc_frame_studio_interactive_decision_ui --> doc_ask_user_question_option_design
  doc_frame_studio_interactive_decision_ui --> doc_evidence_first_verification_gate
  doc_frame_studio_interactive_decision_ui --> doc_frame_plan_synthesis_continuity
  doc_frame_studio_interactive_decision_ui --> doc_frame_planning_identity
  doc_frame_studio_interactive_decision_ui --> doc_frame_verify_contract
  doc_frame_studio_interactive_decision_ui --> doc_live_artifact_preview_pattern
  doc_frame_studio_interactive_decision_ui --> doc_tft_visual_structure_renderer
  doc_interactive_shell_overlay_tool --> doc_bash_tool_title_output_override
  doc_interactive_shell_overlay_tool --> doc_terminal_host_integration
  doc_interactive_shell_overlay_tool --> doc_tool_output_noise_management
  doc_live_artifact_preview_pattern --> doc_artifact_archive_reopenability
  doc_live_artifact_preview_pattern --> doc_verify_report_workflow
  doc_live_artifact_preview_pattern --> doc_web_search_curator
  doc_local_dev_startup_diagnosis --> doc_private_overlay_package_boundary
  doc_local_dev_startup_diagnosis --> doc_root_cause_before_fix
  doc_local_dev_startup_diagnosis --> doc_worktree_execution_boundary
  doc_pilee_final_check_gate --> doc_change_integration_discipline
  doc_pilee_final_check_gate --> doc_evidence_first_verification_gate
  doc_pilee_final_check_gate --> doc_pilee_knowledge_system
  doc_pilee_final_check_gate --> doc_request_traceability_surgical_changes
  doc_private_overlay_package_boundary --> doc_database_write_human_execution_gate
  doc_private_overlay_package_boundary --> doc_private_journal_public_doctrine
  doc_private_overlay_package_boundary --> doc_skills_as_portable_procedures
  doc_private_overlay_package_boundary --> doc_verify_risk_lens_overlay
  doc_queued_command_prefill_boundary --> doc_session_identity_over_filenames
  doc_queued_command_prefill_boundary --> doc_subagent_prompt_specificity
  doc_queued_command_prefill_boundary --> doc_subagent_skill_delegation
  doc_queued_command_prefill_boundary --> doc_worktree_execution_boundary
  doc_read_edit_tool_output_override --> doc_atomic_evidence_workflow
  doc_read_edit_tool_output_override --> doc_bash_tool_title_output_override
  doc_read_edit_tool_output_override --> doc_tool_output_noise_management
  doc_request_traceability_surgical_changes --> doc_change_integration_discipline
  doc_request_traceability_surgical_changes --> doc_evidence_first_verification_gate
  doc_request_traceability_surgical_changes --> doc_frame_verify_contract
  doc_revive_over_transcript_recall --> doc_fork_panel_parent_inbox
  doc_revive_over_transcript_recall --> doc_session_identity_over_filenames
  doc_revive_over_transcript_recall --> doc_worktree_session_continuity
  doc_session_classification_sidecar --> doc_artifact_archive_reopenability
  doc_session_classification_sidecar --> doc_backlog_source_session_provenance
  doc_session_classification_sidecar --> doc_deterministic_fallbacks_preserve_workflow
  doc_session_classification_sidecar --> doc_session_export_source_preservation
  doc_session_export_source_preservation --> doc_artifact_archive_reopenability
  doc_session_export_source_preservation --> doc_backlog_source_session_provenance
  doc_session_export_source_preservation --> doc_deterministic_fallbacks_preserve_workflow
  doc_session_export_source_preservation --> doc_session_identity_over_filenames
  doc_session_identity_over_filenames --> doc_backlog_source_session_provenance
  doc_session_identity_over_filenames --> doc_revive_over_transcript_recall
  doc_session_identity_over_filenames --> doc_worktree_session_continuity
  doc_ship_pr_ship_review_boundary --> doc_change_integration_discipline
  doc_ship_pr_ship_review_boundary --> doc_diff_review_draft_handoff
  doc_ship_pr_ship_review_boundary --> doc_evidence_first_verification_gate
  doc_ship_pr_ship_review_boundary --> doc_request_traceability_surgical_changes
  doc_ship_pr_ship_review_boundary --> doc_subagent_skill_delegation
  doc_skills_as_portable_procedures --> doc_context_loading_minimal_surface
  doc_skills_as_portable_procedures --> doc_judgment_doc_unit
  doc_slice_auto_commit_rhythm --> doc_auto_commit_explicit_plan_gate
  doc_slice_auto_commit_rhythm --> doc_change_integration_discipline
  doc_slice_auto_commit_rhythm --> doc_frame_plan_synthesis_continuity
  doc_slice_auto_commit_rhythm --> doc_work_context_card_task_board
  doc_tft_command_shim_skill_routing --> doc_frame_verify_contract
  doc_tft_command_shim_skill_routing --> doc_queued_command_prefill_boundary
  doc_tft_command_shim_skill_routing --> doc_skills_as_portable_procedures
  doc_tft_preference_regression_gate --> doc_ask_user_question_option_design
  doc_tft_preference_regression_gate --> doc_atomic_evidence_workflow
  doc_tft_preference_regression_gate --> doc_decide_tradeoff_challenge
  doc_tft_preference_regression_gate --> doc_evidence_first_verification_gate
  doc_tft_preference_regression_gate --> doc_frame_verify_contract
  doc_tft_visual_structure_renderer --> doc_backend_layer_map_frame_gate
  doc_tft_visual_structure_renderer --> doc_evidence_first_verification_gate
  doc_tft_visual_structure_renderer --> doc_frame_studio_interactive_decision_ui
  doc_tft_visual_structure_renderer --> doc_frame_verify_contract
  doc_to_production_source_preserving_hotfix --> doc_worktree_creation_parent_gate
  doc_to_production_source_preserving_hotfix --> doc_worktree_execution_boundary
  doc_tui_ask_decision_overlay --> doc_ask_user_question_decision_gates
  doc_tui_ask_decision_overlay --> doc_ask_user_question_option_design
  doc_tui_ask_decision_overlay --> doc_tui_rendering_sanitization
  doc_until_loop_explicit_reporting --> doc_deterministic_vs_ai_actions
  doc_until_loop_explicit_reporting --> doc_evidence_first_verification_gate
  doc_work_context_card_task_board --> doc_ambient_status_surfaces
  doc_work_context_card_task_board --> doc_frame_plan_synthesis_continuity
  doc_work_context_card_task_board --> doc_frame_studio_interactive_decision_ui
  doc_work_context_card_task_board --> doc_slice_auto_commit_rhythm
  doc_work_context_card_task_board --> doc_workflow_guard_enforced_flow
  doc_work_context_card_task_board --> doc_worktree_session_continuity
  doc_workflow_guard_enforced_flow --> doc_ask_user_question_decision_gates
  doc_workflow_guard_enforced_flow --> doc_change_integration_discipline
  doc_workflow_guard_enforced_flow --> doc_frame_studio_interactive_decision_ui
  doc_workflow_guard_enforced_flow --> doc_tui_ask_decision_overlay
  doc_workflow_guard_enforced_flow --> doc_validation_baseline_failure_cache
  doc_workflow_guard_enforced_flow --> doc_workflow_weight_proportionality
  doc_workflow_weight_proportionality --> doc_frame_verify_contract
  doc_workflow_weight_proportionality --> doc_request_traceability_surgical_changes
  doc_workflow_weight_proportionality --> doc_verify_report_preflight_readiness
  doc_workflow_weight_proportionality --> doc_worktree_session_continuity
  doc_worktree_creation_parent_gate --> doc_worktree_execution_boundary
  doc_worktree_creation_parent_gate --> doc_worktree_session_continuity
  doc_worktree_dependency_bootstrap_worker --> doc_subagent_model_policy
  doc_worktree_dependency_bootstrap_worker --> doc_subagent_prompt_specificity
  doc_worktree_dependency_bootstrap_worker --> doc_worktree_creation_parent_gate
  doc_worktree_dependency_bootstrap_worker --> doc_worktree_execution_boundary
  doc_worktree_dependency_bootstrap_worker --> doc_worktree_session_continuity
  doc_worktree_execution_boundary --> doc_session_identity_over_filenames
  doc_worktree_execution_boundary --> doc_worktree_session_continuity
  doc_worktree_session_continuity --> doc_frame_plan_synthesis_continuity
  doc_worktree_session_continuity --> doc_pilee_knowledge_system
  doc_worktree_session_continuity --> doc_subagent_model_policy
```

## Review Metadata Summary

- Documents: 98
- Links: 336
- Generated at: deterministic README build (timestamp intentionally omitted)
<!-- PILEE_KNOWLEDGE_GRAPH_END -->
