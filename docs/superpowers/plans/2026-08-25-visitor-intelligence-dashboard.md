# Visitor Intelligence Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explainable network enrichment, per-IP activity, risk classification, counted/excluded decisions, and accessible row details to the private visitor dashboard without deleting existing visits or using an external IP-intelligence service.

**Architecture:** An additive D1 migration stores bounded Cloudflare/request metadata for new visits. A versioned intelligence module owns constants, score weights, visitor-type labels, and ordered reason assembly; D1 queries expose the same evidence and use generated SQL fragments for filtering and totals. The authenticated API, CSV, and dashboard render one consistent decision while old rows remain valid with nullable enrichment.

**Tech Stack:** Cloudflare Workers, D1/SQLite, TypeScript 7, Vitest with `@cloudflare/vitest-pool-workers`, embedded HTML/CSS/JavaScript dashboard, Wrangler 4.

**Spec:** `docs/superpowers/specs/2026-08-25-visitor-intelligence-dashboard-design.md`

## Global Constraints

- Do not delete, rewrite, or clear existing production visit records.
- Keep the existing 90-day retention policy unchanged.
- Do not add an external IP reputation service or transmit visit metadata to a third party.
- Do not collect browser fingerprints, exact coordinates, postal codes, raw URL query strings, or referrer query strings/credentials/fragments.
- Treat hosting/data-center membership as one signal, never as sufficient evidence by itself.
- Derive risk and classification at read time under version `risk-v1`; do not persist calculated decisions.
- Keep all dashboard/API routes behind the existing Cloudflare Access policy and preserve security headers.
- Preserve the existing `bots=exclude|include|only` URL contract.
- Use test-driven development: every behavior test must be observed failing for the intended reason before production code is changed.
- Preserve the untracked `.superpowers/` workspace and unrelated user changes.

---

## File Structure

- `migrations/0002_add_visit_intelligence.sql` — additive metadata columns and the composite IP/time index.
- `src/visits/types.ts` — ingestion, persisted, enrichment, activity, and decision interfaces.
- `src/visits/normalize.ts` — bounded request/Cloudflare extraction only.
- `src/visits/repository.ts` — inserts nullable enrichment fields.
- `src/visits/intelligence.ts` — risk constants, hosting evidence, score calculation, visitor type, reasons, and version.
- `src/dashboard/queries.ts` — SQL evidence/aggregate fragments, counted filtering, row/export/summary queries.
- `src/dashboard/csv.ts` — append-only export contract.
- `src/dashboard/app.js.ts` — safe row rendering and accessible detail toggles.
- `src/dashboard/page.ts` — 13-column table shell and updated filter label.
- `src/dashboard/app.css.ts` — badges and responsive detail layout.
- `test/migrations.test.ts` — schema compatibility and index assertions.
- Existing focused test files under `test/visits/` and `test/dashboard/` — behavior contracts for each production surface.

---

### Task 1: Additive Migration and Request Enrichment

**Files:**
- Create: `cloudflare/visitor-logging/migrations/0002_add_visit_intelligence.sql`
- Create: `cloudflare/visitor-logging/test/migrations.test.ts`
- Modify: `cloudflare/visitor-logging/src/visits/types.ts`
- Modify: `cloudflare/visitor-logging/src/visits/normalize.ts`
- Modify: `cloudflare/visitor-logging/src/visits/repository.ts`
- Modify: `cloudflare/visitor-logging/test/visits/normalize.test.ts`
- Modify: `cloudflare/visitor-logging/test/visits/repository.test.ts`
- Modify: `cloudflare/visitor-logging/test/public-handler.test.ts`

**Interfaces:**
- Consumes: `request.cf`, bounded request headers, and the existing `VisitInput`/D1 insert flow.
- Produces: nullable `VisitInput` fields `asOrganization`, `continent`, `timezone`, `httpProtocol`, `tlsVersion`, `clientTcpRttMs`, `acceptLanguage`, `secFetchSite`, `cfBotScore`, `cfVerifiedBot`, and `cfCorporateProxy`; matching D1 columns and index.

- [ ] **Step 1: Write migration compatibility tests**

Add `test/migrations.test.ts` that queries `PRAGMA table_info(visits)` and asserts all eleven nullable columns exist with the names in the spec. Query `PRAGMA index_list(visits)` plus `PRAGMA index_info(visits_ip_address_visited_at_utc_idx)` and assert the ordered columns are `ip_address`, `visited_at_utc`. Insert a row using only the original columns and assert every new column reads as `NULL`.

- [ ] **Step 2: Run the migration test and verify RED**

Run:

```bash
cd cloudflare/visitor-logging
npx vitest run test/migrations.test.ts
```

Expected: FAIL because migration `0002` and its columns/index do not exist.

- [ ] **Step 3: Add the additive migration**

Create `0002_add_visit_intelligence.sql` with eleven `ALTER TABLE visits ADD COLUMN` statements. Add `CHECK` constraints for the bot score (`NULL` or `1–99`), nullable booleans (`NULL`, `0`, `1`), and non-negative/capped RTT (`NULL` or `0–600000`). Create `visits_ip_address_visited_at_utc_idx` on `(ip_address, visited_at_utc)`.

- [ ] **Step 4: Run the migration test and verify GREEN**

Run the focused migration test again. Expected: PASS.

- [ ] **Step 5: Write normalization and persistence tests first**

Extend `normalize.test.ts` with:

- one complete `request.cf` example containing all new scalar fields and optional `botManagement`;
- one missing/malformed/out-of-range example proving values become `NULL`;
- truncation cases for organization, timezone, language, and protocol fields;
- accepted `Sec-Fetch-Site` values `none`, `same-origin`, `same-site`, `cross-site` plus rejection of other values;
- proof that no query/referrer credential sentinel is stored.

Extend `repository.test.ts` to expect every new value in D1 and a second insert with all nullable fields. Extend `public-handler.test.ts` so the saved production-shaped request contains enrichment without changing origin-response behavior.

- [ ] **Step 6: Run focused ingestion tests and verify RED**

Run:

```bash
npx vitest run test/visits/normalize.test.ts test/visits/repository.test.ts test/public-handler.test.ts
```

Expected: FAIL because `VisitInput`, `buildVisit()`, and the insert statement do not expose the new fields.

- [ ] **Step 7: Implement bounded enrichment**

Extend `VisitInput` in `types.ts`. In `normalize.ts`, add focused helpers for bounded strings, nullable booleans, Bot Management score, RTT, and `Sec-Fetch-Site`. Read `asOrganization`, `continent`, `timezone`, `httpProtocol`, `tlsVersion`, `clientTcpRtt`, optional `botManagement`, `Accept-Language`, and `Sec-Fetch-Site`. Never throw on absent or malformed `request.cf` values. Extend the parameterized insert and bindings in `repository.ts` in migration-column order.

- [ ] **Step 8: Verify GREEN and regression safety**

Run the focused command, then:

```bash
npm run typecheck
npx vitest run test/cleanup.test.ts test/public-handler.test.ts test/visits
```

Expected: all selected tests pass, and cleanup still removes whole rows without logging their contents.

- [ ] **Step 9: Commit Task 1**

```bash
git add cloudflare/visitor-logging/migrations/0002_add_visit_intelligence.sql cloudflare/visitor-logging/test/migrations.test.ts cloudflare/visitor-logging/src/visits/types.ts cloudflare/visitor-logging/src/visits/normalize.ts cloudflare/visitor-logging/src/visits/repository.ts cloudflare/visitor-logging/test/visits/normalize.test.ts cloudflare/visitor-logging/test/visits/repository.test.ts cloudflare/visitor-logging/test/public-handler.test.ts
git commit -m "feat: capture visitor intelligence metadata"
```

---

### Task 2: Versioned Risk Classification and Activity Queries

**Files:**
- Create: `cloudflare/visitor-logging/src/visits/intelligence.ts`
- Create: `cloudflare/visitor-logging/test/visits/intelligence.test.ts`
- Modify: `cloudflare/visitor-logging/src/visits/types.ts`
- Modify: `cloudflare/visitor-logging/src/dashboard/queries.ts`
- Modify: `cloudflare/visitor-logging/test/dashboard/queries.test.ts`

**Interfaces:**
- Consumes: persisted visit fields, existing scanner/allowlist/Oracle/Tencent evidence, nullable Cloudflare enrichment, and same-IP activity.
- Produces: `VisitEvidence`, `VisitDecision`, `RISK_WEIGHTS`, `buildVisitDecision(evidence)`, `CLASSIFICATION_VERSION = "risk-v1"`, activity fields on `VisitRow`, and SQL `counted` semantics shared by page/export/summary queries.

- [ ] **Step 1: Write pure classification tests**

Create `intelligence.test.ts` with a `baselineEvidence()` helper and independent cases for every score contribution. Assert forced score `100` for Cloudflare verified bots and known bot signatures; minimum `90` for existing effective-bot signals; additive/capped scores; ordered reason strings; and exact thresholds `39/40/69/70`.

Add the approved examples:

```ts
expect(buildVisitDecision(hetznerUnknownRepeat)).toMatchObject({
  visitorType: "Suspicious automation",
  riskScore: 90,
  counted: false
});
expect(buildVisitDecision(digitalOceanChromeDirect)).toMatchObject({
  visitorType: "Uncertain",
  riskScore: 40,
  counted: true
});
expect(buildVisitDecision(normalBrowserDirect)).toMatchObject({
  visitorType: "Likely human",
  riskScore: 10,
  counted: true
});
```

- [ ] **Step 2: Run classification tests and verify RED**

Run:

```bash
npx vitest run test/visits/intelligence.test.ts
```

Expected: FAIL because the intelligence module does not exist.

- [ ] **Step 3: Implement the pure intelligence module**

Define the five approved hosting ASNs, normalized provider-name tokens, exported immutable `RISK_WEIGHTS`, visitor type union, ordered reasons, and `risk-v1`. Keep `buildVisitDecision()` deterministic and side-effect free. Use “Hosting network,” never VPN/proxy/purity claims. Ensure a hosting signal alone returns score `30`, `Likely human`, counted `true`.

- [ ] **Step 4: Run classification tests and verify GREEN**

Run the focused test again. Expected: PASS.

- [ ] **Step 5: Write D1 query tests first**

Extend `queries.test.ts` to insert:

- legacy rows with all enrichment fields `NULL`;
- Hetzner/Internet Vikings/DigitalOcean rows with old ASN-only evidence;
- new rows with organization-name evidence;
- bot-signature, Bot Management score, verified-bot, scanner, unlisted-page, and existing Oracle/Tencent patterns;
- repeated same-IP visits inside/outside two minutes;
- rows at preceding-24-hour and threshold boundaries;
- multiple paths for first/last/retained/distinct-path aggregates;
- at least 51 rows to exercise pagination and a 50-row response.

Assert `VisitRow` contains all activity fields, evidence-consistent decisions, stable reason order, and `risk-v1`. Assert `bots=exclude`, `include`, and `only` select by `counted`; default summaries equal counted rows; export and page decisions agree.

- [ ] **Step 6: Run focused query tests and verify RED**

Run:

```bash
npx vitest run test/dashboard/queries.test.ts
```

Expected: FAIL because queries do not expose aggregates/risk and still filter only through the previous effective-bot expression.

- [ ] **Step 7: Implement evidence SQL and row mapping**

In `queries.ts`:

- preserve the existing SQL helpers and give each effective-bot cause a selectable boolean;
- add SQL helpers for known bot signature, hosting evidence, two-minute count, preceding-24-hour count, high activity, and optional Cloudflare bot score;
- generate the risk score from the imported `RISK_WEIGHTS` constants in `intelligence.ts` and clamp/force it as specified;
- add `countedSql()` as `risk_score < 70` while respecting forced bot outcomes;
- select first/last/retained/distinct-path aggregates in the same page/export statement;
- map SQL evidence through `buildVisitDecision()` and fail tests if its score differs from SQL;
- change bot filters and summary totals to `countedSql()`.

Use bound filter values and fixed literals only. Do not add per-row Worker-to-D1 calls.

- [ ] **Step 8: Verify GREEN, typing, and query regression safety**

Run:

```bash
npx vitest run test/visits/intelligence.test.ts test/dashboard/queries.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 9: Commit Task 2**

```bash
git add cloudflare/visitor-logging/src/visits/intelligence.ts cloudflare/visitor-logging/test/visits/intelligence.test.ts cloudflare/visitor-logging/src/visits/types.ts cloudflare/visitor-logging/src/dashboard/queries.ts cloudflare/visitor-logging/test/dashboard/queries.test.ts
git commit -m "feat: classify visitor intelligence risk"
```

---

### Task 3: Authenticated API and CSV Intelligence Contract

**Files:**
- Modify: `cloudflare/visitor-logging/src/dashboard/csv.ts`
- Modify: `cloudflare/visitor-logging/test/dashboard/csv.test.ts`
- Modify: `cloudflare/visitor-logging/test/dashboard/api.test.ts`

**Interfaces:**
- Consumes: enriched `VisitRow` from Task 2.
- Produces: additive `/api/visits` JSON properties and the exact append-only CSV column contract from the spec.

- [ ] **Step 1: Write failing API contract tests**

Extend `api.test.ts` with a complete enriched visit and assert `/api/visits` returns network/protocol fields, activity aggregates, visitor type, risk score/reasons, counted, and `risk-v1`. Add a legacy-null row assertion. Preserve all existing Access, security-header, method, and invalid-filter assertions.

- [ ] **Step 2: Write failing CSV contract tests**

Update `csv.test.ts` to assert the current header prefix remains unchanged and the 22 exact columns from the spec are appended in order. Assert booleans are stable `true`/`false` or empty when unavailable, reasons serialize as a readable delimiter-separated string, nullable metadata is empty, and formula-injection protection covers every new string field.

- [ ] **Step 3: Run API/CSV tests and verify RED**

Run:

```bash
npx vitest run test/dashboard/api.test.ts test/dashboard/csv.test.ts
```

Expected: FAIL on missing new JSON/CSV properties and headers.

- [ ] **Step 4: Implement additive API/CSV output**

The JSON API already serializes `VisitRow`; make only the minimal type/query fixture changes required. Append CSV headers and values exactly as specified. Continue escaping CR/LF/quotes and prefixing spreadsheet-formula initiators for every string cell. Keep the 5,000-row cap.

- [ ] **Step 5: Verify GREEN and security regressions**

Run the focused tests and:

```bash
npx vitest run test/dashboard/api.test.ts test/dashboard/csv.test.ts test/access.test.ts test/security-headers.test.ts
```

Expected: all pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add cloudflare/visitor-logging/src/dashboard/csv.ts cloudflare/visitor-logging/test/dashboard/csv.test.ts cloudflare/visitor-logging/test/dashboard/api.test.ts
git commit -m "feat: export visitor intelligence details"
```

---

### Task 4: Rich Dashboard Table and Accessible Details

**Files:**
- Modify: `cloudflare/visitor-logging/src/dashboard/page.ts`
- Modify: `cloudflare/visitor-logging/src/dashboard/app.js.ts`
- Modify: `cloudflare/visitor-logging/src/dashboard/app.css.ts`
- Modify: `cloudflare/visitor-logging/test/dashboard/page.test.ts`

**Interfaces:**
- Consumes: Task 3 API fields.
- Produces: 13-column main table, safe badges/reasons, keyboard-accessible detail rows, updated filter copy, and responsive layout.

- [ ] **Step 1: Write failing static page tests**

Extend `page.test.ts` to assert the 13 exact headers and order, loading/error/empty `colSpan = 13`, `Include excluded automation`, detail CSS hooks, one-column mobile detail layout, and unchanged CSP/security response metadata.

- [ ] **Step 2: Write failing runtime rendering tests**

Update the DOM harness expectations so a complete row renders:

- `AS24940 · Hetzner Online GmbH`;
- `24h: 2` activity;
- visitor type, numeric risk, ordered reason text, and `Counted`/`Excluded`;
- a real details button with `aria-expanded="false"` and a unique `aria-controls`;
- a following hidden details row with six grouped sections and all values supplied through text nodes/textContent.

Simulate click and keyboard activation through the button click handler, assert expanded state/visibility toggles, and verify hostile strings such as `<img onerror=...>` remain text. Add null-field rendering as `Unknown` or `Not available` according to the spec.

- [ ] **Step 3: Run dashboard page tests and verify RED**

Run:

```bash
npx vitest run test/dashboard/page.test.ts
```

Expected: FAIL because the current page has seven columns and no detail controls.

- [ ] **Step 4: Update the static table shell**

Change `page.ts` to the exact 13 headers and filter label. Set the loading-row span to 13. Do not add inline script/style or loosen CSP.

- [ ] **Step 5: Implement safe row/details rendering**

In `app.js.ts`, add small functions for network, activity, risk badge class, counted label, definition-list entries, and unique detail IDs. Append the main row followed by a hidden detail row. Build all dynamic content with `createElement` and `textContent`; never use `innerHTML`. The details button toggles `hidden` and `aria-expanded`. Set all empty/error spans to 13.

- [ ] **Step 6: Add responsive and accessible styling**

In `app.css.ts`, add non-color-only badge text, visible focus states, compact reason wrapping, details-row background/border, responsive definition-list grids, and a one-column layout below 44rem. Preserve horizontal scrolling for the main table.

- [ ] **Step 7: Verify GREEN and bundle behavior**

Run:

```bash
npx vitest run test/dashboard/page.test.ts
npm run typecheck
npm run verify:dashboard-bundle
```

Expected: all pass and Wrangler emits the dashboard asset.

- [ ] **Step 8: Commit Task 4**

```bash
git add cloudflare/visitor-logging/src/dashboard/page.ts cloudflare/visitor-logging/src/dashboard/app.js.ts cloudflare/visitor-logging/src/dashboard/app.css.ts cloudflare/visitor-logging/test/dashboard/page.test.ts
git commit -m "feat: show visitor intelligence dashboard"
```

---

### Task 5: Full Review, Migration, Deployment, and Production Verification

**Files:**
- Modify if required by verified behavior: `cloudflare/visitor-logging/DEPLOYMENT.md`
- Verify: all files changed in Tasks 1–4

**Interfaces:**
- Consumes: complete tested feature.
- Produces: reviewed commits, applied production migration, deployed Worker version, merged pull request, and verified authenticated dashboard.

- [ ] **Step 1: Run the complete local verification**

Run:

```bash
cd cloudflare/visitor-logging
npm run typecheck
npx vitest run --exclude test/render-production-config.test.ts
npm run test:production-config
npm run verify:dashboard-bundle
npm run d1:migrate:local
git diff --check origin/master..HEAD
```

Expected: zero failed tests, type errors, bundle errors, migration errors, or whitespace errors.

- [ ] **Step 2: Review migration safety**

Inspect the migration file and use Wrangler migration listing against the private production configuration. Confirm only `0002_add_visit_intelligence.sql` is pending, the target binding is `lizhe-visitor-logs`, and no statement drops/recreates `visits` or deletes rows. Record the pre-migration remote row count with a read-only parameter-free query:

```bash
npx wrangler d1 migrations list DB --remote --config .private/wrangler.production.jsonc
npx wrangler d1 execute DB --remote --config .private/wrangler.production.jsonc --command "SELECT COUNT(*) AS visit_count FROM visits"
```

- [ ] **Step 3: Request independent full-diff review**

Review `origin/master..HEAD` against the approved spec. The reviewer checks risk/SQL equivalence, false-positive thresholds, migration ordering, old-row compatibility, query performance, XSS/CSV injection, Access/CSP, responsive details, and test credibility. Fix every Critical or Important finding and rerun Step 1.

- [ ] **Step 4: Apply production migration**

Run:

```bash
npm run d1:migrate:remote
```

Verify `0002` is applied. Re-run the remote row-count query and confirm it equals the pre-migration count. Inspect the new columns and composite index through read-only remote D1 commands. Do not clear records:

```bash
npx wrangler d1 migrations list DB --remote --config .private/wrangler.production.jsonc
npx wrangler d1 execute DB --remote --config .private/wrangler.production.jsonc --command "SELECT COUNT(*) AS visit_count FROM visits; PRAGMA table_info(visits); PRAGMA index_info(visits_ip_address_visited_at_utc_idx)"
```

- [ ] **Step 5: Deploy the Worker**

Run:

```bash
npm run deploy
```

Record the Worker version ID. If deployment fails after migration, leave the additive columns in place, diagnose, and redeploy the last known-good code before proceeding.

- [ ] **Step 6: Push and merge through a pull request**

Push `codex/visitor-intelligence-dashboard`, create a pull request to `master`, include test/migration/deployment evidence, verify GitHub reports it mergeable, and merge using the repository’s existing merge-commit convention. Preserve the worktree for follow-up.

- [ ] **Step 7: Verify production API and dashboard**

Through the existing authenticated browser session, verify:

- the table has 13 columns and new filter copy;
- an old row shows absent enrichment as `Unknown`/`Not available`;
- a newly generated allowed-page visit shows available network/protocol fields;
- details toggles with keyboard and updates `aria-expanded`;
- Hetzner Unknown-browser repeats are excluded with score/reasons;
- single normal-browser data-center visits remain `Uncertain` and counted;
- default summaries omit excluded rows;
- `bots=include` exposes excluded rows and their reasons;
- CSV downloads with the appended header contract;
- no console errors or visibly broken mobile layout.

- [ ] **Step 8: Measure representative query latency**

Use one authenticated `/api/visits?bots=include&page=1` response and Worker/HTTP timing evidence. Record latency without exposing IPs or row contents. If it exceeds 1 second consistently across three requests, stop and optimize/explain the query plan before declaring completion.

- [ ] **Step 9: Record final evidence**

Report test counts, migration name, unchanged row count, Worker version, PR/merge commit, dashboard verification results, and any unavailable Cloudflare Bot Management fields. State explicitly that no existing visits were cleared and no external intelligence service was added.
