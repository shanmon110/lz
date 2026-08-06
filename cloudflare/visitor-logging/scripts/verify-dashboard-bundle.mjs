import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const wranglerBin = join(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");

class BundleElement {
  children = [];
  checked = false;
  className = "";
  colSpan = 1;
  hidden = false;
  href = "";
  textContent = "";
  value = "";
  listeners = new Map();

  set innerHTML(_value) {
    throw new Error("Production dashboard asset attempted to write innerHTML");
  }

  append(...elements) {
    this.children.push(...elements);
  }

  replaceChildren(...elements) {
    this.children.splice(0, this.children.length, ...elements);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
}

const dashboardIds = [
  "today-total",
  "today-distinct",
  "seven-days-total",
  "seven-days-distinct",
  "thirty-days-total",
  "thirty-days-distinct",
  "from-filter",
  "to-filter",
  "ip-filter",
  "country-filter",
  "path-filter",
  "bots-filter",
  "filters-form",
  "error-state",
  "retry-button",
  "export-link",
  "visit-rows",
  "previous-page",
  "next-page",
  "page-status"
];

function dashboardDocument() {
  const elements = new Map(dashboardIds.map((id) => [id, new BundleElement()]));
  elements.get("error-state").hidden = true;

  return {
    createElement() {
      return new BundleElement();
    },
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    element(id) {
      const element = elements.get(id);
      assert.ok(element, `Missing production dashboard element ${id}`);
      return element;
    }
  };
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" }
  });
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Production dashboard asset did not finish startup");
}

async function executeDashboardAsset(script) {
  const document = dashboardDocument();
  const requests = [];
  const browserFetch = async (url, init) => {
    requests.push({ url, init });
    if (url === "/api/summary") {
      return jsonResponse({
        today: { totalVisits: 1, distinctNetworkAddresses: 1 },
        sevenDays: { totalVisits: 2, distinctNetworkAddresses: 2 },
        thirtyDays: { totalVisits: 3, distinctNetworkAddresses: 3 }
      });
    }
    return jsonResponse({
      hasNext: false,
      items: [{
        id: 1,
        visitedAtUtc: "2026-08-06T16:30:05.000Z",
        ipAddress: "203.0.113.7",
        method: "GET",
        host: "lizhe.link",
        path: "/production-bundle",
        queryString: "",
        referrer: "",
        userAgent: "Mozilla/5.0",
        browserSummary: "Chrome on macOS",
        country: "HK",
        region: "Hong Kong",
        city: "Hong Kong",
        asn: 13335,
        colo: "HKG",
        cfRay: "bundle-ray",
        isSuspectedBot: false
      }],
      page: 1,
      pageSize: 50
    });
  };
  const window = {
    location: {
      search: "",
      assign() {}
    }
  };

  const execute = new Function("window", "document", "fetch", script);
  execute(window, document, browserFetch);
  await waitFor(() => document.element("visit-rows").children.length === 1);

  assert.deepEqual(
    requests.map(({ url, init }) => ({
      url,
      credentials: init?.credentials
    })),
    [
      { url: "/api/summary", credentials: "same-origin" },
      { url: "/api/visits?bots=exclude&page=1", credentials: "same-origin" }
    ]
  );
  assert.equal(document.element("today-total").textContent, "1");
  assert.equal(
    document.element("visit-rows").children[0].children[0].textContent,
    "2026-08-07 00:30:05 HKT"
  );
}

async function productionDashboardScript(bundlePath, temporaryDirectory) {
  const bundle = await readFile(bundlePath, "utf8");
  const instrumentedPath = join(temporaryDirectory, "instrumented-bundle.mjs");
  await writeFile(
    instrumentedPath,
    `${bundle}\nexport { DASHBOARD_SCRIPT as __dashboardScript };\n`,
    "utf8"
  );
  const instrumented = await import(pathToFileURL(instrumentedPath).href);
  assert.equal(typeof instrumented.__dashboardScript, "string");
  return instrumented.__dashboardScript;
}

async function main() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "visitor-dashboard-bundle-"));
  try {
    const build = spawnSync(
      process.execPath,
      [wranglerBin, "deploy", "--dry-run", "--outdir", temporaryDirectory],
      { cwd: projectRoot, encoding: "utf8" }
    );
    if (build.status !== 0) {
      process.stderr.write(build.stdout);
      process.stderr.write(build.stderr);
      throw new Error(`Wrangler dry-run failed with status ${build.status}`);
    }

    const entryFiles = (await readdir(temporaryDirectory))
      .filter((name) => name.endsWith(".js") && !name.endsWith(".js.map"));
    assert.deepEqual(entryFiles, ["index.js"]);
    const script = await productionDashboardScript(
      join(temporaryDirectory, entryFiles[0]),
      temporaryDirectory
    );
    await executeDashboardAsset(script);
    process.stdout.write("Verified the dashboard asset emitted by Wrangler dry-run.\n");
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await main();
