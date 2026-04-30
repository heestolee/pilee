---
name: performance-optimization
description: Optimize performance based on measurement, not instinct. Use when performance budgets exist, users report slowness, profiling reveals a bottleneck, or a change appears to have introduced a regression.
---

# Performance Optimization

## Overview

Measure before optimizing. Performance work without evidence typically adds complexity without improving anything that matters. Start with a baseline measurement, identify the actual bottleneck, make the smallest effective change, and measure again. If the improvement is not meaningful, the complexity is not worth keeping.

## When to Use

- Performance requirements or budgets are defined in the spec
- Users or monitoring report slow behavior
- A change appears to have introduced a regression
- The system handles large data, high traffic, or expensive operations
- Resource budgets (latency, CPU, memory, bundle size) matter for the project

**Do not use when:** there is no evidence of a problem and you are optimizing based on instinct alone.

## Workflow

```
1. Measure → establish a baseline
2. Identify → find the actual bottleneck
3. Fix → make the smallest effective change
4. Verify → measure again and compare
5. Guard → add a regression check if the metric matters
```

## Step 1: Measure

Use the tools appropriate for the project:
- Profilers and flame graphs
- Timing instrumentation and structured logging
- Benchmark suites
- Browser performance traces
- Production telemetry or representative staging data

Record:
- the operation being measured
- the baseline result
- the environment and data scale
- the threshold or budget you care about

## Step 2: Identify the Bottleneck

Categorize where time or resources are actually spent:

```
Where does the cost come from?
  Compute     → repeated calculations, heavy transforms, expensive algorithms
  Data access → repeated fetches, full scans, missing indexes, oversized results
  Network/IO  → slow external calls, retries, large payloads, slow storage
  Rendering   → heavy repaints, expensive layout, large DOM trees, repeated work
  Memory      → leaks, unbounded caches, retained references, growing queues
```

Do not fix until you know which category is responsible.

## Step 3: Fix Common Anti-Patterns

### Repeated Work

```
Problem: recomputing the same expensive result per request or interaction
Fix: compute once per appropriate boundary, reuse when inputs are unchanged
```

### Unbounded Data Processing

```
Problem: loading the full dataset when only a subset is needed
Fix: paginate, stream, batch, or window the work
```

### N+1 Lookups

```
Problem: one follow-up query or fetch for every item in a result set
Fix: batch or join retrieval so related data arrives together
```

### Oversized Payloads

```
Problem: transferring large artifacts or responses by default
Fix: send only what the current path needs; compress, split, or defer the rest
```

### Missing or Unbounded Caching

```
Problem: expensive reads repeated with no reuse, or caches with no eviction
Fix: cache where reads dominate writes; define TTL, size limits, and invalidation rules
```

### Unnecessary Re-Rendering

```
Problem: UI components redraw on every state change regardless of relevance
Fix: memoize expensive components, stabilize callback references, minimize state scope
```

## Step 4: Verify

After the change:
- Run the same measurement again under the same conditions
- Compare before and after
- Confirm the improvement is meaningful relative to the budget
- Confirm correctness and stability did not regress

If the improvement is too small to justify the added complexity, revert.

## Performance Budgets

Define the metrics that matter for the project:

```
Examples:
  p95 API response latency < 200ms
  page load (Largest Contentful Paint) < 2.5s
  JavaScript bundle < 250KB gzipped
  build time < 60s
  memory under steady load < 512MB
  interaction to next paint < 100ms
```

If a budget matters, make it visible in the spec, CI, or monitoring dashboards.

## Regression Guards

For important performance paths, add at least one guard:
- A benchmark test that fails when the metric exceeds the budget
- A CI step that measures and reports the metric
- A dashboard alert tied to the production metric
- A review checklist item for changes touching hot paths

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "We will optimize later" | Some performance debt compounds until it is expensive to unwind. Fix proven bottlenecks early. |
| "It is fast on my machine" | Your machine is not the user's device or the production workload. |
| "This optimization is obvious" | If it was not measured, it is still a guess. |
| "A small slowdown does not matter" | Small regressions accumulate into real user-facing and operational cost. |
| "Premature optimization is the root of all evil" | The full quote says to focus on the critical 3%. Measure to find the critical 3%, then optimize it. |

## Red Flags

- Optimization with no baseline measurement
- Significant complexity added for tiny or unproven gains
- Unbounded scans, caches, or queues in production paths
- Repeated expensive work in hot loops
- No way to detect the next regression
- Performance "improvements" that regress correctness

## Verification

After a performance change:

- [ ] A before/after measurement exists under comparable conditions
- [ ] The actual bottleneck was identified before the fix
- [ ] The change improved a metric that matters to the project
- [ ] Correctness and stability still hold
- [ ] A regression guard exists for important paths
