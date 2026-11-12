const origin = "https://api-m.sandbox.paypal.com";
const maximumResponseBytes = 256 * 1024;
async function providerJson(response) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumResponseBytes)) {
    await response.body?.cancel().catch(() => {});
    throw new Error('Provider response exceeds the transport limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Provider response body is missing');
  const chunks = [];let bytes = 0;
  try {
    for (;;) {
      const {done,value} = await reader.read();if (done) break;
      bytes += value.byteLength;
      if (bytes > maximumResponseBytes) {
        await reader.cancel().catch(() => {});
        throw new Error('Provider response exceeds the transport limit');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const value = JSON.parse(Buffer.concat(chunks,bytes).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid provider response');
  return value;
}
export class ProviderError extends Error {
  constructor(code, status = null) { super(code); this.code = code; this.status = status; }
}
const identifier = value => typeof value === "string" && /^[A-Za-z0-9-]{1,64}$/.test(value);
export function validatePurchase(purchase) {
  if (!purchase || !identifier(purchase.merchantId) || purchase.currency !== "USD" ||
      typeof purchase.amount !== "string" || !/^(?:0|[1-9]\d{0,6})\.\d{2}$/.test(purchase.amount) ||
      Number(purchase.amount) <= 0) throw new ProviderError("INVALID_PURCHASE");
}
export function assertApprovedOrder(order, orderId, purchase) {
  validatePurchase(purchase);
  const units = order?.purchase_units;
  if (order?.id !== orderId || order.status !== "APPROVED" || !Array.isArray(units) || units.length !== 1 ||
      units[0].amount?.value !== purchase.amount || units[0].amount?.currency_code !== purchase.currency ||
      units[0].payee?.merchant_id !== purchase.merchantId) throw new ProviderError("ORDER_NOT_AUTHORIZED");
}
export function completedCapture(order,orderId,purchase) {
  validatePurchase(purchase);
  const unit=order?.purchase_units?.[0];
  if(order?.id!==orderId||!Array.isArray(order.purchase_units)||order.purchase_units.length!==1||
    unit.amount?.value!==purchase.amount||unit.amount?.currency_code!==purchase.currency||
    unit.payee?.merchant_id!==purchase.merchantId)throw new ProviderError('PROVIDER_BINDING_MISMATCH');
  if(order.status!=='COMPLETED')return null;
  const captures=unit.payments?.captures;
  if(!Array.isArray(captures)||captures.length!==1)throw new ProviderError('AMBIGUOUS_PROVIDER_CAPTURES');
  const capture=captures[0];
  if(capture.status!=='COMPLETED')return null;
  if(!identifier(capture.id)||capture.amount?.value!==purchase.amount||
    capture.amount?.currency_code!==purchase.currency||capture.final_capture!==true)
    throw new ProviderError('CAPTURE_BINDING_MISMATCH');
  return Object.freeze({captureId:capture.id,orderId,amount:purchase.amount,currency:purchase.currency,
    merchantId:purchase.merchantId,status:'COMPLETED'});
}
export class PayPalSandboxClient {
  constructor({clientId, clientSecret, fetchImpl = globalThis.fetch, timeoutMs = 10000}) {
    if (!clientId || !clientSecret || typeof fetchImpl !== "function") throw new ProviderError("SANDBOX_NOT_CONFIGURED");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) throw new ProviderError("INVALID_TIMEOUT");
    this.clientId = clientId; this.clientSecret = clientSecret; this.fetch = fetchImpl; this.timeoutMs = timeoutMs;
  }
  async request(path, options, ambiguous = false) {
    try {
      const response = await this.fetch(origin + path, {...options, redirect: "error", signal: AbortSignal.timeout(this.timeoutMs)});
      // Provider bodies may contain payer details. Errors expose only status.
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new ProviderError(ambiguous && response.status >= 500 ? "CAPTURE_UNKNOWN" : "PROVIDER_REJECTED", response.status);
      }
      return await providerJson(response);
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(ambiguous ? "CAPTURE_UNKNOWN" : "PROVIDER_UNAVAILABLE");
    }
  }
  async token() {
    const result = await this.request("/v1/oauth2/token", {method: "POST", headers: {
      authorization: `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
    }, body: "grant_type=client_credentials"});
    if (typeof result.access_token !== "string" || !result.access_token) throw new ProviderError("INVALID_PROVIDER_TOKEN");
    return result.access_token;
  }
  async createOrder(purchase, requestId) {
    validatePurchase(purchase); if (!identifier(requestId)) throw new ProviderError("INVALID_REQUEST_ID");
    const token = await this.token();
    return this.request("/v2/checkout/orders", {method: "POST", headers: {
      authorization: `Bearer ${token}`, "content-type": "application/json", "PayPal-Request-Id": requestId,
    }, body: JSON.stringify({intent: "CAPTURE", purchase_units: [{amount: {currency_code: purchase.currency, value: purchase.amount}, payee: {merchant_id: purchase.merchantId}}]})});
  }
  async getOrder(orderId) {
    if (!identifier(orderId)) throw new ProviderError("INVALID_ORDER_ID");
    return this.request(`/v2/checkout/orders/${orderId}`, {headers: {authorization: `Bearer ${await this.token()}`}});
  }
  async verifyWebhook(event,headers,webhookId) {
    if(!identifier(webhookId))throw new ProviderError('WEBHOOK_NOT_CONFIGURED');
    const names={'transmission_id':'paypal-transmission-id','transmission_time':'paypal-transmission-time',
      'transmission_sig':'paypal-transmission-sig','cert_url':'paypal-cert-url','auth_algo':'paypal-auth-algo'};
    const payload={webhook_id:webhookId,webhook_event:event};
    for(const [key,name] of Object.entries(names)){
      const value=headers.get(name);
      if(typeof value!=='string'||!value||value.length>2048)throw new ProviderError('INVALID_WEBHOOK_HEADERS');
      payload[key]=value;
    }
    // Post back to PayPal; never fetch a caller-controlled certificate URL.
    const result=await this.request('/v1/notifications/verify-webhook-signature',{method:'POST',headers:{
      authorization:`Bearer ${await this.token()}`,'content-type':'application/json'},body:JSON.stringify(payload)});
    if(result.verification_status!=='SUCCESS')throw new ProviderError('UNVERIFIED_WEBHOOK');
    return true;
  }
  // Transport only: callers must persist the attempt and consume verified
  // authority before using this operation. This is not an exposed API route.
  async captureOrder(orderId, requestId) {
    if (!identifier(orderId) || !identifier(requestId)) throw new ProviderError("INVALID_CAPTURE_ID");
    return this.request(`/v2/checkout/orders/${orderId}/capture`, {method: "POST", headers: {
      authorization: `Bearer ${await this.token()}`, "content-type": "application/json", "PayPal-Request-Id": requestId,
    }, body: "{}"}, true);
  }
}
