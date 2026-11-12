import {WorkflowError} from './workflow.mjs';
import {verifyExecutionEvidence,verifyStoredReceipt} from './paypal/evidence.mjs';
import {executionReadiness} from './execution-readiness.mjs';
/** @param {{provider?: any, config?: any}} [options] */
export async function transactionDetail(pool,actor,id,options={}){
 const {provider=null,config}=options;
 const purchase=(await pool.query('SELECT id,tenant_id,user_id,item_id,quantity,amount,currency,merchant_id,state,version,quote,quote_digest FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3',[id,actor.tenant_id,actor.user_id])).rows[0];
 if(!purchase)throw new WorkflowError('NOT_FOUND',404);
 const args=[id,actor.tenant_id,actor.user_id];
 const [orders,attempts,authority,observations,receipts]=await Promise.all([
 pool.query('SELECT provider_order_id,buyer_status,provider_status,verified_at FROM ap_orders WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3',args),
 pool.query('SELECT id,state,reconciliation_count,next_reconciliation_at FROM ap_attempts WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3',args),
 pool.query('SELECT state,expires_at FROM ap_authority_requests WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3',args),
 pool.query('SELECT outcome,observed_at,metadata FROM ap_provider_observations WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3 ORDER BY observed_at DESC LIMIT 50',args),
 pool.query('SELECT id,provider_capture_id,evidence,platform_receipt FROM ap_receipts WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3',args)]);
 const task=(await pool.query('SELECT task_id FROM ap_task_purchases WHERE tenant_id=$1 AND user_id=$2 AND purchase_id=$3',[actor.tenant_id,actor.user_id,id])).rows[0];
 const merchantOrder=(await pool.query('SELECT id,state,quote_digest,receipt_id,accepted_at FROM ap_reference_merchant_orders WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3',args)).rows[0]??null;
 const audit=(await pool.query('SELECT event,occurred_at FROM ap_audit WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3 ORDER BY id LIMIT 200',args)).rows;
 const ai=(await pool.query("SELECT model,budget,proposal,created_at FROM ap_ai_proposals WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3 AND state='READY' ORDER BY created_at DESC LIMIT 1",args)).rows[0]??null;
 const probes=(await pool.query('SELECT decision,created_at FROM ap_trust_replay_probes WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3 ORDER BY created_at DESC LIMIT 20',args)).rows;
 return {purchase,audit,ai,probes,merchantOrder,taskId:task?.task_id??null,orders:orders.rows,attempts:attempts.rows,authority:authority.rows[0]??{state:'UNAVAILABLE'},observations:observations.rows,
 receipts:await Promise.all(receipts.rows.map(async row=>({...row,verification:provider
 ?await verifyStoredReceipt(pool,actor,row.id,provider,config?{config}:{})
 :await verifyExecutionEvidence(row.evidence,{tenantId:actor.tenant_id,purchaseId:id})}))),
 ...executionReadiness(actor,purchase,orders.rows,authority.rows[0],attempts.rows)};
}
