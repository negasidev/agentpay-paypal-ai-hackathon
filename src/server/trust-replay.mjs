import {requireSandboxWriter} from './sandbox-membership.mjs';
import {createHash,timingSafeEqual} from 'node:crypto';
import {transaction} from './persistence/db.mjs';
export class ReplayError extends Error{constructor(code,status=409){super(code);this.status=status;}}
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest();
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
function terms(purchase,order){return {purchaseId:purchase.id,purchaseVersion:purchase.version,orderId:order.provider_order_id,merchantId:purchase.merchant_id,amount:purchase.amount,currency:purchase.currency};}
function validateProbe(purchaseId,input){
 if(!uuid(purchaseId)||!input||Array.isArray(input)||Object.keys(input).some(k=>!['requestId','amount','merchantId','currency','purchaseVersion'].includes(k))||!uuid(input.requestId)||!/^\d{1,7}\.\d{2}$/.test(input.amount??'')||!/^[A-Za-z0-9-]{1,64}$/.test(input.merchantId??'')||!/^[A-Z]{3}$/.test(input.currency??'')||!Number.isSafeInteger(input.purchaseVersion)||input.purchaseVersion<1)throw new ReplayError('INVALID_BINDING_PROBE',400);
}
async function boundOrder(db,actor,purchaseId,lock){
 const values=[purchaseId,actor.tenant_id,actor.user_id];
 const p=(await db.query('SELECT * FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3'+lock,values)).rows[0];if(!p)throw new ReplayError('NOT_FOUND',404);
 const order=(await db.query('SELECT * FROM ap_orders WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3',values)).rows[0];if(!order)throw new ReplayError('RECORDED_PROVIDER_ORDER_REQUIRED');
 if(order.purchase_version!==p.version||order.amount!==p.amount||order.currency!==p.currency||order.merchant_id!==p.merchant_id)throw new ReplayError('ORDER_SNAPSHOT_CHANGED');
 return {p,order};
}
function comparison(p,order,input){
 const original=terms(p,order),attempted={...original,amount:input.amount,merchantId:input.merchantId,currency:input.currency,purchaseVersion:input.purchaseVersion};
 return {original,attempted,decision:timingSafeEqual(hash(original),hash(attempted))?'TERMS_MATCH_INSPECTION_ONLY':'TERMS_MISMATCH'};
}
export async function inspectStoredBinding(pool,actor,purchaseId,input){
 validateProbe(purchaseId,input);
 return transaction(pool,async db=>{
  const {p,order}=await boundOrder(db,actor,purchaseId,' FOR SHARE');
  // A comparison cannot grant authority or modify a workflow. Read-only owners
  // can inspect the same bound terms without permission to approve or execute.
  return {...comparison(p,order,input),executionAllowed:false,providerDispatched:false,canonicalAuthorizationEvaluated:false,inspectionOnly:true,boundary:'Read-only stored-order comparison; not an approved-grant or payment execution test'};
 });
}
export async function probeStoredBinding(pool,actor,purchaseId,input){
 await requireSandboxWriter(pool,actor);
 validateProbe(purchaseId,input);
 return transaction(pool,async db=>{
  const {p,order}=await boundOrder(db,actor,purchaseId,' FOR UPDATE');
  const {original,attempted,decision}=comparison(p,order,input);const digest=hash({purchaseId,attempted}).toString('hex');
  const prior=(await db.query('SELECT * FROM ap_trust_replay_probes WHERE tenant_id=$1 AND user_id=$2 AND id=$3',[actor.tenant_id,actor.user_id,input.requestId])).rows[0];
  if(prior){if(prior.purchase_id!==purchaseId||prior.input_hash!==digest)throw new ReplayError('PROBE_IDEMPOTENCY_CONFLICT');return view(prior);}
  const row=(await db.query('INSERT INTO ap_trust_replay_probes(id,tenant_id,user_id,purchase_id,input_hash,original_terms,attempted_terms,decision) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[input.requestId,actor.tenant_id,actor.user_id,purchaseId,digest,JSON.stringify(original),JSON.stringify(attempted),decision])).rows[0];
  await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[actor.tenant_id,actor.user_id,purchaseId,decision==='TERMS_MISMATCH'?'trust-replay.binding-mismatch':'trust-replay.binding-match']);
  return view(row);
 });
}
// The inspection never issues/redeems a grant or calls PayPal. Matching a stored
// snapshot cannot establish genuine human approval or current capture authority.
function view(row){return {id:row.id,decision:row.decision,original:row.original_terms,attempted:row.attempted_terms,recordedAt:row.created_at,executionAllowed:false,providerDispatched:false,canonicalAuthorizationEvaluated:false,boundary:'Server-side stored-order binding inspection; not an approved-grant or provider execution test'};}
