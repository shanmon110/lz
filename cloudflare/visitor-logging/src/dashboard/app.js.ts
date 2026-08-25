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

  function formatUnknown(value) {
    return value === null || value === undefined || value === "" ? "Unknown" : String(value);
  }

  function formatHongKongTimestamp(value) {
    if (!value) return "Unknown";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Unknown";
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
    cell.textContent = formatUnknown(value);
    if (className) cell.className = className;
    return cell;
  }

  function fullPath(visit) {
    return formatUnknown(visit.path);
  }

  function location(visit) {
    const values = [visit.country, visit.city].filter((value) => value !== null && value !== "");
    return values.length ? values.join(" · ") : "Unknown";
  }

  function network(visit) {
    if (visit.asn === null || visit.asn === undefined || visit.asn === "") return "Unknown";
    const asn = "AS" + String(visit.asn);
    return visit.asOrganization ? asn + " · " + String(visit.asOrganization) : asn;
  }

  function activity(visit) {
    const count = Number(visit.visitsPreceding24h);
    return "24h: " + String(Number.isFinite(count) ? count : 0);
  }

  function riskBadgeClass(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return "risk-badge risk-unknown";
    if (value >= 70) return "risk-badge risk-high";
    if (value >= 40) return "risk-badge risk-medium";
    return "risk-badge risk-low";
  }

  function riskText(visit) {
    const score = Number(visit.riskScore);
    return "Risk " + (Number.isFinite(score) ? String(score) : "Unknown");
  }

  function reasonText(visit) {
    return Array.isArray(visit.riskReasons) && visit.riskReasons.length
      ? visit.riskReasons.map((reason) => String(reason)).join(" · ")
      : "No recorded reasons";
  }

  function countedLabel(visit) {
    return visit.counted ? "Counted" : "Excluded";
  }

  function cloudflareValue(value) {
    if (value === null || value === undefined) return "Not available";
    return value ? "Yes" : "No";
  }

  function detailEntry(list, label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = formatUnknown(value);
    list.append(term, description);
  }

  function appendDetailsGroup(panel, title, entries) {
    const group = document.createElement("section");
    group.className = "detail-group";
    const heading = document.createElement("h3");
    heading.textContent = title;
    const list = document.createElement("dl");
    list.className = "detail-list";
    for (const entry of entries) detailEntry(list, entry[0], entry[1]);
    group.append(heading, list);
    panel.append(group);
  }

  function uniqueDetailId(visit, index, usedIds) {
    const id = Number(visit.id);
    const base = "visit-details-" + String(Number.isSafeInteger(id) && id > 0 ? id : index + 1);
    let candidate = base;
    let duplicate = 2;
    while (usedIds.has(candidate)) {
      candidate = base + "-" + String(duplicate);
      duplicate += 1;
    }
    usedIds.add(candidate);
    return candidate;
  }

  function detailsRow(visit, index, usedIds) {
    const row = document.createElement("tr");
    row.className = "details-row";
    row.hidden = true;
    const cell = document.createElement("td");
    cell.colSpan = 13;
    const panel = document.createElement("div");
    panel.className = "details-panel";
    panel.setAttribute("id", uniqueDetailId(visit, index, usedIds));

    appendDetailsGroup(panel, "Request", [
      ["Visit ID", visit.id], ["Method", visit.method], ["Host", visit.host],
      ["Path", fullPath(visit)], ["Sanitized referrer", visit.referrer],
      ["Timestamp", formatHongKongTimestamp(visit.visitedAtUtc)], ["Ray ID", visit.cfRay]
    ]);
    appendDetailsGroup(panel, "Network", [
      ["IP address", visit.ipAddress], ["Country", visit.country], ["Region", visit.region],
      ["City", visit.city], ["Continent", visit.continent], ["Timezone", visit.timezone],
      ["ASN", visit.asn === null || visit.asn === undefined ? null : "AS" + String(visit.asn)],
      ["Organization", visit.asOrganization], ["Colo", visit.colo],
      ["HTTP protocol", visit.httpProtocol], ["TLS version", visit.tlsVersion],
      ["TCP RTT", visit.clientTcpRttMs === null || visit.clientTcpRttMs === undefined
        ? null : String(visit.clientTcpRttMs) + " ms"]
    ]);
    appendDetailsGroup(panel, "Client", [
      ["Browser summary", visit.browserSummary], ["Raw User-Agent", visit.userAgent],
      ["Accept-Language", visit.acceptLanguage], ["Sec-Fetch-Site", visit.secFetchSite]
    ]);
    appendDetailsGroup(panel, "Cloudflare signals", [
      ["Bot score", visit.cfBotScore === null || visit.cfBotScore === undefined
        ? "Not available" : visit.cfBotScore],
      ["Verified bot", cloudflareValue(visit.cfVerifiedBot)],
      ["Corporate proxy", cloudflareValue(visit.cfCorporateProxy)]
    ]);
    appendDetailsGroup(panel, "Activity", [
      ["First seen", formatHongKongTimestamp(visit.firstSeenUtc)],
      ["Last seen", formatHongKongTimestamp(visit.lastSeenUtc)],
      ["Retained total", visit.retainedVisitCount], ["Preceding 24-hour total", visit.visitsPreceding24h],
      ["Two-minute total", visit.visitsWithin2m], ["Distinct paths", visit.distinctPathCount]
    ]);
    appendDetailsGroup(panel, "Decision", [
      ["Visitor type", visit.visitorType], ["Risk score", visit.riskScore],
      ["Reasons", reasonText(visit)], ["Counted", countedLabel(visit)],
      ["Classification version", visit.classificationVersion]
    ]);

    cell.append(panel);
    row.append(cell);
    return row;
  }

  function renderRows(items) {
    const body = byId("visit-rows");
    body.replaceChildren();

    if (items.length === 0) {
      const row = document.createElement("tr");
      const cell = tableCell("No visits match these filters.");
      cell.colSpan = 13;
      row.append(cell);
      body.append(row);
      return;
    }

    const usedDetailIds = new Set();
    for (let index = 0; index < items.length; index += 1) {
      const visit = items[index];
      const row = document.createElement("tr");
      const detailRow = detailsRow(visit, index, usedDetailIds);
      const details = document.createElement("button");
      details.className = "details-toggle";
      details.setAttribute("type", "button");
      details.setAttribute("aria-expanded", "false");
      details.setAttribute("aria-controls", detailRow.children[0].children[0].getAttribute("id"));
      details.textContent = "Details";
      details.addEventListener("click", () => {
        const expanded = details.getAttribute("aria-expanded") === "true";
        details.setAttribute("aria-expanded", expanded ? "false" : "true");
        detailRow.hidden = expanded;
      });
      const riskCell = document.createElement("td");
      const riskBadge = document.createElement("span");
      riskBadge.className = riskBadgeClass(visit.riskScore);
      riskBadge.textContent = riskText(visit);
      riskCell.append(riskBadge);
      const detailsCell = document.createElement("td");
      detailsCell.append(details);
      row.append(
        tableCell(formatHongKongTimestamp(visit.visitedAtUtc), "time-cell"),
        tableCell(visit.ipAddress, "ip-cell"),
        tableCell(location(visit)),
        tableCell(network(visit)),
        tableCell(fullPath(visit)),
        tableCell(visit.referrer),
        tableCell(visit.browserSummary),
        tableCell(activity(visit), "activity-cell"),
        tableCell(visit.visitorType, "visitor-type"),
        riskCell,
        tableCell(reasonText(visit), "reasons-cell"),
        tableCell(countedLabel(visit), visit.counted ? "counted" : "excluded"),
        detailsCell
      );
      body.append(row);
      body.append(detailRow);
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
    cell.colSpan = 13;
    row.append(cell);
    byId("visit-rows").append(row);
  }

  async function loadDashboard() {
    byId("error-state").hidden = true;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("bots")) params.set("bots", "exclude");
    if (!params.has("page")) params.set("page", "1");
    const page = pageNumber(params);

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
      renderRows(visits.items);

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
