import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutput = resolve(packageRoot, ".private", "wrangler.production.jsonc");
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function d1DatabaseId() {
  const value = requiredEnvironment("CF_D1_DATABASE_ID");
  if (!uuidPattern.test(value)) throw new Error("CF_D1_DATABASE_ID must be a UUID.");
  return value;
}

function teamDomain() {
  const value = requiredEnvironment("CF_TEAM_DOMAIN");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("CF_TEAM_DOMAIN must be a Cloudflare Access HTTPS URL.");
  }

  const isTeamDomain =
    parsed.protocol === "https:" &&
    parsed.hostname.endsWith(".cloudflareaccess.com") &&
    !parsed.username &&
    !parsed.password &&
    !parsed.port &&
    parsed.pathname === "/" &&
    !parsed.search &&
    !parsed.hash;
  if (!isTeamDomain) {
    throw new Error("CF_TEAM_DOMAIN must be a Cloudflare Access HTTPS URL.");
  }
  return parsed.origin;
}

function productionConfig() {
  const databaseId = d1DatabaseId();
  const accessTeamDomain = teamDomain();
  const accessAudience = requiredEnvironment("CF_POLICY_AUD");

  return {
    $schema: "node_modules/wrangler/config-schema.json",
    name: "lizhe-visitor-logging",
    main: "src/index.ts",
    compatibility_date: "2026-08-06",
    workers_dev: false,
    observability: {
      enabled: true,
      head_sampling_rate: 1
    },
    routes: [
      { pattern: "lizhe.link/*", zone_name: "lizhe.link" },
      { pattern: "www.lizhe.link/*", zone_name: "lizhe.link" },
      { pattern: "logs.lizhe.link", custom_domain: true }
    ],
    d1_databases: [
      {
        binding: "DB",
        database_name: "lizhe-visitor-logging",
        database_id: databaseId
      }
    ],
    vars: {
      PUBLIC_HOSTS: "lizhe.link,www.lizhe.link",
      ADMIN_HOST: "logs.lizhe.link",
      ADMIN_EMAIL: "lizheqlut@gmail.com",
      TEAM_DOMAIN: accessTeamDomain,
      POLICY_AUD: accessAudience
    },
    triggers: {
      crons: ["15 16 * * *"]
    }
  };
}

async function main() {
  const output = process.argv[2] ? resolve(process.argv[2]) : defaultOutput;
  const serializedConfig = `${JSON.stringify(productionConfig(), null, 2)}\n`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serializedConfig, { encoding: "utf8", mode: 0o600 });
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error && error.message.startsWith("CF_")
    ? error.message
    : "Unable to write the production configuration.";
  console.error(message);
  process.exitCode = 1;
}
