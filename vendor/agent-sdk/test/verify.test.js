import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalGrant, verifyGrant, fetchGrantKeys } from '../src/verify.js';

/// Cross-language conformance.
///
/// The fixture is a grant signed by the .NET reference implementation, frozen
/// with the key that verifies it. A JavaScript test that signs and verifies with
/// its own code proves only that it agrees with itself; this proves the two
/// implementations agree on the bytes.
///
/// It has already earned its place: the first fixture showed the reference
/// canonical form escaping a plus sign into six characters, which no other
/// runtime would have produced. Nothing else in either repository could have
/// caught that, because both sides of the signature were the same runtime.
const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/signed-grant.json', import.meta.url)), 'utf8'));

const { grant, jwk } = fixture;
// The fixture is dated; verifying "now" would start failing when it expires.
const beforeExpiry = new Date(new Date(grant.expiresAt).getTime() - 1000);

test('rebuilds the exact bytes the reference implementation signed', () => {
  assert.equal(canonicalGrant(grant), fixture.canonical);
});

test('verifies a grant signed by the reference implementation', async () => {
  const result = await verifyGrant(grant, jwk, { now: beforeExpiry });
  assert.deepEqual(result, { ok: true, reason: 'verified' });
});

test('refuses a grant whose parameters were changed after signing', async () => {
  for (const [field, value] of Object.entries({
    actionHash: 'a'.repeat(64),
    agentId: '00000000-0000-0000-0000-000000000000',
    intentVersion: grant.intentVersion + 1,
    id: '00000000-0000-0000-0000-000000000000',
  })) {
    const tampered = { ...grant, [field]: value };
    const result = await verifyGrant(tampered, jwk, { now: beforeExpiry });

    assert.equal(result.ok, false, field);
    assert.equal(result.reason, 'bad-signature', field);
  }
});

test('extending the expiry does not extend the grant', async () => {
  // The most tempting single-field edit: the grant is otherwise genuine.
  const extended = {
    ...grant,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };

  assert.equal((await verifyGrant(extended, jwk)).reason, 'bad-signature');
});

test('refuses a grant signed by a different key', async () => {
  // Same shape, different curve point.
  const other = { ...jwk, x: jwk.y, y: jwk.x };

  const result = await verifyGrant(grant, other, { now: beforeExpiry });
  assert.equal(result.ok, false);
  assert.ok(['bad-signature', 'malformed'].includes(result.reason));
});

test('reports expiry separately from forgery', async () => {
  // A genuine signature and a passed deadline is an operational problem. A bad
  // signature is an attack. Collapsing both into false loses that distinction.
  const afterExpiry = new Date(new Date(grant.expiresAt).getTime() + 1000);

  assert.equal((await verifyGrant(grant, jwk, { now: afterExpiry })).reason, 'expired');
});

test('refuses a consumed or revoked grant even though the signature holds', async () => {
  // The signature deliberately does not cover this state, because signing it
  // would invalidate the grant the moment it was redeemed. A tool must still
  // refuse to act on one.
  assert.equal(
    (await verifyGrant({ ...grant, consumed: true }, jwk, { now: beforeExpiry })).reason,
    'consumed');
  assert.equal(
    (await verifyGrant({ ...grant, revoked: true }, jwk, { now: beforeExpiry })).reason,
    'revoked');
});

test('refuses an unsigned grant and a missing key', async () => {
  assert.equal((await verifyGrant({ ...grant, signature: undefined }, jwk)).reason, 'unsigned');
  assert.equal((await verifyGrant(grant, {})).reason, 'no-key');
});

test('a malformed signature is refused, not thrown', async () => {
  // A verifier that throws is one a caller might catch into an allow.
  const result = await verifyGrant({ ...grant, signature: 'not-base64url!!!' }, jwk,
    { now: beforeExpiry });

  assert.equal(result.ok, false);
  assert.ok(['malformed', 'bad-signature'].includes(result.reason));
});

test('a key rotation is reported rather than guessed at', async () => {
  const rotated = { ...jwk, kid: 'some-other-key' };

  assert.equal((await verifyGrant(grant, rotated, { now: beforeExpiry })).reason, 'key-mismatch');
});

test('fetching the key set surfaces whether the key is ephemeral', async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ keys: [jwk], ephemeral: true }),
  });

  const result = await fetchGrantKeys('https://api.verid.test/', { fetchImpl });

  // A tool caching an ephemeral key is caching something that stops existing on
  // the next restart, and should refuse to rely on it in production.
  assert.equal(result.ephemeral, true);
  assert.equal(result.keys[0].kid, jwk.kid);
});
