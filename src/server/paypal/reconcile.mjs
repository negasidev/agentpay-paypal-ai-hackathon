import {randomUUID} from 'node:crypto';
import {WorkflowError} from '../workflow.mjs';
import {completedCapture} from './client.mjs';
import {buildEvidence} from './evidence.mjs';
import {authorityConfig} from '../authorization/requests.mjs';
import {TwoayeAuthorityAdapter} from '../authorization/twoaye.mjs';
export async function reconcileAttempt(pool,actor,attemptId,provider,{force=false,authority=authorityConfig(actor)}={}){
 const db=await pool.connect();let locked=false;
 try{
 const row=(await db.query(`SELECT a.*,o.amount,o.currency,
 o.merchant_id,approval.authority_id,approval.action_hash,r.platform_intent_version
 FROM ap_attempts a JOIN ap_purchases p ON p.id=a.purchase_id AND p.tenant_id=a.tenant_id AND p.user_id=a.user_id
 LEFT JOIN ap_orders o ON o.purchase_id=p.id AND o.provider_order_id=a.provider_order_id
 LEFT JOIN ap_approvals approval ON approval.purchase_id=p.id AND approval.reserved_attempt_id=a.id
 LEFT JOIN ap_authority_requests r ON r.purchase_id=p.id AND r.execution_id=a.id
 WHERE a.id=$1 AND a.tenant_id=$2 AND a.user_id=$3`,[attemptId,actor.tenant_id,actor.user_id])).rows[0];
 if(!row)throw new WorkflowError('NOT_FOUND',404);
 // Session locking spans provider I/O without holding a database transaction.
 // Process death releases the lock; durable STARTED observations remain recoverable.
 await db.query('SELECT pg_advisory_lock(hashtextextended($1,6))',[attemptId]);locked=true;
 const current=(await db.query('SELECT * FROM ap_attempts WHERE id=$1',[attemptId])).rows[0];
 if(current.state==='COMPLETED')return {state:'COMPLETED',paymentOutcome:'CAPTURED',receiptVerification:'INCOMPLETE'};
 if(current.state==='CAPTURE_PENDING'&&Date.now()-new Date(current.created_at).getTime()>60000){
  await db.query("UPDATE ap_attempts SET state='UNKNOWN' WHERE id=$1 AND state='CAPTURE_PENDING'",[attemptId]);current.state='UNKNOWN';
 }
 if(current.state!=='UNKNOWN')throw new WorkflowError('INVALID_TRANSITION');
 if(!row.amount||!row.currency||!row.merchant_id)throw new WorkflowError('ORIGINAL_ORDER_BINDING_REQUIRED');
 if(!force&&(current.reconciliation_count>=8||current.next_reconciliation_at&&new Date(current.next_reconciliation_at)>new Date()))return {state:'UNKNOWN',scheduled:true,manualReview:current.reconciliation_count>=8};
 await db.query('BEGIN');
 await db.query(`UPDATE ap_attempts SET reconciliation_count=reconciliation_count+1,
 next_reconciliation_at=now()+make_interval(secs=>LEAST(900,30*power(2,LEAST(reconciliation_count,5)))::int) WHERE id=$1`,[attemptId]);
 await observation(db,row,'STARTED',{requestId:row.request_id});await db.query('COMMIT');
 let capture;
 try{
 const order=await provider.getOrder(row.provider_order_id);
 if(order.intent!=='CAPTURE')throw new Error('PROVIDER_INTENT_MISMATCH');
 capture=completedCapture(order,row.provider_order_id,{amount:row.amount,currency:row.currency,merchantId:row.merchant_id});
 }catch(error){await observation(db,row,'REFUSED',{reason:['PROVIDER_BINDING_MISMATCH','CAPTURE_BINDING_MISMATCH','AMBIGUOUS_PROVIDER_CAPTURES','PROVIDER_INTENT_MISMATCH'].includes(error.message)?error.message:'PROVIDER_UNAVAILABLE'});return {state:'UNKNOWN',scheduled:true};}
 if(!capture){await observation(db,row,'UNKNOWN',{reason:'NO_AFFIRMATIVE_COMPLETION'});return {state:'UNKNOWN',scheduled:true};}
 const evidence=buildEvidence(row,capture,new Date().toISOString());
 let authorityVerified=false;
 if(authority&&row.authority_consumed_at&&row.authority_grant&&row.authority_envelope&&row.authority_grant.intentVersion===row.platform_intent_version&&row.authority_grant.id===row.authority_id){
  try{
   const adapter=new TwoayeAuthorityAdapter(authority);await adapter.verifier.refreshKeys();
   await adapter.verifier.verify(row.authority_grant,{tenantId:authority.tenantId,agentId:authority.agentId,intentId:authority.intentId,envelope:row.authority_envelope,now:new Date(row.authority_consumed_at).getTime(),allowConsumed:true});
   authorityVerified=true;
  }catch{}
 }
 await db.query('BEGIN');
 await db.query(`INSERT INTO ap_receipts(id,tenant_id,user_id,purchase_id,attempt_id,provider_capture_id,outcome,evidence)
 VALUES($1,$2,$3,$4,$5,$6,'COMPLETED',$7)`,[randomUUID(),actor.tenant_id,actor.user_id,row.purchase_id,attemptId,capture.captureId,JSON.stringify(evidence)]);
 await observation(db,row,'CAPTURED',{captureId:capture.captureId,evidenceHash:evidence.integrityHash});
 await db.query("UPDATE ap_attempts SET state='COMPLETED',next_reconciliation_at=NULL WHERE id=$1",[attemptId]);
 await db.query('UPDATE ap_purchases SET state=$4 WHERE id=$1 AND tenant_id=$2 AND user_id=$3',[row.purchase_id,actor.tenant_id,actor.user_id,authorityVerified?'COMPLETED':'UNKNOWN']);
 await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[actor.tenant_id,actor.user_id,row.purchase_id,authorityVerified?'capture.reconciled.authorized':'capture.reconciled.provider-only']);await db.query('COMMIT');
 return {state:'COMPLETED',paymentOutcome:'CAPTURED',captureId:capture.captureId,receiptVerification:authorityVerified?'PROVIDER_CONFIRMED':'INCOMPLETE',authorityReceiptVerified:false};
 }catch(error){await db.query('ROLLBACK');throw error;}
 finally{try{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,6))',[attemptId]);}finally{db.release();}}
}
async function observation(db,row,outcome,metadata){await db.query('INSERT INTO ap_provider_observations(id,tenant_id,user_id,purchase_id,attempt_id,outcome,metadata) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),row.tenant_id,row.user_id,row.purchase_id,row.id,outcome,JSON.stringify(metadata)]);}
