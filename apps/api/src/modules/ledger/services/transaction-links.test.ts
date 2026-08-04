import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_LINKS_PER_TX } from "./transaction-links.ts";

test("MAX_LINKS_PER_TX is set to 20", () => {
  assert.equal(MAX_LINKS_PER_TX, 20);
});

test("transaction-links service exports the expected functions", async () => {
  const mod = await import("./transaction-links.ts");
  assert.ok(typeof mod.listLinks === "function");
  assert.ok(typeof mod.addLink === "function");
  assert.ok(typeof mod.deleteLink === "function");
});
