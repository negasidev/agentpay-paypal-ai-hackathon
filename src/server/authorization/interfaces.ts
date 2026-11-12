export type PurchaseBinding={purchaseId:string;tenantId:string;userId:string;amount:string;currency:string;merchantId:string;providerOrderId:string};
export interface AuthorityBoundary {
  requestApproval(binding: PurchaseBinding): Promise<{status:"PENDING"; requestId:string}>;
  verifyAndReserve(binding: PurchaseBinding, attemptId:string): Promise<{authorityId:string;actionHash:string;expiresAt:string}>;
}
export interface PaymentBoundary {
  createOrder(purchase:{amount:string;currency:string;merchantId:string},requestId:string):Promise<unknown>;
  getOrder(orderId:string):Promise<unknown>;
  captureOrder(orderId:string,requestId:string):Promise<unknown>;
}
// No success stand-in: a configured, verified authority adapter is required.
export const unavailableAuthority:AuthorityBoundary={async requestApproval(){throw new Error("AUTHORITY_UNAVAILABLE")},async verifyAndReserve(){throw new Error("AUTHORITY_UNAVAILABLE")}};
