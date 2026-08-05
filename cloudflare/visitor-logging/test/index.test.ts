import { SELF } from "cloudflare:test";
import { expect, test } from "vitest";

test("returns 404 for an unknown host", async () => {
  const response = await SELF.fetch("https://unknown.example");

  expect(response.status).toBe(404);
});
