---
name: api-and-interface-design
description: Design durable, consistent APIs and module interfaces. Use when creating endpoints, defining contracts between systems, establishing component prop shapes, or drawing boundaries between modules that evolve independently.
---

# API and Interface Design

## Overview

An interface is a promise. Once consumers depend on it, changing it costs more than building it right the first time. This skill helps you design APIs, module boundaries, and component contracts that are predictable, extensible, and resistant to accidental misuse. The same principles apply whether the interface is a REST endpoint, a function signature, a message schema, or a component prop surface.

## When to Use

- Creating new HTTP, RPC, or event-driven endpoints
- Defining type contracts shared across modules or teams
- Designing component prop interfaces in a UI framework
- Establishing boundaries between frontend and backend
- Evolving an existing public interface without breaking consumers
- Reviewing a proposed interface for stability and clarity

## Design Principles

### 1. Define the Contract Before the Implementation

The interface is the deliverable. Implementation is an internal detail that can change without affecting consumers.

```
Start with:
  what can the caller send?
  what will they receive on success?
  what will they receive on failure?
  what invariants does the system guarantee?

Then implement against that contract.
```

### 2. Make Illegal States Unrepresentable

Design types and schemas so that invalid combinations cannot be expressed. If a field only makes sense when another field has a specific value, model them together rather than making both optional.

```
Weak:
  { status: string, completedAt?: date, error?: string }
  → caller can set completedAt on a failed item

Strong:
  | { status: "completed", completedAt: date }
  | { status: "failed", error: string }
  | { status: "pending" }
  → each state carries exactly the fields that belong to it
```

### 3. One Error Shape Everywhere

Pick a single error envelope and apply it across every endpoint and boundary:

```
error:
  code: machine-readable key (e.g. VALIDATION_FAILED)
  message: human-readable explanation
  target: optional field or parameter that caused the error
  details: optional structured metadata
```

When consumers see an error, they should never need to guess which shape it has.

### 4. Grow by Addition

Evolve interfaces by adding optional fields, new endpoints, or new enum values. Never remove fields, change types, or alter the meaning of an existing key.

```
Safe evolution:
  + add an optional "tags" field to the response
  + add a new /tasks/:id/attachments sub-resource
  + add a new enum value ARCHIVED alongside existing values

Unsafe evolution:
  - rename "createdAt" to "created_at"
  - change "count" from number to string
  - remove "legacyId" because "nobody uses it"
```

### 5. Naming That Predicts Behavior

Consumers form expectations from names alone. Reward those expectations.

| Element | Convention | Example |
|---------|-----------|---------|
| Collection endpoints | plural nouns | `/projects`, `/invoices` |
| Actions on resources | HTTP verbs or explicit action paths | `POST /orders/:id/cancel` |
| Boolean fields | `is`/`has`/`can` prefix | `isArchived`, `hasChildren` |
| Timestamps | past-tense verb + `At` | `createdAt`, `resolvedAt` |
| Identifiers | noun + `Id` | `projectId`, `ownerId` |

## Resource Endpoint Layout

```
GET    /resources              → paginated list with filter query params
POST   /resources              → create, returns the created resource
GET    /resources/:id          → single resource
PATCH  /resources/:id          → partial update
DELETE /resources/:id          → remove (idempotent)

GET    /resources/:id/children → sub-collection
POST   /resources/:id/children → create child
```

## Pagination

Every list endpoint must be bounded. Return:
- the items for the current page
- a cursor or offset for the next page
- total count when cheap to compute, omit when expensive

```
Request:  GET /items?cursor=abc&limit=25
Response: { items: [...], nextCursor: "def", hasMore: true }
```

## Partial Updates

Accept only the fields being changed. Preserve everything else. Make the semantics explicit — "fields present in the body are set; absent fields are untouched."

## Input Validation

Validate at the boundary where untrusted data enters:

```
1. Parse raw input into a typed structure
2. Reject anything that violates constraints (length, format, range, policy)
3. Return the standard error shape on rejection
4. Pass only validated data into internal logic
```

Do not re-validate inside internal functions that receive already-validated types.

## Versioning Strategy

Prefer extension over versioning. When a breaking change is unavoidable:

```
Option A: URL prefix        /v2/resources
Option B: Header            Accept: application/vnd.app.v2+json
Option C: Query parameter   /resources?version=2
```

Whichever you pick, apply it uniformly. Supporting multiple active versions has ongoing cost — prefer the One-Version Rule and migrate consumers forward.

## Interface Separation

Separate what the caller sends from what the system returns:

```
CreateInput  → fields the caller controls
Resource     → all fields including system-generated ones (id, timestamps, derived state)
UpdateInput  → subset of mutable fields, all optional
```

This prevents callers from setting server-owned fields and keeps the contract unambiguous.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "We can document the quirks" | Quirks become contracts. Design them out instead of documenting around them. |
| "It is only used internally" | Internal consumers deserve the same contract clarity. Today's internal API is tomorrow's public one. |
| "We will paginate when the data grows" | Unbounded lists break at unpredictable moments. Paginate from day one. |
| "Versioning is premature" | Extension-friendly design is not premature — it is the default that avoids versioning later. |
| "One big endpoint is simpler" | One endpoint that returns fifteen optional shapes is harder to consume than five focused endpoints. |

## Red Flags

- Endpoints returning different shapes based on caller role or hidden flags
- Mixed error formats across the same API surface
- Validation logic scattered deep inside business logic instead of at the boundary
- Mutable fields on system-generated resources (letting callers set `id` or `createdAt`)
- List endpoints with no pagination or upper bound
- Verbs in REST paths (`/createOrder`, `/fetchUser`)

## Verification

After designing or reviewing an interface:

- [ ] Every endpoint has typed request and response schemas
- [ ] Errors follow a single consistent envelope
- [ ] Validation occurs at the system boundary, not inside internal logic
- [ ] List endpoints are paginated with explicit limits
- [ ] New fields are additive and optional
- [ ] Naming conventions are consistent across the entire surface
- [ ] Input types are separated from output types
- [ ] The contract is committed alongside or before the implementation
