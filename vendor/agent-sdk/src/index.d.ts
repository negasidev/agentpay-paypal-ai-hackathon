export interface VeridClientOptions {
  baseUrl: string;
  tenantId: string;
  accessToken?: string;
  fetchImpl?: typeof fetch;
  allowInsecureHttp?: boolean;
  timeoutMs?: number;
}

export interface Predicate {
  type: "amount" | "counterparty_reference" | "data_class" | "region" |
    "record_count" | "model_provenance" | "resource_reference" | "resource_version";
  value?: string | number;
  rawValue?: string;
  currency?: string;
  access?: "read" | "write" | "export";
  hashed?: boolean;
  hosting?: "self_hosted" | "vendor_hosted" | "on_device";
  model?: string;
  weightsDigest?: string;
  resourceType?: string;
  namespace?: string;
  resourceId?: string;
  parentReference?: { resourceType: string; namespace: string; resourceId: string; parentReference?: Predicate['parentReference'] };
  versionType?: "commit_sha" | "resource_generation" | "concurrency_token" | "record_version";
  version?: string;
}

export interface PredicateEnvelope {
  schemaVersion?: "1.0";
  agentId: string;
  tool: string;
  action: string;
  environment: "development" | "staging" | "production";
  requestedAt?: string;
  predicates: Predicate[];
}

export interface AuthorizationGrant {
  id: string;
  tenantId: string;
  intentId: string;
  intentVersion: number;
  agentId: string;
  actionHash: string;
  expiresAt: string;
  consumed: boolean;
  revoked: boolean;
  envelope?: PredicateEnvelope;
  signature?: string;
  signingKeyId?: string;
}

export interface ActionProposal {
  intentId: string;
  agentId: string;
  tool: string;
  action: string;
  environment?: "development" | "staging" | "production";
  amount?: string;
  currency?: string;
  counterparty?: string;
  dataClass?: string;
  region?: string;
  recordCount?: number | string;
  model?: string;
  modelHosting?: "self_hosted" | "vendor_hosted" | "on_device";
  weightsDigest?: string;
  requestedAt?: string;
}

export class VeridAgentClient {
  constructor(options: VeridClientOptions);
  readonly tenantId: string;
  agentOwnership(agentId: string): Promise<Record<string, unknown>>;
  transferAgentOwnership(agentId: string, input: {actorId: string; newOwnerPrincipalId: string; reason: string; expectedOwnershipVersion: number}): Promise<Record<string, unknown>>;
  suspendAgentOwnership(agentId: string, input: {actorId: string; reason: string; expectedOwnershipVersion: number}): Promise<Record<string, unknown>>;
  withdrawAgentOwnership(agentId: string, input: {actorId: string; reason: string; expectedOwnershipVersion: number}): Promise<Record<string, unknown>>;
  evaluate(input: ActionProposal): Promise<Record<string, unknown>>;
  envelopeFor(input: Omit<ActionProposal, "intentId">): PredicateEnvelope;
  authorizationById(id: string): Promise<AuthorizationGrant>;
  consume(input: {
    authorizationId: string;
    agentId: string;
    envelope?: PredicateEnvelope;
    action?: unknown;
  }): Promise<AuthorizationGrant>;
  submitReceipt(input: {
    authorizationId: string;
    status: "Succeeded" | "Failed" | "Partial" | "TimedOut";
    externalReference: string;
    evidence: string;
    executed?: PredicateEnvelope;
  }): Promise<Record<string, unknown>>;
}

export class VeridProcurementClient extends VeridAgentClient {
  registerAgent(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  registerTool(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  createIntent(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  signIntent(intentId: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  evaluateAction(input: ActionProposal): Promise<Record<string, unknown>>;
  validateAuthorization(input: Parameters<VeridAgentClient["consume"]>[0]): Promise<AuthorizationGrant>;
  submitExecutionReceipt(input: Parameters<VeridAgentClient["submitReceipt"]>[0]): Promise<Record<string, unknown>>;
}

export class VeridGrantVerificationError extends Error {
  readonly code: string;
}

export class VeridGrantVerifier {
  constructor(options: {
    baseUrl: string;
    fetchImpl?: typeof fetch;
    allowEphemeralKeys?: boolean;
    clockSkewMs?: number;
    allowInsecureHttp?: boolean;
    timeoutMs?: number;
    clock?: () => number;
  });
  refreshKeys(): Promise<Record<string, unknown>>;
  verify(grant: AuthorizationGrant, expected?: {
    tenantId?: string;
    agentId?: string;
    intentId?: string;
    envelope?: PredicateEnvelope;
    now?: number;
    allowConsumed?: boolean;
  }): Promise<Readonly<Record<string, unknown>>>;
}

export function canonicalizeEnvelope(envelope: PredicateEnvelope): string;
export function executeWithAuthorization<T>(input: {
  client: VeridAgentClient;
  verifier: VeridGrantVerifier;
  grant: AuthorizationGrant;
  envelope: PredicateEnvelope;
  agentId: string;
  execute: () => Promise<T>;
  externalReference: string;
  evidence: string;
}): Promise<T>;

export class VeridAuthClient {
  constructor(options: VeridClientOptions);
}
export class VeridClient {
  constructor(options: VeridClientOptions);
}

export interface GoogleAdsBudgetChange {
  id: string;
  intentId: string;
  amountMicros: string;
  digest: string;
  state: string;
  expiresAt: string;
  envelope: PredicateEnvelope;
}
export class VeridConnectClient {
  constructor(options: VeridClientOptions);
  connectionDiagnostics(): Promise<{schemaVersion: string; observedAt: string; observationSource: string; providerContacted: false; actionAuthorized: false; accounts: ConnectorAccountDiagnostics[]}>;
  connectorContract(): Promise<Record<string, unknown>>;
  connectors(): Promise<Record<string, unknown>[]>;
  connector(id: string): Promise<Record<string, unknown>>;
  prepareBudgetChange(input: {connectionId: string; intentId: string; agentId: string; campaignId: string; amountMicros: string}): Promise<GoogleAdsBudgetChange>;
  budgetChange(id: string): Promise<GoogleAdsBudgetChange>;
  approveBudgetChange(id: string, digest: string): Promise<GoogleAdsBudgetChange>;
  evaluateBudgetChange(change: GoogleAdsBudgetChange): Promise<Record<string, unknown>>;
  executeBudgetChange(id: string, authorizationId: string): Promise<Record<string, unknown>>;
  reconcileBudgetChange(id: string): Promise<Record<string, unknown>>;
}
export interface ConnectorAccountDiagnostics {
  connectionId: string; provider: string; ownerId: string; account: string; expiresAt: string;
  credentialVersion: number; credentialState: string; revocationState: string; issues: string[];
  operations: {awaitingApproval: number; approved: number; inFlight: number; adapterConfirmed: number; failed: number; uncertain: number; revoked: number; unknown: number};
  operationalVerification: 'not_verified';
}
export class VeridIntent {
  constructor(value: Record<string, unknown>);
}
export class VeridIntentGuard extends VeridProcurementClient {}
