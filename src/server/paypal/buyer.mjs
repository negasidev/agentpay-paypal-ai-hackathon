import {PayPalSandboxClient,ProviderError} from './client.mjs';
import {verifySandboxOrder} from './order-probe.mjs';
export function sandboxProvider(){
  if(process.env.AGENTPAY_SANDBOX_CHECKOUT_ENABLED!=='true')throw new ProviderError('SANDBOX_CHECKOUT_DISABLED');
  return new PayPalSandboxClient({clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,clientSecret:process.env.PAYPAL_SANDBOX_CLIENT_SECRET});
}
export async function buyerOutcome(pool,actor,purchaseId,action,provider){
  const row=(await pool.query('SELECT s.*,p.amount,p.currency FROM ap_sandbox_order_probes s JOIN ap_purchases p ON p.id=s.purchase_id WHERE s.purchase_id=$1 AND s.tenant_id=$2 AND s.user_id=$3',[purchaseId,actor.tenant_id,actor.user_id])).rows[0];
  if(!row?.provider_order_id)throw new ProviderError('NOT_FOUND');
  if(action==='cancel'){
    const result=await pool.query("UPDATE ap_sandbox_order_probes SET buyer_status=CASE WHEN buyer_status='APPROVED' THEN buyer_status ELSE 'CANCELED' END WHERE purchase_id=$1 RETURNING buyer_status",[purchaseId]);
    return {buyerStatus:result.rows[0].buyer_status,captureEnabled:false,providerCancellation:false};
  }
  if(action!=='verify')throw new ProviderError('INVALID_ACTION');
  const order=await provider.getOrder(row.provider_order_id);
  verifySandboxOrder(order,row.provider_order_id,{amount:row.amount,currency:row.currency,merchantId:row.merchant_id});
  if(order.status!=='APPROVED')throw new ProviderError('BUYER_APPROVAL_NOT_VERIFIED');
  await pool.query("UPDATE ap_sandbox_order_probes SET buyer_status='APPROVED',provider_status='APPROVED',verified_at=now() WHERE purchase_id=$1",[purchaseId]);
  return {buyerStatus:'APPROVED',captureEnabled:false,paymentCompleted:false};
}
