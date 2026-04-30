---
name: ci-cd-and-automation
description: Build and maintain automated quality gates and deployment pipelines. Use when setting up CI for a new project, adding checks to an existing pipeline, configuring deployment workflows, or diagnosing CI failures.
---

# CI/CD and Automation

## Overview

Automate every quality check so that nothing reaches production without evidence of correctness. CI is the enforcement layer for every other engineering practice — it runs the linter, the type checker, the tests, and the build on every change, regardless of who or what produced the code. CD extends the chain to deliver verified changes to users predictably and reversibly.

## When to Use

- Setting up a new project's automated pipeline
- Adding or modifying quality gates (lint, test, type check, audit)
- Configuring deployment pipelines for staging and production
- Optimizing a slow pipeline
- Diagnosing and resolving CI failures
- Integrating CI feedback into an agent workflow

## Quality Gate Sequence

Every change passes through these stages before merge:

```
Change submitted
    │
    ▼
  Format / Lint check
    │ pass
    ▼
  Static analysis / Type check
    │ pass
    ▼
  Automated tests (unit, integration)
    │ pass
    ▼
  Build / Package validation
    │ pass
    ▼
  Dependency / Security audit
    │ pass
    ▼
  Optional: size or performance budget check
    │ pass
    ▼
  Ready for human review
```

No gate is skippable. A failing lint check means the code needs fixing, not that the rule should be disabled.

## Pipeline Structure

### Minimal Pipeline

```
trigger: changes to default branch or review requests

steps:
  - checkout source
  - install dependencies
  - run lint / format check
  - run type check or static analysis
  - run test suite
  - run build / package step
  - run dependency audit
```

### With Service Dependencies

```
integration job:
  - provision required services (database, cache, queue)
  - inject CI-managed test credentials
  - run setup or migration commands
  - run integration test suite
```

Use the CI platform's secret management — never hardcode credentials, even for test environments.

### End-to-End Tests

```
e2e job:
  - install dependencies and build the project
  - set up browser or system test tooling
  - run end-to-end test suite
  - upload failure artifacts (screenshots, traces) on failure
```

## Deployment Stages

```
Change merged
    │
    ▼
  Staging deployment (automatic)
    │ manual verification window
    ▼
  Production deployment (gated or automatic after staging succeeds)
    │ monitoring window
    ├── healthy → done
    └── degraded → rollback
```

### Preview Environments

If the platform supports it, deploy a preview environment per change request so reviewers can see the change running before merge.

### Rollback

Every deployment must be reversible:

```
rollback workflow:
  - triggered manually or by alert
  - redeploys the previous known-good release
  - verified by the same health checks used during rollout
```

## Agent Feedback Loop

When CI fails, feed the failure into the agent for automated repair:

```
CI failure
    │
    ▼
  Extract the specific error message or failing test
    │
    ▼
  Provide to the agent:
    "CI failed with: [exact error]. Fix the issue and verify locally."
    │
    ▼
  Agent fixes → pushes → CI re-runs
```

Pattern mapping:
- Lint failure → agent runs the formatter and commits
- Type error → agent reads the error location and corrects the types
- Test failure → agent follows the debugging skill
- Build error → agent checks config and dependencies
- Audit finding → agent evaluates and updates the dependency

## Pipeline Optimization

When the pipeline exceeds 10 minutes, apply these in order of impact:

```
1. Cache dependencies
   → avoid re-downloading on every run

2. Parallelize independent jobs
   → lint, type check, test, and build run concurrently

3. Path-based filtering
   → skip unrelated jobs (e.g., skip e2e for docs-only changes)

4. Shard large test suites
   → split tests across multiple runners

5. Move slow tests to a scheduled job
   → keep the critical path fast, run expensive checks periodically

6. Use larger runners
   → trade compute cost for engineer waiting time
```

## Environment and Secrets

```
example config template  → committed, no real values
local developer secrets  → never committed
CI secrets               → stored in the CI platform's secret manager
production secrets       → stored in the deployment platform's secret manager
```

CI and production use separate credentials. Never share secrets across environments.

## Branch Protection

- Require all status checks to pass before merge
- Require at least one approval (or the project's review policy)
- Protect the default branch from direct push
- Enable auto-merge when all gates pass and approval is given

## Scheduled Automation

Beyond per-change CI:

- **Dependency updates:** automated PRs on a regular schedule
- **Security scans:** periodic audit beyond per-commit checks
- **Performance benchmarks:** scheduled runs to detect drift
- **Stale branch cleanup:** automated reminders or deletion of old branches

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "CI is too slow to bother with" | Optimize it. A 5-minute pipeline prevents hours of debugging broken deploys. |
| "This change is trivial, skip CI" | Trivial changes break builds more often than you expect. CI is fast for trivial changes anyway. |
| "The test is flaky, just re-run" | Flaky tests hide real failures and waste cumulative time. Fix the flakiness. |
| "We will add CI later" | Projects without CI from the start accumulate invisible breakage. Set it up on day one. |
| "Manual verification is sufficient" | Manual checks are not repeatable and do not scale. Automate the verification you care about. |

## Red Flags

- No automated pipeline in the project
- CI failures routinely ignored or re-run without investigation
- Tests disabled to make the pipeline pass
- Production deploys that skip staging
- No rollback mechanism
- Secrets in code or CI config files instead of the secret manager
- Pipeline takes more than 15 minutes with no optimization effort

## Verification

After setting up or modifying CI/CD:

- [ ] All quality gates are present (lint, types, tests, build, audit)
- [ ] Pipeline triggers on every change request and default branch push
- [ ] Failures block merge (branch protection configured)
- [ ] Secrets are in the secret manager, not in source
- [ ] Deployment includes a rollback mechanism
- [ ] Pipeline completes in a reasonable time
- [ ] CI failure feedback can be routed to agents for automated repair
