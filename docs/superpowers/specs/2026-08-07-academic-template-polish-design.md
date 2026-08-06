# Academic Template Polish Design

## Goal

Refine the existing AcademicPages-based personal site without changing its
information architecture, routes, Markdown content, visitor logging, or
privacy behavior. The result should feel more deliberate and readable while
remaining recognizably academic.

## Visual Direction

- Deep navy is the primary color: `#0B1F3A`.
- Warm gold is a restrained accent: `#C89B3C`.
- Warm white remains the reading background.
- Gold is limited to interaction states, small rules, and emphasis markers;
  it must not become a dominant background color.

## Scope

Create a single site-local stylesheet that loads after the existing theme and
only overrides presentation. It will:

- refine masthead spacing, opacity, current-page state, and hover treatment;
- improve heading, body, link, rule, and list rhythm;
- present the sidebar portrait and author metadata with a subtle rounded frame
  and gold accent;
- make social links compact, consistent icon buttons;
- improve visual separation and scanability of the homepage Biography, News,
  Research Interests, and Research Experience sections;
- provide responsive adjustments for narrow viewports.

## Non-goals

- No content rewrites, new content sections, route changes, or template
  replacement.
- No new JavaScript, analytics, external font dependency, image generation, or
  visitor-log changes.
- No modification of the private dashboard or Cloudflare deployment settings.

## Integration

The new stylesheet will be imported from the existing stylesheet pipeline so
that it naturally follows the base theme. Existing HTML and Markdown remain
the source of truth; CSS selectors must be scoped to established AcademicPages
classes and page content to avoid styling the Access dashboard.

## Responsive Behavior

At tablet and phone widths, navigation controls remain readable, the sidebar
uses reduced padding, author metadata wraps safely, and page headings/news
items retain clear hierarchy without horizontal overflow.

## Validation

- Build the site with Jekyll.
- Inspect rendered desktop and mobile screenshots for contrast, clipping,
  wrapping, and visual hierarchy.
- Confirm the existing homepage, privacy page, and public static assets still
  resolve.
