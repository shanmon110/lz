import { env } from "cloudflare:test";
import { beforeEach, expect, test } from "vitest";

const intelligenceColumns = [
  "as_organization",
  "continent",
  "timezone",
  "http_protocol",
  "tls_version",
  "client_tcp_rtt_ms",
  "accept_language",
  "sec_fetch_site",
  "cf_bot_score",
  "cf_verified_bot",
  "cf_corporate_proxy"
];

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM visits").run();
});

test("additive intelligence migration preserves legacy rows and creates the activity index", async () => {
  const table = await env.DB.prepare("PRAGMA table_info(visits)").all<{ name: string; notnull: number }>();
  const columns = new Map(table.results.map((column) => [column.name, column]));

  for (const name of intelligenceColumns) {
    expect(columns.get(name)).toMatchObject({ name, notnull: 0 });
  }

  const indexes = await env.DB.prepare("PRAGMA index_list(visits)").all<{ name: string }>();
  expect(indexes.results.map((index) => index.name)).toContain("visits_ip_address_visited_at_utc_idx");

  const indexColumns = await env.DB
    .prepare("PRAGMA index_info(visits_ip_address_visited_at_utc_idx)")
    .all<{ seqno: number; name: string }>();
  expect(indexColumns.results.sort((left, right) => left.seqno - right.seqno).map((column) => column.name)).toEqual([
    "ip_address",
    "visited_at_utc"
  ]);

  await env.DB.prepare(
    "INSERT INTO visits (visited_at_utc, ip_address, method, host, path) VALUES (?, ?, ?, ?, ?)"
  )
    .bind("2026-08-25T00:00:00.000Z", "203.0.113.31", "GET", "lizhe.link", "/")
    .run();

  const legacyRow = await env.DB.prepare(
    `SELECT ${intelligenceColumns.join(", ")} FROM visits WHERE ip_address = ?`
  )
    .bind("203.0.113.31")
    .first<Record<string, unknown>>();

  expect(legacyRow).toEqual(Object.fromEntries(intelligenceColumns.map((name) => [name, null])));
});

test.each([
  [0, 1, 0, 1],
  [600_000, 99, null, null]
])("accepts valid intelligence CHECK boundaries", async (
  clientTcpRttMs,
  cfBotScore,
  cfVerifiedBot,
  cfCorporateProxy
) => {
  await expect(env.DB.prepare(
    `INSERT INTO visits (
      visited_at_utc, ip_address, method, host, path,
      client_tcp_rtt_ms, cf_bot_score, cf_verified_bot, cf_corporate_proxy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    "2026-08-25T00:00:00.000Z",
    `192.0.2.${clientTcpRttMs === 0 ? 41 : 42}`,
    "GET",
    "lizhe.link",
    "/",
    clientTcpRttMs,
    cfBotScore,
    cfVerifiedBot,
    cfCorporateProxy
  ).run()).resolves.toMatchObject({ success: true });
});

test.each([
  ["RTT below minimum", "client_tcp_rtt_ms", -1],
  ["RTT above maximum", "client_tcp_rtt_ms", 600_001],
  ["bot score below minimum", "cf_bot_score", 0],
  ["bot score above maximum", "cf_bot_score", 100],
  ["verified-bot outside nullable boolean", "cf_verified_bot", 2],
  ["corporate-proxy outside nullable boolean", "cf_corporate_proxy", 2]
])("rejects %s", async (_label, column, value) => {
  await expect(env.DB.prepare(
    `INSERT INTO visits (visited_at_utc, ip_address, method, host, path, ${column})
      VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    "2026-08-25T00:00:00.000Z",
    "192.0.2.43",
    "GET",
    "lizhe.link",
    "/",
    value
  ).run()).rejects.toThrow(/CHECK constraint failed/);
});
