---
name: shipping-and-launch
description: Ship changes safely with controlled rollout, monitoring, and rollback plans. Use when preparing a deployment, enabling a new capability, rolling out a risky change, or coordinating a release that affects users or external systems.
---

# Shipping and Launch

## Overview

Shipping safely means reducing uncertainty before release, limiting blast radius during rollout, and making recovery straightforward when something goes wrong. Smaller, observable, reversible releases are always safer than large opaque ones.

## When to Use

- Preparing a deployment or release
- Rolling out a high-impact or risky change
- Enabling a previously hidden feature
- Coordinating a release that affects users or downstream systems
- Designing monitoring and rollback strategies

## Pre-Launch Checklist

### Quality

- [ ] Relevant tests and verification steps pass
- [ ] Build and packaging succeed
- [ ] The change has been reviewed at the required level
- [ ] Known issues that could endanger the launch are resolved or explicitly accepted

### Safety

- [ ] No secrets exposed in code or release artifacts
- [ ] Input validation and authorization checks are in place
- [ ] Risky changes have guardrails (feature flags, staged rollout, rollback plan)
- [ ] Data or state changes have a remediation or rollback path

### Operability

- [ ] Monitoring and alerting cover the changed path
- [ ] Logs and metrics are sufficient to detect failure quickly
- [ ] The responsible owner knows the release is happening
- [ ] User or stakeholder communication is prepared if needed

## Rollout Strategy

Prefer the smallest safe blast radius:

```
1. Deploy to the lowest-risk environment first
2. Verify the critical path (smoke tests, health checks)
3. Enable for a small audience if possible (canary, percentage rollout)
4. Monitor for a defined window
5. Expand gradually only if signals remain healthy
```

Useful mechanisms:
- Staged environments (dev → staging → production)
- Feature flags with percentage or account-scoped targeting
- Canary deployments (small traffic slice)
- Manual approval gates for high-risk steps
- Region or tenant-scoped enablement

## Rollback Strategy

Every significant release should answer:

```
What triggers rollback?
  → error rate exceeds threshold, latency spikes, data corruption detected

Who decides?
  → the on-call owner or the release coordinator

How fast can rollback happen?
  → disable the flag (seconds) or redeploy previous version (minutes)

What needs cleanup?
  → state changes, partial migrations, cached data, queued jobs
```

### Rollback Plan Template

```markdown
## Rollback Plan

**Trigger conditions:** [error rate, latency, failed workflows, data issues]
**Action:** [disable flag / redeploy previous version / run remediation script]
**Data considerations:** [what to preserve, repair, replay, or clean up]
**Expected recovery time:** [estimate]
**Owner:** [who executes the rollback]
```

## Monitoring During Launch

Watch the signals that prove success or failure for this specific change:

- Error rate and error distribution
- Latency (p50, p95, p99) for affected paths
- Throughput or request volume
- Queue depth or backlog growth
- Resource utilization (CPU, memory, connections)
- User-visible workflow completion rate
- Support ticket volume

Do not rely on a single metric. Failures can manifest in unexpected dimensions.

## Feature Flags for Launch Control

Feature flags decouple deployment from release:

```
Deploy code to production (disabled by default)
  → enable for internal testing
  → enable for 1% of users (canary)
  → enable for 10%, then 50%, then 100%
  → remove the flag and dead code
```

Flag lifecycle: create → test → canary → full rollout → remove flag and old code path.

Flags that live forever become technical debt. Set a cleanup date when creating them.

## Communication

For non-trivial launches:
- Who needs advance notice?
- Who confirms the rollout is healthy?
- Who is informed if rollback happens?
- What should users expect?

## Post-Launch Review

After the monitoring window:
- Compare actual results to expected success criteria
- Record anything surprising
- Remove temporary launch controls when safe
- File follow-up tasks for residual issues

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "Monitoring is overhead" | Without monitoring, you learn about problems from user complaints, not signals. |
| "Rollback will not be needed" | Design rollback before the release, not during the incident. |
| "Ship everything at once" | Larger blast radius makes diagnosis and recovery slower. |
| "We will clean up the flags later" | Set a cleanup date now. Flag debt accumulates silently. |
| "The staging test was fine" | Staging does not have production traffic, data volume, or edge cases. Monitor production. |

## Red Flags

- No rollback plan for a risky change
- No defined owner watching the launch
- No success or failure signals defined
- Releasing something nobody can observe in production
- Large irreversible changes with no checkpoint
- Feature flags without a scheduled cleanup date

## Verification

Before marking a launch complete:

- [ ] Rollout completed without crossing failure thresholds
- [ ] Critical workflows remain healthy
- [ ] Monitoring confirms the expected outcome
- [ ] Any incident or rollback is documented
- [ ] Follow-up work is captured for deferred items
- [ ] Temporary launch controls have a cleanup plan
