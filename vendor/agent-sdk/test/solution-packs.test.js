import test from "node:test";
import assert from "node:assert/strict";
import { VeridClient } from "../src/index.js";

function client() {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return { calls, value: new VeridClient({ baseUrl: "https://api.verid.test", tenantId: "tenant-1", accessToken: "token", fetchImpl }) };
}

test("lists guarded industry solution packs", async () => {
  const { calls, value } = client();
  await value.solutionPacks();
  assert.equal(calls[0].url, "https://api.verid.test/v1/solution-packs?tenantId=tenant-1");
  assert.equal(calls[0].init.headers.authorization, "Bearer token");
});

test("prepares a pack envelope for the canonical runtime", async () => {
  const { calls, value } = client();
  await value.prepareIndustryEnvelope("healthcare", {
    workflow: "clinical-record-access", agentId: "agent-1", environment: "production",
    dataClass: "phi", access: "read", region: "US", recordCount: 1,
    requestedAt: "2026-01-01T00:00:00.000Z"
  });
  assert.equal(calls[0].url, "https://api.verid.test/v1/solution-packs/healthcare/envelopes");
  assert.equal(calls[0].body.tenantId, "tenant-1");
  assert.equal(calls[0].body.dataClass, "phi");
});
