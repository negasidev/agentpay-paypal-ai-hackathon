const encoder = new TextEncoder();
import {endpoint, boundedFetch} from './transport.js';

import { canonicalGrant as sharedCanonicalGrant } from './verify.js';

export class VeridGrantVerificationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "VeridGrantVerificationError";
    this.code = code;
  }
}

function reject(code, message) {
  throw new VeridGrantVerificationError(code, message);
}

function base64UrlBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    reject("invalid_signature", "Grant signature is not valid base64url.");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    + "=".repeat((4 - value.length % 4) % 4);
  const binary = globalThis.atob
    ? globalThis.atob(padded)
    : Buffer.from(padded, "base64").toString("binary");
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function cryptoApi() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) reject("crypto_unavailable", "Web Crypto is required to verify Verid grants.");
  return subtle;
}

function canonicalGrant(grant) {
  const required = [
    "actionHash", "agentId", "expiresAt", "id", "intentId",
    "intentVersion", "tenantId"
  ];
  for (const field of required) {
    if (grant?.[field] === undefined || grant[field] === null || grant[field] === "")
      reject("malformed_grant", `Grant is missing ${field}.`);
  }
  // Delegated to verify.js rather than rebuilt here. Two canonical forms for one
  // signature is the same defect as two evaluators for one decision: they agree
  // until they do not, and the disagreement surfaces as a grant that verifies in
  // one place and is refused in another.
  //
  // This function previously used JSON.stringify and passed expiresAt through
  // verbatim. The issuer signs an RFC 3339 millisecond-precision UTC form, while
  // the grant's JSON carries a seven-digit fraction and a numeric offset, so the
  // bytes never matched and no real grant could verify.
  return sharedCanonicalGrant(grant);
}

function normalizeResource(reference, depth = 0) {
  if (depth > 4) reject("invalid_resource", "Resource nesting exceeds four parents.");
  for (const [camel,snake] of [["resourceType","resource_type"],["resourceId","resource_id"],["parentReference","parent_reference"]]) if (reference[camel] != null && reference[snake] != null && reference[camel] !== reference[snake]) reject("conflicting_alias", "Conflicting resource aliases.");
  const resourceType = reference.resourceType ?? reference.resource_type;
  const resourceId = reference.resourceId ?? reference.resource_id;
  const namespace = reference.namespace;
  if ([resourceType, resourceId, namespace].some(value => typeof value !== "string"))
    reject("invalid_resource", "Resource fields must be strings.");
  if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(resourceId)) reject("invalid_resource", "Invalid Unicode resource ID.");
  const type = resourceType.trim().toLowerCase();
  if (!/^[a-z0-9]+(?:_[a-z0-9]+)*(?:\.[a-z0-9]+(?:_[a-z0-9]+)*){1,5}$/.test(type) ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,62}(?:\/[A-Za-z0-9][A-Za-z0-9_.:-]{0,62}){0,7}$/.test(namespace.trim()) ||
      !resourceId.trim() || resourceId.trim().length > 256)
    reject("invalid_resource", "Invalid resource reference.");
  const result = {namespace: namespace.trim()};
  const parent = reference.parentReference ?? reference.parent_reference;
  if (parent != null) result.parent_reference = normalizeResource(parent, depth + 1);
  result.resource_id = resourceId.trim();
  result.resource_type = type;
  return result;
}

function normalizePredicate(predicate) {
  switch (predicate?.type) {
    case "resource_reference": return {...normalizeResource(predicate), type: "resource_reference"};
    case "resource_version": {
      const versionType = predicate.versionType ?? predicate.version_type;
      const version = predicate.version ?? predicate.value;
      if (typeof version === "string" && /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(version))
        reject("invalid_resource_version", "Invalid Unicode resource version.");
      if (predicate.version != null && predicate.value != null && predicate.version !== predicate.value)
        reject("conflicting_alias", "Conflicting resource version values.");
      if (predicate.versionType != null && predicate.version_type != null && predicate.versionType !== predicate.version_type)
        reject("conflicting_alias", "Conflicting resource version aliases.");
      if (typeof versionType !== "string" || !["commit_sha", "resource_generation", "concurrency_token", "record_version"].includes(versionType.trim().toLowerCase()) ||
          typeof version !== "string" || !version.trim() || version.trim().length > 256)
        reject("invalid_resource_version", "Invalid resource version.");
      return {type: "resource_version", version: version.trim(), version_type: versionType.trim().toLowerCase()};
    }
    case "amount": {
      // The amount travels as text and is hashed as text. A JSON number cannot
      // carry its own scale - 1200.00 and 1200 are the same number and
      // different actions - and binary floating point cannot represent 0.1
      // exactly, so a value that changes on a round trip cannot be hashed
      // reliably. The frozen vectors require refusing it (reject-decimal-as-json-number).
      const raw = predicate.rawValue ?? predicate.value;
      if (typeof raw === "number") {
        throw new Error("amount.value must be a decimal string, not a JSON number.");
      }
      return {
        currency: String(predicate.currency ?? "").trim().toUpperCase(),
        type: "amount",
        value: String(raw ?? "").trim()
      };
    }
    case "counterparty_reference": {
      const value = {
        type: "counterparty_reference",
        value: String(predicate.value ?? "").trim().toLowerCase()
      };
      return predicate.hashed ? { hashed: true, ...value } : value;
    }
    case "data_class": {
      const access = predicate.access == null
        ? null : String(predicate.access).trim().toLowerCase();
      return access
        ? { access, type: "data_class", value: String(predicate.value ?? "").trim().toLowerCase() }
        : { type: "data_class", value: String(predicate.value ?? "").trim().toLowerCase() };
    }
    case "region":
      return { type: "region", value: String(predicate.value ?? "").trim().toUpperCase() };
    case "record_count":
      return { type: "record_count", value: Number(predicate.value) };
    case "model_provenance": {
      const value = {
        hosting: String(predicate.hosting ?? "").trim().toLowerCase(),
        model: String(predicate.model ?? predicate.value ?? "").trim().toLowerCase(),
        type: "model_provenance"
      };
      const digest = predicate.weightsDigest ?? predicate.weights_digest;
      return digest == null
        ? value
        : { ...value, weights_digest: String(digest).trim().toLowerCase() };
    }
    default:
      reject("unregistered_predicate", `Unregistered predicate type '${predicate?.type}'.`);
  }
}

function platformSerialize(value) {
  if (typeof value === "string") return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  if (Array.isArray(value)) return '[' + value.map(platformSerialize).join(',') + ']';
  if (value && typeof value === "object") return '{' + Object.entries(value).map(([key,item]) => platformSerialize(key)+':'+platformSerialize(item)).join(',') + '}';
  return JSON.stringify(value);
}
export function canonicalizeEnvelope(envelope) {
  if (!envelope) reject("missing_envelope", "An envelope is required.");
  if (envelope.schemaVersion === null || envelope.schema_version === null)
    reject("unsupported_schema", "An explicit null schema is not a supported version.");
  if (envelope.schemaVersion != null && envelope.schema_version != null && envelope.schemaVersion !== envelope.schema_version) reject("conflicting_schema", "Conflicting schema aliases.");
  if ((envelope.schemaVersion ?? envelope.schema_version ?? "1.0") !== "1.0") reject("unsupported_schema", "Unsupported envelope schema.");
  const identifier = /^[A-Za-z0-9](?:[A-Za-z0-9_.:-]{0,126}[A-Za-z0-9])?$/;
  for (const field of ["tool", "action", "agentId"]) {
    if (typeof envelope[field] !== "string" || !identifier.test(envelope[field].trim()))
      reject("invalid_identifier", `${field} must be an identifier, not free text.`);
  }
  const requestedAt = envelope.requestedAt ?? envelope.requested_at;
  if (requestedAt != null && (typeof requestedAt !== "string" || !requestedAt.endsWith("Z") || !Number.isFinite(Date.parse(requestedAt))))
    reject("invalid_timestamp", "requested_at must be a UTC timestamp ending in Z.");
  const predicates = (envelope.predicates ?? [])
    .map(normalizePredicate)
    .sort((left, right) => {
      const a = platformSerialize(left);
      const b = platformSerialize(right);
      return a < b ? -1 : a > b ? 1 : 0;
    });
  const canonical = {
    action: String(envelope.action ?? "").trim().toLowerCase(),
    agent_id: String(envelope.agentId ?? "").trim(),
    environment: String(envelope.environment ?? "").trim().toLowerCase()
  };
  if (predicates.length) canonical.predicates = predicates;
  canonical.schema_version = "1.0";
  canonical.tool = String(envelope.tool ?? "").trim().toLowerCase();
  return platformSerialize(canonical);
}

async function sha256Hex(value) {
  const digest = await cryptoApi().digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export class VeridGrantVerifier {
  constructor({
    baseUrl,
    fetchImpl = globalThis.fetch,
    allowEphemeralKeys = false,
    clockSkewMs = 0,
    clock = Date.now,
    allowInsecureHttp = false,
    timeoutMs = 10000
  } = {}) {
    if (!baseUrl || !fetchImpl)
      throw new TypeError("baseUrl and fetch are required.");
    if (!Number.isFinite(clockSkewMs) || clockSkewMs < 0)
      throw new TypeError("clockSkewMs must be a non-negative number.");
    if (typeof clock !== "function")
      throw new TypeError("clock must be a function.");
    this.baseUrl = endpoint(baseUrl, allowInsecureHttp);
    this.fetch = boundedFetch(fetchImpl, timeoutMs);
    this.allowEphemeralKeys = allowEphemeralKeys;
    this.clockSkewMs = clockSkewMs;
    this.clock = clock;
    this.keySet = null;
  }

  async refreshKeys() {
    const response = await this.fetch(
      `${this.baseUrl}/.well-known/verid-grant-keys`,
      { headers: { accept: "application/json" } });
    if (!response.ok)
      reject("key_fetch_failed", `Grant key request failed (${response.status}).`);
    const keySet = await response.json();
    if (!Array.isArray(keySet?.keys))
      reject("invalid_key_set", "Grant key response does not contain a keys array.");
    if (keySet.ephemeral && !this.allowEphemeralKeys)
      reject("ephemeral_key", "The issuer is using an ephemeral development signing key.");
    for (const key of keySet.keys) {
      if (key.kty !== "EC" || key.crv !== "P-256" || key.alg !== "ES256" ||
          key.use !== "sig" || !key.kid || !key.x || !key.y)
        reject("invalid_key_set", "Grant key set contains a non-ES256 verification key.");
      if ("d" in key)
        reject("private_key_exposed", "Grant key response contains private key material.");
    }
    this.keySet = keySet;
    return keySet;
  }

  async verify(grant, {
    tenantId,
    agentId,
    intentId,
    envelope,
    now = this.clock(),
    allowConsumed = false
  } = {}) {
    if (!grant?.signature || !grant?.signingKeyId)
      reject("unsigned_grant", "The authorization grant is not signed.");
    if (grant.revoked) reject("revoked_grant", "The authorization grant is revoked.");
    if (grant.consumed && !allowConsumed)
      reject("consumed_grant", "The authorization grant has already been consumed.");
    const expiresAt = Date.parse(grant.expiresAt);
    if (!Number.isFinite(expiresAt))
      reject("malformed_grant", "Grant expiration is not a valid timestamp.");
    if (Number(now) - this.clockSkewMs >= expiresAt)
      reject("expired_grant", "The authorization grant has expired.");
    if (tenantId && String(grant.tenantId) !== String(tenantId))
      reject("tenant_mismatch", "The authorization grant belongs to another tenant.");
    if (agentId && String(grant.agentId) !== String(agentId))
      reject("agent_mismatch", "The authorization grant belongs to another agent.");
    if (intentId && String(grant.intentId) !== String(intentId))
      reject("intent_mismatch", "The authorization grant belongs to another intent.");

    const coveredEnvelope = envelope ?? grant.envelope;
    if (!coveredEnvelope)
      reject("missing_envelope", "Tool-side verification requires the covered envelope.");
    const actionHash = await sha256Hex(canonicalizeEnvelope(coveredEnvelope));
    if (actionHash !== String(grant.actionHash).toUpperCase())
      reject("action_mismatch", "The envelope is not covered by this authorization grant.");

    let keySet = this.keySet ?? await this.refreshKeys();
    let jwk = keySet.keys.find(key => key.kid === grant.signingKeyId);
    if (!jwk && this.keySet) {
      keySet = await this.refreshKeys();
      jwk = keySet.keys.find(key => key.kid === grant.signingKeyId);
    }
    if (!jwk)
      reject("unknown_key", "No published verification key matches the grant.");
    const key = await cryptoApi().importKey(
      "jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const valid = await cryptoApi().verify(
      { name: "ECDSA", hash: "SHA-256" },
      key, base64UrlBytes(grant.signature), encoder.encode(canonicalGrant(grant)));
    if (!valid) reject("invalid_signature", "The authorization grant signature is invalid.");

    return Object.freeze({
      valid: true,
      grantId: grant.id,
      tenantId: grant.tenantId,
      agentId: grant.agentId,
      intentId: grant.intentId,
      intentVersion: grant.intentVersion,
      expiresAt: grant.expiresAt,
      signingKeyId: grant.signingKeyId
    });
  }
}

export async function executeWithAuthorization({
  client,
  verifier,
  grant,
  envelope,
  agentId,
  execute,
  externalReference,
  evidence
}) {
  if (!client || !verifier || typeof execute !== "function")
    throw new TypeError("client, verifier, and execute are required.");
  await verifier.verify(grant, {
    tenantId: client.tenantId,
    agentId,
    envelope
  });
  await client.consume({ authorizationId: grant.id, agentId, envelope });
  let result;
  try {
    result = await execute();
  } catch (error) {
    await client.submitReceipt({
      authorizationId: grant.id,
      status: "Failed",
      externalReference,
      evidence
    });
    throw error;
  }
  // A receipt transport failure says nothing about whether the effect ran.
  // Never turn it into a false failed-effect receipt or retry the callback.
  await client.submitReceipt({authorizationId: grant.id, status: "Succeeded",
    externalReference, evidence, executed: envelope});
  return result;
}
