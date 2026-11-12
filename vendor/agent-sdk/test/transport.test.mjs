import test from 'node:test';
import assert from 'node:assert/strict';
import {VeridAgentClient} from '../src/index.js';
import {VeridGrantVerifier} from '../src/security.js';

test('API and key discovery refuse cleartext and credential-bearing URLs', () => {
  for (const baseUrl of ['http://localhost:5130', 'https://user:secret@example.test', 'https://example.test/?token=secret']) {
    assert.throws(() => new VeridAgentClient({baseUrl, tenantId: 'tenant'}));
    assert.throws(() => new VeridGrantVerifier({baseUrl}));
  }
});
test('explicit development HTTP still has a deadline and refuses redirects', async () => {
  let seen;
  const client = new VeridAgentClient({baseUrl: 'http://localhost:5130', tenantId: 'tenant', allowInsecureHttp: true,
    fetchImpl: async (url, options) => {seen = options; return Response.json({decision: 'DENY'});}});
  await client.evaluate({agentId: 'agent', intentId: 'intent', tool: 'tool', action: 'read'});
  assert.equal(seen.redirect, 'error');
  assert.ok(seen.signal instanceof AbortSignal);
  assert.equal(seen.signal.aborted, false);
});
