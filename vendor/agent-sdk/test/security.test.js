import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  VeridGrantVerifier,
  VeridGrantVerificationError,
  executeWithAuthorization
} from "../src/index.js";

const fixture = JSON.parse(await readFile(
  new URL("./fixtures/signed-grant.json", import.meta.url), "utf8"));

const envelope = {
  agentId: fixture.grant.agentId,
  tool: "datadog",
  action: "renew",
  environment: "development",
  predicates: [
    { type: "amount", currency: "USD", value: "1200.00" },
    { type: "counterparty_reference", value: "datadog" }
  ]
};

function keyFetch({ ephemeral = false } = {}) {
  return async () => ({
    ok: true,
    json: async () => ({ keys: [fixture.jwk], ephemeral })
  });
}

test("verifies a reference-implementation ES256 grant and its exact envelope", async () => {
  const verifier = new VeridGrantVerifier({
    baseUrl: "https://api.verid.test",
    fetchImpl: keyFetch(),
    clock: () => Date.parse(fixture.grant.createdAt)
  });

  const result = await verifier.verify(fixture.grant, {
    tenantId: fixture.grant.tenantId,
    agentId: fixture.grant.agentId,
    intentId: fixture.grant.intentId,
    envelope,
    now: Date.parse(fixture.grant.createdAt)
  });

  assert.equal(result.valid, true);
  assert.equal(result.signingKeyId, fixture.jwk.kid);
});

test("refuses parameter substitution even when the signature itself is valid", async () => {
  const verifier = new VeridGrantVerifier({
    baseUrl: "https://api.verid.test",
    fetchImpl: keyFetch()
  });

  await assert.rejects(
    () => verifier.verify(fixture.grant, {
      envelope: {
        ...envelope,
        predicates: [
          { type: "amount", currency: "USD", value: "9900.00" },
          { type: "counterparty_reference", value: "datadog" }
        ]
      },
      now: Date.parse(fixture.grant.createdAt)
    }),
    error => error instanceof VeridGrantVerificationError &&
      error.code === "action_mismatch"
  );
});

test("rejects ephemeral issuer keys unless development use is explicit", async () => {
  const verifier = new VeridGrantVerifier({
    baseUrl: "https://api.verid.test",
    fetchImpl: keyFetch({ ephemeral: true })
  });

  await assert.rejects(
    () => verifier.verify(fixture.grant, {
      envelope,
      now: Date.parse(fixture.grant.createdAt)
    }),
    error => error.code === "ephemeral_key"
  );
});

test("tool helper verifies then redeems then records execution", async () => {
  const calls = [];
  const client = {
    tenantId: fixture.grant.tenantId,
    consume: async input => calls.push(["consume", input]),
    submitReceipt: async input => calls.push(["receipt", input])
  };
  const verifier = new VeridGrantVerifier({
    baseUrl: "https://api.verid.test",
    fetchImpl: keyFetch(),
    clock: () => Date.parse(fixture.grant.createdAt)
  });

  const result = await executeWithAuthorization({
    client,
    verifier,
    grant: fixture.grant,
    envelope,
    agentId: fixture.grant.agentId,
    execute: async () => {
      calls.push(["execute"]);
      return "done";
    },
    externalReference: "invoice-1",
    evidence: "sha256:evidence"
  });

  assert.equal(result, "done");
  assert.deepEqual(calls.map(([name]) => name), ["consume", "execute", "receipt"]);
  assert.equal(calls[2][1].status, "Succeeded");
  assert.deepEqual(calls[2][1].executed, envelope);
});
