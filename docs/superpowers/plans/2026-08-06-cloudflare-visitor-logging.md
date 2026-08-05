# Cloudflare Visitor Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the public visitor badge with a fail-open Cloudflare Worker and D1 visitor log, a Cloudflare Access-protected dashboard at `logs.lizhe.link`, 90-day retention, and a concise public privacy notice.

**Architecture:** One ES-module Worker dispatches by hostname. Requests for `lizhe.link` and `www.lizhe.link` are proxied to GitHub Pages and eligible HTML document requests are inserted asynchronously into D1. Requests for `logs.lizhe.link` must pass both Cloudflare Access and Worker-side JWT/email validation before they can query the same D1 database. A daily scheduled handler deletes rows older than 90 days. Checked-in configuration remains free of Cloudflare account/resource identifiers; an ignored production configuration is generated locally from validated deployment inputs.

**Tech Stack:** TypeScript 7, Cloudflare Workers, D1/SQLite migrations, Wrangler 4, Vitest 4 with `@cloudflare/vitest-pool-workers`, `jose` 6, plain HTML/CSS/JavaScript for the private dashboard, Jekyll/GitHub Pages for the public site.

## Global Constraints

- Public-site availability outranks analytics. Start the origin fetch immediately; run the D1 insert through `ctx.waitUntil()`; never let a logging failure alter the origin response.
- Store only eligible `GET` document visits. Do not log images, CSS, JavaScript, fonts, PDFs, health checks, Cloudflare internal paths, or private-dashboard traffic.
- Store the raw Cloudflare client IP and approved metadata only. Never store cookies, authorization headers, request bodies, form content, or Access tokens.
- Retain raw rows for 90 days, purge daily using a UTC cutoff, and create no archive of deleted rows.
- Treat distinct IPs as network addresses, never as verified people.
- Protect the complete `logs.lizhe.link` hostname with Cloudflare Access. The sole allowed identity is the exact email `lizheqlut@gmail.com` using one-time PIN, and the Worker must independently verify the Access JWT issuer, audience, signature, and email claim.
- Dashboard and API responses use `Cache-Control: no-store`, deny framing, and use a CSP without `unsafe-inline`. Render all visit values with DOM `textContent`, never untrusted `innerHTML`.
- Query SQL uses bound parameters and fixed sort order. Page size is 50. CSV export is capped at 5,000 rows and neutralizes spreadsheet-formula prefixes.
- Display dashboard time in `Asia/Hong_Kong`; persist timestamps in UTC with millisecond precision.
- Query string, referrer, and user agent are length-limited before insert. Raw IPs and Cloudflare identifiers must never be written to console, CI, or deployment logs.
- Do not commit Cloudflare account IDs, zone IDs, D1 database IDs, Access audience values, API tokens, DNS snapshots, or deployment credentials. Keep them under the ignored `cloudflare/visitor-logging/.private/` directory or in the authenticated Wrangler/browser session.
- Stay on Cloudflare's free plan. Never enable a paid plan or automatic paid upgrade.
- Follow strict red-green-refactor for every behavior change. Configuration and human prose do not need artificial source-text tests; verify their consuming behavior instead.
- Before nameserver, DNS proxy, Worker Route, or Access-policy changes, capture the current exact state and verify the rollback target. Do not delete the D1 database during rollback.

---

### Task 1: Create the isolated Worker project and test harness

**Files:**

- Create: `cloudflare/visitor-logging/package.json`
- Create: `cloudflare/visitor-logging/package-lock.json`
- Create: `cloudflare/visitor-logging/tsconfig.json`
- Create: `cloudflare/visitor-logging/wrangler.jsonc`
- Create: `cloudflare/visitor-logging/vitest.config.ts`
- Create: `cloudflare/visitor-logging/test/tsconfig.json`
- Create: `cloudflare/visitor-logging/test/apply-migrations.ts`
- Create: `cloudflare/visitor-logging/src/env.ts`
- Create: `cloudflare/visitor-logging/src/index.ts`
- Modify: `.gitignore`

- [ ] Add `/cloudflare/visitor-logging/.private/` and `/cloudflare/visitor-logging/node_modules/` to `.gitignore`.
- [ ] Create a private npm package named `lizhe-visitor-logging` with scripts `test`, `test:watch`, `typecheck`, `check`, `dev`, `deploy`, `d1:migrate:local`, and `d1:migrate:remote`. Pin `jose` to `6.2.8`; pin dev dependencies `wrangler` `4.119.0`, `@cloudflare/workers-types` `5.20260804.1`, `@cloudflare/vitest-pool-workers` `0.20.2`, `vitest` `4.1.10`, and `typescript` `7.0.2`.
- [ ] Use this checked-in Wrangler base configuration: Worker name `lizhe-visitor-logging`, entry `src/index.ts`, compatibility date `2026-08-06`, `workers_dev: true`, observability enabled with sampling rate `1`, and cron `15 16 * * *` (00:15 Hong Kong time). Do not put routes, D1 IDs, Access values, or Cloudflare identifiers in this base file.
- [ ] Configure Vitest with `cloudflareTest()`, the base Wrangler file, a test-only D1 binding named `DB`, and migrations loaded with `readD1Migrations()`. Apply them in `test/apply-migrations.ts` using `applyD1Migrations()`.
- [ ] Define `Env` with `DB: D1Database`, `PUBLIC_HOSTS`, `ADMIN_HOST`, `ADMIN_EMAIL`, `TEAM_DOMAIN`, and `POLICY_AUD`. Export a minimal handler whose unknown host response is `404` so the harness compiles before behavior tasks begin.
- [ ] Run `npm install`, `npm run typecheck`, and `npm test` from `cloudflare/visitor-logging/`. Record exact output in the task report.
- [ ] Commit: `chore: scaffold visitor logging worker`

### Task 2: Add the D1 schema and typed visit repository

**Files:**

- Create: `cloudflare/visitor-logging/migrations/0001_create_visits.sql`
- Create: `cloudflare/visitor-logging/src/visits/types.ts`
- Create: `cloudflare/visitor-logging/src/visits/repository.ts`
- Create: `cloudflare/visitor-logging/test/visits/repository.test.ts`

- [ ] RED: Write D1-backed tests that prove an inserted row can be read back, all approved nullable Cloudflare fields survive, and values are bound rather than interpolated. The mutation each test catches is a missing/wrong column or unsafe statement construction. Newest-first reads belong to Task 6, which owns repository query ordering and filtering.
- [ ] Verify RED fails because the migration/repository does not exist.
- [ ] Create `visits` with `id INTEGER PRIMARY KEY AUTOINCREMENT`; non-null `visited_at_utc`, `ip_address`, `method`, `host`, `path`, `query_string`, `referrer`, `user_agent`, `browser_summary`, and `is_suspected_bot`; nullable `country`, `region`, `city`, `asn`, `colo`, and `cf_ray`. Constrain `is_suspected_bot` to `0` or `1`.
- [ ] Create indexes on `visited_at_utc`, `ip_address`, `country`, `path`, and the compound pair `(is_suspected_bot, visited_at_utc)`.
- [ ] Implement typed `insertVisit(db, visit)` and repository result types with prepared statements and `.bind()` for every value.
- [ ] GREEN: Run `npm test -- test/visits/repository.test.ts`; then run `npm run check`.
- [ ] Commit: `feat: add visitor log schema and repository`

The migration column contract is:

```sql
CREATE TABLE visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  visited_at_utc TEXT NOT NULL,
  ip_address TEXT NOT NULL CHECK (length(ip_address) BETWEEN 1 AND 45),
  method TEXT NOT NULL,
  host TEXT NOT NULL,
  path TEXT NOT NULL,
  query_string TEXT NOT NULL DEFAULT '',
  referrer TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  browser_summary TEXT NOT NULL DEFAULT '',
  country TEXT,
  region TEXT,
  city TEXT,
  asn INTEGER,
  colo TEXT,
  cf_ray TEXT,
  is_suspected_bot INTEGER NOT NULL DEFAULT 0 CHECK (is_suspected_bot IN (0, 1))
);
```

### Task 3: Classify document requests and normalize visit metadata

**Files:**

- Create: `cloudflare/visitor-logging/src/visits/classify.ts`
- Create: `cloudflare/visitor-logging/src/visits/normalize.ts`
- Create: `cloudflare/visitor-logging/src/visits/user-agent.ts`
- Create: `cloudflare/visitor-logging/test/visits/classify.test.ts`
- Create: `cloudflare/visitor-logging/test/visits/normalize.test.ts`
- Create: `cloudflare/visitor-logging/test/visits/user-agent.test.ts`

- [ ] RED: Add literal table tests for `isDocumentVisit(request)` covering `GET` plus `Sec-Fetch-Dest: document`, HTML `Accept` fallback, non-GET methods, asset extensions, `/cdn-cgi/`, `/healthz`, and a non-HTML `Accept` header.
- [ ] RED: Add tests for `buildVisit(request, now)` using a controlled inbound request with `CF-Connecting-IP`, `CF-Ray`, a complete `request.cf` fixture, referrer, query, and user agent. Assert the exact normalized object and hard length boundaries.
- [ ] RED: Add browser/device and suspected-bot fixtures for Chrome, Edge, Firefox, Safari, mobile, curl, crawler, and unknown agents.
- [ ] Verify each new test file fails for the missing behavior.
- [ ] Implement extension exclusion for images, styles, scripts, maps, fonts, media, archives, office files, PDFs, feeds, and manifest/service-worker assets. Paths remain case-insensitive for extension matching.
- [ ] Generate timestamps with `now.toISOString()`. Take the client IP only from `CF-Connecting-IP`; use `request.cf` for location/network metadata. Store URL path separately from the query.
- [ ] Enforce these maximum lengths: host 253, path 2,048, query 2,048, referrer 2,048, user agent 1,024, browser summary 160, region 128, city 128, colo 3, and CF Ray 64. Truncate by JavaScript code points, not partial UTF-16 surrogate pairs.
- [ ] Use a documented best-effort bot expression covering common bot/crawler/spider/headless and command-line clients. Label output as a suspected-bot heuristic, not verified Bot Management.
- [ ] GREEN: Run the three focused files, then `npm run check`.
- [ ] Commit: `feat: classify and normalize page visits`

### Task 4: Implement fail-open public reverse-proxy logging

**Files:**

- Create: `cloudflare/visitor-logging/src/public-handler.ts`
- Create: `cloudflare/visitor-logging/test/public-handler.test.ts`
- Modify: `cloudflare/visitor-logging/src/index.ts`

- [ ] RED: Test that the origin fetch starts before the D1 write; an eligible document schedules exactly one row; an asset schedules no row; and a rejected D1 write still returns the unchanged origin status, body, and headers.
- [ ] RED: Test that the public handler does not read or clone request bodies and that no cookie or authorization value is included in the stored row.
- [ ] Verify RED fails for the missing handler.
- [ ] Implement `handlePublicRequest(request, env, ctx, fetchOrigin = fetch)`. Start `const originResponsePromise = fetchOrigin(request)` first. For eligible requests, create `const visitWrite = insertVisit(env.DB, buildVisit(request, new Date())).catch(reportOperationalError)` and pass `visitWrite` to `ctx.waitUntil()`; the reporter may log a fixed error category and exception name, but no visit fields, IPs, URLs, or Cloudflare IDs.
- [ ] Return the original `Response` without mutating its body, headers, caching, redirects, or status.
- [ ] Dispatch `lizhe.link` and `www.lizhe.link` to the public handler. Keep `logs.lizhe.link` reserved for later admin handling and return `404` for other hosts.
- [ ] GREEN: Run `npm test -- test/public-handler.test.ts`, then `npm run check`.
- [ ] Commit: `feat: add fail-open visitor logging proxy`

### Task 5: Validate Cloudflare Access JWTs and the exact administrator email

**Files:**

- Create: `cloudflare/visitor-logging/src/access.ts`
- Create: `cloudflare/visitor-logging/test/access.test.ts`
- Modify: `cloudflare/visitor-logging/src/env.ts`

- [ ] RED: Generate a test RSA key pair and signed JWTs with `jose`. Prove acceptance requires all of: `Cf-Access-Jwt-Assertion`, RS256 signature from the configured JWKS, issuer equal to `TEAM_DOMAIN`, audience equal to `POLICY_AUD`, non-expired claims, and lowercase-normalized email exactly `lizheqlut@gmail.com`.
- [ ] RED: Cover missing configuration, missing token, bad signature, wrong issuer, wrong audience, expired token, missing email, and another valid Gmail address; every case must return the same non-enumerating `403` result.
- [ ] Verify RED fails because validation is absent.
- [ ] Implement `verifyAccessIdentity(request, config, keySet?)` with `jwtVerify`. Production uses `createRemoteJWKSet(new URL(`${TEAM_DOMAIN}/cdn-cgi/access/certs`))`; tests inject a local JWK set. Cache the production remote JWK set per team-domain string at module scope.
- [ ] Return only the verified email from the helper. Do not log JWTs, claims, rejected email values, or token errors.
- [ ] GREEN: Run `npm test -- test/access.test.ts`, then `npm run check`.
- [ ] Commit: `feat: validate private dashboard identity`

### Task 6: Implement safe filters, summary queries, and pagination

**Files:**

- Create: `cloudflare/visitor-logging/src/dashboard/filters.ts`
- Create: `cloudflare/visitor-logging/src/dashboard/queries.ts`
- Create: `cloudflare/visitor-logging/src/dashboard/time.ts`
- Create: `cloudflare/visitor-logging/test/dashboard/filters.test.ts`
- Create: `cloudflare/visitor-logging/test/dashboard/queries.test.ts`
- Create: `cloudflare/visitor-logging/test/dashboard/time.test.ts`

- [ ] RED: Test literal query parsing for `from`, `to`, `ip`, `country`, `path`, `bots=exclude|include|only`, and positive page numbers. Invalid dates/ranges, unsupported bot modes, and date windows over 90 days return `400`; text filters are length-capped.
- [ ] RED: Use real D1 fixtures to prove newest-first 50-row pages, default bot exclusion, include/only modes, exact/partial IP, country, path, and date filters. Prove all filter-like strings are treated as data.
- [ ] RED: Verify summary totals and distinct-IP counts for Hong Kong “today,” rolling 7 days, and rolling 30 days at a controlled instant spanning a UTC/Hong Kong date boundary.
- [ ] Verify RED fails for missing filters/queries.
- [ ] Implement Hong Kong day start as a fixed UTC+08:00 boundary because Hong Kong has no daylight-saving transitions. Persist/query ISO UTC strings.
- [ ] Build WHERE fragments only from a fixed internal list; append every external value through bound parameters. Sort only by `visited_at_utc DESC, id DESC`. Return `items`, `page`, `pageSize: 50`, and `hasNext` using a 51-row probe.
- [ ] Label distinct counts as `distinctNetworkAddresses` in APIs and UI-facing view models.
- [ ] GREEN: Run the three focused files, then `npm run check`.
- [ ] Commit: `feat: query private visitor analytics`

### Task 7: Add authenticated dashboard APIs and safe CSV export

**Files:**

- Create: `cloudflare/visitor-logging/src/dashboard/api.ts`
- Create: `cloudflare/visitor-logging/src/dashboard/csv.ts`
- Create: `cloudflare/visitor-logging/src/security-headers.ts`
- Create: `cloudflare/visitor-logging/test/dashboard/api.test.ts`
- Create: `cloudflare/visitor-logging/test/dashboard/csv.test.ts`
- Modify: `cloudflare/visitor-logging/src/index.ts`

- [ ] RED: Test that all `logs.lizhe.link` paths require a valid Access identity before D1 is queried. Test `/api/summary`, `/api/visits`, `/api/export.csv`, unsupported method `405`, and unknown route `404`.
- [ ] RED: Test API JSON content types, non-sensitive error bodies, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options: DENY`.
- [ ] RED: Test CSV header order, RFC 4180 quote/newline escaping, UTF-8 content, active-filter reuse, 5,000-row cap, and neutralization of cells beginning with `=`, `+`, `-`, `@`, tab, carriage return, or line feed by prefixing an apostrophe.
- [ ] Verify RED fails for the absent routes.
- [ ] Implement admin dispatch only after `verifyAccessIdentity` succeeds. Parse filters once per route, reuse the query layer, and never expose exception strings or SQL in responses.
- [ ] Name downloads `lizhe-visitor-logs-YYYY-MM-DD.csv` using the Hong Kong date at request time.
- [ ] GREEN: Run the focused API/CSV tests, then `npm run check`.
- [ ] Commit: `feat: add protected visitor log APIs`

### Task 8: Build the private no-framework dashboard

**Files:**

- Create: `cloudflare/visitor-logging/src/dashboard/page.ts`
- Create: `cloudflare/visitor-logging/src/dashboard/app.css.ts`
- Create: `cloudflare/visitor-logging/src/dashboard/app.js.ts`
- Create: `cloudflare/visitor-logging/test/dashboard/page.test.ts`
- Modify: `cloudflare/visitor-logging/src/index.ts`

- [ ] RED: Test `/` returns an accessible HTML shell with today/7/30 cards, distinct-network-address labels, filter controls, visit table headings, pagination controls, CSV link, and external `/app.css` and `/app.js` assets.
- [ ] RED: Test the CSP exactly permits only same-origin scripts/styles/connections, blocks all frames, and contains neither `unsafe-inline` nor third-party origins. Test the asset content types and `no-store` headers.
- [ ] RED: Export pure dashboard formatting/URL helpers and test Hong Kong timestamp rendering, empty/null values, pagination query preservation, bot-toggle behavior, and filter-to-CSV URL construction.
- [ ] Verify RED fails for the absent page/assets.
- [ ] Implement a responsive plain HTML dashboard. Fetch summary and rows with `credentials: "same-origin"`. Create cells with `document.createElement` and assign `textContent`. Show a generic recoverable error state without data or stack traces.
- [ ] Default bots to excluded, 50 rows per page, newest first. Display full IP, Hong Kong time, country/city, path, referrer, browser/device summary, and suspected-bot marker when included.
- [ ] GREEN: Run `npm test -- test/dashboard/page.test.ts`, then `npm run check`.
- [ ] Commit: `feat: build private visitor dashboard`

### Task 9: Add and verify automatic 90-day retention

**Files:**

- Create: `cloudflare/visitor-logging/src/cleanup.ts`
- Create: `cloudflare/visitor-logging/test/cleanup.test.ts`
- Modify: `cloudflare/visitor-logging/src/index.ts`

- [ ] RED: Insert one row 91 days old, one exactly 90 days old, and one current row relative to a controlled scheduled timestamp. Prove the cleanup deletes only `visited_at_utc < cutoff`, is idempotent, and uses the supplied scheduled time rather than local wall-clock time.
- [ ] Verify RED fails because the scheduled handler is absent.
- [ ] Implement `purgeExpiredVisits(db, now, retentionDays = 90)` with one bound `DELETE` on the indexed timestamp. The Worker's `scheduled` handler passes `new Date(controller.scheduledTime)`.
- [ ] Log only a fixed cleanup failure category and exception name; never log row contents. Let Cloudflare mark the scheduled execution failed after logging so operational failure is visible.
- [ ] GREEN: Run `npm test -- test/cleanup.test.ts`, then `npm run check`.
- [ ] Commit: `feat: enforce visitor log retention`

### Task 10: Remove the public badge and publish the privacy notice

**Files:**

- Modify: `_pages/about.md`
- Create: `_pages/privacy.md`
- Modify: `_includes/footer/custom.html`

- [ ] Remove the entire centered `hits.sh` visitor-counter block from the bottom of `_pages/about.md`.
- [ ] Create `/privacy/` with title `Privacy`, last-modified date `2026-08-06`, and concise English text stating that the site records IP address, access time, requested page, referrer, browser/device information, and approximate network/location metadata for security and traffic analysis; only the administrator can access it; it is not sold or shared for advertising; raw records are deleted automatically after 90 days; the public logger uses no cookies or browser storage; IP/network data does not necessarily identify a person.
- [ ] Add `<a href="/privacy/">Privacy</a>` beside the existing Sitemap link in the custom footer.
- [ ] Run `bundle install` if dependencies are absent, then `bundle exec jekyll build`.
- [ ] Verify rendered behavior: `_site/privacy/index.html` is present; a built public page footer links to `/privacy/`; the built home page has no request to `hits.sh`; the privacy page contains the approved categories and 90-day policy. These are rendered-output checks, not source-text unit tests.
- [ ] Commit: `feat: publish visitor logging privacy notice`

### Task 11: Generate deployment configuration without committing identifiers

**Files:**

- Create: `cloudflare/visitor-logging/scripts/render-production-config.mjs`
- Create: `cloudflare/visitor-logging/test/render-production-config.test.ts`
- Create: `cloudflare/visitor-logging/DEPLOYMENT.md`
- Modify: `cloudflare/visitor-logging/package.json`

- [ ] RED: Run the generator against a temporary output path and prove it rejects missing/invalid `CF_D1_DATABASE_ID`, `CF_TEAM_DOMAIN`, and `CF_POLICY_AUD`; emits valid JSONC-free JSON when all are valid; keeps the public Worker Routes `lizhe.link/*` and `www.lizhe.link/*`; adds `logs.lizhe.link` as a custom domain; binds D1 as `DB`; sets `PUBLIC_HOSTS`, `ADMIN_HOST`, `ADMIN_EMAIL`, `TEAM_DOMAIN`, and `POLICY_AUD`; preserves the daily cron; and writes only inside a caller-supplied path.
- [ ] Verify RED fails because the generator is missing.
- [ ] Implement the generator with no shell interpolation and no secret logging. Read values from process environment, validate the D1 UUID, require an HTTPS team domain ending in `.cloudflareaccess.com`, require a non-empty Access audience, and write `.private/wrangler.production.jsonc` by default.
- [ ] Add `config:production` and make `deploy`/`d1:migrate:remote` use `--config .private/wrangler.production.jsonc`.
- [ ] Document exact authenticated commands and rollback commands. Documentation must say that the route is removed first during rollback, DNS stays proxied initially, nameservers are restored only if necessary, and D1 is retained.
- [ ] GREEN: Run the focused generator test, then `npm run check`.
- [ ] Commit: `chore: add identifier-safe deployment workflow`

The generated production route contract is:

```json
{
  "routes": [
    { "pattern": "lizhe.link/*", "zone_name": "lizhe.link" },
    { "pattern": "www.lizhe.link/*", "zone_name": "lizhe.link" },
    { "pattern": "logs.lizhe.link", "custom_domain": true }
  ]
}
```

### Task 12: Provision Cloudflare D1 and validate the Worker on a test endpoint

**Files:**

- Local ignored evidence: `cloudflare/visitor-logging/.private/resource-inventory.json`
- Local ignored config: `cloudflare/visitor-logging/.private/wrangler.production.jsonc`
- Modify only if verification exposes a tested defect: Worker source/tests from Tasks 1–11

- [ ] Authenticate with `npx wrangler login` and confirm the selected free-plan account with `npx wrangler whoami`. If login, MFA, or account creation requires the owner's action, pause only for that identity step.
- [ ] Create D1 with `npx wrangler d1 create lizhe-visitor-logs`. Record the returned database ID locally in `resource-inventory.json`; do not print it in reports or commit it.
- [ ] Save the exact D1 binding snippet returned by Wrangler as ignored `.private/wrangler.d1.jsonc`, combined with the checked-in Worker name, entry point, compatibility date, and migration directory. This file exists only to address the new remote database before Access values and production routes exist.
- [ ] Apply local migrations and run the complete automated suite. Apply remote migrations with `npx wrangler d1 migrations apply lizhe-visitor-logs --remote --config .private/wrangler.d1.jsonc`, then list migrations remotely and confirm `0001_create_visits.sql` is applied.
- [ ] Deploy the checked-in base configuration to the assigned `workers.dev` endpoint and verify the Worker loads and returns the expected unknown-host response. Document-request logging is verified locally here and against the production hostname in Task 14, where the trusted Cloudflare IP/location headers and actual origin route exist.
- [ ] Confirm Workers and D1 usage/billing settings remain free and no paid upgrade is enabled.

### Task 13: Inventory DNS, onboard the zone, and configure private Access

**Files:**

- Local ignored evidence: `cloudflare/visitor-logging/.private/dns-before.json`
- Local ignored evidence: `cloudflare/visitor-logging/.private/cloudflare-before-cutover.json`
- Local ignored evidence: `cloudflare/visitor-logging/.private/access-inventory.json`

- [ ] Capture `dig +short NS lizhe.link`, apex A/AAAA/CNAME behavior, `www`, MX, TXT, CAA, and the GitHub Pages CNAME/HTTPS state. Export every record from the current DNS provider, including TTL and provider-specific proxy state, into `dns-before.json`.
- [ ] Add `lizhe.link` to the selected Cloudflare free-plan account without changing nameservers. Reproduce every record exactly, then compare the two inventories line by line. Preserve mail and verification records.
- [ ] Configure Cloudflare Zero Trust one-time PIN as an identity provider. Create one self-hosted Access application for the complete `logs.lizhe.link` hostname.
- [ ] Create one Allow policy whose Include selector is the exact email `lizheqlut@gmail.com`; require the one-time-PIN login method. Do not use `Everyone`, email-domain, or “Login Methods: OTP” as the Include selector. Keep deny-by-default behavior.
- [ ] Record the Access team domain and application audience locally. Generate the production Worker configuration and deploy the Worker custom domain, but do not enable the public-site routes until the zone and DNS proxy are active.
- [ ] From a signed-out browser, verify the dashboard is challenged. Verify a different email receives no usable access. Verify `lizheqlut@gmail.com` can complete OTP and load the protected shell.

### Task 14: Perform the DNS cutover and attach public Worker Routes

**Files:**

- Local ignored evidence: `cloudflare/visitor-logging/.private/cutover-log.md`
- Local ignored evidence: `cloudflare/visitor-logging/.private/cloudflare-after-cutover.json`

- [ ] Re-run the DNS comparison immediately before cutover and record the current registrar nameservers. Confirm the GitHub Pages origin and `CNAME` still specify `lizhe.link`.
- [ ] Change only the authoritative nameservers at the registrar to the exact pair assigned by Cloudflare. Wait for Cloudflare zone activation and authoritative propagation; do not change unrelated registrar settings.
- [ ] Set the GitHub Pages apex and `www` records to Cloudflare proxied status. Verify `https://lizhe.link/` and representative HTML, image, CSS, JavaScript, PDF, redirect, and TLS behavior before enabling Worker Routes.
- [ ] Deploy the production config to attach `lizhe.link/*` and `www.lizhe.link/*`. Verify the origin still responds unchanged and one controlled browser navigation creates exactly one row while asset requests create zero rows.
- [ ] Exercise fail-open behavior using a test binding/configuration that makes D1 inserts fail; confirm the origin remains reachable. Do not intentionally break the production D1 binding.
- [ ] If any availability check fails, remove the exact public Worker Routes first and retest. Restore the previous authoritative nameservers from `dns-before.json` only if Cloudflare DNS/proxy itself remains the cause.

### Task 15: Run full acceptance, final review, and handoff

**Files:**

- Create: `docs/cloudflare-visitor-logging-operations.md`
- Update: `docs/superpowers/specs/2026-08-06-cloudflare-visitor-logging-design.md`
- Local ignored evidence: `cloudflare/visitor-logging/.private/acceptance-results.md`

- [ ] Run fresh `npm run check` in `cloudflare/visitor-logging/` and `bundle exec jekyll build` at the repository root. Record test/build counts and exit codes.
- [ ] Verify every approved acceptance criterion: public origin parity; document-only logging; raw fields for a controlled request; UTC persistence/Hong Kong rendering; D1 fail-open; Access challenge and exact-email denial/allow; filters; 50-row pagination; default bot hiding; 5,000-row CSV cap and escaping; retention fixture purge; public badge removal; footer Privacy link; privacy text; and rollback commands/targets.
- [ ] Inspect live responses for `no-store`, anti-framing, no-sniff, referrer, and CSP headers. Confirm the CSP contains no `unsafe-inline` and the dashboard renders without console errors.
- [ ] Check Cloudflare usage after controlled tests and confirm free-plan status. State explicitly that an IP address is not a verified person identity.
- [ ] Write the operations guide with: architecture summary; authenticated deploy/migrate commands; DNS/route rollback order; Access policy description; retention schedule; dashboard filters/export; free-plan monitoring; and where ignored inventories are stored. Include no IDs, tokens, raw IPs, or private logs.
- [ ] Change the design document status to `Implemented` only after live acceptance passes; otherwise set it to `Partially implemented` and enumerate the exact remaining external blocker.
- [ ] Commit documentation: `docs: add visitor logging operations guide`
- [ ] Dispatch the required whole-branch code review, fix its complete finding set in one wave, and run one scoped re-review.
- [ ] Re-run the full verification commands after final-review fixes. Do not claim completion without their fresh output.

## Primary References

- [Cloudflare Worker Routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Cloudflare D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/)
- [Cloudflare Request metadata](https://developers.cloudflare.com/workers/runtime-apis/request/)
- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Access JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Access one-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
- [Cloudflare Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)
