import test from "node:test";
import assert from "node:assert/strict";
import { VeridProcurementClient } from "../src/index.js";

test("binds the tenant and action when evaluating and consuming authorization", async () => {
  const requests = [];
  const client = new VeridProcurementClient({
    baseUrl: "https://api.verid.test/",
    tenantId: "tenant-1",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, json: async () => ({ status: "ok" }) };
    }
  });
  const proposal = {
    intentId: "intent-1",
    agentId: "agent-1",
    tool: "datadog",
    action: "renew",
    amount: "13800.00",
    currency: "USD",
    counterparty: "datadog"
  };
  const envelope = client.envelopeFor(proposal);

  await client.evaluateAction(proposal);
  await client.validateAuthorization({
    authorizationId: "auth-1",
    agentId: "agent-1",
    envelope
  });

  assert.equal(
    requests[0].url,
    "https://api.verid.test/v1/runtime/evaluations"
  );
  assert.equal(JSON.parse(requests[0].init.body).schemaVersion, "1.0");
  assert.equal(
    requests[1].url,
    "https://api.verid.test/v1/runtime/authorizations/auth-1/consume"
  );
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    tenantId: "tenant-1",
    agentId: "agent-1",
    envelope
  });
});

test("submits tenant-bound execution receipts", async () => {
  let body;
  const client = new VeridProcurementClient({
    baseUrl: "https://api.verid.test",
    tenantId: "tenant-1",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ id: "receipt-1" }) };
    }
  });

  await client.submitExecutionReceipt({
    authorizationId: "auth-1",
    status: "Succeeded",
    externalReference: "datadog-renewal-2026",
    evidence: "invoice-hash"
  });

  assert.deepEqual(body, {
    tenantId: "tenant-1",
    status: "Succeeded",
    externalReference: "datadog-renewal-2026",
    evidence: "invoice-hash"
  });
});

test("fetches the signing statement and submits device proof when signing a contract", async () => {
  // GAP-2026-09-12-03: a contract is activated by the signer's device signing
  // the platform's statement, not by a reference string.
  const requests = [];
  const client = new VeridProcurementClient({
    baseUrl: "https://api.verid.test/",
    tenantId: "tenant-1",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return { ok: true, json: async () => ({ canonical: "statement=verid.contract.sign.v1\n" }) };
    }
  });

  await client.signingStatement("intent 1", "device-1");
  await client.signIntent("intent 1", { deviceId: "device-1", confirmationMethod: "biometric", deviceSignature: "sig" });

  assert.equal(requests[0].url,
    "https://api.verid.test/v1/intents/intent%201/signing-statement?tenantId=tenant-1&deviceId=device-1");
  assert.equal(requests[1].url, "https://api.verid.test/v1/intents/intent%201/sign");
  assert.deepEqual(JSON.parse(requests[1].init.body),
    { deviceId: "device-1", confirmationMethod: "biometric", deviceSignature: "sig", tenantId: "tenant-1" });
});

/// US-K004. The approval now names the grant it issued, so an agent that
/// escalated can collect it instead of guessing which authorization was its own.
test("waits for a decision and fetches the authorization the approval names", async () => {
  const urls = [];
  let polls = 0;
  const client = new VeridProcurementClient({
    baseUrl: "https://api.verid.test/",
    tenantId: "tenant-1",
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes("/approvals/")) {
        // Pending once, so the wait loop is actually exercised.
        return polls++ === 0
          ? { ok: true, json: async () => ({ status: "Pending" }) }
          : { ok: true, json: async () => ({ status: "Approved", authorizationId: "grant-7" }) };
      }
      return { ok: true, json: async () => ({ id: "grant-7", consumed: false }) };
    }
  });

  const grant = await client.waitForAuthorization("approval-1", { intervalMs: 1 });

  assert.equal(grant.id, "grant-7");
  assert.equal(
    urls.at(-1),
    "https://api.verid.test/v1/runtime/authorizations/grant-7?tenantId=tenant-1"
  );
});

test("a refused approval raises rather than returning a grant that was never issued", async () => {
  const client = new VeridProcurementClient({
    baseUrl: "https://api.verid.test/",
    tenantId: "tenant-1",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ status: "Denied", decisionReason: "Too much" })
    })
  });

  await assert.rejects(
    () => client.waitForAuthorization("approval-1", { intervalMs: 1 }),
    (error) => {
      assert.match(error.message, /Denied/);
      // The approval rides along, so a caller can read the reason without a
      // second round trip.
      assert.equal(error.approval.decisionReason, "Too much");
      return true;
    }
  );
});

test("an approval that names no authorization says so instead of guessing", async () => {
  const client = new VeridProcurementClient({
    baseUrl: "https://api.verid.test/",
    tenantId: "tenant-1",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ status: "Approved" })
    })
  });

  await assert.rejects(
    () => client.waitForAuthorization("approval-1", { intervalMs: 1 }),
    /names no authorization/
  );
});
