/// <reference types="node" />

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generator = join(packageRoot, "scripts", "render-production-config.mjs");
const defaultOutput = join(packageRoot, ".private", "wrangler.production.jsonc");
const validEnvironment = {
  CF_D1_DATABASE_ID: "123e4567-e89b-42d3-a456-426614174000",
  CF_TEAM_DOMAIN: "https://lizhe.cloudflareaccess.com",
  CF_POLICY_AUD: "visitor-logging-dashboard"
};

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

function runGenerator(
  output: string,
  overrides: Partial<Record<keyof typeof validEnvironment, string | undefined>> = {}
) {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const name of Object.keys(validEnvironment) as Array<keyof typeof validEnvironment>) {
    const value = Object.hasOwn(overrides, name) ? overrides[name] : validEnvironment[name];
    if (value === undefined) delete environment[name];
    else environment[name] = value;
  }

  return spawnSync(process.execPath, [generator, output], {
    cwd: packageRoot,
    encoding: "utf8",
    env: environment
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const invalidCases = [
  ["missing D1 database ID", { CF_D1_DATABASE_ID: undefined }],
  ["malformed D1 database ID", { CF_D1_DATABASE_ID: "not-a-uuid" }],
  ["missing team domain", { CF_TEAM_DOMAIN: undefined }],
  ["non-HTTPS team domain", { CF_TEAM_DOMAIN: "http://team.cloudflareaccess.com" }],
  ["lookalike team domain", { CF_TEAM_DOMAIN: "https://team.cloudflareaccess.com.example.com" }],
  ["team-domain URL with credentials", { CF_TEAM_DOMAIN: "https://user@team.cloudflareaccess.com" }],
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
      database_id: validEnvironment.CF_D1_DATABASE_ID
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
  for (const value of Object.values(validEnvironment)) {
    assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
  }
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
