import test from "node:test";
import assert from "node:assert/strict";
import { VeridAuthClient } from "../src/index.js";

test("starts a tenant-bound login transaction", async () => {
  let body;
  const client = new VeridAuthClient({
    baseUrl: "https://api.verid.test",
    tenantId: "tenant-1",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ id: "tx-1" }) };
    }
  });
  const tx = await client.startLogin({
    clientId: "vyr_client",
    redirectUri: "https://app.example/callback",
    state: "0123456789abcdef"
  });
  assert.equal(tx.id, "tx-1");
  assert.equal(body.tenantId, "tenant-1");
});
