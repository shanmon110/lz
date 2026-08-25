# Academic Homepage CV Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the English academic website from the supplied CV with six clear navigation destinations and strict separation between tutorials, talks, and conference organization.

**Architecture:** Keep the existing Jekyll/Academic Pages theme and implement the information architecture with focused Markdown pages plus the existing navigation data file. Add a build-level Node test that exercises generated HTML, and update the visitor logger's shared allowlist so new navigation pages count as possible human visits.

**Tech Stack:** Jekyll/GitHub Pages, Liquid, Markdown, YAML, Node.js built-in test runner, TypeScript, Vitest, Cloudflare Workers/D1

**Spec:** `docs/superpowers/specs/2026-08-25-homepage-cv-refresh-design.md`

## Global Constraints

- Public website copy is English only.
- Navigation order is Home, Publications, Tutorials, Talks, Academic Service, Teaching.
- Conference organization and tutorials are separate pages and never share a content section.
- Preserve every usable URL supplied by the CV or the user; do not invent collaborator URLs.
- Do not publish CV comments or unverified impact-factor/quartile claims.
- Keep the existing Jekyll theme and author profile; do not introduce a frontend framework.
- Visitor counting accepts only the six navigation paths, with exact no-slash or one-trailing-slash variants.

---

### Task 1: Build-Level Site Contract

**Files:**
- Create: `test/site-content.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: Jekyll source under `_data/`, `_pages/`, and `_config.yml`.
- Produces: `npm run test:site`, which builds into a temporary directory and verifies the public HTML contract.

- [ ] **Step 1: Prepare an isolated Ruby dependency path**

Run:

```bash
export BUNDLE_PATH=/Users/lizhe/Documents/Codex/2026-08-25/n-x20/work/lz-jekyll-bundle
bundle install
```

Expected: Jekyll and GitHub Pages executables install outside the repository checkout.

- [ ] **Step 2: Add the failing generated-site test**

Create `test/site-content.test.js` using `node:test`:

```js
const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");

const repositoryRoot = resolve(__dirname, "..");
const bundlePath = "/Users/lizhe/Documents/Codex/2026-08-25/n-x20/work/lz-jekyll-bundle";
let destination;

function generated(relativePath) {
  return readFileSync(join(destination, relativePath), "utf8");
}

function navigationHrefs(html) {
  const visibleLinks = html.match(/<ul class="visible-links">([\s\S]*?)<\/ul>/);
  assert.ok(visibleLinks, "generated masthead contains visible navigation links");
  return [...visibleLinks[1].matchAll(/<a href="([^"]+)"/g)].map((match) => match[1]);
}

before(() => {
  destination = mkdtempSync(join(tmpdir(), "lz-site-"));
  execFileSync("bundle", ["exec", "jekyll", "build", "--destination", destination], {
    cwd: repositoryRoot,
    env: { ...process.env, BUNDLE_PATH: bundlePath },
    stdio: "pipe"
  });
});

after(() => rmSync(destination, { recursive: true, force: true }));

test("publishes the approved navigation and separated academic content", () => {
  const indexHtml = generated("index.html");
  const tutorialsHtml = generated("tutorials/index.html");
  const talksHtml = generated("talks/index.html");
  const serviceHtml = generated("academic-service/index.html");
  const teachingHtml = generated("teaching/index.html");

  assert.deepEqual(navigationHrefs(indexHtml), [
    "/", "/publications/", "/tutorials/", "/talks/",
    "/academic-service/", "/teaching/"
  ]);
  assert.doesNotMatch(indexHtml, />CV</);
  assert.match(tutorialsHtml, /interspeech2026\.org\/en-AU\/pages\/programme\/tutorials/);
  assert.match(tutorialsHtml, /2026\.ieeeicme\.org\/tutorials/);
  assert.doesNotMatch(tutorialsHtml, /mmasia2026/);
  assert.match(serviceHtml, /mmasia2026\.org\/calls\/special-session-trustworthy-speech-audio-ai/);
  assert.doesNotMatch(serviceHtml, /Speech Large Language Models: Architectures/);
  assert.match(talksHtml, /bilibili\.com\/video\/BV17T42127Wd/);
  assert.match(teachingHtml, /Speech Processing and Recognition/);
});
```

- [ ] **Step 3: Expose the site test command**

Add this script to `package.json`:

```json
"test:site": "node --test test/site-content.test.js"
```

- [ ] **Step 4: Run the contract and verify it fails for missing pages/navigation**

Run:

```bash
BUNDLE_PATH=/Users/lizhe/Documents/Codex/2026-08-25/n-x20/work/lz-jekyll-bundle npm run test:site
```

Expected: FAIL because `/tutorials/` and `/academic-service/` do not exist and navigation still contains the old structure.

- [ ] **Step 5: Commit the failing contract**

```bash
git add package.json test/site-content.test.js
git commit -m "test: define refreshed academic site contract"
```

---

### Task 2: Navigation, Tutorials, and Academic Service

**Files:**
- Modify: `_data/navigation.yml`
- Create: `_pages/tutorials.md`
- Create: `_pages/academic-service.md`
- Delete: `_pages/markdown.md`

**Interfaces:**
- Consumes: navigation contract from Task 1 and URLs in the approved spec.
- Produces: `/tutorials/`, `/academic-service/`, and legacy redirects from `/markdown/`, `/md/`, and `/markdown.html`.

- [ ] **Step 1: Replace the navigation data**

Set `_data/navigation.yml` to six ordered entries:

```yaml
main:
  - title: "Home"
    url: /
  - title: "Publications"
    url: /publications/
  - title: "Tutorials"
    url: /tutorials/
  - title: "Talks"
    url: /talks/
  - title: "Academic Service"
    url: /academic-service/
  - title: "Teaching"
    url: /teaching/
```

- [ ] **Step 2: Create the Tutorials page**

Create `_pages/tutorials.md` with front matter for `/tutorials/`. Add reverse-chronological entries for Interspeech 2026 and ICME 2026. Each entry includes its linked official title, event, exact date, city/country, instructor list, and a concise overview covering the topics in the approved source.

- [ ] **Step 3: Create the Academic Service page**

Create `_pages/academic-service.md` with front matter:

```yaml
layout: archive
title: "Academic Service"
permalink: /academic-service/
author_profile: true
redirect_from:
  - /markdown/
  - /md/
  - /markdown.html
```

Add `Conference Organization`, `Peer Review`, and `Professional Memberships` headings. Put only the linked MMAsia 2026 special session under conference organization. Populate review and membership facts from the CV.

- [ ] **Step 4: Remove the superseded Services page**

Delete `_pages/markdown.md` after its redirects and content responsibilities move to `_pages/academic-service.md`.

- [ ] **Step 5: Run the site contract**

Run:

```bash
BUNDLE_PATH=/Users/lizhe/Documents/Codex/2026-08-25/n-x20/work/lz-jekyll-bundle npm run test:site
```

Expected: navigation, tutorial, and academic-service assertions pass; remaining content assertions may still fail until Task 3.

- [ ] **Step 6: Commit the new information architecture**

```bash
git add _data/navigation.yml _pages/tutorials.md _pages/academic-service.md _pages/markdown.md
git commit -m "feat: separate tutorials and academic service"
```

---

### Task 3: Homepage, Talks, Teaching, and Publication Reconciliation

**Files:**
- Modify: `_pages/about.md`
- Modify: `_pages/talks.html`
- Modify: `_pages/teaching.html`
- Modify: `_pages/publications.md`
- Test: `test/site-content.test.js`

**Interfaces:**
- Consumes: CV facts and supplied 2026 links; page destinations from Task 2.
- Produces: concise homepage and complete dedicated content pages with source links preserved.

- [ ] **Step 1: Refresh the homepage**

Update `_pages/about.md` with:

- current HKU postdoctoral position and concise research focus;
- updated 2026 news for the linked MMAsia special session and linked Interspeech/ICME tutorials;
- CV-consistent current/previous positions, education, research interests, and selected awards;
- internal links to `/publications/`, `/tutorials/`, `/talks/`, `/academic-service/`, and `/teaching/` instead of duplicated long lists.

- [ ] **Step 2: Replace the Talks collection loop with CV-derived records**

Update `_pages/talks.html` so it renders the eight `Talks and Presentations` items in reverse chronological order. Attach each supplied WeChat, SharePoint, or Bilibili URL to the talk title; leave the NCMMSC 2023 item unlinked because the CV provides no URL.

- [ ] **Step 3: Refresh Teaching**

Update `_pages/teaching.html` with the four CV courses and a concise responsibilities paragraph. Remove the placeholder collection loop so unpublished template entries do not appear.

- [ ] **Step 4: Reconcile latest publications**

Compare `_pages/publications.md` with the CV's 2026–2027 entries. Correct titles, author lists, venue details, dates, pages, and supplied DOI URLs where the CV is newer. Keep explicitly link-unverified items as plain titles. Do not add impact factors or quartiles.

- [ ] **Step 5: Run the complete generated-site contract**

Run:

```bash
BUNDLE_PATH=/Users/lizhe/Documents/Codex/2026-08-25/n-x20/work/lz-jekyll-bundle npm run test:site
```

Expected: PASS.

- [ ] **Step 6: Commit the CV content refresh**

```bash
git add _pages/about.md _pages/talks.html _pages/teaching.html _pages/publications.md test/site-content.test.js
git commit -m "content: refresh academic profile from CV"
```

---

### Task 4: Visitor Allowlist Synchronization

**Files:**
- Modify: `cloudflare/visitor-logging/test/visits/normalize.test.ts`
- Modify: `cloudflare/visitor-logging/test/dashboard/queries.test.ts`
- Modify: `cloudflare/visitor-logging/src/visits/allowed-pages.ts`

**Interfaces:**
- Consumes: final navigation paths from Task 2.
- Produces: `isAllowedVisitPath(path: string): boolean` recognizing exactly the six navigation paths with zero or one trailing slash.

- [ ] **Step 1: Update allowlist expectations first**

Change the allowed-path cases in `normalize.test.ts` and the historical-query cases in `queries.test.ts` to accept:

```ts
[
  "/", "/publications", "/publications/", "/tutorials/", "/talks/",
  "/academic-service/", "/teaching/"
]
```

Add `/markdown/` to rejected/unlisted cases.

- [ ] **Step 2: Run focused tests and verify failure**

Run:

```bash
cd cloudflare/visitor-logging
npx vitest run test/visits/normalize.test.ts test/dashboard/queries.test.ts
```

Expected: FAIL because `/tutorials/` and `/academic-service/` are not allowed while `/markdown/` remains allowed.

- [ ] **Step 3: Update the shared allowlist**

Set `ALLOWED_VISIT_PATHS` in `allowed-pages.ts` to:

```ts
export const ALLOWED_VISIT_PATHS = [
  "/",
  "/publications",
  "/tutorials",
  "/talks",
  "/academic-service",
  "/teaching"
] as const;
```

- [ ] **Step 4: Run focused tests and verify pass**

Run the focused Vitest command again. Expected: PASS.

- [ ] **Step 5: Commit the synchronized visitor paths**

```bash
git add cloudflare/visitor-logging/src/visits/allowed-pages.ts cloudflare/visitor-logging/test/visits/normalize.test.ts cloudflare/visitor-logging/test/dashboard/queries.test.ts
git commit -m "feat: align visitor allowlist with site navigation"
```

---

### Task 5: Full Verification, Review, and Deployment

**Files:**
- Verify: all files changed in Tasks 1–4

**Interfaces:**
- Consumes: complete refreshed site and visitor logger.
- Produces: reviewed commits, production site deployment, and production Worker deployment.

- [ ] **Step 1: Run production-equivalent site checks**

```bash
BUNDLE_PATH=/Users/lizhe/Documents/Codex/2026-08-25/n-x20/work/lz-jekyll-bundle npm run test:site
BUNDLE_PATH=/Users/lizhe/Documents/Codex/2026-08-25/n-x20/work/lz-jekyll-bundle bundle exec jekyll build --destination /Users/lizhe/Documents/Codex/2026-08-25/n-x20/work/lz-site-final
```

Expected: both commands exit 0.

- [ ] **Step 2: Run the complete visitor-logging verification**

```bash
cd cloudflare/visitor-logging
npm run typecheck
npx vitest run --exclude test/render-production-config.test.ts
npm run test:production-config
npm run verify:dashboard-bundle
```

Expected: all commands exit 0 with no failed tests.

- [ ] **Step 3: Inspect generated pages**

Serve `/Users/lizhe/Documents/Codex/2026-08-25/n-x20/work/lz-site-final` locally and inspect desktop and mobile widths for `/`, `/publications/`, `/tutorials/`, `/talks/`, `/academic-service/`, and `/teaching/`. Confirm readable headings, no overflow, correct link destinations, and strict tutorial/service separation.

- [ ] **Step 4: Request code review**

Review the complete diff against the approved spec. Fix every Critical or Important finding, then rerun Steps 1–2.

- [ ] **Step 5: Deploy the Cloudflare Worker**

```bash
cd cloudflare/visitor-logging
npm run deploy
```

Record the Worker version ID.

- [ ] **Step 6: Push the website branch**

```bash
git push origin codex/cloudflare-visitor-logging
```

If GitHub Pages is configured to deploy another branch, report the branch mismatch rather than mutating repository deployment settings without authorization.

- [ ] **Step 7: Verify public pages**

Open each public navigation URL and confirm status 200, current English content, required external links, and absence of CV/Services navigation entries.
