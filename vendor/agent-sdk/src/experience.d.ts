// Generated from task-continuation.v1.schema.json; navigation is never an execution grant.
export interface TaskContinuationV1 {
  version: 1;
  kind: "navigation_continuation";
  id: string;
  principalId: string;
  tenantId: string;
  sourceApplication: "login" | "console" | "agentpay" | "vault" | "owner" | "mobile" | "developer";
  destinationApplication: "login" | "console" | "agentpay" | "vault" | "owner" | "mobile" | "developer";
  operation: "open_personal_vault" | "open_purchase_workspace" | "review_action" | "review_account_setup" | "review_access" | "reconcile_lifecycle";
  issuedAt: number;
  expiresAt: number;
  returnDestination: string;
  grantsAuthority: false;
}
export declare function validateTaskContinuation(value: unknown): Readonly<TaskContinuationV1>;
export declare function createTaskContinuation(value: Omit<TaskContinuationV1, 'version' | 'kind' | 'grantsAuthority'>): Readonly<TaskContinuationV1>;
export declare function requireCurrentContinuation(value: unknown, current: Pick<TaskContinuationV1, 'principalId' | 'tenantId' | 'sourceApplication' | 'destinationApplication' | 'operation' | 'returnDestination'> & {now: number}): Readonly<TaskContinuationV1>;
export declare function experienceStatus(value: {kind: string; status: string; destinationConfirmed?: boolean}): {label: 'Pending' | 'Completed' | 'Refused' | 'Needs Investigation'; detail: string; grantsAuthority: false; destinationConfirmed: boolean};
