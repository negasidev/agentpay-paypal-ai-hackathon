import {randomUUID} from 'node:crypto';
import {ProviderError, validatePurchase} from './client.mjs';

export function verifySandboxOrder(order, orderId, purchase) {
  validatePurchase(purchase);
  const unit = order?.purchase_units?.[0];
  if (!/^[A-Za-z0-9-]{1,64}$/.test(orderId ?? '') || order?.id !== orderId ||
      order.intent !== 'CAPTURE' || !['CREATED','APPROVED','PAYER_ACTION_REQUIRED'].includes(order.status) ||
      !Array.isArray(order.purchase_units) || order.purchase_units.length !== 1 ||
      unit.amount?.value !== purchase.amount || unit.amount?.currency_code !== purchase.currency ||
      unit.payee?.merchant_id !== purchase.merchantId || unit.payments)
    throw new ProviderError('PROVIDER_BINDING_MISMATCH');
}

// Separate evidence cannot be mistaken for ap_orders, which participates in capture reservation.
export async function probeSandboxOrder(pool, actor, purchaseId, merchantId, provider) {
  const db = await pool.connect();
  let locked = false;
  try {
    const purchase = (await db.query('SELECT * FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3',
      [purchaseId,actor.tenant_id,actor.user_id])).rows[0];
    if (!purchase) throw new ProviderError('NOT_FOUND');
    const trusted = {amount:purchase.amount,currency:purchase.currency,merchantId};
    validatePurchase(trusted);
    await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[purchaseId]); locked = true;
    await db.query("INSERT INTO ap_sandbox_order_probes(purchase_id,tenant_id,user_id,request_id,merchant_id,state) VALUES($1,$2,$3,$4,$5,'PENDING') ON CONFLICT(purchase_id) DO NOTHING",
      [purchaseId,actor.tenant_id,actor.user_id,randomUUID(),merchantId]);
    let record = (await db.query('SELECT * FROM ap_sandbox_order_probes WHERE purchase_id=$1',[purchaseId])).rows[0];
    if (record.merchant_id !== merchantId) throw new ProviderError('MERCHANT_CHANGED');
    // An uncertain creation is never automatically repeated after the provider idempotency window.
    if (!record.provider_order_id && record.state === 'UNKNOWN') throw new ProviderError('ORDER_CREATION_UNKNOWN');
    if (!record.provider_order_id) {
      await db.query("UPDATE ap_sandbox_order_probes SET state='UNKNOWN' WHERE purchase_id=$1",[purchaseId]);
      const created = await provider.createOrder(trusted,record.request_id);
      if (!/^[A-Za-z0-9-]{1,64}$/.test(created?.id ?? '')) throw new ProviderError('INVALID_ORDER_ID');
      await db.query('UPDATE ap_sandbox_order_probes SET provider_order_id=$1 WHERE purchase_id=$2',[created.id,purchaseId]);
      record = {...record,provider_order_id:created.id};
    }
    const retrieved = await provider.getOrder(record.provider_order_id);
    verifySandboxOrder(retrieved,record.provider_order_id,trusted);
    await db.query("UPDATE ap_sandbox_order_probes SET state='VERIFIED',verified_at=now(),provider_status=$2 WHERE purchase_id=$1",[purchaseId,retrieved.status]);
    return {environment:'sandbox',orderId:record.provider_order_id,providerStatus:retrieved.status,
      amount:trusted.amount,currency:trusted.currency,retrievalVerified:true,captureEnabled:false};
  } finally {
    try { if (locked) await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[purchaseId]); }
    finally { db.release(); }
  }
}
