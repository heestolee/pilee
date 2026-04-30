---
name: security-and-hardening
description: Harden software against common vulnerabilities. Use when handling untrusted input, implementing authentication or authorization, managing secrets, integrating with external services, or reviewing dependency and supply-chain risk.
---

# Security and Hardening

## Overview

Treat every external input as hostile, every privilege boundary as critical, and every secret as sensitive. Security is not a late-stage audit — it is a design constraint that shapes how you validate input, enforce access control, handle credentials, and integrate with external systems.

## When to Use

- Building features that accept user or third-party input
- Implementing authentication, authorization, or role-based access
- Handling credentials, tokens, or regulated data
- Integrating with external APIs, webhooks, or callbacks
- Reviewing dependency or supply-chain risk
- Shipping a change that expands the system's attack surface

## Security Workflow

```
1. Identify trust boundaries
2. Validate untrusted input at each boundary
3. Enforce authentication and authorization explicitly
4. Protect secrets and sensitive data
5. Verify dependency safety
6. Confirm logging and failure behavior are safe
7. Review before release
```

## Always

- Validate untrusted input at the point it enters the system
- Encode output for its destination context (HTML, URL, SQL, shell)
- Use minimum necessary privileges for users, services, and jobs
- Keep secrets out of source control, logs, and error messages
- Prefer secure defaults over permissive fallbacks
- Run the project's dependency audit before release

## Ask Before

- Changing authentication or identity flows
- Expanding access to sensitive data or privileged operations
- Adding new inbound integrations or uploaded content types
- Relaxing rate limits, retention policies, or exposure controls
- Introducing new trust assumptions

## Never

- Store secrets in committed code
- Rely on client-side validation as the only check
- Return internal details (stack traces, query text, file paths) in public errors
- Add a dependency without understanding its risk profile
- Disable a safety control for convenience

## Key Review Areas

### 1. Input Validation

At each boundary where external data enters:
- What can the caller control?
- What format, length, and range are allowed?
- What happens when validation fails?
- Does malformed input stop at the boundary or leak deeper?

```
boundary receives input
  → parse into a typed structure
  → validate constraints (format, length, range, policy)
  → reject with standard error on failure
  → pass only validated data inward
```

### 2. Authentication and Authorization

- Authentication proves identity where required
- Authorization proves permission for the specific action
- Ownership, tenancy, and role checks are explicit
- Denial defaults to "reject" not "allow"

```
Every privileged endpoint:
  1. verify identity (authn)
  2. verify permission for this action on this resource (authz)
  3. reject with 401/403 if either check fails
  4. proceed only after both pass
```

### 3. Secrets

- Secrets come from the approved secret management path (vault, env injection, CI secrets)
- Logs and error responses never include secret values
- Exports, backups, and audit trails follow data policy
- Sensitive data has defined retention and deletion behavior

### 4. External Integrations

- Inbound messages (webhooks, callbacks) are signature-verified
- Response data from external APIs is validated before use in logic or rendering
- Timeouts, retries, and circuit breakers are explicit
- Scopes, permissions, and credentials are minimal

### 5. Dependencies

- New dependencies are justified (does the existing stack already solve this?)
- The project's dependency audit is clean or findings are explicitly accepted with a review date
- The team understands whether a finding is reachable in production
- Remediation is documented when a fix cannot be applied immediately

### 6. Failure and Abuse

- Rate limits or throttles exist where brute force or spam is plausible
- Suspicious behavior is observable (logs, metrics, alerts)
- Critical failures degrade safely rather than exposing internals
- Destructive operations have confirmation steps or recovery procedures

## Common Vulnerability Patterns

| Vulnerability | Prevention |
|---|---|
| SQL injection | Parameterized queries; never concatenate user input into SQL |
| XSS | Encode output for context; use framework auto-escaping |
| CSRF | Token-based protection on state-changing requests |
| Command injection | Avoid shell execution; use library APIs with typed arguments |
| Path traversal | Validate and normalize file paths; reject `..` sequences |
| Open redirect | Validate redirect targets against an allowlist |
| Mass assignment | Accept only explicitly allowed fields from input |
| Insecure deserialization | Validate structure before deserializing untrusted data |

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It is internal, the risk is low" | Internal systems are often the easiest path to wider compromise. |
| "We will harden it later" | Security retrofits are slower and riskier than secure defaults from the start. |
| "No one would target this" | Automated scanners target weak spots indiscriminately. |
| "The framework handles that" | Frameworks help but do not remove the need for correct configuration and review. |
| "We can trust this input" | If the input crosses a trust boundary, it is untrusted by definition. |

## Red Flags

- Untrusted input flowing into logic with no validation boundary
- Privileged actions with no authorization check
- Secrets in commits, logs, or example config with real values
- Dependency audit findings with no remediation or review date
- Error responses exposing internal details to callers
- No rate limiting where abuse is plausible

## Verification

After security-relevant work:

- [ ] Trust boundaries are identified and protected
- [ ] Input validation happens at each boundary
- [ ] Authentication and authorization are explicit where required
- [ ] Secrets are handled through the approved path only
- [ ] Dependency audit has been reviewed
- [ ] Logs and error responses do not leak sensitive data
- [ ] Remaining risk is documented with a conscious decision
