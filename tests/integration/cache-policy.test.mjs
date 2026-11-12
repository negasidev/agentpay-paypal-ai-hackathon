import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../../next.config.mjs';

test('private API cache policy covers successful and refused responses at the routing boundary', async () => {
  const policies = await config.headers();
  const api = policies.find(rule => rule.source === '/api/:path*');
  assert.ok(api, 'all private API routes require a routing-level policy');
  const headers = new Headers(api.headers.map(({key,value})=>[key,value]));
  assert.match(headers.get('cache-control'), /\bprivate\b/);
  assert.match(headers.get('cache-control'), /\bno-store\b/);
  assert.match(headers.get('vary'), /\bCookie\b/);
});
