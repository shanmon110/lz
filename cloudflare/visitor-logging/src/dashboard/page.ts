import { DASHBOARD_CSS } from "./app.css";
import { DASHBOARD_SCRIPT } from "./app.js";

const FILTER_KEYS = ["from", "to", "ip", "country", "path", "bots"] as const;

export const DASHBOARD_CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'";

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Visitor logs</title>
  <link rel="stylesheet" href="/app.css">
  <script src="/app.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to visitor logs</a>
  <main id="main-content">
    <header class="page-header">
      <div>
        <p class="eyebrow">Private analytics</p>
        <h1>Visitor logs</h1>
        <p class="lede">Traffic to lizhe.link, shown in Hong Kong time.</p>
      </div>
      <a class="button secondary" id="export-link" href="/api/export.csv?bots=exclude">Download CSV</a>
    </header>

    <section aria-labelledby="summary-heading">
      <h2 class="section-heading" id="summary-heading">Overview</h2>
      <div class="summary-grid" aria-live="polite">
        <article class="summary-card">
          <h3>Today</h3>
          <p class="summary-total" id="today-total">—</p>
          <p class="summary-caption">Visits</p>
          <p><span id="today-distinct">—</span> <span>Distinct network addresses</span></p>
        </article>
        <article class="summary-card">
          <h3>Last 7 days</h3>
          <p class="summary-total" id="seven-days-total">—</p>
          <p class="summary-caption">Visits</p>
          <p><span id="seven-days-distinct">—</span> <span>Distinct network addresses</span></p>
        </article>
        <article class="summary-card">
          <h3>Last 30 days</h3>
          <p class="summary-total" id="thirty-days-total">—</p>
          <p class="summary-caption">Visits</p>
          <p><span id="thirty-days-distinct">—</span> <span>Distinct network addresses</span></p>
        </article>
      </div>
    </section>

    <section class="panel" aria-labelledby="filters-heading">
      <div class="section-title-row">
        <h2 id="filters-heading">Filters</h2>
        <a href="/">Reset filters</a>
      </div>
      <form id="filters-form" action="/" method="get">
        <div class="filter-grid">
          <label>From date<input id="from-filter" name="from" type="date"></label>
          <label>To date<input id="to-filter" name="to" type="date"></label>
          <label>IP address<input id="ip-filter" name="ip" type="search" maxlength="45" autocomplete="off" placeholder="203.0.113"></label>
          <label>Country code<input id="country-filter" name="country" type="search" maxlength="2" autocomplete="off" placeholder="HK"></label>
          <label>Path contains<input id="path-filter" name="path" type="search" maxlength="2048" autocomplete="off" placeholder="/notes"></label>
          <label class="toggle"><input id="bots-filter" type="checkbox"> Include suspected bots</label>
        </div>
        <button class="button" type="submit">Apply filters</button>
      </form>
    </section>

    <section id="error-state" class="error-state" role="alert" hidden>
      <p>Unable to load visitor data. Please try again.</p>
      <button class="button secondary" id="retry-button" type="button">Try again</button>
    </section>

    <section class="panel visits-panel" aria-labelledby="visits-heading">
      <div class="section-title-row">
        <div>
          <h2 id="visits-heading">Visits</h2>
          <p>50 rows per page · newest first</p>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Time (Hong Kong)</th>
              <th scope="col">IP address</th>
              <th scope="col">Location</th>
              <th scope="col">Path</th>
              <th scope="col">Referrer</th>
              <th scope="col">Browser / device</th>
              <th scope="col">Bot</th>
            </tr>
          </thead>
          <tbody id="visit-rows">
            <tr><td colspan="7">Loading visits…</td></tr>
          </tbody>
        </table>
      </div>
      <nav class="pagination" aria-label="Visit pagination">
        <a class="button secondary" id="previous-page" href="/?bots=exclude&page=1">Previous</a>
        <span id="page-status" aria-live="polite">Page 1</span>
        <a class="button secondary" id="next-page" href="/?bots=exclude&page=2">Next</a>
      </nav>
    </section>
  </main>
</body>
</html>`;

function filterParams(search: string): URLSearchParams {
  const source = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const result = new URLSearchParams();

  for (const key of FILTER_KEYS) {
    const value = source.get(key);
    if (value) {
      result.set(key, value);
    }
  }
  if (!result.has("bots")) {
    result.set("bots", "exclude");
  }

  return result;
}

function dashboardUrl(params: URLSearchParams): string {
  return `/?${params.toString()}`;
}

export function formatDashboardValue(
  value: string | number | null | undefined
): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function formatHongKongTimestamp(value: string | null | undefined): string {
  if (!value) return "—";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));

  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")} ${byType.get("hour")}:${byType.get("minute")}:${byType.get("second")} HKT`;
}

export function buildPaginationUrl(search: string, page: number): string {
  const params = filterParams(search);
  params.set("page", String(page));
  return dashboardUrl(params);
}

export function buildBotToggleUrl(search: string, includeBots: boolean): string {
  const params = filterParams(search);
  params.set("bots", includeBots ? "include" : "exclude");
  params.set("page", "1");
  return dashboardUrl(params);
}

export function buildCsvUrl(search: string): string {
  return `/api/export.csv?${filterParams(search).toString()}`;
}

function dashboardResponse(body: string, contentType: string): Response {
  return new Response(body, {
    headers: {
      "Content-Security-Policy": DASHBOARD_CONTENT_SECURITY_POLICY,
      "Content-Type": contentType
    }
  });
}

export function dashboardPageResponse(): Response {
  return dashboardResponse(DASHBOARD_HTML, "text/html; charset=utf-8");
}

export function dashboardCssResponse(): Response {
  return dashboardResponse(DASHBOARD_CSS, "text/css; charset=utf-8");
}

export function dashboardScriptResponse(): Response {
  return dashboardResponse(DASHBOARD_SCRIPT, "text/javascript; charset=utf-8");
}
