import { createExecutionContext, env } from "cloudflare:test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import worker from "../src/index";
import type { Env } from "../src/env";

const SCHEDULED_TIME = Date.parse("2040-06-01T12:00:00.000Z");

function controller(scheduledTime = SCHEDULED_TIME): ScheduledController {
  return {
    scheduledTime,
    cron: "0 0 * * *",
    noRetry() {}
  } as ScheduledController;
}

function workerEnv(DB: D1Database): Env {
  return {
    DB,
    PUBLIC_HOSTS: "lizhe.link,www.lizhe.link",
    ADMIN_HOST: "logs.lizhe.link",
    ADMIN_EMAIL: "lizheqlut@gmail.com",
    TEAM_DOMAIN: "https://lizhe.cloudflareaccess.com",
    POLICY_AUD: "visitor-logging-dashboard"
  };
}

async function runScheduled(DB: D1Database, scheduledTime = SCHEDULED_TIME): Promise<void> {
  const scheduled = (worker as ExportedHandler<Env>).scheduled;
  if (!scheduled) {
    throw new Error("scheduled handler is absent");
  }

  await scheduled(controller(scheduledTime), workerEnv(DB), createExecutionContext());
}

async function insertVisit(visitedAtUtc: string, ipAddress: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO visits (visited_at_utc, ip_address, method, host, path) VALUES (?, ?, 'GET', 'lizhe.link', '/')"
  )
    .bind(visitedAtUtc, ipAddress)
    .run();
}

async function storedVisitTimes(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT visited_at_utc FROM visits ORDER BY visited_at_utc"
  ).all<{ visited_at_utc: string }>();

  return results.map((row) => row.visited_at_utc);
}

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM visits").run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("scheduled cleanup deletes only visits strictly older than 90 days using the scheduled time", async () => {
  await insertVisit("2040-03-02T12:00:00.000Z", "203.0.113.91");
  await insertVisit("2040-03-03T12:00:00.000Z", "203.0.113.90");
  await insertVisit("2040-06-01T12:00:00.000Z", "203.0.113.1");

  await runScheduled(env.DB);

  expect(await storedVisitTimes()).toEqual([
    "2040-03-03T12:00:00.000Z",
    "2040-06-01T12:00:00.000Z"
  ]);

  await runScheduled(env.DB);
  expect(await storedVisitTimes()).toEqual([
    "2040-03-03T12:00:00.000Z",
    "2040-06-01T12:00:00.000Z"
  ]);
});

test("scheduled cleanup logs only its fixed category and exception name before failing", async () => {
  const failure = new Error(
    "DELETE FROM visits exposed 203.0.113.91 and sensitive row contents"
  );
  failure.name = "D1Error";
  const failingDb = {
    prepare(): D1PreparedStatement {
      throw failure;
    }
  } as unknown as D1Database;
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

  await expect(runScheduled(failingDb)).rejects.toBe(failure);
  expect(consoleError.mock.calls).toEqual([
    ["visitor_retention_cleanup_failed", "D1Error"]
  ]);
});
