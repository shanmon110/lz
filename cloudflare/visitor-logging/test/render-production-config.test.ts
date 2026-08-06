/// <reference types="node" />

import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = join(packageRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const defaultOutput = join(packageRoot, ".private", "wrangler.production.jsonc");
const validEnvironment = {
  CF_D1_DATABASE_ID: "123e4567-e89b-42d3-a456-426614174000",
  CF_TEAM_DOMAIN: "https://lizhe.cloudflareaccess.com",
  CF_POLICY_AUD: "visitor-logging-dashboard"
};
const skillsCacheFixture = JSON.stringify({ lastUpdate: Date.now(), skillNames: [] });

const temporaryDirectories: string[] = [];

function temporaryOutput(): string {
  const directory = mkdtempSync(join(tmpdir(), "visitor-logging-config-"));
  temporaryDirectories.push(directory);
  return join(directory, "nested", "wrangler.production.jsonc");
}

function metadata(path: string): { size: number; mtimeMs: number } | undefined {
  try {
    const stats = statSync(path);
    return { size: stats.size, mtimeMs: stats.mtimeMs };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function inventory(root: string, current = root): string[] {
  if (!existsSync(current)) return [];
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    const name = `${relative(root, path)}${entry.isDirectory() ? "/" : ""}`;
    return entry.isDirectory() ? [name, ...inventory(root, path)] : [name];
  });
}

function runGenerator(
  output?: string,
  overrides: Partial<Record<keyof typeof validEnvironment, string | undefined>> = {},
  projectRoot = packageRoot
) {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(validEnvironment) as Array<keyof typeof validEnvironment>) {
    const value = Object.hasOwn(overrides, name) ? overrides[name] : validEnvironment[name];
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }

  return spawnSync(
    process.execPath,
    [join(projectRoot, "scripts", "render-production-config.mjs"), ...(output ? [output] : [])],
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: environment
    }
  );
}

function isolatedProject(): string {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "visitor-logging-project-"));
  temporaryDirectories.push(temporaryDirectory);
  const projectRoot = join(temporaryDirectory, "project");
  const excludedTopLevelEntries = new Set([".private", ".wrangler", "dist", "node_modules"]);

  cpSync(packageRoot, projectRoot, {
    recursive: true,
    filter(source) {
      const pathFromRoot = relative(packageRoot, source);
      const topLevelEntry = pathFromRoot.split(sep)[0];
      return !excludedTopLevelEntries.has(topLevelEntry);
    }
  });
  symlinkSync(
    join(packageRoot, "node_modules"),
    join(projectRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir"
  );
  return projectRoot;
}

function runWrangler(
  projectRoot: string,
  args: string[],
  inheritedEnvironment: NodeJS.ProcessEnv = process.env
) {
  const environment = { ...inheritedEnvironment };
  const profileRoot = join(projectRoot, ".wrangler-test-profile");
  const xdgConfigHome = join(profileRoot, "xdg-config");
  const wranglerConfig = join(xdgConfigHome, ".wrangler");
  const temp = join(profileRoot, "tmp");
  mkdirSync(wranglerConfig, { recursive: true });
  mkdirSync(temp, { recursive: true });
  writeFileSync(
    join(wranglerConfig, "cloudflare-skills-repo-cache.json"),
    skillsCacheFixture,
    "utf8"
  );

  delete environment.CLOUDFLARE_API_TOKEN;
  delete environment.CLOUDFLARE_ACCOUNT_ID;
  environment.HOME = join(profileRoot, "home");
  environment.USERPROFILE = join(profileRoot, "user-profile");
  environment.XDG_CONFIG_HOME = xdgConfigHome;
  environment.XDG_CACHE_HOME = join(profileRoot, "xdg-cache");
  environment.APPDATA = join(profileRoot, "app-data");
  environment.LOCALAPPDATA = join(profileRoot, "local-app-data");
  environment.TMPDIR = temp;
  environment.TEMP = temp;
  environment.TMP = temp;
  environment.CI = "true";
  environment.NO_COLOR = "1";
  environment.WRANGLER_CACHE_DIR = join(profileRoot, "wrangler-cache");
  environment.WRANGLER_LOG_PATH = join(profileRoot, "logs");
  environment.WRANGLER_SEND_ERROR_REPORTS = "false";
  environment.WRANGLER_SEND_METRICS = "false";
  return spawnSync(process.execPath, [wranglerCli, "--install-skills=false", ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: environment
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
    assert.equal(existsSync(directory), false, `temporary directory was not removed: ${directory}`);
  }
});

const invalidCases = [
  ["missing D1 database ID", { CF_D1_DATABASE_ID: undefined }],
  ["malformed D1 database ID", { CF_D1_DATABASE_ID: "not-a-uuid" }],
  ["missing team domain", { CF_TEAM_DOMAIN: undefined }],
  ["non-HTTPS team domain", { CF_TEAM_DOMAIN: "http://team.cloudflareaccess.com" }],
  ["lookalike team domain", { CF_TEAM_DOMAIN: "https://team.cloudflareaccess.com.example.com" }],
  ["team-domain URL with credentials", { CF_TEAM_DOMAIN: "https://user@team.cloudflareaccess.com" }],
  ["team-domain URL with a port", { CF_TEAM_DOMAIN: "https://team.cloudflareaccess.com:443" }],
  ["team-domain URL with a path", { CF_TEAM_DOMAIN: "https://team.cloudflareaccess.com/cdn-cgi" }],
  ["team-domain URL with a query", { CF_TEAM_DOMAIN: "https://team.cloudflareaccess.com?x=1" }],
  ["team-domain URL with a fragment", { CF_TEAM_DOMAIN: "https://team.cloudflareaccess.com#x" }],
  ["empty team label", { CF_TEAM_DOMAIN: "https://.cloudflareaccess.com" }],
  ["double-label separator", { CF_TEAM_DOMAIN: "https://evil..cloudflareaccess.com" }],
  ["extra team label", { CF_TEAM_DOMAIN: "https://evil.team.cloudflareaccess.com" }],
  ["noncanonical HTTPS syntax", { CF_TEAM_DOMAIN: "https:team.cloudflareaccess.com" }],
  ["empty query marker", { CF_TEAM_DOMAIN: "https://team.cloudflareaccess.com?" }],
  ["leading-hyphen team label", { CF_TEAM_DOMAIN: "https://-team.cloudflareaccess.com" }],
  ["trailing-hyphen team label", { CF_TEAM_DOMAIN: "https://team-.cloudflareaccess.com" }],
  ["underscore team label", { CF_TEAM_DOMAIN: "https://team_name.cloudflareaccess.com" }],
  ["overlong team label", { CF_TEAM_DOMAIN: `https://${"a".repeat(64)}.cloudflareaccess.com` }],
  ["leading whitespace", { CF_TEAM_DOMAIN: " https://team.cloudflareaccess.com" }],
  ["trailing control character", { CF_TEAM_DOMAIN: "https://team.cloudflareaccess.com\n" }],
  ["missing Access audience", { CF_POLICY_AUD: undefined }],
  ["blank Access audience", { CF_POLICY_AUD: "   " }]
] as const;

for (const [label, overrides] of invalidCases) {
  test(`rejects a ${label} without logging its value`, () => {
    const output = temporaryOutput();
    const result = runGenerator(output, overrides);

    assert.notEqual(result.status, 0);
    assert.equal(metadata(output), undefined);
    for (const value of Object.values(overrides)) {
      if (value?.trim()) assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
    }
  });
}

test("writes strict JSON with the production route, binding, vars, and cron contract", () => {
  const output = temporaryOutput();
  const result = runGenerator(output);

  assert.equal(result.status, 0, result.stderr);
  const rawConfig = readFileSync(output, "utf8");
  const config = JSON.parse(rawConfig);

  assert.deepEqual(config.routes, [
    { pattern: "lizhe.link/*", zone_name: "lizhe.link" },
    { pattern: "www.lizhe.link/*", zone_name: "lizhe.link" },
    { pattern: "logs.lizhe.link", custom_domain: true }
  ]);
  assert.deepEqual(config.d1_databases, [
    {
      binding: "DB",
      database_name: "lizhe-visitor-logging",
      database_id: validEnvironment.CF_D1_DATABASE_ID,
      migrations_dir: relative(dirname(output), join(packageRoot, "migrations"))
        .split(sep)
        .join("/")
    }
  ]);
  assert.deepEqual(config.vars, {
    PUBLIC_HOSTS: "lizhe.link,www.lizhe.link",
    ADMIN_HOST: "logs.lizhe.link",
    ADMIN_EMAIL: "lizheqlut@gmail.com",
    TEAM_DOMAIN: validEnvironment.CF_TEAM_DOMAIN,
    POLICY_AUD: validEnvironment.CF_POLICY_AUD
  });
  assert.deepEqual(config.triggers, { crons: ["15 16 * * *"] });
  assert.equal(resolve(dirname(output), config.main), join(packageRoot, "src", "index.ts"));
  assert.equal(
    resolve(dirname(output), config.$schema),
    join(packageRoot, "node_modules", "wrangler", "config-schema.json")
  );
  assert.equal(
    resolve(dirname(output), config.d1_databases[0].migrations_dir),
    join(packageRoot, "migrations")
  );
  for (const value of Object.values(validEnvironment)) {
    assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
  }
});

test("normalizes one trailing slash on a canonical team domain", () => {
  const output = temporaryOutput();
  const result = runGenerator(output, {
    CF_TEAM_DOMAIN: "https://team.cloudflareaccess.com/"
  });

  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(readFileSync(output, "utf8"));
  assert.equal(config.vars.TEAM_DOMAIN, "https://team.cloudflareaccess.com");
});

test("the default private config passes a real Wrangler deploy dry-run", () => {
  const projectRoot = isolatedProject();
  const generation = runGenerator(undefined, {}, projectRoot);
  assert.equal(generation.status, 0, generation.stderr);

  const dryRun = runWrangler(projectRoot, [
    "deploy",
    "--dry-run",
    "--outdir",
    join(projectRoot, ".wrangler-dry-run"),
    "--config",
    ".private/wrangler.production.jsonc"
  ]);

  assert.equal(dryRun.status, 0, `${dryRun.stdout}${dryRun.stderr}`);
});

test("the default private config exposes repository migrations to local Wrangler", () => {
  const projectRoot = isolatedProject();
  const generation = runGenerator(undefined, {}, projectRoot);
  assert.equal(generation.status, 0, generation.stderr);

  const migrationList = runWrangler(projectRoot, [
    "d1",
    "migrations",
    "list",
    "DB",
    "--local",
    "--persist-to",
    join(projectRoot, ".wrangler-local-state"),
    "--config",
    ".private/wrangler.production.jsonc"
  ]);

  assert.equal(migrationList.status, 0, `${migrationList.stdout}${migrationList.stderr}`);
  assert.match(`${migrationList.stdout}${migrationList.stderr}`, /0001_create_visits\.sql/);
});

test("real Wrangler checks stay inside their owned tree and work without network", () => {
  const projectRoot = isolatedProject();
  const sentinelRoot = join(dirname(projectRoot), "sentinel-profile");
  const inheritedProfile = {
    HOME: join(sentinelRoot, "home"),
    USERPROFILE: join(sentinelRoot, "user-profile"),
    XDG_CONFIG_HOME: join(sentinelRoot, "xdg-config"),
    XDG_CACHE_HOME: join(sentinelRoot, "xdg-cache"),
    APPDATA: join(sentinelRoot, "app-data"),
    LOCALAPPDATA: join(sentinelRoot, "local-app-data"),
    WRANGLER_CACHE_DIR: join(sentinelRoot, "wrangler-cache"),
    CODEX_THREAD_ID: "offline-hermeticity-sentinel",
    CLOUDFLARE_API_BASE_URL: "http://127.0.0.1:1",
    HTTP_PROXY: "http://127.0.0.1:1",
    HTTPS_PROXY: "http://127.0.0.1:1",
    ALL_PROXY: "http://127.0.0.1:1",
    NO_PROXY: "",
    http_proxy: "http://127.0.0.1:1",
    https_proxy: "http://127.0.0.1:1",
    all_proxy: "http://127.0.0.1:1",
    no_proxy: "",
    NODE_USE_ENV_PROXY: "1"
  };
  const sentinelEnvironment = { ...process.env, ...inheritedProfile };
  const generation = runGenerator(undefined, {}, projectRoot);
  assert.equal(generation.status, 0, generation.stderr);
  const dryRun = runWrangler(
    projectRoot,
    [
      "deploy",
      "--dry-run",
      "--outdir",
      join(projectRoot, ".wrangler-offline-dry-run"),
      "--config",
      ".private/wrangler.production.jsonc"
    ],
    sentinelEnvironment
  );
  const skillsCachePath = join(
    projectRoot,
    ".wrangler-test-profile",
    "xdg-config",
    ".wrangler",
    "cloudflare-skills-repo-cache.json"
  );
  assert.equal(readFileSync(skillsCachePath, "utf8"), skillsCacheFixture);
  const migrationList = runWrangler(
    projectRoot,
    [
      "d1",
      "migrations",
      "list",
      "DB",
      "--local",
      "--persist-to",
      join(projectRoot, ".wrangler-offline-local-state"),
      "--config",
      ".private/wrangler.production.jsonc"
    ],
    sentinelEnvironment
  );

  assert.equal(dryRun.status, 0, `${dryRun.stdout}${dryRun.stderr}`);
  assert.equal(migrationList.status, 0, `${migrationList.stdout}${migrationList.stderr}`);
  assert.match(`${migrationList.stdout}${migrationList.stderr}`, /0001_create_visits\.sql/);
  assert.equal(readFileSync(skillsCachePath, "utf8"), skillsCacheFixture);
  assert.deepEqual(inventory(sentinelRoot), []);
  const ownedProfileInventory = inventory(join(projectRoot, ".wrangler-test-profile"));
  assert.ok(
    ownedProfileInventory.some((path) => path.endsWith("cloudflare-skills-repo-cache.json")),
    "the owned profile must contain the local skills cache fixture"
  );
  assert.ok(
    ownedProfileInventory.some((path) => path.endsWith("metrics.json")),
    "Wrangler metrics state must stay inside the owned profile"
  );
});

test("an explicit output path leaves the default private config untouched", () => {
  const before = metadata(defaultOutput);
  const result = runGenerator(temporaryOutput());

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(metadata(defaultOutput), before);
});

test("production package commands always use the private configuration", () => {
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["config:production"], "node scripts/render-production-config.mjs");
  assert.match(packageJson.scripts["test:watch"], /--exclude test\/render-production-config\.test\.ts/);
  assert.match(packageJson.scripts.deploy, /--config \.private\/wrangler\.production\.jsonc/);
  assert.match(packageJson.scripts["d1:migrate:remote"], /--config \.private\/wrangler\.production\.jsonc/);
  assert.match(
    readFileSync(resolve(packageRoot, "..", "..", ".gitignore"), "utf8"),
    /^\/cloudflare\/visitor-logging\/\.private\/$/m
  );
});

test("deployment documentation gives authenticated commands and the safe rollback order", () => {
  const deploymentPath = join(packageRoot, "DEPLOYMENT.md");
  assert.equal(existsSync(deploymentPath), true, "DEPLOYMENT.md must exist");
  const deployment = readFileSync(deploymentPath, "utf8");

  for (const command of [
    "npx wrangler login",
    "npx wrangler whoami",
    "npm run config:production",
    "npm run d1:migrate:remote",
    "npm run deploy",
    "npx wrangler delete lizhe-visitor-logging --config .private/wrangler.production.jsonc"
  ]) {
    assert.equal(deployment.includes(command), true, `missing command: ${command}`);
  }

  const rollbackSteps = [
    "Remove the Worker routes first",
    "Keep DNS proxied initially",
    "Restore nameservers only if needed",
    "Retain D1"
  ];
  let previousIndex = -1;
  for (const step of rollbackSteps) {
    const index = deployment.indexOf(step);
    assert.ok(index > previousIndex, `missing or out-of-order rollback step: ${step}`);
    previousIndex = index;
  }
});
