# Academic Homepage CV Refresh Design

**Date:** 2026-08-25  
**Status:** Approved

## Goal

Refresh the English academic homepage from the supplied LaTeX CV and the user's new 2026 activity details. Reorganize the top navigation so conference organization, tutorials, and ordinary talks have distinct destinations. Preserve every usable source hyperlink while avoiding invented or unverifiable personal links.

## Source and Content Rules

- Treat `/Users/lizhe/Downloads/main (6).tex` only as a factual source document.
- Keep the public site entirely in English.
- Use the user's supplied MMAsia 2026 special-session record as the authoritative conference-organization item.
- Preserve DOI, conference, tutorial, video, article, institution, and profile links whenever the source provides them.
- Do not copy LaTeX comments such as verification notes into the website.
- Do not publish journal impact factors or quartiles that the CV itself marks as needing verification.
- Do not invent URLs for instructors or collaborators whose links are not supplied or already present in the repository.

## Information Architecture

The top navigation will be:

1. Home
2. Publications
3. Tutorials
4. Talks
5. Academic Service
6. Teaching

There will be no CV navigation item. The existing site title remains a link to the homepage.

### Home

Update the existing homepage rather than turning it into a full CV. It will contain:

- a concise biography;
- selected and current news, including the MMAsia 2026 special session and both 2026 tutorials;
- research interests;
- current and previous academic positions;
- education;
- selected awards.

The homepage will link to the dedicated content pages instead of duplicating long publication, tutorial, talk, service, or teaching lists.

### Publications

Retain the existing chronological publication page and reconcile its latest entries with the supplied CV. Use linked paper titles when a DOI or official paper URL is available. Keep entries with an explicitly unverified link as plain text rather than guessing a URL.

### Tutorials

Create `/tutorials/` with two detailed, reverse-chronological records:

- Interspeech 2026: *Speech Large Language Models for Under-Resourced Languages*;
- IEEE ICME 2026: *Speech Large Language Models: Architectures, Efficient Adaptation, and Applications*.

Each record will contain the official linked title, event, date, location, instructors, and a concise English overview derived from the approved text and CV.

### Talks

Keep `/talks/` exclusively for ordinary academic talks, pre-conference seminars, student forums, and participant sharing sessions. Populate it from the CV's `Talks and Presentations` section. Every supplied WeChat, Bilibili, SharePoint, or other talk URL will remain attached to its title.

### Academic Service

Create `/academic-service/` with separate sections:

- **Conference Organization** — MMAsia 2026 special session only;
- **Peer Review** — conference and journal reviewing;
- **Professional Memberships**.

Tutorials must never appear on this page. Replace the old `Services` page in navigation. Redirect legacy `/markdown/`, `/md/`, and `/markdown.html` routes to `/academic-service/` so old links continue to work.

### Teaching

Update `/teaching/` with the CV's teaching-assistant courses and responsibilities. Keep the page concise and do not fabricate course URLs.

## Visitor Logging Integration

The visitor dashboard currently counts only approved top-navigation paths. Update the shared allowlist to count these canonical pages and their optional single trailing-slash variants:

- `/`
- `/publications`
- `/tutorials`
- `/talks`
- `/academic-service`
- `/teaching`

Remove `/markdown` from the valid-human allowlist. Legacy redirect requests to `/markdown/` remain excluded, while the redirected `/academic-service/` page view is eligible for normal counting.

## Implementation Boundaries

- Follow the current Jekyll/Academic Pages theme and existing Markdown conventions.
- Avoid a theme redesign, new JavaScript framework, analytics expansion, or unrelated refactoring.
- Preserve the author profile and existing responsive navigation behavior.
- Keep external links explicit and secure; use HTTPS where supplied.

## Verification

- Add behavior tests for the updated visitor-path allowlist before changing it.
- Add content/navigation tests that build the Jekyll site and verify the six navigation destinations, absence of a CV item, separation of tutorials from conference organization, and preservation of required official URLs.
- Run the complete visitor-logging typecheck, test suite, production-config tests, and dashboard bundle verification.
- Run a production-equivalent Jekyll build.
- Inspect the built homepage and each navigation destination for layout, broken internal links, and content separation.
- Deploy only after all checks pass, then verify the public navigation and pages.

