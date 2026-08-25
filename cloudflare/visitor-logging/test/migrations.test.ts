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
