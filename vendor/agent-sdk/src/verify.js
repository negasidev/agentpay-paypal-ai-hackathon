// Tool-side grant verification.
//
// This is the half of the runtime loop that runs on the other side of the
// trust boundary. Everything else in this SDK asks Verid whether an action is
// permitted; this decides whether to believe the answer, using only a public
// key fetched once. A tool that calls back to the issuer to check a grant has
// gained nothing over an unsigned one.
//
// The rule a tool needs, and the reason it cannot be softened: execute only if
// verify() returns ok. A grant that fails any check is not a grant.

import { webcrypto } from 'node:crypto';

const { subtle } = webcrypto;

/// Rebuilds exactly the bytes the issuer signed.
///
/// Hand-built, in Unicode code point key order, with no serializer involved.
/// JSON.stringify would happen to agree today and is not contractually obliged
/// to tomorrow, and a canonical form that depends on a runtime's escaping
/// choices is not canonical - the reference implementation shipped that bug and
/// an interop fixture is what caught it.
export function canonicalGrant(grant) {
  const quote = (value) =>
    `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

  // RFC 3339, UTC, Z, millisecond precision. The issuer normalises to this, so
  // a grant whose JSON carries an offset or extra precision still verifies.
  const expiresAt = new Date(grant.expiresAt).toISOString().replace(/\.(\d{3})\d*Z$/, '.$1Z');

  return '{' + [
    ['action_hash', grant.actionHash],
    ['agent_id', grant.agentId],
    ['expires_at', expiresAt],
    ['grant_id', grant.id],
    ['intent_id', grant.intentId],
    ['intent_version', String(grant.intentVersion)],
    ['single_use', 'true'],
    ['tenant_id', grant.tenantId],
  ].map(([key, value]) => `"${key}":${quote(value)}`).join(',') + '}';
}

const base64UrlToBytes = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
};

async function importKey(jwk) {
  return subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

/// Verifies a grant and reports why it failed.
///
/// Returns { ok, reason }. A boolean would force the caller to guess between an
/// expired grant, a forged one, and a misconfigured key - three situations that
/// need three different responses from an operator.
///
/// Checks the signature first. An expired grant with a bad signature is a
/// forgery, and reporting it as merely expired would hide that.
export async function verifyGrant(grant, jwk, { now = new Date() } = {}) {
  if (!grant?.signature) return { ok: false, reason: 'unsigned' };
  if (!jwk?.x || !jwk?.y) return { ok: false, reason: 'no-key' };
  if (jwk.kid && grant.signingKeyId && jwk.kid !== grant.signingKeyId) {
    // Fetch the key set again rather than guessing: this is what a rotation
    // looks like from the outside.
    return { ok: false, reason: 'key-mismatch' };
  }

  let verified = false;
  try {
    verified = await subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await importKey(jwk),
      base64UrlToBytes(grant.signature),
      Buffer.from(canonicalGrant(grant), 'utf8'),
    );
  } catch {
    // A malformed signature or key is a refusal, never an exception a caller
    // could catch into an allow.
    return { ok: false, reason: 'malformed' };
  }
  if (!verified) return { ok: false, reason: 'bad-signature' };

  if (new Date(grant.expiresAt) <= now) return { ok: false, reason: 'expired' };

  // Signed, unexpired, and still not sufficient on its own. Consumed and
  // revoked are mutable state the issuer holds; a signature cannot say whether
  // a grant has already been spent, so a tool must redeem through the runtime
  // rather than treat verification as permission.
  if (grant.consumed) return { ok: false, reason: 'consumed' };
  if (grant.revoked) return { ok: false, reason: 'revoked' };

  return { ok: true, reason: 'verified' };
}

/// Fetches the issuer's key set once, for verifying offline afterwards.
///
/// `ephemeral` is passed through deliberately. An ephemeral key changes on every
/// restart, so a tool caching one is caching something that will stop existing -
/// callers should refuse to rely on it in production rather than discover it
/// during an incident.
export async function fetchGrantKeys(baseUrl, { fetchImpl = globalThis.fetch, allowInsecureHttp = false, timeoutMs = 10000 } = {}) {
  const {endpoint, boundedFetch} = await import('./transport.js');
  const response = await boundedFetch(fetchImpl, timeoutMs)(`${endpoint(baseUrl, allowInsecureHttp)}/.well-known/verid-grant-keys`);
  if (!response.ok) throw new Error(`Grant key set unavailable (${response.status})`);
  const body = await response.json();
  return { keys: body.keys ?? [], ephemeral: Boolean(body.ephemeral) };
}
