# Verify Risk Lenses

`/verify`는 success criteria만 다시 읽는 절차가 아니라, diff가 만든 실패 모드를 찾아 증거로 닫는 절차다. 이 문서는 특정 회사나 프레임워크에 묶이지 않는 generic lens를 정의한다. 프로젝트별/private overlay는 이 lens에 concrete command, path, convention을 더한다.

## 사용법

1. Diff와 frame의 success criteria를 읽고 아래 Trigger에 맞는 lens를 선택한다.
2. 선택한 lens마다 Critical Questions를 최소 1회 통과한다.
3. 질문에 대한 증거가 없으면 PASS가 아니라 `부분`, `미검증`, 또는 `blocked`로 남긴다.
4. 프로젝트/private overlay가 있으면 generic lens를 대체하지 말고 보강한다.
5. lens 결과는 verify report의 `Risk lens findings` 또는 SC 근거에 포함한다.

## Grade 영향 규칙

- high-risk lens가 선택됐는데 증거가 코드 위치 설명뿐이면 `달성(코드만)`으로 올리지 않는다. `부분` 또는 `달성(코드만, lens gap 있음)`처럼 gap을 명시한다.
- DB/API/cache/운영 runbook lens는 “테스트 통과”만으로 닫히지 않는다. schema/metadata/runtime/read-only query/manual evidence 중 하나가 필요하다.
- lens 질문이 새 사용자 정책 선택을 요구하면 `/decide` 또는 AskUserQuestion으로 분리한다.
- lens 질문이 단순 결함이면 묻지 말고 수정하거나 gap으로 보고한다.

## Lens Index

| Lens | Trigger | Strong evidence |
|---|---|---|
| DB schema & migration | migration, DDL, seed/backfill, enum value, FK/unique/index | migration review + rollback/down + post-SELECT/read-only query or explicit manual gap |
| Data preservation & rollback | UPDATE/DELETE/backfill, upsert, rollback section | pre-state snapshot, restore SQL, idempotency proof |
| ORM association & model mapping | model relation, FK to non-id/alternate key, join include | association metadata/test/query proving join key |
| Cache / loader / memoization | DataLoader/cache/singleton state around mutable data | request scope/invalidation/TTL proof + stale scenario checked |
| API contract | GraphQL/gRPC/REST/event payload/schema | generated schema/codegen + backward compatibility check |
| UI data flow | UI consumes new backend/domain value | source-of-truth trace + capture/test for effective value |
| i18n / locale / copy | user-facing text, placeholder, locale/language enum | placeholder validation + locale/value-system mapping |
| External notification | Slack/email/webhook/ops alert | sample/test proving operators get required fields |
| Ops runbook | human DB write, manual operation, deployment procedure | pre-SELECT, execution, post-SELECT, rollback, log path, human gate |
| Security / permission / PII | auth, role, token, PII, access boundary | explicit threat/boundary check + negative case |
| Money / settlement / entitlement | price, rate, point, coupon, refund, commission | single source of truth + before/after accounting path |
| Architecture friction | new abstraction, wrapper, split condition, module boundary | findability and next-change path review |
| Visual / responsive | UI layout, viewport, copy position, table/form/nav | focused screenshot/GIF + before/after when baseline matters |

---

## DB schema & migration lens

### Trigger

- New migration, DDL, seed, data backfill, enum value, index/unique/FK.
- Runbook or manual SQL changes production/development data.

### Critical Questions

- Does the schema encode the invariant the feature relies on?
- Are defaults/seed rows present exactly once when fallback depends on them?
- Does `down()` reflect the intended rollback policy, and is data loss explicit?
- Are generated schema/model registries updated by commands, not manually edited?
- Are enum/string values the same across DB, backend enum, frontend locale, and runbook?

### Evidence

- Migration diff and generated outputs.
- Migration lint/build/schema generation.
- Read-only `describe`/`SELECT` before or after when safe.
- Manual gap if migration cannot be applied in this session.

## Data preservation & rollback lens

### Trigger

- `UPDATE`, `DELETE`, `INSERT ... SELECT`, `ON DUPLICATE KEY UPDATE`, merge/upsert, backfill.

### Critical Questions

- If the script overwrites existing state, is that state captured before execution?
- Does rollback restore previous state, or merely delete new rows?
- Is the operation idempotent when partially applied or re-run?
- Does rollback require same DB session temporary tables? If yes, is a later-session recovery path documented?

### Evidence

- Pre-state snapshot table/query.
- Rollback SQL that restores old values and removes only newly-created rows.
- Post-SELECT validating counts and duplicates.

## ORM association & model mapping lens

### Trigger

- New/changed relation decorators, model association, `include`, eager loading, relation resolver.
- FK points to a unique business key instead of the related model primary key.

### Critical Questions

- Does the ORM default join key match the DB FK target?
- If FK references a non-PK field, are `targetKey`/`sourceKey` or equivalent options explicit?
- Does a mapped/non-default row actually resolve the related object in a test or metadata check?
- Are reverse associations using property names rather than raw DB column names when the ORM expects property names?

### Evidence

- Association metadata or integration/unit test for mapped and fallback rows.
- Code location showing explicit join key.
- Query result sample if local DB is available.

## Cache / loader / memoization lens

### Trigger

- DataLoader, singleton provider, in-memory cache, memoized selector, localStorage/session cache.
- Mutable DB/operational data flows through cache.

### Critical Questions

- Is cache scoped to request/user/session or global process lifetime?
- If global, what invalidates it when operators change DB/config?
- Can key cardinality grow unbounded?
- Does cache conflate role, locale, tenant, environment, feature flag, or membership state?

### Evidence

- Scope/TTL/invalidation code.
- Test or reasoning for stale value scenario.
- Manual risk if cache lifetime is intentionally accepted.

## API contract lens

### Trigger

- GraphQL/gRPC/REST schema, generated types, events, webhook payload.

### Critical Questions

- Is the change additive and backward-compatible?
- Are nullable/non-null, enum additions/removals, ID/string/int conversions safe for consumers?
- Were generated schema/types updated by the official command?
- Did every consumer that needs the new field include it in fragments/queries?

### Evidence

- Schema generation/codegen output.
- Consumer fragment diff.
- Contract tests or validate command.

## UI data flow lens

### Trigger

- UI displays a backend/domain value, derived rate/status, badge, guide, form state.

### Critical Questions

- Is the displayed value the same source of truth used by backend/notification/operation?
- Are all entry points updated, or only the primary page?
- Does the UI choose the effective value under role/membership/state differences?
- Are loading/null/fallback states explicit?

### Evidence

- Source-to-render trace.
- UI capture or component test for default and non-default values.
- Search proving removed hardcoded fallback strings.

## i18n / locale / copy lens

### Trigger

- User-facing copy, translation key, placeholder, language enum, locale path.

### Critical Questions

- Are dynamic values injected via placeholders rather than string split/concat hacks?
- Do all supported locales have the key and required placeholders?
- Are backend language enum values distinct from frontend route/locale folder names?
- Do translations preserve numeric/unit formatting across locales?

### Evidence

- i18n type generation/validation.
- Locale file diff or placeholder validation.
- Explicit enum/value mapping check.

## External notification lens

### Trigger

- Slack/email/SMS/webhook/operator alert changed.

### Critical Questions

- Does the message include fields required for human decision-making?
- Does it match the same source of truth as UI/backend state?
- Are mentions/channels/severity unchanged or intentionally changed?
- Is there a test/sample for the rendered message?

### Evidence

- Unit test with text assertions or real sample capture.
- Operator-facing field checklist.

## Ops runbook lens

### Trigger

- Manual DB write, migration run, rollout/rollback instruction, operational runbook.

### Critical Questions

- Is there a task description and exact target scope?
- Are pre-SELECT, execution SQL, post-SELECT, rollback, and log steps all present?
- Is the AI prevented from executing writes when human approval is required?
- Can a future operator reproduce rollback without session-local temporary state?

### Evidence

- Runbook sections with SQL blocks.
- Safety note for human execution and logging.

## Security / permission / PII lens

### Trigger

- Auth, role, token, PII, permissions, admin/partner/customer boundary.

### Critical Questions

- Does the change widen read/write access?
- Is a negative permission case covered?
- Are logs/notifications free of secrets and unnecessary PII?
- Does any cached value cross user/tenant/role boundary?

### Evidence

- Guard/resolver/service check.
- Negative test or manual boundary statement.

## Money / settlement / entitlement lens

### Trigger

- Price/rate/refund/point/coupon/commission/settlement/membership entitlement.

### Critical Questions

- Is there one source of truth for the amount/rate/status?
- Do display, notification, accounting, and persistence use the same effective value?
- Are rounding/currency/membership/period conditions explicit?
- Does rollback avoid double payment or lost entitlement?

### Evidence

- Source-of-truth trace across UI/backend/ops.
- Unit/integration test for the effective value.
- Manual accounting gap if real payment/settlement cannot be exercised.

## Architecture friction lens

### Trigger

- New abstraction, wrapper, indirection, distributed conditional, renamed concept.

### Critical Questions

- Can the next person/agent find the change point in one or two hops?
- Did we introduce a new name for an existing concept?
- Is a shallow helper reducing duplication, or hiding simple logic behind a deep module?
- Did decision mitigations about structure actually land?

### Evidence

- Usage search and call path summary.
- Note of accepted friction or follow-up.

## Visual / responsive lens

### Trigger

- UI layout, visual hierarchy, table/form/nav, copy position, responsive behavior.

### Critical Questions

- Which viewport/role/state is the primary success criterion?
- Does existing behavior need before/after comparison?
- Is a focused crop enough, or is a full-page capture only supporting context?
- Are long/tall captures hidden behind toggles in reports?

### Evidence

- Focused screenshots/GIFs.
- Before/after when baseline matters.
- Coverage gap if capture is blocked.

## Overlay Rule

Generic lens names are stable; project overlays provide concrete checks. A private overlay may say, for example, “for this repo, GraphQL schema changes require command X and generated path Y” or “this ORM requires targetKey for non-PK FK.” Public pilee should not encode those concrete repo names or commands unless they are generic examples.
