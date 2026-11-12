import {requireSandboxWriter} from '../sandbox-membership.mjs';
import {randomUUID} from 'node:crypto';
import {transaction} from '../persistence/db.mjs';
import {ProviderError,validatePurchase} from './client.mjs';
import {verifySandboxOrder} from './order-probe.mjs';
import {assertReferenceQuote} from '../shopping/reference-merchant.mjs';
const scoped='SELECT * FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3';
async function atomic(db,work){await db.query('BEGIN');try{const result=await work(db);await db.query('COMMIT');return result;}catch(error){await db.query('ROLLBACK');throw error;}}
async function audit(db,a,id,event){await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[a.tenant_id,a.user_id,id,event]);}
export async function createCheckout(pool,actor,id,merchantId,provider){
  await requireSandboxWriter(pool,actor);
  const db=await pool.connect();let locked=false;
  try{
    await db.query('SELECT pg_advisory_lock(hashtextextended($1,1))',[id]);locked=true;
    const purchase=(await db.query(scoped,[id,actor.tenant_id,actor.user_id])).rows[0];
    if(!purchase)throw new ProviderError('NOT_FOUND');
    assertReferenceQuote(purchase);
    if(!['REVIEWED','AUTHORIZATION_PENDING'].includes(purchase.state))throw new ProviderError('INVALID_TRANSITION');
    if(purchase.merchant_id!==merchantId)throw new ProviderError('MERCHANT_CHANGED');
    const prior=(await db.query('SELECT * FROM ap_orders WHERE purchase_id=$1',[id])).rows[0];
    if(prior){
      if(prior.purchase_version!==purchase.version||prior.merchant_id!==merchantId)throw new ProviderError('INTENT_CHANGED');
      const order=await provider.getOrder(prior.provider_order_id);
      verifySandboxOrder(order,prior.provider_order_id,{amount:prior.amount,currency:prior.currency,merchantId:prior.merchant_id});
      if(!['CREATED','APPROVED'].includes(order.status))throw new ProviderError('PROVIDER_STATUS_UNCERTAIN');
      await db.query('UPDATE ap_orders SET provider_status=$2,verified_at=now() WHERE purchase_id=$1',[id,order.status]);
      return {orderId:prior.provider_order_id,captureEnabled:false};
    }
    const trusted={amount:purchase.amount,currency:purchase.currency,merchantId};validatePurchase(trusted);
    const priorAttempt=(await db.query('SELECT * FROM ap_checkout_creations WHERE purchase_id=$1',[id])).rows[0];
    if(priorAttempt)throw new ProviderError('ORDER_CREATION_UNKNOWN');
    const requestId=randomUUID();
    await db.query("INSERT INTO ap_checkout_creations VALUES($1,$2,$3,$4,$5,$6,$7,$8,'UNKNOWN')",[id,actor.tenant_id,actor.user_id,requestId,purchase.version,trusted.amount,trusted.currency,merchantId]);
    const result=await provider.createOrder(trusted,requestId);
    if(!/^[A-Za-z0-9-]{1,64}$/.test(result?.id??''))throw new ProviderError('INVALID_ORDER_ID');
    // Persist the returned identity before retrieval so a read timeout cannot cause another create.
    await atomic(db,async tx=>{
      await tx.query('INSERT INTO ap_orders(id,tenant_id,user_id,purchase_id,provider_order_id,request_id,purchase_version,amount,currency,merchant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),actor.tenant_id,actor.user_id,id,result.id,requestId,purchase.version,trusted.amount,trusted.currency,merchantId]);
      await tx.query("UPDATE ap_checkout_creations SET state='CREATED' WHERE purchase_id=$1",[id]);await audit(tx,actor,id,'checkout.order_created');
    });
    const actual=await provider.getOrder(result.id);verifySandboxOrder(actual,result.id,trusted);
    await db.query('UPDATE ap_orders SET provider_status=$2,verified_at=now() WHERE purchase_id=$1',[id,actual.status]);
    return {orderId:result.id,captureEnabled:false};
  }finally{try{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,1))',[id]);}finally{db.release();}}
}
export async function checkoutOutcome(pool,actor,id,action,orderId,provider){
  await requireSandboxWriter(pool,actor);
  const purchase=(await pool.query(scoped,[id,actor.tenant_id,actor.user_id])).rows[0];
  if(!purchase)throw new ProviderError('NOT_FOUND');
  const stored=(await pool.query('SELECT * FROM ap_orders WHERE purchase_id=$1',[id])).rows[0];
  if(!stored)throw new ProviderError('NOT_FOUND');
  if(stored.provider_order_id!==orderId)throw new ProviderError('ORDER_ID_MISMATCH');
  if(action==='cancel')return transaction(pool,async db=>{
    const row=(await db.query("UPDATE ap_orders SET buyer_status=CASE WHEN buyer_status='APPROVED' THEN buyer_status ELSE 'CANCELED' END WHERE purchase_id=$1 RETURNING buyer_status",[id])).rows[0];
    await audit(db,actor,id,'checkout.buyer_cancel_callback');return {buyerStatus:row.buyer_status,providerCancellation:false,captureEnabled:false};
  });
  if(action!=='verify')throw new ProviderError('INVALID_ACTION');
  const actual=await provider.getOrder(orderId);
  verifySandboxOrder(actual,orderId,{amount:stored.amount,currency:stored.currency,merchantId:stored.merchant_id});
  if(actual.status!=='APPROVED')throw new ProviderError('BUYER_APPROVAL_NOT_VERIFIED');
  return transaction(pool,async db=>{
    const current=(await db.query(scoped+' FOR UPDATE',[id,actor.tenant_id,actor.user_id])).rows[0];
    if(current.version!==stored.purchase_version||!['REVIEWED','AUTHORIZATION_PENDING'].includes(current.state))throw new ProviderError('INTENT_CHANGED');
    await db.query("UPDATE ap_orders SET buyer_status='APPROVED',provider_status='APPROVED',verified_at=now() WHERE purchase_id=$1",[id]);await audit(db,actor,id,'checkout.buyer_verified');
    return {buyerStatus:'APPROVED',paymentCompleted:false,captureEnabled:false};
  });
}
export async function checkoutStatus(pool,actor,id){
  const purchase=(await pool.query(scoped,[id,actor.tenant_id,actor.user_id])).rows[0];if(!purchase)throw new ProviderError('NOT_FOUND');
  const order=(await pool.query('SELECT provider_order_id,buyer_status,provider_status FROM ap_orders WHERE purchase_id=$1',[id])).rows[0];
  return {orderId:order?.provider_order_id??null,buyerStatus:order?.buyer_status??'NOT_APPROVED',providerStatus:order?.provider_status??null,captureEnabled:false};
}
