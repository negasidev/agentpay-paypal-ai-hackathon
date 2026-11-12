import test from "node:test";
import assert from "node:assert/strict";
import { VeridClient, VeridIntent, VeridIntentGuard } from "../src/index.js";

test("exports the locked Verid SDK client names", () => {
  const options = {
    baseUrl: "https://api.verid.com",
    tenantId: "tenant-1",
    fetchImpl: async () => ({ ok: true, json: async () => ({}) })
  };
  assert.ok(new VeridClient(options));
  assert.ok(new VeridIntentGuard(options));
  assert.equal(new VeridIntent({ id: "intent-1" }).id, "intent-1");
});
