import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {canonicalizeEnvelope} from '@verid/agent-sdk';
import {WorkflowError} from '../workflow.mjs';
import {authorityConfig} from '../authorization/requests.mjs';
import {purchaseEnvelope,TwoayeAuthorityAdapter} from '../authorization/twoaye.mjs';
import {assertApprovedOrder,completedCapture} from './client.mjs';
import {buildEvidence} from './evidence.mjs';
import {recordPlatformReceipt} from './platform-receipt.mjs';
import {assertReferenceQuote} from '../shopping/reference-merchant.mjs';

const digest=e=>createHash('sha256').update(canonicalizeEnvelope(e)).digest();
async function atomic(db,work){await db.query('BEGIN');try{const result=await work(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}}
export function assertExecutionBinding(p,order,request,config){
 assertReferenceQuote(p);
 if(!config||request.platform_intent_id!==config.intentId||request.platform_intent_version!==config.intentVersion||
 request.purchase_version!==p.version||order.purchase_version!==p.version||order.provider_order_id!==request.provider_order_id||
 order.amount!==p.amount||order.currency!==p.currency||order.merchant_id!==p.merchant_id||order.buyer_status!=='APPROVED'||request.state!=='VERIFIED')throw new WorkflowError('INVALID_AUTHORITY_BINDING');
 const expected=purchaseEnvelope({tenantId:config.tenantId,localTenantId:p.tenant_id,principalId:p.user_id,purchaseVersion:p.version,purchaseId:p.id,providerOrderId:order.provider_order_id,executionId:request.execution_id,merchantId:p.merchant_id,amount:p.amount,currency:p.currency,quoteDigest:p.quote_digest},config);
 if(!timingSafeEqual(digest(expected),digest(request.envelope)))throw new WorkflowError('INVALID_AUTHORITY_BINDING');
}

export async function protectedCapture(pool,actor,id,provider,{config=authorityConfig(actor),enabled=process.env.AGENTPAY_PROTECTED_CAPTURE_ENABLED==='true',adapter=config?new TwoayeAuthorityAdapter(config):null}={}){
 if(!enabled||!adapter||!config)throw new WorkflowError('VERIFIED_EXTERNAL_AUTHORITY_REQUIRED',503);
 const db=await pool.connect();let locked=false,attemptLocked=false,released=false,redemptionStarted=false,attempt;
 try{
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,10))',[id]);locked=true;
  const reserved=await atomic(db,async tx=>{
   const p=(await tx.query('SELECT * FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE',[id,actor.tenant_id,actor.user_id])).rows[0];
   if(!p)throw new WorkflowError('NOT_FOUND',404);
   const prior=(await tx.query('SELECT * FROM ap_attempts WHERE purchase_id=$1',[id])).rows[0];
   if(prior)return {prior};
   if(p.state!=='AUTHORIZATION_PENDING')throw new WorkflowError('INVALID_TRANSITION');
   const order=(await tx.query('SELECT * FROM ap_orders WHERE purchase_id=$1',[id])).rows[0];
   const request=(await tx.query('SELECT * FROM ap_authority_requests WHERE purchase_id=$1',[id])).rows[0];
   const approval=(await tx.query('SELECT * FROM ap_approvals WHERE purchase_id=$1 AND expires_at>now() AND reserved_attempt_id IS NULL',[id])).rows[0];
   if(!order||!request||!approval||approval.authority_id!==request.grant_id)throw new WorkflowError('VERIFIED_EXTERNAL_AUTHORITY_REQUIRED',503);
   assertExecutionBinding(p,order,request,config);
   const result=(await tx.query("INSERT INTO ap_attempts(id,tenant_id,user_id,purchase_id,provider_order_id,request_id,state,authority_envelope,purchase_version) VALUES($1,$2,$3,$4,$5,$6,'CAPTURE_PENDING',$7,$8) RETURNING *",[request.execution_id,actor.tenant_id,actor.user_id,id,order.provider_order_id,randomUUID(),JSON.stringify(request.envelope),p.version])).rows[0];
   await tx.query('UPDATE ap_approvals SET reserved_attempt_id=$1 WHERE purchase_id=$2',[result.id,id]);
   await tx.query("UPDATE ap_purchases SET state='CAPTURE_PENDING' WHERE id=$1",[id]);
   await tx.query("INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,'capture.reserved')",[actor.tenant_id,actor.user_id,id]);
   return {attempt:result,p,order,request,approval};
  });
  if(reserved.prior)return {state:reserved.prior.state,attemptId:reserved.prior.id,reconciliationRequired:reserved.prior.state!=='COMPLETED'};
  attempt=reserved.attempt;const {p,order,request}=reserved;
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,6))',[attempt.id]);attemptLocked=true;
  const terms={amount:p.amount,currency:p.currency,merchantId:p.merchant_id};
  const actual=await provider.getOrder(order.provider_order_id);
  if(actual.intent!=='CAPTURE')throw new WorkflowError('PROVIDER_BINDING_MISMATCH');
  assertApprovedOrder(actual,order.provider_order_id,terms);
  const {grant}=await adapter.verifyEnvelope(request.envelope,request.grant_id,request.platform_intent_version);
  if(grant.approvalId!==request.approval_request_id)throw new WorkflowError('DEVICE_APPROVAL_REQUIRED');
  const approval=await adapter.approval(request.approval_request_id);
  if(approval.id!==request.approval_request_id||approval.tenantId!==config.tenantId||approval.intentId!==config.intentId||approval.agentId!==config.agentId||approval.status!=='Approved'||approval.authorizationId!==grant.id||approval.decidedBy!==config.principalId||!approval.decidedByDeviceId||!approval.confirmationMethod||approval.actionHash!==grant.actionHash)throw new WorkflowError('DEVICE_APPROVAL_REQUIRED');
  assertReferenceQuote(p);
  redemptionStarted=true;
  await adapter.consumeEnvelope(request.envelope,request.grant_id,request.platform_intent_version);
  // An uncertain redemption never dispatches a payment. A committed dispatch
  // marker prevents process recovery from inventing a fresh provider request.
  await db.query('UPDATE ap_attempts SET authority_consumed_at=now(),authority_grant=$2 WHERE id=$1',[attempt.id,JSON.stringify(grant)]);
  assertReferenceQuote(p);
  await db.query('UPDATE ap_attempts SET dispatched_at=now() WHERE id=$1 AND authority_consumed_at IS NOT NULL',[attempt.id]);
  await provider.captureOrder(order.provider_order_id,attempt.request_id);
  const observed=await provider.getOrder(order.provider_order_id);
  if(observed.intent!=='CAPTURE')throw new WorkflowError('PROVIDER_BINDING_MISMATCH');
  const capture=completedCapture(observed,order.provider_order_id,terms);
  if(!capture)throw new WorkflowError('CAPTURE_UNKNOWN');
  const evidence=buildEvidence({...attempt,platform_intent_version:request.platform_intent_version,action_hash:grant.actionHash,authority_id:grant.id},capture,new Date().toISOString());
  await atomic(db,async tx=>{
   await tx.query("INSERT INTO ap_receipts(id,tenant_id,user_id,purchase_id,attempt_id,provider_capture_id,outcome,evidence) VALUES($1,$2,$3,$4,$5,$6,'COMPLETED',$7)",[randomUUID(),actor.tenant_id,actor.user_id,id,attempt.id,capture.captureId,JSON.stringify(evidence)]);
   await tx.query("UPDATE ap_attempts SET state='COMPLETED' WHERE id=$1",[attempt.id]);
   await tx.query("UPDATE ap_purchases SET state='COMPLETED' WHERE id=$1",[id]);
   await tx.query("INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,'capture.provider-confirmed')",[actor.tenant_id,actor.user_id,id]);
  });
  await db.query('SELECT pg_advisory_unlock(hashtextextended($1,6))',[attempt.id]);attemptLocked=false;
  await db.query('SELECT pg_advisory_unlock(hashtextextended($1,10))',[id]);locked=false;db.release();released=true;
  let platformReceipt='PENDING';
  try{await recordPlatformReceipt(pool,actor,attempt.id,config);platformReceipt='RECORDED';}catch{}
  return {state:'COMPLETED',paymentOutcome:'CAPTURED',receiptVerification:'PROVIDER_CONFIRMED',platformReceipt,authorityReceiptVerified:false};
 }catch(error){
  if(!attempt)throw error;
  const refused=!redemptionStarted&&['ORDER_NOT_AUTHORIZED','PROVIDER_BINDING_MISMATCH','DEVICE_APPROVAL_REQUIRED','expired_grant','revoked_grant','consumed_grant','unsigned_grant','invalid_signature','action_mismatch','tenant_mismatch','agent_mismatch','intent_mismatch','INTENT_VERSION_MISMATCH'].includes(error.code??error.message);
  await atomic(db,async tx=>{
   await tx.query("UPDATE ap_attempts SET state=$2 WHERE id=$1 AND state='CAPTURE_PENDING'",[attempt.id,refused?'FAILED':'UNKNOWN']);
   await tx.query("UPDATE ap_purchases SET state=$2 WHERE id=$1 AND state='CAPTURE_PENDING'",[id,refused?'REJECTED':'UNKNOWN']);
   await tx.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[actor.tenant_id,actor.user_id,id,refused?'capture.refused':'capture.unknown']);
  });
  return {state:refused?'REFUSED':'UNKNOWN',reconciliationRequired:!refused};
 }finally{try{if(attemptLocked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,6))',[attempt.id]);if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,10))',[id]);}finally{if(!released)db.release();}}
}
