# Visitor Intelligence Dashboard Design

**Date:** 2026-08-25
**Status:** Approved in chat; awaiting written-spec review

## Goal

Extend the private visitor dashboard so each recorded document visit explains who or what likely generated it, why the visit is or is not counted, and what network and behavioral evidence supports that decision. Preserve existing visits, keep classification deterministic and auditable, and avoid invasive browser fingerprinting or an external paid IP-intelligence dependency.

## Existing System

The Cloudflare Worker currently records document requests in D1 for 90 days. Each record already includes the timestamp, IP address, host, path, sanitized referrer, raw User-Agent, parsed browser summary, country/region/city, ASN, Cloudflare colo, Ray ID, and an ingestion-time suspected-bot boolean.

The dashboard recomputes effective bot status for historical rows using the navigation allowlist, scanner paths, nearby scanner probes, and known Oracle/Tencent automated-browser patterns. Suspected automation is hidden from the default totals and visit list but can be included through the existing filter.

## Approaches Considered

### 1. Cloudflare metadata plus explainable local rules — selected

Capture additional metadata already available to the Worker, calculate per-IP activity from D1, and apply versioned deterministic rules. This has no per-request third-party disclosure, no new service bill, works for historical records where fields already exist, and provides an explanation for every decision.

### 2. External IP-intelligence API

An external API can label VPN, proxy, residential, hosting, or abuse reputation more broadly. It adds a secret, cost, latency, rate limits, privacy disclosure, cache design, and a new failure mode. It is intentionally deferred until the local dashboard demonstrates that the missing labels materially affect decisions.

### 3. Browser fingerprinting and interaction telemetry

Client JavaScript could collect screen size, canvas/WebGL, fonts, scroll depth, and active time. It would be more invasive, easier to block, and unnecessary for the current goal. It is explicitly excluded.

## Scope

### Included

- A new additive D1 migration; no destructive rewrite or deletion of existing visits.
- Additional Cloudflare/network and request metadata for new visits.
- Per-IP activity aggregates for both new and historical visits.
- A deterministic 0–100 risk score, visitor type, reasons, and counted/excluded decision.
- A richer main table and an accessible per-row details panel.
- Matching API and CSV fields.
- Default totals and filtering based on the same counted/excluded decision shown in the table.
- Complete tests, production migration, Worker deployment, and authenticated dashboard verification.

### Excluded

- External IP reputation or reverse-DNS lookups during requests.
- Claims that an IP is definitively residential, a VPN, a proxy, or "pure" without a reliable source.
- Canvas, WebGL, font, screen, cookie, or cross-site browser fingerprinting.
- Storing raw URL query strings, referrer query strings, credentials, or fragments.
- Exact latitude/longitude or postal-code storage.
- Automatic permanent IP blocklists.
- Changing the existing 90-day retention policy.

## Data Model

Add `migrations/0002_add_visit_intelligence.sql` with nullable columns so old rows remain valid:

| Column | Type | Source and limit |
|---|---|---|
| `as_organization` | `TEXT` | `request.cf.asOrganization`, 256 code points |
| `continent` | `TEXT` | `request.cf.continent`, 2 characters |
| `timezone` | `TEXT` | `request.cf.timezone`, 64 code points |
| `http_protocol` | `TEXT` | `request.cf.httpProtocol`, 32 code points |
| `tls_version` | `TEXT` | `request.cf.tlsVersion`, 32 code points |
| `client_tcp_rtt_ms` | `INTEGER` | Non-negative `request.cf.clientTcpRtt`, capped at 600,000 ms |
| `accept_language` | `TEXT` | `Accept-Language`, 256 code points |
| `sec_fetch_site` | `TEXT` | `Sec-Fetch-Site`, normalized to known values or `NULL` |
| `cf_bot_score` | `INTEGER` | Optional Cloudflare Bot Management score, `1–99`, otherwise `NULL` |
| `cf_verified_bot` | `INTEGER` | Optional Bot Management boolean, otherwise `NULL` |
| `cf_corporate_proxy` | `INTEGER` | Optional Bot Management boolean, otherwise `NULL` |

Add a composite index on `(ip_address, visited_at_utc)` for activity and repeat-window queries. Keep the original single-column IP index for migration compatibility unless D1 query plans prove it redundant.

Do not persist the calculated risk score or classification. They are derived at read time so historical rows use the current rule version and rule changes cannot leave stale decisions in the database.

## Enrichment and Compatibility

`buildVisit()` reads only bounded scalar fields from `request.cf` and request headers. Missing, malformed, negative, or out-of-range values become `NULL`; new optional fields must never prevent the origin response or visit insertion.

Historical rows show `Unknown` for metadata that did not exist when they were recorded. Existing ASN, browser, referrer, path, time, and IP data still participate in activity and risk classification.

The initial local data-center evidence set includes the observed/previously handled ASNs:

- AS24940 — Hetzner Online GmbH
- AS16312 — Internet Vikings International AB
- AS14061 — DigitalOcean, LLC
- AS31898 — Oracle Cloud
- AS132203 — Tencent Cloud

For new records, normalized organization-name tokens can also identify the same providers. A data-center signal is evidence only; it never excludes a visit by itself.

## Activity Aggregates

For each displayed visit, query and expose:

- first recorded visit from the same IP;
- most recent recorded visit from the same IP;
- total retained visits from the same IP;
- visits from the same IP during the preceding 24 hours relative to the selected event;
- visits from the same IP within two minutes of the selected event;
- distinct paths from the same IP during the retained period.

The two-minute count includes the selected visit. `repeated requests` is true when it is at least two. Aggregates include all retained visits, including excluded automation, because they are evidence used to classify the current visit.

## Classification Model

Classification is deterministic, versioned as `risk-v1`, and shared by the dashboard list, summary counts, filtering, detail panel, and CSV export.

### Signals

| Signal | Score contribution | Reason text |
|---|---:|---|
| Cloudflare `verifiedBot` | Forces 100 | `Cloudflare verified bot` |
| Recognized bot/crawler User-Agent signature | Forces 100 | `Known bot signature` |
| Existing effective-bot rule: scanner, unlisted path, scanner burst, or known automated-browser pattern | Minimum 90 | Specific existing reason |
| Cloudflare bot score `1–29` when available | +50 | `Low Cloudflare bot score` |
| Cloudflare bot score `30–49` when available | +25 | `Elevated Cloudflare bot risk` |
| Data-center ASN or organization | +30 | `Hosting network` |
| Empty or unrecognized browser summary | +25 | `Unknown browser` |
| Empty sanitized referrer | +10 | `No referrer` |
| At least two visits from the same IP within two minutes | +25 | `Repeated requests` |
| At least ten visits from the same IP in the preceding 24 hours | +10 | `High 24h activity` |

Clamp the result to `0–100`. A normal recognized browser starts at zero; absence of a referrer is weak evidence and cannot independently make a visit uncertain.

### Visitor type and counting decision

| Rule | Visitor type | Counted |
|---|---|---|
| Cloudflare verified bot or recognized bot signature | `Known bot signature` | No |
| Existing effective-bot rule or score `70–100` | `Suspicious automation` | No |
| Score `40–69` | `Uncertain` | Yes |
| Score `0–39` | `Likely human` | Yes |

`Counted` means included in the default list and summary totals. The existing “Include suspected bots” control continues to expose excluded rows. A data-center visit using a normal browser is not automatically excluded. For example:

- Hetzner + Unknown browser + no referrer + repeated requests: `90`, `Suspicious automation`, excluded.
- DigitalOcean + Chrome on Linux + no referrer + no repetition: `40`, `Uncertain`, counted.
- Network without a hosting signal + normal browser + no referrer: `10`, `Likely human`, counted.

The dashboard must call the first example “hosting network,” not “VPN,” “proxy,” or “impure IP.”

## Query Architecture

Keep SQL fragments in `dashboard/queries.ts` as the single source of truth for evidence that must participate in filtering. Add named SQL helpers for known-bot signatures, hosting networks, two-minute repeats, 24-hour activity, risk score, and counted status.

Select the risk inputs and activity aggregates with each page/export row. Convert database rows to the public `VisitRow` in TypeScript, where reason strings and the visitor-type label are assembled in a stable order. Filtering and summary totals use `countedSql()` so the visible `Counted` value cannot disagree with totals.

Avoid N+1 Worker-to-D1 calls. One SQL statement returns each 50-row page. The composite IP/time index supports correlated activity subqueries. Tests must include a representative 50-row query and the existing full suite; production monitoring will confirm latency after deployment.

## Dashboard Interface

Keep the dashboard in English and behind the existing Cloudflare Access policy.

### Main table

Display these columns:

1. Time (Hong Kong)
2. IP address
3. Location
4. Network
5. Path
6. Referrer
7. Browser / device
8. IP activity
9. Visitor type
10. Risk
11. Reasons
12. Counted
13. Details

`Network` displays `AS<number> · <organization>` when available, ASN alone for historical rows, and `Unknown` otherwise. `IP activity` displays the preceding-24-hour count and links visually to the details control. Risk uses text plus a numeric badge; color is supplementary and never the only status indication.

### Details panel

Each visit row has a real `<button>` with `aria-expanded` and `aria-controls`. Activating it toggles a following details row containing grouped definition lists:

- **Request:** Visit ID, method, host, path, sanitized referrer, timestamp, Ray ID.
- **Network:** IP, country/region/city/continent/timezone, ASN, organization, colo, HTTP protocol, TLS version, TCP RTT.
- **Client:** Browser summary, raw User-Agent, Accept-Language, Sec-Fetch-Site.
- **Cloudflare signals:** Bot score, verified-bot value, corporate-proxy value, each showing `Not available` when absent.
- **Activity:** First seen, last seen, retained total, preceding-24-hour total, two-minute total, distinct paths.
- **Decision:** Visitor type, risk score, ordered reasons, counted/excluded, classification version.

The details row is hidden by default, keyboard accessible, safe against HTML injection through `textContent`, and responsive without forcing every detail into the main horizontal table.

### Filters and summaries

Rename the existing checkbox label to `Include excluded automation` while retaining the `bots=exclude|include|only` URL contract for backward compatibility. Summary cards count only `Counted: Yes` records.

Empty results and error rows span all 13 columns. On small screens, the main table remains horizontally scrollable and detail groups collapse to one column.

## API and CSV

The authenticated `/api/visits` response adds all enrichment, aggregate, and decision fields. Existing property names remain unchanged.

CSV preserves existing columns and appends:

- `as_organization`
- `continent`
- `timezone`
- `http_protocol`
- `tls_version`
- `client_tcp_rtt_ms`
- `accept_language`
- `sec_fetch_site`
- `cf_bot_score`
- `cf_verified_bot`
- `cf_corporate_proxy`
- `first_seen_utc`
- `last_seen_utc`
- `retained_visit_count`
- `visits_preceding_24h`
- `visits_within_2m`
- `distinct_path_count`
- `visitor_type`
- `risk_score`
- `risk_reasons`
- `counted`
- `classification_version`

Continue formula-injection protection for every string cell. Export remains capped at 5,000 rows.

## Privacy and Security

- Continue stripping credentials, query strings, and fragments from referrers.
- Continue leaving request query strings empty.
- Do not expose any new endpoint outside Cloudflare Access.
- Do not log visit field values on database or parsing errors.
- Keep Content Security Policy and dashboard security headers unchanged unless tests require a stricter policy.
- Keep the 90-day scheduled deletion for all added columns because they live on the same visit row.
- Do not transmit IPs, User-Agents, or visit metadata to an external enrichment service.

## Migration and Deployment

1. Add and test migration `0002` locally.
2. Deploy the additive migration to the production D1 database before deploying code that inserts new columns.
3. Verify migration state and row count; do not clear existing visits.
4. Deploy the Worker.
5. Verify the authenticated API and dashboard with old and new rows.
6. Monitor one representative visit-page query for latency and record the deployed Worker version.

Rollback order is code first, then leave the additive columns and index in place. Dropping columns is unnecessary and riskier than retaining unused nullable fields.

## Testing

Follow red-green-refactor for every production behavior.

- Migration tests: old rows survive; new columns are nullable; composite index exists; cleanup still deletes whole rows.
- Normalization tests: bounded Cloudflare fields, optional Bot Management, invalid/missing values, no credential/query persistence.
- Classification tests: each signal, thresholds `39/40/69/70`, forced known-bot outcomes, reason order, and the three approved examples.
- Query tests: aggregates, historical compatibility, counted/filter/summary consistency, pagination, injection-safe filters, and 50-row page behavior.
- API tests: new JSON fields and unchanged security headers/authentication.
- CSV tests: header order, values, absent metadata, formula injection, and maximum rows.
- Page/script tests: 13 headers, accessible toggle, safe `textContent`, empty/error colspan, labels, old query parameters, and responsive CSS.
- Full verification: typecheck, all Vitest tests, production-config tests, dashboard bundle verification, migration dry-run, production deployment, and authenticated dashboard inspection.

## Success Criteria

- A newly recorded visit shows network organization and available protocol metadata.
- Old visits load without migration errors and show `Unknown` only for genuinely absent fields.
- Every row displays a visitor type, numeric risk, reasons, and a counted/excluded decision.
- Default rows and summary totals use exactly the displayed decision.
- The Hetzner Unknown-browser repeat pattern is excluded only when the combined signals meet the threshold.
- A single normal-browser data-center visit remains counted as `Uncertain` rather than being falsely labeled a bot.
- No existing visit is deleted, no sensitive URL data is newly stored, and the 90-day retention behavior still passes.
