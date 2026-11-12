import test from "node:test";
import assert from "node:assert/strict";
import { VeridAgentClient } from "../src/index.js";

function stub(response = { ok: true, json: async () => ({ decision: "ALLOW" }) }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return response;
  };
  return { calls, fetchImpl };
}

function agentClient(overrides = {}) {
  const { calls, fetchImpl } = overrides.stub ?? stub();
  return {
    calls,
    agent: new VeridAgentClient({
      baseUrl: "https://api.verid.test/",
      tenantId: "tenant-1",
      accessToken: "test-access-token",
      fetchImpl
    })
  };
}

test("evaluates against the single runtime path that can issue authorization", async () => {
  const { calls, agent } = agentClient();

  const result = await agent.evaluate({
    intentId: "intent-1", agentId: "agent-1", tool: "datadog-billing",
    action: "renew", environment: "development"
  });

  assert.equal(result.decision, "ALLOW");
  // Not /v1/runtime/evaluate. The legacy engine issued no authorization, so an
  // SDK pointed at it could never complete the runtime loop.
  assert.equal(calls[0].url, "https://api.verid.test/v1/runtime/evaluations");
  assert.equal(calls[0].body.tenantId, "tenant-1");
  assert.equal(calls[0].body.schemaVersion, "1.0");
});

test("sends the bearer token on every tenant-scoped call", async () => {
  const { calls, agent } = agentClient();

  await agent.evaluate({ intentId: "intent-1", agentId: "agent-1", tool: "t", action: "a" });

  assert.equal(calls[0].init.headers.authorization, "Bearer test-access-token");
});

test("sends amounts as strings so the hashed scale survives", async () => {
  const { calls, agent } = agentClient();

  await agent.evaluate({
    intentId: "intent-1", agentId: "agent-1", tool: "datadog-billing", action: "renew",
    amount: "13800.00", currency: "USD", counterparty: "datadog"
  });

  const amount = calls[0].body.predicates.find(x => x.type === "amount");
  assert.equal(amount.value, "13800.00");
  assert.equal(typeof amount.value, "string");
  assert.equal(amount.currency, "USD");

  const counterparty = calls[0].body.predicates.find(x => x.type === "counterparty_reference");
  assert.equal(counterparty.value, "datadog");
});

test("omits predicates that were not supplied rather than sending nulls", async () => {
  const { calls, agent } = agentClient();

  await agent.evaluate({ intentId: "intent-1", agentId: "agent-1", tool: "t", action: "a" });

  // An absent amount is not a zero amount: the envelope schema rejects null,
  // and an action with no amount is one the financial constraints skip.
  assert.deepEqual(calls[0].body.predicates, []);
});

test("carries the server's reason into the thrown error", async () => {
  const failing = stub({
    ok: false,
    status: 409,
    text: async () => '{"detail":"Authorization replay detected."}'
  });
  const { agent } = agentClient({ stub: failing });

  await assert.rejects(
    () => agent.evaluate({ intentId: "intent-1", agentId: "agent-1", tool: "t", action: "a" }),
    /409[\s\S]*replay detected/
  );
});
