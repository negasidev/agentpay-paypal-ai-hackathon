import {createHash,timingSafeEqual} from 'node:crypto';
import {signReceiverEffect,verifyReceiverEffect} from './receiver-effect.mjs';
import {authorityConfig} from '../authorization/requests.mjs';
import {TwoayeAuthorityAdapter,purchaseEnvelope} from '../authorization/twoaye.mjs';
import {canonicalizeEnvelope} from '@verid/agent-sdk';
import {assertReferenceQuote} from '../shopping/reference-merchant.mjs';
const fields=['format','tenantId','purchaseId','intentVersion','intentHash','authorizationId','attemptId','requestId','orderId','captureId','merchantId','amount','currency','status','verifiedAt'];
export function evidenceHash(e){
 if(!e||fields.some(key=>!(key in e)))throw new Error('INCOMPLETE_EVIDENCE');
 return createHash('sha256').update(JSON.stringify(fields.map(key=>[key,e[key]]))).digest('hex');
}
export function buildEvidence(original,capture,verifiedAt){
 const e={format:'agentpay-provider-observation-v1',tenantId:original.tenant_id,purchaseId:original.purchase_id,
 intentVersion:original.platform_intent_version??null,intentHash:original.action_hash??null,authorizationId:original.authority_id??null,
 attemptId:original.id,requestId:original.request_id,...capture,verifiedAt,source:'provider-order-read',authorityReceiptVerified:false};
 return signReceiverEffect({...e,integrityHash:evidenceHash(e)});
}
export async function verifyExecutionEvidence(e,original,providerCapture){
 try{
 const hash=evidenceHash(e);
 if(e.format!=='agentpay-provider-observation-v1'||e.status!=='COMPLETED'||typeof e.amount!=='string'||!/^\d+\.\d{2}$/.test(e.amount))return {status:'INVALID',reason:'MALFORMED_EVIDENCE'};
 if(typeof e.integrityHash!=='string'||! /^[a-f0-9]{64}$/.test(e.integrityHash)||!timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(e.integrityHash,'hex')))return {status:'INVALID',reason:'INTEGRITY_MISMATCH'};
 for(const [key,value] of Object.entries(original))if(!fields.includes(key)||e[key]!==value)return {status:'INVALID',reason:'PURCHASE_BINDING_MISMATCH'};
 if(!providerCapture)return {status:'INCOMPLETE',reason:'PROVIDER_REVERIFICATION_REQUIRED'};
 for(const key of ['orderId','captureId','merchantId','amount','currency','status'])if(e[key]!==providerCapture[key])return {status:'INVALID',reason:'PROVIDER_BINDING_MISMATCH'};
 if(['tenantId','purchaseId','intentVersion','intentHash','authorizationId','attemptId','requestId','orderId','captureId','merchantId','amount','currency'].some(key=>!(key in original)||original[key]===null))return {status:'INCOMPLETE',reason:'ORIGINAL_AUTHORIZATION_BINDING_REQUIRED'};
 // Receiver authenticity alone cannot prove issuer authority or its canonical
 // receipt. Only the scoped stored-record verifier can join those boundaries.
 return verifyReceiverEffect(e)
 ?{status:'INCOMPLETE',reason:'ISSUER_AUTHORITY_AND_CANONICAL_RECEIPT_REQUIRED',receiverSignatureVerified:true}
 :{status:'INCOMPLETE',reason:'PLATFORM_SIGNED_RECEIPT_AND_AUTHORITY_REQUIRED'};
 }catch{return {status:'INVALID',reason:'MALFORMED_EVIDENCE'};}
}
export async function verifyStoredReceipt(pool,actor,receiptId,provider,{config=authorityConfig(actor)}={}){
 const row=(await pool.query(`SELECT receipt.evidence,receipt.provider_capture_id,a.id,a.tenant_id,a.purchase_id,a.request_id,a.provider_order_id,
 a.authority_grant,a.authority_envelope,a.authority_consumed_at,a.purchase_version,p.quote,p.quote_digest,p.item_id,p.quantity,
 o.amount,o.currency,o.merchant_id,approval.authority_id,approval.action_hash,r.platform_intent_version
 FROM ap_receipts receipt JOIN ap_attempts a ON a.id=receipt.attempt_id AND a.tenant_id=receipt.tenant_id AND a.user_id=receipt.user_id AND a.purchase_id=receipt.purchase_id
 JOIN ap_purchases p ON p.id=a.purchase_id AND p.tenant_id=a.tenant_id AND p.user_id=a.user_id
 JOIN ap_orders o ON o.purchase_id=a.purchase_id AND o.provider_order_id=a.provider_order_id
 LEFT JOIN ap_approvals approval ON approval.purchase_id=a.purchase_id AND approval.reserved_attempt_id=a.id
 LEFT JOIN ap_authority_requests r ON r.purchase_id=a.purchase_id AND r.execution_id=a.id
 WHERE receipt.id=$1 AND receipt.tenant_id=$2 AND receipt.user_id=$3`,[receiptId,actor.tenant_id,actor.user_id])).rows[0];
 if(!row)throw new Error('NOT_FOUND');
 const original={tenantId:row.tenant_id,purchaseId:row.purchase_id,intentVersion:row.platform_intent_version??null,
 intentHash:row.action_hash??null,authorizationId:row.authority_id??null,attemptId:row.id,requestId:row.request_id,
 orderId:row.provider_order_id,captureId:row.provider_capture_id,merchantId:row.merchant_id,amount:row.amount,currency:row.currency};
 let capture;
 try{const order=await provider.getOrder(row.provider_order_id);if(order.intent!=='CAPTURE')return {status:'INVALID',reason:'PROVIDER_BINDING_MISMATCH'};
 const {completedCapture}=await import('./client.mjs');capture=completedCapture(order,row.provider_order_id,{amount:row.amount,currency:row.currency,merchantId:row.merchant_id});}
 catch(error){return ['PROVIDER_BINDING_MISMATCH','CAPTURE_BINDING_MISMATCH','AMBIGUOUS_PROVIDER_CAPTURES'].includes(error.message)
 ?{status:'INVALID',reason:'PROVIDER_BINDING_MISMATCH'}:{status:'INCOMPLETE',reason:'PROVIDER_REVERIFICATION_UNAVAILABLE'};}
 const observation=await verifyExecutionEvidence(row.evidence,original,capture);
 if(observation.status==='INVALID'||!observation.receiverSignatureVerified)return observation;
 if(!config||!row.authority_grant||!row.authority_envelope||!row.authority_consumed_at)
  return {status:'INCOMPLETE',reason:'ORIGINAL_AUTHORIZATION_BINDING_REQUIRED'};
 try{assertReferenceQuote({...row,id:row.purchase_id,user_id:actor.user_id},new Date(row.authority_consumed_at));}
 catch{return {status:'INVALID',reason:'QUOTE_BINDING_MISMATCH'};}
 try{
  const grant=row.authority_grant;
  if(grant.id!==original.authorizationId||grant.actionHash!==original.intentHash||grant.intentVersion!==original.intentVersion||grant.intentVersion!==config.intentVersion||!grant.approvalId)
   return {status:'INVALID',reason:'AUTHORITY_BINDING_MISMATCH'};
  const expectedEnvelope=purchaseEnvelope({tenantId:config.tenantId,localTenantId:actor.tenant_id,
   principalId:actor.user_id,purchaseVersion:row.purchase_version,purchaseId:row.purchase_id,
   providerOrderId:row.provider_order_id,executionId:row.id,merchantId:row.merchant_id,amount:row.amount,currency:row.currency,quoteDigest:row.quote_digest},config);
  if(canonicalizeEnvelope(expectedEnvelope)!==canonicalizeEnvelope(row.authority_envelope))
   return {status:'INVALID',reason:'AUTHORITY_BINDING_MISMATCH'};
  const adapter=new TwoayeAuthorityAdapter(config);
  await adapter.verifier.refreshKeys();
  await adapter.verifier.verify(grant,{tenantId:config.tenantId,agentId:config.agentId,intentId:config.intentId,
   envelope:row.authority_envelope,now:new Date(row.authority_consumed_at).getTime(),allowConsumed:true});
  const approval=await adapter.approval(grant.approvalId);
  if(approval.id!==grant.approvalId||approval.tenantId!==config.tenantId||approval.intentId!==config.intentId||approval.agentId!==config.agentId||
   approval.status!=='Approved'||approval.authorizationId!==grant.id||approval.actionHash!==grant.actionHash||
   approval.decidedBy!==config.principalId||!approval.decidedByDeviceId||!approval.confirmationMethod)
   return {status:'INVALID',reason:'DEVICE_APPROVAL_REQUIRED'};
  const receipt=await adapter.receiptFor(grant.id);
  if(!receipt)return {status:'INCOMPLETE',reason:'CANONICAL_RECEIPT_REQUIRED'};
  const expected=createHash('sha256').update(JSON.stringify(row.evidence)).digest('hex').toUpperCase();
  if(receipt.tenantId!==config.tenantId||receipt.authorizationId!==grant.id||receipt.intentId!==config.intentId||
   receipt.intentVersion!==grant.intentVersion||receipt.status!=='Succeeded'||receipt.comparison!=='Matched'||
   receipt.externalReference!==capture.captureId||receipt.evidenceHash?.toUpperCase()!==expected)
   return {status:'INVALID',reason:'CANONICAL_RECEIPT_MISMATCH'};
  return {status:'VERIFIED',receiverSignatureVerified:true,issuerGrantSignatureVerified:true,
   providerReverified:true,canonicalReceiptMatched:true,scope:'AgentPay receiver effect; canonical platform receipt is an authenticated record'};
 }catch{return {status:'INCOMPLETE',reason:'ISSUER_VERIFICATION_UNAVAILABLE'};}
}
