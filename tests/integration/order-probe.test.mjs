import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../../src/server/persistence/db.mjs';
import {provision} from '../../src/server/auth.mjs';
import {createPurchase} from '../../src/server/workflow.mjs';
import {probeSandboxOrder,verifySandboxOrder} from '../../src/server/paypal/order-probe.mjs';
import {buyerOutcome} from '../../src/server/paypal/buyer.mjs';
const trusted={amount:'119.00',currency:'USD',merchantId:'MERCHANT-1'};
const order={id:'FIXTURE-ORDER',intent:'CAPTURE',status:'CREATED',purchase_units:[{amount:{value:'119.00',currency_code:'USD'},payee:{merchant_id:'MERCHANT-1'}}]};
test('retrieved order refuses material mismatch and existing payments',()=>{
  verifySandboxOrder(order,order.id,trusted);
  for(const changed of [{...trusted,amount:'119.01'},{...trusted,merchantId:'OTHER'}])assert.throws(()=>verifySandboxOrder(order,order.id,changed));
  assert.throws(()=>verifySandboxOrder({...order,purchase_units:[{...order.purchase_units[0],payments:{}}]},order.id,trusted));
  assert.throws(()=>verifySandboxOrder({...order,intent:'AUTHORIZE'},order.id,trusted));
});
test('durable sandbox probe is scoped, serialized and never grants capture eligibility',async()=>{
  const pool=createPool();
  try {
    const user=await provision(pool,`probe-${randomUUID()}@example.test`,'probe-evaluation-password');
    const actor={tenant_id:user.tenantId,user_id:user.id};
    const purchase=await createPurchase(pool,actor,'keyboard');
    let creates=0;
    const provider={async createOrder(){creates++;return {...order,id:'FIXTURE-'+randomUUID()};},async getOrder(id){return {...order,id};},captureOrder(){assert.fail('capture prohibited');}};
    await assert.rejects(probeSandboxOrder(pool,{...actor,user_id:randomUUID()},purchase.id,trusted.merchantId,provider),/NOT_FOUND/);
    await Promise.all(Array.from({length:5},()=>probeSandboxOrder(pool,actor,purchase.id,trusted.merchantId,provider)));
    assert.equal(creates,1);
    assert.equal((await pool.query('SELECT state FROM ap_sandbox_order_probes WHERE purchase_id=$1',[purchase.id])).rows[0].state,'VERIFIED');
    assert.equal((await pool.query('SELECT state FROM ap_purchases WHERE id=$1',[purchase.id])).rows[0].state,'DRAFT');
    assert.equal((await pool.query('SELECT count(*) FROM ap_orders WHERE purchase_id=$1',[purchase.id])).rows[0].count,'0');
    await assert.rejects(buyerOutcome(pool,{...actor,user_id:randomUUID()},purchase.id,'verify',provider),/NOT_FOUND/);
    await assert.rejects(buyerOutcome(pool,actor,purchase.id,'verify',provider),/BUYER_APPROVAL_NOT_VERIFIED/);
    const canceled=await buyerOutcome(pool,actor,purchase.id,'cancel',provider);assert.equal(canceled.providerCancellation,false);
    const approved={async getOrder(id){return {...order,id,status:'APPROVED'};}};
    assert.equal((await buyerOutcome(pool,actor,purchase.id,'verify',approved)).paymentCompleted,false);
    assert.equal((await pool.query('SELECT buyer_status FROM ap_sandbox_order_probes WHERE purchase_id=$1',[purchase.id])).rows[0].buyer_status,'APPROVED');
    const uncertain=await createPurchase(pool,actor,'keyboard');let attempts=0;
    const unavailable={async createOrder(){attempts++;throw new Error('timeout');}};
    await assert.rejects(probeSandboxOrder(pool,actor,uncertain.id,trusted.merchantId,unavailable));
    await assert.rejects(probeSandboxOrder(pool,actor,uncertain.id,trusted.merchantId,unavailable),/ORDER_CREATION_UNKNOWN/);
    assert.equal(attempts,1);
  }finally{await pool.end();}
});
