export const DASHBOARD_SCRIPT = `(() => {
  "use strict";

  const filterKeys = ["from", "to", "ip", "country", "path", "bots"];
  const byId = (id) => document.getElementById(id);

  function filterParams(search) {
    const source = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
    const result = new URLSearchParams();
    for (const key of filterKeys) {
      const value = source.get(key);
      if (value) result.set(key, value);
    }
    if (!result.has("bots")) result.set("bots", "exclude");
    return result;
  }

  function formatDashboardValue(value) {
    return value === null || value === undefined || value === "" ? "—" : String(value);
  }

  function formatHongKongTimestamp(value) {
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
    return byType.get("year") + "-" + byType.get("month") + "-" + byType.get("day") +
      " " + byType.get("hour") + ":" + byType.get("minute") + ":" + byType.get("second") + " HKT";
  }

  function buildPaginationUrl(search, page) {
    const params = filterParams(search);
    params.set("page", String(page));
    return "/?" + params.toString();
  }

  function buildBotToggleUrl(search, includeBots) {
    const params = filterParams(search);
    params.set("bots", includeBots ? "include" : "exclude");
    params.set("page", "1");
    return "/?" + params.toString();
  }

  function buildCsvUrl(search) {
    return "/api/export.csv?" + filterParams(search).toString();
  }

  function pageNumber(params) {
    const value = Number(params.get("page") || "1");
    return Number.isSafeInteger(value) && value > 0 ? value : 1;
  }

  function pageUrl(params, page) {
    return buildPaginationUrl(params.toString(), page);
  }

  function csvUrl(params) {
    return buildCsvUrl(params.toString());
  }

  function visitsUrl(params) {
    const query = filterParams(params.toString());
    query.set("page", String(pageNumber(params)));
    return "/api/visits?" + query.toString();
  }

  async function fetchJson(url) {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("Dashboard request failed");
    return response.json();
  }

  function setSummary(prefix, count) {
    byId(prefix + "-total").textContent = formatDashboardValue(count.totalVisits);
    byId(prefix + "-distinct").textContent = formatDashboardValue(count.distinctNetworkAddresses);
  }

  function tableCell(value, className) {
    const cell = document.createElement("td");
    cell.textContent = formatDashboardValue(value);
    if (className) cell.className = className;
    return cell;
  }

  function fullPath(visit) {
    return visit.queryString ? visit.path + "?" + visit.queryString : visit.path;
  }

  function location(visit) {
    const values = [visit.country, visit.city].filter((value) => value !== null && value !== "");
    return values.length ? values.join(" · ") : formatDashboardValue(null);
  }

  function renderRows(items, botsIncluded) {
    const body = byId("visit-rows");
    body.replaceChildren();

    if (items.length === 0) {
      const row = document.createElement("tr");
      const cell = tableCell("No visits match these filters.");
      cell.colSpan = 7;
      row.append(cell);
      body.append(row);
      return;
    }

    for (const visit of items) {
      const row = document.createElement("tr");
      row.append(
        tableCell(formatHongKongTimestamp(visit.visitedAtUtc), "time-cell"),
        tableCell(visit.ipAddress, "ip-cell"),
        tableCell(location(visit)),
        tableCell(fullPath(visit)),
        tableCell(visit.referrer),
        tableCell(visit.browserSummary)
      );
      const botCell = tableCell(
        botsIncluded && visit.isSuspectedBot ? "Suspected bot" : formatDashboardValue(null),
        botsIncluded && visit.isSuspectedBot ? "bot-marker" : ""
      );
      row.append(botCell);
      body.append(row);
    }
  }

  function populateFilters(params) {
    for (const name of ["from", "to", "ip", "country", "path"]) {
      byId(name + "-filter").value = params.get(name) || "";
    }
    const bots = params.get("bots") || "exclude";
    byId("bots-filter").checked = bots === "include" || bots === "only";
  }

  function applyFilterForm(event) {
    event.preventDefault();
    const query = new URLSearchParams();
    for (const name of ["from", "to", "ip", "country", "path"]) {
      const value = byId(name + "-filter").value.trim();
      if (value) query.set(name, value);
    }
    window.location.assign(
      buildBotToggleUrl(query.toString(), byId("bots-filter").checked)
    );
  }

  function showError() {
    byId("error-state").hidden = false;
    byId("visit-rows").replaceChildren();
    const row = document.createElement("tr");
    const cell = tableCell("Visitor data is temporarily unavailable.");
    cell.colSpan = 7;
    row.append(cell);
    byId("visit-rows").append(row);
  }

  async function loadDashboard() {
    byId("error-state").hidden = true;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("bots")) params.set("bots", "exclude");
    if (!params.has("page")) params.set("page", "1");
    const page = pageNumber(params);
    const botsIncluded = params.get("bots") !== "exclude";

    populateFilters(params);
    byId("export-link").href = csvUrl(params);

    try {
      const [summary, visits] = await Promise.all([
        fetchJson("/api/summary"),
        fetchJson(visitsUrl(params))
      ]);
      setSummary("today", summary.today);
      setSummary("seven-days", summary.sevenDays);
      setSummary("thirty-days", summary.thirtyDays);
      renderRows(visits.items, botsIncluded);

      const previous = byId("previous-page");
      previous.href = pageUrl(params, Math.max(1, page - 1));
      previous.hidden = page <= 1;
      const next = byId("next-page");
      next.href = pageUrl(params, page + 1);
      next.hidden = !visits.hasNext;
      byId("page-status").textContent = "Page " + String(page);
    } catch {
      showError();
    }
  }

  byId("filters-form").addEventListener("submit", applyFilterForm);
  byId("retry-button").addEventListener("click", loadDashboard);
  loadDashboard();
})();`;
