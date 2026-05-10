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
| [Worker는 readiness ownership을 가진다](./ai-worker-readiness-orchestrator.md) | active | high | 2026-05-10 | 8a66b77 | worker, subagent, orchestrator, readiness, bootstrap, diagnosis |
| [Self-healing은 actionable item만 수정한다](./self-healing-actionable-loop.md) | active | high | 2026-05-10 | 3d5b2f2 | self-healing, actionable, worker, fix-class, subagent, 자동수정 |
| [Stress Interview는 다축 검토다](./stress-interview-multi-axis-review.md) | active | high | 2026-05-09 | b10752d | stress-interview, review, verifier, reviewer, challenger, subagent |
| [Codex-first subagent 모델 운용 정책](./subagent-model-policy.md) | active | high | 2026-05-09 | b10752d | subagent, codex, model-policy, worker, finder, searcher |
| [Subagent 위임은 구체 프롬프트를 요구한다](./subagent-prompt-specificity.md) | active | high | 2026-05-09 | 5f1411c | subagent, prompt, delegation, worker, context, 위임 |
| [Supervisor는 outcome guardrail이다](./supervisor-outcome-guardrail.md) | active | high | 2026-05-09 | b10752d | supervisor, outcome, guardrail, steering, agent |

### architecture

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [Architecture friction은 TFT의 검증 축이다](./architecture-friction-tft-lens.md) | active | high | 2026-05-10 | 3d5b2f2 | architecture, frame, decide, verify, deep-module, shallow-module |
| [Utils surface는 사용자 계약을 만들지 않는다](./utility-surface-stays-invisible.md) | active | high | 2026-05-09 | 8050064 | utils, internal, surface, abstraction, extension |

### database

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [DB write는 인간 실행 게이트를 가진다](./database-write-human-execution-gate.md) | active | high | 2026-05-07 | f1480c7 | db-write, migration, sql, approval, transaction, database |

### debugging

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [수정 전에 근본 원인을 좁힌다](./root-cause-before-fix.md) | active | high | 2026-05-10 | 3d5b2f2 | debugging, root-cause, triage, error-recovery, systematic, 디버깅 |

### knowledge

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [낮은 confidence 판단은 정합성 PR로 올린다](./confidence-sensitive-review.md) | active | high | 2026-05-09 | 8050064 | confidence, review, freshness, ai-actions, user-review, 정합성 |
| [Deterministic action과 AI review action은 분리한다](./deterministic-vs-ai-actions.md) | active | high | 2026-05-09 | 15b060f | knowledge, deterministic, ai-actions, review, automation, 정합성 |
| [Ember는 knowledge의 친근한 입구다](./ember-friendly-knowledge-entrypoint.md) | active | high | 2026-05-09 | 15b060f | ember, branding, command, knowledge |
| [Freshness는 진단서다](./freshness-diagnosis-report.md) | active | high | 2026-05-09 | 15b060f | knowledge, freshness, diagnosis, review, candidate, 정합성 |
| [Knowledge 문서 단위는 판단 하나다](./judgment-doc-unit.md) | active | high | 2026-05-09 | 15b060f | knowledge, judgment, granularity, documentation, coverage, 문서 |
| [pilee 지식 계층과 정합성 갱신](./pilee-knowledge-system.md) | active | high | 2026-05-09 | 15b060f | pilee, knowledge, history, journal, sanitized, reviewed-at |
| [Private journal과 public doctrine은 분리한다](./private-journal-public-doctrine.md) | active | high | 2026-05-09 | 15b060f | knowledge, journal, privacy, sanitized, doctrine, history |
| [README는 knowledge coverage map이다](./readme-coverage-map.md) | active | high | 2026-05-09 | 15b060f | knowledge, readme, coverage, graph, surface, todo |
| [README 철학 변경은 사용자 판단 게이트를 지난다](./readme-philosophy-user-gate.md) | active | high | 2026-05-09 | 8050064 | readme, philosophy, user-gate, public-facing, documentation, 판단 |
| [Retro는 private reflection이다](./retro-private-reflection-boundary.md) | active | high | 2026-05-09 | 15b060f | retro, notion, reflection, private, journal, 회고 |
| [reviewed_commit은 날짜 freshness의 빈틈을 막는다](./reviewed-commit-freshness.md) | active | high | 2026-05-09 | 15b060f | knowledge, reviewed-commit, reviewed-at, freshness, commit, 정합성 |

### review

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [Diff review draft는 PR 코멘트 전 단계다](./diff-review-draft-handoff.md) | active | high | 2026-05-08 | 9b7ea36 | diff-overlay, review-draft, pr-comments, code-review, handoff |

### runtime

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [Deterministic fallback은 workflow를 보존한다](./deterministic-fallbacks-preserve-workflow.md) | active | high | 2026-05-09 | 5a310af | fallback, deterministic, model-failure, resilience, web-search, report |
| [Embedded WebView script는 escape 경계를 보존한다](./embedded-webview-script-escape-boundary.md) | active | high | 2026-05-09 | 5a310af | webview, embedded-script, escape, string-raw, regex, glimpse |
| [MCP stderr는 TUI 출력이 아니다](./mcp-stderr-isolation.md) | active | high | 2026-05-10 | 3d5b2f2 | mcp, stderr, stdio, terminal, tui, noise |
| [터미널 연동은 host adapter로 다룬다](./terminal-host-integration.md) | active | high | 2026-05-10 | 3d5b2f2 | terminal, ghostty, applescript, notify, host, integration |

### ui

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [Idle UI는 장식이 아니라 ambient status다](./ambient-status-surfaces.md) | active | high | 2026-05-07 | 0e6c083 | idle-screensaver, tasks, spinner, status, ambient, ui |
| [Editor affordance는 숨은 컨텍스트가 아니다](./editor-affordance-not-context.md) | active | high | 2026-05-09 | 5f1411c | editor, footer, prompt-suggest, working-text, affordance, ui |
| [User-facing 출력은 한국어를 기본으로 한다](./korean-first-user-facing-output.md) | active | high | 2026-05-09 | 8050064 | korean-output, localization, web-search, ui, rewrite, 한국어 |
| [색상은 정보 위계다](./theme-information-hierarchy.md) | active | high | 2026-05-10 | 3d5b2f2 | theme, color, dim, muted, border, accent |
| [도구 출력은 대화 흐름을 침범하지 않는다](./tool-output-noise-management.md) | active | high | 2026-05-09 | d54d56d | tool-output, collapse, noise, ui, usage, renderer |
| [TUI 렌더링 경계에서는 문자열을 신뢰하지 않는다](./tui-rendering-sanitization.md) | active | high | 2026-05-10 | 3d5b2f2 | tui, rendering, newline, ansi, sanitize, terminal |

### verification

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [완료 선언은 증거 뒤에만 온다](./evidence-first-verification-gate.md) | active | high | 2026-05-09 | 5a310af | verify, evidence, gate, done, ready, verification |
| [Frame과 Verify는 구조화 계약이다](./frame-verify-contract.md) | active | high | 2026-05-10 | 3d5b2f2 | frame, verify, frame-json, success-criteria, contract, verification |
| [검증 중 코드 변경은 이전 검증을 무효화한다](./verification-invalidation-on-change.md) | active | high | 2026-05-09 | 5a310af | verify, invalidation, code-change, freshness, gate, 검증 |
| [Verify Report와 coverage-aware 증거 검증 흐름](./verify-report-workflow.md) | active | high | 2026-05-09 | 5a310af | verify-report, verification, evidence, coverage, capture, crop |

### web-access

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [웹 검색은 승인된 출처 선택을 거친다](./curator-approved-source-selection.md) | active | high | 2026-05-09 | 5a310af | web-search, curator, source-selection, approval, tavily, 검색 |
| [Web Search curator와 승인형 요약 흐름](./web-search-curator.md) | active | high | 2026-05-09 | 5a310af | web-search, tavily, curator, glimpse, summary-review, korean-output |

### workflow

| Topic | Status | Confidence | Reviewed | Commit | Tags |
|---|---|---:|---:|---:|---|
| [검토 산출물은 다시 열 수 있어야 한다](./artifact-archive-reopenability.md) | active | high | 2026-05-09 | 5a310af | artifact, archive, show-report, archive-command, history, html |
| [AskUserQuestion은 의사결정 게이트다](./ask-user-question-decision-gates.md) | active | high | 2026-05-09 | 8050064 | ask-user-question, tft, decision-gate, question, non-delegable, 질문 |
| [AskUserQuestion 옵션은 행동 분기를 표현한다](./ask-user-question-option-design.md) | active | high | 2026-05-09 | 8050064 | ask-user-question, option, wording, ceremony, tft, 질문 |
| [Backlog는 원 세션 출처를 보존한다](./backlog-source-session-provenance.md) | active | high | 2026-05-09 | 5a310af | backlog, tasks, provenance, source-session, session, 맥락 |
| [변경 통합은 작은 단위와 검증을 요구한다](./change-integration-discipline.md) | active | high | 2026-05-08 | 9b7ea36 | git, incremental, code-review, commit, quality, 통합 |
| [자동 로드 컨텍스트는 최소 surface만 가진다](./context-loading-minimal-surface.md) | active | high | 2026-05-09 | 5f1411c | context, agents-md, memory, system-prompt, token, autoload |
| [Decide는 선택을 한 번 공격한다](./decide-tradeoff-challenge.md) | active | high | 2026-05-10 | 3d5b2f2 | decide, tradeoff, challenge, productive-resistance, frame-json, decision |
| [외부 이슈 업데이트는 preview gate를 지난다](./external-issue-preview-gate.md) | active | high | 2026-05-08 | 9b7ea36 | jira, issue, preview, wiki-markup, external-update, approval |
| [Fork-panel handoff는 parent inbox로 들어간다](./fork-panel-parent-inbox.md) | active | high | 2026-05-10 | 3d5b2f2 | fork-panel, handoff, inbox, inject, parent, panel |
| [Fork-panel 위치는 작업 맥락의 일부다](./fork-panel-spatial-continuity.md) | active | high | 2026-05-10 | 3d5b2f2 | fork-panel, revive, repanel, ghostty, spatial, panel |
| [Frame identity는 cwd보다 작업 의도를 우선한다](./frame-planning-identity.md) | active | high | 2026-05-09 | 5a310af | frame, planning, identity, home-directory, ticket, session-title |
| [TFT Studio는 TFT 단계를 작업 단위 UI로 묶는다](./frame-studio-interactive-decision-ui.md) | active | high | 2026-05-09 | 8050064 | tft-studio, frame-studio, frame, glimpse, ask-user-question, decision-ui |
| [Live artifact는 local preview first다](./live-artifact-preview-pattern.md) | active | high | 2026-05-09 | 5a310af | artifact, glimpse, preview, sse, upload, local-first |
| [로컬 개발 서버 시작은 진단 가능한 절차여야 한다](./local-dev-startup-diagnosis.md) | active | high | 2026-05-07 | 264ea17 | local-dev, server, startup, diagnosis, dev |
| [Private overlay package는 회사·개인 실행 맥락을 담는다](./private-overlay-package-boundary.md) | active | high | 2026-05-10 | 3d5b2f2 | privacy, package, overlay, skill, company-context |
| [Queued command는 실행 보장이 아니다](./queued-command-prefill-boundary.md) | active | high | 2026-05-10 | 3d5b2f2 | queued-messages, slash-command, prefill, worktree, session, boundary |
| [변경된 줄은 요청으로 추적 가능해야 한다](./request-traceability-surgical-changes.md) | active | high | 2026-05-09 | 5a310af | request-traceability, surgical-change, karpathy, diff, scope, review |
| [종료된 포크는 transcript 주입보다 revive가 우선이다](./revive-over-transcript-recall.md) | active | high | 2026-05-10 | 3d5b2f2 | revive, recall, fork-panel, session, continuity, 세션 |
| [세션 분류는 원본 위의 sidecar다](./session-classification-sidecar.md) | active | high | 2026-05-09 | 8050064 | archive, show-report, session-classification, sidecar, session, ai-suggestion |
| [Session export는 원본을 보존하는 adapter를 거친다](./session-export-source-preservation.md) | active | high | 2026-05-09 | 5a310af | session-export, source-preservation, jsonl, conductor, normalize, show-report |
| [세션 식별자는 파일명이 아니라 사람이 본 이름이다](./session-identity-over-filenames.md) | active | high | 2026-05-10 | 3d5b2f2 | session, title, identity, session_info, worktree, revive |
| [Skill은 재사용 가능한 절차다](./skills-as-portable-procedures.md) | active | high | 2026-05-09 | b10752d | skill, skill-creator, procedure, porting, workflow, 스킬 |
| [Command shim은 skill source of truth를 지킨다](./tft-command-shim-skill-routing.md) | active | high | 2026-05-09 | 5a310af | command-shim, skill, tft, frame, slash-command, routing |
| [Until loop는 종료 조건을 명시 보고한다](./until-loop-explicit-reporting.md) | active | high | 2026-05-05 | 059f445 | until, loop, report, condition, automation |
| [Worktree 생성은 부모 패널의 게이트다](./worktree-creation-parent-gate.md) | active | high | 2026-05-10 | 3d5b2f2 | worktree, fork-panel, parent-panel, hotfix, context, profile-driven |
| [Worktree 의존성 준비는 조건부 worker가 맡는다](./worktree-dependency-bootstrap-worker.md) | active | high | 2026-05-10 | 3d5b2f2 | worktree, dependencies, bootstrap, profile-driven, worker, subagent |
| [Worktree는 실행 경계다](./worktree-execution-boundary.md) | active | high | 2026-05-10 | 3d5b2f2 | worktree, workspace, repo, branch, execution-boundary, 워크트리 |
| [Worktree 세션 연속성과 식별성 원칙](./worktree-session-continuity.md) | active | high | 2026-05-10 | 3d5b2f2 | worktree, session, revive, fork-panel, panel-inbox, handoff |

## Knowledge Map

```mermaid
graph TD
  doc_ai_worker_readiness_orchestrator["Worker는 readiness ownership을 가진다"]
  doc_self_healing_actionable_loop["Self-healing은 actionable item만 수정한다"]
  doc_stress_interview_multi_axis_review["Stress Interview는 다축 검토다"]
  doc_subagent_model_policy["Codex-first subagent 모델 운용 정책"]
  doc_subagent_prompt_specificity["Subagent 위임은 구체 프롬프트를 요구한다"]
  doc_supervisor_outcome_guardrail["Supervisor는 outcome guardrail이다"]
  doc_architecture_friction_tft_lens["Architecture friction은 TFT의 검증 축이다"]
  doc_utility_surface_stays_invisible["Utils surface는 사용자 계약을 만들지 않는다"]
  doc_database_write_human_execution_gate["DB write는 인간 실행 게이트를 가진다"]
  doc_root_cause_before_fix["수정 전에 근본 원인을 좁힌다"]
  doc_confidence_sensitive_review["낮은 confidence 판단은 정합성 PR로 올린다"]
  doc_deterministic_vs_ai_actions["Deterministic action과 AI review action은 분리한다"]
  doc_ember_friendly_knowledge_entrypoint["Ember는 knowledge의 친근한 입구다"]
  doc_freshness_diagnosis_report["Freshness는 진단서다"]
  doc_judgment_doc_unit["Knowledge 문서 단위는 판단 하나다"]
  doc_pilee_knowledge_system["pilee 지식 계층과 정합성 갱신"]
  doc_private_journal_public_doctrine["Private journal과 public doctrine은 분리한다"]
  doc_readme_coverage_map["README는 knowledge coverage map이다"]
  doc_readme_philosophy_user_gate["README 철학 변경은 사용자 판단 게이트를 지난다"]
  doc_retro_private_reflection_boundary["Retro는 private reflection이다"]
  doc_reviewed_commit_freshness["reviewed_commit은 날짜 freshness의 빈틈을 막는다"]
  doc_diff_review_draft_handoff["Diff review draft는 PR 코멘트 전 단계다"]
  doc_deterministic_fallbacks_preserve_workflow["Deterministic fallback은 workflow를 보존한다"]
  doc_embedded_webview_script_escape_boundary["Embedded WebView script는 escape 경계를 보존한다"]
  doc_mcp_stderr_isolation["MCP stderr는 TUI 출력이 아니다"]
  doc_terminal_host_integration["터미널 연동은 host adapter로 다룬다"]
  doc_ambient_status_surfaces["Idle UI는 장식이 아니라 ambient status다"]
  doc_editor_affordance_not_context["Editor affordance는 숨은 컨텍스트가 아니다"]
  doc_korean_first_user_facing_output["User-facing 출력은 한국어를 기본으로 한다"]
  doc_theme_information_hierarchy["색상은 정보 위계다"]
  doc_tool_output_noise_management["도구 출력은 대화 흐름을 침범하지 않는다"]
  doc_tui_rendering_sanitization["TUI 렌더링 경계에서는 문자열을 신뢰하지 않는다"]
  doc_evidence_first_verification_gate["완료 선언은 증거 뒤에만 온다"]
  doc_frame_verify_contract["Frame과 Verify는 구조화 계약이다"]
  doc_verification_invalidation_on_change["검증 중 코드 변경은 이전 검증을 무효화한다"]
  doc_verify_report_workflow["Verify Report와 coverage-aware 증거 검증 흐름"]
  doc_curator_approved_source_selection["웹 검색은 승인된 출처 선택을 거친다"]
  doc_web_search_curator["Web Search curator와 승인형 요약 흐름"]
  doc_artifact_archive_reopenability["검토 산출물은 다시 열 수 있어야 한다"]
  doc_ask_user_question_decision_gates["AskUserQuestion은 의사결정 게이트다"]
  doc_ask_user_question_option_design["AskUserQuestion 옵션은 행동 분기를 표현한다"]
  doc_backlog_source_session_provenance["Backlog는 원 세션 출처를 보존한다"]
  doc_change_integration_discipline["변경 통합은 작은 단위와 검증을 요구한다"]
  doc_context_loading_minimal_surface["자동 로드 컨텍스트는 최소 surface만 가진다"]
  doc_decide_tradeoff_challenge["Decide는 선택을 한 번 공격한다"]
  doc_external_issue_preview_gate["외부 이슈 업데이트는 preview gate를 지난다"]
  doc_fork_panel_parent_inbox["Fork-panel handoff는 parent inbox로 들어간다"]
  doc_fork_panel_spatial_continuity["Fork-panel 위치는 작업 맥락의 일부다"]
  doc_frame_planning_identity["Frame identity는 cwd보다 작업 의도를 우선한다"]
  doc_frame_studio_interactive_decision_ui["TFT Studio는 TFT 단계를 작업 단위 UI로 묶는다"]
  doc_live_artifact_preview_pattern["Live artifact는 local preview first다"]
  doc_local_dev_startup_diagnosis["로컬 개발 서버 시작은 진단 가능한 절차여야 한다"]
  doc_private_overlay_package_boundary["Private overlay package는 회사·개인 실행 맥락을 담는다"]
  doc_queued_command_prefill_boundary["Queued command는 실행 보장이 아니다"]
  doc_request_traceability_surgical_changes["변경된 줄은 요청으로 추적 가능해야 한다"]
  doc_revive_over_transcript_recall["종료된 포크는 transcript 주입보다 revive가 우선이다"]
  doc_session_classification_sidecar["세션 분류는 원본 위의 sidecar다"]
  doc_session_export_source_preservation["Session export는 원본을 보존하는 adapter를 거친다"]
  doc_session_identity_over_filenames["세션 식별자는 파일명이 아니라 사람이 본 이름이다"]
  doc_skills_as_portable_procedures["Skill은 재사용 가능한 절차다"]
  doc_tft_command_shim_skill_routing["Command shim은 skill source of truth를 지킨다"]
  doc_until_loop_explicit_reporting["Until loop는 종료 조건을 명시 보고한다"]
  doc_worktree_creation_parent_gate["Worktree 생성은 부모 패널의 게이트다"]
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
  doc_confidence_sensitive_review --> doc_deterministic_vs_ai_actions
  doc_confidence_sensitive_review --> doc_freshness_diagnosis_report
  doc_confidence_sensitive_review --> doc_readme_philosophy_user_gate
  doc_deterministic_vs_ai_actions --> doc_freshness_diagnosis_report
  doc_deterministic_vs_ai_actions --> doc_readme_coverage_map
  doc_ember_friendly_knowledge_entrypoint --> doc_judgment_doc_unit
  doc_ember_friendly_knowledge_entrypoint --> doc_pilee_knowledge_system
  doc_ember_friendly_knowledge_entrypoint --> doc_private_journal_public_doctrine
  doc_ember_friendly_knowledge_entrypoint --> doc_readme_philosophy_user_gate
  doc_freshness_diagnosis_report --> doc_deterministic_vs_ai_actions
  doc_freshness_diagnosis_report --> doc_judgment_doc_unit
  doc_freshness_diagnosis_report --> doc_readme_coverage_map
  doc_judgment_doc_unit --> doc_freshness_diagnosis_report
  doc_judgment_doc_unit --> doc_private_journal_public_doctrine
  doc_judgment_doc_unit --> doc_readme_coverage_map
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
  doc_deterministic_fallbacks_preserve_workflow --> doc_curator_approved_source_selection
  doc_deterministic_fallbacks_preserve_workflow --> doc_live_artifact_preview_pattern
  doc_embedded_webview_script_escape_boundary --> doc_artifact_archive_reopenability
  doc_embedded_webview_script_escape_boundary --> doc_deterministic_fallbacks_preserve_workflow
  doc_embedded_webview_script_escape_boundary --> doc_frame_studio_interactive_decision_ui
  doc_embedded_webview_script_escape_boundary --> doc_live_artifact_preview_pattern
  doc_embedded_webview_script_escape_boundary --> doc_tui_rendering_sanitization
  doc_mcp_stderr_isolation --> doc_terminal_host_integration
  doc_mcp_stderr_isolation --> doc_tui_rendering_sanitization
  doc_terminal_host_integration --> doc_fork_panel_spatial_continuity
  doc_terminal_host_integration --> doc_mcp_stderr_isolation
  doc_terminal_host_integration --> doc_theme_information_hierarchy
  doc_ambient_status_surfaces --> doc_backlog_source_session_provenance
  doc_ambient_status_surfaces --> doc_tool_output_noise_management
  doc_editor_affordance_not_context --> doc_context_loading_minimal_surface
  doc_editor_affordance_not_context --> doc_theme_information_hierarchy
  doc_editor_affordance_not_context --> doc_tool_output_noise_management
  doc_korean_first_user_facing_output --> doc_curator_approved_source_selection
  doc_korean_first_user_facing_output --> doc_theme_information_hierarchy
  doc_korean_first_user_facing_output --> doc_web_search_curator
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
  doc_frame_verify_contract --> doc_verification_invalidation_on_change
  doc_verification_invalidation_on_change --> doc_evidence_first_verification_gate
  doc_verification_invalidation_on_change --> doc_frame_verify_contract
  doc_verify_report_workflow --> doc_artifact_archive_reopenability
  doc_verify_report_workflow --> doc_evidence_first_verification_gate
  doc_verify_report_workflow --> doc_live_artifact_preview_pattern
  doc_verify_report_workflow --> doc_pilee_knowledge_system
  doc_verify_report_workflow --> doc_private_overlay_package_boundary
  doc_verify_report_workflow --> doc_web_search_curator
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
  doc_ask_user_question_option_design --> doc_evidence_first_verification_gate
  doc_backlog_source_session_provenance --> doc_artifact_archive_reopenability
  doc_backlog_source_session_provenance --> doc_session_identity_over_filenames
  doc_change_integration_discipline --> doc_evidence_first_verification_gate
  doc_change_integration_discipline --> doc_stress_interview_multi_axis_review
  doc_context_loading_minimal_surface --> doc_private_journal_public_doctrine
  doc_context_loading_minimal_surface --> doc_tool_output_noise_management
  doc_decide_tradeoff_challenge --> doc_architecture_friction_tft_lens
  doc_decide_tradeoff_challenge --> doc_ask_user_question_decision_gates
  doc_decide_tradeoff_challenge --> doc_ask_user_question_option_design
  doc_decide_tradeoff_challenge --> doc_evidence_first_verification_gate
  doc_decide_tradeoff_challenge --> doc_frame_studio_interactive_decision_ui
  doc_decide_tradeoff_challenge --> doc_frame_verify_contract
  doc_external_issue_preview_gate --> doc_ask_user_question_decision_gates
  doc_external_issue_preview_gate --> doc_live_artifact_preview_pattern
  doc_external_issue_preview_gate --> doc_private_overlay_package_boundary
  doc_fork_panel_parent_inbox --> doc_revive_over_transcript_recall
  doc_fork_panel_parent_inbox --> doc_session_identity_over_filenames
  doc_fork_panel_parent_inbox --> doc_subagent_prompt_specificity
  doc_fork_panel_spatial_continuity --> doc_revive_over_transcript_recall
  doc_fork_panel_spatial_continuity --> doc_session_identity_over_filenames
  doc_fork_panel_spatial_continuity --> doc_terminal_host_integration
  doc_frame_planning_identity --> doc_frame_verify_contract
  doc_frame_planning_identity --> doc_session_identity_over_filenames
  doc_frame_planning_identity --> doc_worktree_session_continuity
  doc_frame_studio_interactive_decision_ui --> doc_ask_user_question_option_design
  doc_frame_studio_interactive_decision_ui --> doc_evidence_first_verification_gate
  doc_frame_studio_interactive_decision_ui --> doc_frame_planning_identity
  doc_frame_studio_interactive_decision_ui --> doc_frame_verify_contract
  doc_frame_studio_interactive_decision_ui --> doc_live_artifact_preview_pattern
  doc_live_artifact_preview_pattern --> doc_artifact_archive_reopenability
  doc_live_artifact_preview_pattern --> doc_verify_report_workflow
  doc_live_artifact_preview_pattern --> doc_web_search_curator
  doc_local_dev_startup_diagnosis --> doc_private_overlay_package_boundary
  doc_local_dev_startup_diagnosis --> doc_root_cause_before_fix
  doc_local_dev_startup_diagnosis --> doc_worktree_execution_boundary
  doc_private_overlay_package_boundary --> doc_database_write_human_execution_gate
  doc_private_overlay_package_boundary --> doc_private_journal_public_doctrine
  doc_private_overlay_package_boundary --> doc_skills_as_portable_procedures
  doc_queued_command_prefill_boundary --> doc_session_identity_over_filenames
  doc_queued_command_prefill_boundary --> doc_subagent_prompt_specificity
  doc_queued_command_prefill_boundary --> doc_worktree_execution_boundary
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
  doc_skills_as_portable_procedures --> doc_context_loading_minimal_surface
  doc_skills_as_portable_procedures --> doc_judgment_doc_unit
  doc_tft_command_shim_skill_routing --> doc_frame_verify_contract
  doc_tft_command_shim_skill_routing --> doc_queued_command_prefill_boundary
  doc_tft_command_shim_skill_routing --> doc_skills_as_portable_procedures
  doc_until_loop_explicit_reporting --> doc_deterministic_vs_ai_actions
  doc_until_loop_explicit_reporting --> doc_evidence_first_verification_gate
  doc_worktree_creation_parent_gate --> doc_worktree_execution_boundary
  doc_worktree_creation_parent_gate --> doc_worktree_session_continuity
  doc_worktree_dependency_bootstrap_worker --> doc_subagent_model_policy
  doc_worktree_dependency_bootstrap_worker --> doc_subagent_prompt_specificity
  doc_worktree_dependency_bootstrap_worker --> doc_worktree_creation_parent_gate
  doc_worktree_dependency_bootstrap_worker --> doc_worktree_execution_boundary
  doc_worktree_dependency_bootstrap_worker --> doc_worktree_session_continuity
  doc_worktree_execution_boundary --> doc_session_identity_over_filenames
  doc_worktree_execution_boundary --> doc_worktree_session_continuity
  doc_worktree_session_continuity --> doc_pilee_knowledge_system
  doc_worktree_session_continuity --> doc_subagent_model_policy
```

## Review Metadata Summary

- Documents: 66
- Links: 194
- Generated at: deterministic README build (timestamp intentionally omitted)
<!-- PILEE_KNOWLEDGE_GRAPH_END -->
