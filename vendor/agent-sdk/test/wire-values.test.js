import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VeridAgentClient } from '../src/index.js';

test('builders refuse numeric amounts before evaluation or redemption can lose scale', () => {
  const client = new VeridAgentClient({ baseUrl: 'https://api.test', tenantId: 'tenant', fetchImpl: () => { throw new Error('must not send'); } });
  for (const build of ['evaluate', 'envelopeFor']) {
    assert.throws(() => client[build]({ amount: 1200 }), /Amounts must be strings/);
  }
});

test('evaluation and redemption preserve textual amounts and encode counts as wire strings', async () => {
  let sent;
  const client = new VeridAgentClient({ baseUrl: 'https://api.test', tenantId: 'tenant', fetchImpl: async (_, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({}) };
  } });
  const proposal = { amount: '1200.00', currency: 'USD', recordCount: 7 };
  await client.evaluate(proposal);
  assert.deepEqual(sent.predicates, client.envelopeFor(proposal).predicates);
  assert.deepEqual(sent.predicates.map(p => p.value), ['1200.00', '7']);
  assert.throws(() => client.envelopeFor({ recordCount: Number.MAX_SAFE_INTEGER + 1 }), /safe integers/);
});
