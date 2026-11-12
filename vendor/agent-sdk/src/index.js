import {endpoint, boundedFetch} from './transport.js';

function amountText(value) {
  if (typeof value !== "string") throw new TypeError("Amounts must be strings so decimal scale is preserved");
  return value;
}
function countText(value) {
  if (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) throw new TypeError("Record counts must be non-negative safe integers or digit strings");
  const text = String(value);
  if (!/^\d+$/.test(text)) throw new TypeError("Record counts must contain only digits");
  return text;
}

function ownershipVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError("An exact positive ownership version is required");
  return value;
}

class BaseClient {
  constructor({ baseUrl, tenantId, accessToken, fetchImpl = globalThis.fetch, allowInsecureHttp = false, timeoutMs = 10000 }) {
    if (!baseUrl || !tenantId || !fetchImpl) throw new Error("baseUrl, tenantId, and fetch are required");
    this.baseUrl = endpoint(baseUrl, allowInsecureHttp); this.tenantId = tenantId; this.fetch = boundedFetch(fetchImpl, timeoutMs);
    this.accessToken = accessToken;
  }
  // Every tenant-scoped route requires a bearer token bound to the same tenant.
  // Sending it here rather than per call means a new method cannot forget it.
  authorization() { return this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}; }
  async request(path, init = {}) {
    const response = await this.fetch(`${this.baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", ...this.authorization(), ...(init.headers || {}) } });
    if (!response.ok) {
      // Surface the server's reason. A bare status turns a policy denial, an
      // expired token, and a tenant mismatch into the same opaque failure.
      const detail = await response.text().catch(() => "");
      throw new Error(`Verid request failed (${response.status})${detail ? `: ${detail}` : ""}`);
    }
    return response.status === 204 ? null : response.json();
  }
}
export class VeridAgentClient extends BaseClient {
  agentOwnership(agentId) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/ownership?tenantId=${encodeURIComponent(this.tenantId)}`);
  }
  transferAgentOwnership(agentId, {actorId, newOwnerPrincipalId, reason, expectedOwnershipVersion}) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/ownership/transfer`, {
      method: "POST", body: JSON.stringify({tenantId:this.tenantId, actorId, newOwnerPrincipalId, reason, expectedOwnershipVersion:ownershipVersion(expectedOwnershipVersion)})
    });
  }
  suspendAgentOwnership(agentId, {actorId, reason, expectedOwnershipVersion}) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/ownership/suspend`, {
      method: "POST", body: JSON.stringify({tenantId:this.tenantId, actorId, reason, expectedOwnershipVersion:ownershipVersion(expectedOwnershipVersion)})
    });
  }
  withdrawAgentOwnership(agentId, {actorId, reason, expectedOwnershipVersion}) {
    return this.request(`/v1/agents/${encodeURIComponent(agentId)}/ownership/withdraw`, {
      method: "POST", body: JSON.stringify({tenantId:this.tenantId, actorId, reason, expectedOwnershipVersion:ownershipVersion(expectedOwnershipVersion)})
    });
  }
  /// Submits a proposed action to the deterministic runtime as a predicate
  /// envelope â€” the single evaluation path, and the only one that returns a
  /// short-lived authorization when the action is allowed.
  ///
  /// Amounts are sent as strings so their scale survives the round trip: the
  /// grant is bound to the text, so 13800.00 and 13800 are not interchangeable.
  evaluate({ intentId, agentId, tool, action, environment = "production", amount, currency, counterparty, dataClass, region, recordCount, model, modelHosting, weightsDigest, requestedAt } = {}) {
    const predicates = [];
    if (amount !== undefined && amount !== null) predicates.push({ type: "amount", currency, value: amountText(amount) });
    if (counterparty) predicates.push({ type: "counterparty_reference", value: counterparty });
    if (dataClass) predicates.push({ type: "data_class", value: dataClass });
    if (region) predicates.push({ type: "region", value: region });
    if (recordCount !== undefined && recordCount !== null) predicates.push({ type: "record_count", value: countText(recordCount) });
    // Declare which model produced the proposal so an intent can restrict action
    // to weights the tenant controls. Omitting this is not a way to opt out: a
    // contract that requires provenance denies an action that declares none.
    if (model) predicates.push({ type: "model_provenance", value: model, hosting: modelHosting, weightsDigest });
    return this.request("/v1/runtime/evaluations", {
      method: "POST",
      body: JSON.stringify({
        tenantId: this.tenantId, intentId, schemaVersion: "1.0", agentId, tool, action,
        environment, requestedAt: requestedAt ?? new Date().toISOString(), predicates
      })
    });
  }
  /// Redeems a grant by presenting the envelope it was issued for.
  ///
  /// The grant is bound to the whole envelope, so anything the evaluation
  /// declared - amount, counterparty, data class, region, record count, model
  /// provenance - has to come back unchanged. Build it with the same arguments
  /// passed to evaluate(); a typed action cannot express most of them and would
  /// be refused.
  consume({ authorizationId, agentId, envelope, action }) {
    const body = { tenantId: this.tenantId, agentId };
    if (envelope) body.envelope = envelope; else body.action = action;
    return this.request(`/v1/runtime/authorizations/${authorizationId}/consume`, { method: "POST", body: JSON.stringify(body) });
  }

  authorizationById(authorizationId) {
    return this.request(
      `/v1/runtime/authorizations/${encodeURIComponent(authorizationId)}?tenantId=${encodeURIComponent(this.tenantId)}`);
  }

  /// The envelope body for redemption, from the same arguments as evaluate().
  envelopeFor({ agentId, tool, action, environment = "production", amount, currency, counterparty, dataClass, region, recordCount, model, modelHosting, weightsDigest, requestedAt } = {}) {
    const predicates = [];
    if (amount !== undefined && amount !== null) predicates.push({ type: "amount", currency, value: amountText(amount) });
    if (counterparty) predicates.push({ type: "counterparty_reference", value: counterparty });
    if (dataClass) predicates.push({ type: "data_class", value: dataClass });
    if (region) predicates.push({ type: "region", value: region });
    if (recordCount !== undefined && recordCount !== null) predicates.push({ type: "record_count", value: countText(recordCount) });
    if (model) predicates.push({ type: "model_provenance", value: model, hosting: modelHosting, weightsDigest });
    return { schemaVersion: "1.0", agentId, tool, action, environment, requestedAt: requestedAt ?? new Date().toISOString(), predicates };
  }
  /// Records what happened, and optionally what executed.
  ///
  /// Passing `executed` (build it with envelopeFor()) has the platform compare
  /// the execution against the authorization and name any field that differs.
  /// Omitting it is recorded as NotProvided, not as a match: a receipt that
  /// describes nothing has not established that nothing changed.
  submitReceipt({ authorizationId, status, externalReference, evidence, executed }) {
    const body = { tenantId: this.tenantId, status, externalReference, evidence };
    if (executed) body.executed = executed;
    return this.request(`/v1/runtime/authorizations/${authorizationId}/receipt`, { method: "POST", body: JSON.stringify(body) });
  }
}
export class VeridAuthClient extends BaseClient {
  startLogin({ clientId, redirectUri, state, codeChallenge }) { return this.request("/v1/login/transactions", { method: "POST", body: JSON.stringify({ tenantId: this.tenantId, clientId, redirectUri, state, codeChallenge }) }); }
  completeLogin({ transactionId, principalId, assurance }) { return this.request(`/v1/login/transactions/${transactionId}/complete`, { method: "POST", body: JSON.stringify({ tenantId: this.tenantId, principalId, assurance }) }); }
  exchangeCode({ clientId, code, codeVerifier, clientSecret }) { return this.request("/oauth/token", { method: "POST", body: JSON.stringify({ grantType: "authorization_code", tenantId: this.tenantId, clientId, code, codeVerifier, clientSecret }) }); }
  refresh({ clientId, refreshToken, clientSecret }) { return this.request("/oauth/token", { method: "POST", body: JSON.stringify({ grantType: "refresh_token", tenantId: this.tenantId, clientId, refreshToken, clientSecret }) }); }
  validateAccessToken(accessToken) { return this.request("/oauth/introspect", { method: "POST", body: JSON.stringify({ tenantId: this.tenantId, accessToken }) }); }
  revokeRefreshToken(refreshToken) { return this.request("/oauth/revoke", { method: "POST", body: JSON.stringify({ tenantId: this.tenantId, refreshToken }) }); }
  sessions(principalId) { return this.request(`/v1/tenants/${this.tenantId}/principals/${principalId}/sessions`); }
  revokeSession(sessionId, actorId) { return this.request(`/v1/tenants/${this.tenantId}/sessions/${sessionId}?actorId=${encodeURIComponent(actorId)}`, { method: "DELETE" }); }
}


export class VeridProcurementClient extends VeridAgentClient {
  registerAgent(agent) { return this.request("/v1/agents", { method: "POST", body: JSON.stringify({ ...agent, tenantId: this.tenantId }) }); }
  registerTool(tool) { return this.request("/v1/tools", { method: "POST", body: JSON.stringify({ ...tool, tenantId: this.tenantId }) }); }
  createIntent(intent) { return this.request("/v1/intents", { method: "POST", body: JSON.stringify({ ...intent, tenantId: this.tenantId }) }); }
  /// The statement the signer's enrolled device must sign before signIntent
  /// will activate a draft. Pass the resulting { deviceId, confirmationMethod,
  /// deviceSignature } to signIntent; a signatureReference alone is refused.
  signingStatement(intentId, deviceId) { return this.request(`/v1/intents/${encodeURIComponent(intentId)}/signing-statement?tenantId=${encodeURIComponent(this.tenantId)}&deviceId=${encodeURIComponent(deviceId)}`); }
  signIntent(intentId, input) { return this.request(`/v1/intents/${encodeURIComponent(intentId)}/sign`, { method: "POST", body: JSON.stringify({ ...input, tenantId: this.tenantId }) }); }
  evaluateAction(input) { return this.evaluate(input); }
  async waitForApproval(approvalId, { timeoutMs = 300000, intervalMs = 1000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const approval = await this.request(`/v1/runtime/approvals/${encodeURIComponent(approvalId)}?tenantId=${encodeURIComponent(this.tenantId)}`);
      if (approval.status !== "Pending") return approval;
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    throw new Error("Approval wait timed out");
  }
  /// Waits for the decision and returns the grant it issued.
  ///
  /// An agent that escalated has to redeem the authorization its approval
  /// produced, and until the approval named it (US-K004) there was no way to
  /// ask for it: the only route was to list authorizations and take the newest,
  /// which is a guess, and the wrong one the moment two approvals against one
  /// intent are decided together.
  ///
  /// Throws on a refusal rather than returning it. A denial is not a grant; a
  /// caller that wants to handle "no" should wait on the approval itself. The
  /// approval is attached to the error either way.
  async waitForAuthorization(approvalId, options = {}) {
    const approval = await this.waitForApproval(approvalId, options);
    if (approval.status !== "Approved") {
      const error = new Error(`The approval was ${approval.status}.`);
      error.approval = approval;
      throw error;
    }
    if (!approval.authorizationId) {
      // A platform old enough not to record the link. Say so, rather than
      // falling back to guessing which grant this decision produced.
      const error = new Error("The approval was granted but names no authorization.");
      error.approval = approval;
      throw error;
    }
    return this.request(`/v1/runtime/authorizations/${encodeURIComponent(approval.authorizationId)}?tenantId=${encodeURIComponent(this.tenantId)}`);
  }
  validateAuthorization(input) { return this.consume(input); }
  submitExecutionReceipt(input) { return this.submitReceipt(input); }
}

export class VeridClient extends BaseClient {
  organizations(input) { return this.request("/v1/organizations", { method: "POST", body: JSON.stringify(input) }); }
  intents() { return this.request(`/v1/intents?tenantId=${this.tenantId}`); }
  evaluation(id) { return this.request(`/v1/evaluations/${id}?tenantId=${this.tenantId}`); }
  solutionPacks() { return this.request(`/v1/solution-packs?tenantId=${encodeURIComponent(this.tenantId)}`); }
  solutionPack(slug) { return this.request(`/v1/solution-packs/${encodeURIComponent(slug)}?tenantId=${encodeURIComponent(this.tenantId)}`); }
  prepareIndustryEnvelope(slug, input) {
    return this.request(`/v1/solution-packs/${encodeURIComponent(slug)}/envelopes`, {
      method: "POST", body: JSON.stringify({ ...input, tenantId: this.tenantId })
    });
  }
}

export class VeridConnectClient extends BaseClient {
  connectionDiagnostics() { return this.request(`/v1/tenants/${encodeURIComponent(this.tenantId)}/marketplace/diagnostics`); }
  connectorContract() { return this.request(`/v1/tenants/${encodeURIComponent(this.tenantId)}/marketplace/contract`); }
  connectors() { return this.request(`/v1/tenants/${encodeURIComponent(this.tenantId)}/marketplace/connectors`); }
  connector(id) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(id || '')) throw new TypeError('A registered connector identifier is required');
    return this.request(`/v1/tenants/${encodeURIComponent(this.tenantId)}/marketplace/connectors/${id}`);
  }
  budgetPath(id, suffix = '') {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id || '')) throw new TypeError('A prepared change UUID is required');
    return `/v1/tenants/${encodeURIComponent(this.tenantId)}/marketplace/google-ads/changes/${id}${suffix}`;
  }
  prepareBudgetChange(input) {
    if (typeof input?.amountMicros !== 'string' || !/^[1-9][0-9]*$/.test(input.amountMicros) || BigInt(input.amountMicros) > 9223372036854775807n)
      throw new TypeError('Budget micros must be a positive int64 string');
    return this.request(`/v1/tenants/${encodeURIComponent(this.tenantId)}/marketplace/google-ads/changes`, {method:'POST', body:JSON.stringify(input)});
  }
  budgetChange(id) { return this.request(this.budgetPath(id)); }
  approveBudgetChange(id, digest) { return this.request(this.budgetPath(id, '/approve'), {method:'POST', body:JSON.stringify({digest})}); }
  evaluateBudgetChange(change) {
    if (!change?.envelope || !change.intentId) throw new TypeError('Use the server-prepared change and envelope');
    return this.request('/v1/runtime/evaluations', {method:'POST', body:JSON.stringify({...change.envelope, tenantId:this.tenantId, intentId:change.intentId})});
  }
  executeBudgetChange(id, authorizationId) {
    // A timeout is uncertain, so this method performs exactly one transport call.
    return this.request(this.budgetPath(id, '/execute'), {method:'POST', body:JSON.stringify({authorizationId})});
  }
  reconcileBudgetChange(id) { return this.request(this.budgetPath(id, '/reconcile')); }
}

export class VeridIntent {
  constructor(value) { Object.assign(this, value); Object.freeze(this); }
}

export class VeridIntentGuard extends VeridProcurementClient {
  inspectEvaluation(id) { return this.request(`/v1/evaluations/${id}?tenantId=${this.tenantId}`); }
}

export {
  VeridGrantVerifier,
  VeridGrantVerificationError,
  canonicalizeEnvelope,
  executeWithAuthorization
} from "./security.js";
