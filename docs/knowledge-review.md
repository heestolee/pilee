# pilee knowledge 검토 큐

> daily knowledge sync workflow가 생성한 공개 검토 큐입니다. 직접 수정하지 말고, 연결된 문서를 검토한 뒤 후속 커밋에서 confidence/review metadata를 갱신하세요.

## 검토 현황

> `stale`은 문서가 틀렸다는 확정이 아니라, `reviewed_commit` 이후 관련 변경이 있어 현재 HEAD와 동기화됐다고 아직 확인할 수 없다는 뜻입니다. 문서를 읽고 내용이 맞으면 `--confirm`, 다르면 수정 후 `--confirm`으로 해소합니다.

| 항목 | 값 | 의미 |
|---|---:|---|
| 기준 커밋 | 16c38d4 | 이 커밋 기준으로 freshness를 계산했습니다. |
| 전체 상태 | ⚠️ stale / 검토 필요 | 검토 action이 남아 있으면 전체 상태는 stale입니다. |
| Knowledge 문서 | 73개 | active/deprecated doctrine 전체 수 |
| Fresh 문서 | ✅ 27개 | 현재 HEAD 기준 검토 완료 |
| Stale / review_needed 문서 | ⚠️ 46개 | 재검토가 필요하지만 틀렸다고 확정된 것은 아님 |
| Unknown / unreviewed 문서 | ❓ 0개 | reviewed_commit 기준점 없음 |
| README coverage | 67/67 | surface와 knowledge 문서 연결 상태 |
| 자동 수정 action | 0개 | generated block 재생성처럼 기계적으로 처리 가능한 항목 |
| AI/사람 검토 action | 46개 | 문서 의미를 읽고 판단해야 하는 항목 |

## 검토 사유 요약

| 사유 | 개수 |
|---|---:|
| 관련 커밋/히스토리 근거가 발견됨 | 46개 |

## Stale / review_needed 문서 46개

| 문서 | confidence | 검토 사유 | 근거 요약 |
|---|---|---|---|
| [ai-worker-readiness-orchestrator](./knowledge/ai-worker-readiness-orchestrator.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [architecture-friction-tft-lens](./knowledge/architecture-friction-tft-lens.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [artifact-archive-reopenability](./knowledge/artifact-archive-reopenability.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가 |
| [ask-user-question-decision-gates](./knowledge/ask-user-question-decision-gates.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [ask-user-question-option-design](./knowledge/ask-user-question-option-design.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [backlog-source-session-provenance](./knowledge/backlog-source-session-provenance.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [change-integration-discipline](./knowledge/change-integration-discipline.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [ci-ship-failure-response-boundary](./knowledge/ci-ship-failure-response-boundary.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [context-loading-minimal-surface](./knowledge/context-loading-minimal-surface.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: MCP digest-first artifact 저장 |
| [curator-approved-source-selection](./knowledge/curator-approved-source-selection.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: web access digest-first artifact 저장 |
| [decide-tradeoff-challenge](./knowledge/decide-tradeoff-challenge.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [deterministic-fallbacks-preserve-workflow](./knowledge/deterministic-fallbacks-preserve-workflow.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [diff-review-draft-handoff](./knowledge/diff-review-draft-handoff.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [embedded-webview-script-escape-boundary](./knowledge/embedded-webview-script-escape-boundary.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [ember-friendly-knowledge-entrypoint](./knowledge/ember-friendly-knowledge-entrypoint.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [evidence-first-verification-gate](./knowledge/evidence-first-verification-gate.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [frame-plan-synthesis-continuity](./knowledge/frame-plan-synthesis-continuity.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화 |
| [frame-planning-identity](./knowledge/frame-planning-identity.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [frame-verify-contract](./knowledge/frame-verify-contract.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [korean-first-user-facing-output](./knowledge/korean-first-user-facing-output.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [live-artifact-preview-pattern](./knowledge/live-artifact-preview-pattern.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [mcp-stderr-isolation](./knowledge/mcp-stderr-isolation.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: feat: MCP digest-first artifact 저장 |
| [private-overlay-package-boundary](./knowledge/private-overlay-package-boundary.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: worktree switch cwd binding 보강<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [request-traceability-surgical-changes](./knowledge/request-traceability-surgical-changes.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [revive-over-transcript-recall](./knowledge/revive-over-transcript-recall.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [root-cause-before-fix](./knowledge/root-cause-before-fix.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [self-healing-actionable-loop](./knowledge/self-healing-actionable-loop.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [session-classification-sidecar](./knowledge/session-classification-sidecar.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [session-export-source-preservation](./knowledge/session-export-source-preservation.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [session-identity-over-filenames](./knowledge/session-identity-over-filenames.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [stress-interview-multi-axis-review](./knowledge/stress-interview-multi-axis-review.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가 |
| [subagent-model-policy](./knowledge/subagent-model-policy.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: MCP digest-first artifact 저장<br>관련 커밋: feat: web access digest-first artifact 저장 |
| [subagent-prompt-specificity](./knowledge/subagent-prompt-specificity.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가 |
| [supervisor-outcome-guardrail](./knowledge/supervisor-outcome-guardrail.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가 |
| [tft-command-shim-skill-routing](./knowledge/tft-command-shim-skill-routing.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [tft-visual-structure-renderer](./knowledge/tft-visual-structure-renderer.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: TFT Studio 제출 단축키 라벨 보강<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [tui-rendering-sanitization](./knowledge/tui-rendering-sanitization.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: Frame Studio ERD 렌더링 깨짐 완화 |
| [utility-surface-stays-invisible](./knowledge/utility-surface-stays-invisible.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원 |
| [verification-invalidation-on-change](./knowledge/verification-invalidation-on-change.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [verify-report-workflow](./knowledge/verify-report-workflow.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원 |
| [verify-risk-lens-overlay](./knowledge/verify-risk-lens-overlay.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강 |
| [web-search-curator](./knowledge/web-search-curator.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: Glimpse Cmd V 붙여넣기 지원<br>관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: MCP digest-first artifact 저장 |
| [worktree-creation-parent-gate](./knowledge/worktree-creation-parent-gate.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [worktree-dependency-bootstrap-worker](./knowledge/worktree-dependency-bootstrap-worker.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: subagent ship skill delegation 추가<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [worktree-execution-boundary](./knowledge/worktree-execution-boundary.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: fix: verify-report primary 이미지 폭과 폰트 가이드 보강<br>관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: worktree switch cwd binding 보강 |
| [worktree-session-continuity](./knowledge/worktree-session-continuity.md) | high | 관련 커밋/히스토리 근거가 발견됨 | 관련 커밋: feat: Frame plan synthesis 연속성 개선<br>관련 커밋: fix: worktree switch cwd binding 보강 |

## confidence 검토 항목 해소 방법

medium/low confidence 문서를 받아들이기로 했다면 다음 명령을 실행하세요:

```bash
node scripts/knowledge.mjs --confirm <doc-id> --confidence high
```

