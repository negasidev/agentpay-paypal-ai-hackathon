import {WorkflowError} from '../workflow.mjs';
import {verifyStoredReceipt} from '../paypal/evidence.mjs';
import {assertReferenceQuote} from './reference-merchant.mjs';

export async function acceptReferenceOrder(pool,actor,purchaseId,provider,options={}){
 const db=await pool.connect();
 try{
  await db.query('BEGIN');
  const row=(await db.query(`SELECT m.*,p.quote,p.item_id,p.quantity,p.merchant_id,p.amount,p.currency
   FROM ap_reference_merchant_orders m JOIN ap_purchases p ON p.id=m.purchase_id AND p.tenant_id=m.tenant_id AND p.user_id=m.user_id
   WHERE m.purchase_id=$1 AND m.tenant_id=$2 AND m.user_id=$3 FOR UPDATE OF m,p`,[purchaseId,actor.tenant_id,actor.user_id])).rows[0];
  if(!row)throw new WorkflowError('NOT_FOUND',404);
  const receipt=(await db.query(`SELECT r.id,a.authority_consumed_at FROM ap_receipts r JOIN ap_attempts a ON a.id=r.attempt_id
   WHERE r.purchase_id=$1 AND r.tenant_id=$2 AND r.user_id=$3`,[purchaseId,actor.tenant_id,actor.user_id])).rows[0];
  if(!receipt?.authority_consumed_at)throw new WorkflowError('VERIFIED_PAYMENT_REQUIRED',409);
  assertReferenceQuote({...row,id:purchaseId},new Date(receipt.authority_consumed_at));
  // Merchant acceptance is a distinct mutation after provider and issuer checks;
  // a purchase state or caller-supplied capture ID cannot stand in for evidence.
  const verification=await verifyStoredReceipt(db,actor,receipt.id,provider,options);
  if(verification.status!=='VERIFIED')throw new WorkflowError('VERIFIED_PAYMENT_REQUIRED',409);
  const result=(await db.query(`UPDATE ap_reference_merchant_orders SET state='ACCEPTED_SANDBOX',receipt_id=$2,
   accepted_at=COALESCE(accepted_at,now()) WHERE id=$1 RETURNING id,state,receipt_id,accepted_at`,[row.id,receipt.id])).rows[0];
  if(row.state!=='ACCEPTED_SANDBOX')await db.query("INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,'merchant.reference.accepted')",[actor.tenant_id,actor.user_id,purchaseId]);
  await db.query('COMMIT');return {...result,fulfillment:'NO_REAL_GOODS'};
 }catch(error){await db.query('ROLLBACK');throw error;}finally{db.release();}
}
