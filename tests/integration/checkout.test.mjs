import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createPool} from '../../src/server/persistence/db.mjs';import {provision} from '../../src/server/auth.mjs';
import {createPurchase,transition} from '../../src/server/workflow.mjs';
import {createCheckout,checkoutOutcome,checkoutStatus} from '../../src/server/paypal/checkout.mjs';
test('checkout orders persist consent independently, reject tampering and recover safely',async()=>{
 let pool=createPool();try{
  const u=await provision(pool,`checkout-${randomUUID()}@example.test`,'checkout-test-password');const a={tenant_id:u.tenantId,user_id:u.id};
  const p=await createPurchase(pool,a,'keyboard');await transition(pool,a,p.id,'review');await transition(pool,a,p.id,'submit');
  let creates=0,status='CREATED',wrongAmount=false;
  const provider={async createOrder(){creates++;return {id:'FIXTURE-'+randomUUID()};},async getOrder(id){return {id,intent:'CAPTURE',status,purchase_units:[{amount:{value:wrongAmount?'119.01':p.amount,currency_code:p.currency},payee:{merchant_id:p.merchant_id}}]};},captureOrder(){assert.fail('capture prohibited');}};
  await assert.rejects(createCheckout(pool,{...a,user_id:randomUUID()},p.id,p.merchant_id,provider),/NOT_FOUND/);
  const outcomes=await Promise.all(Array.from({length:12},()=>createCheckout(pool,a,p.id,p.merchant_id,provider)));assert.equal(creates,1);const id=outcomes[0].orderId;
  await assert.rejects(checkoutOutcome(pool,a,p.id,'verify','WRONG',provider),/ORDER_ID_MISMATCH/);
  await assert.rejects(checkoutOutcome(pool,a,p.id,'verify',id,provider),/BUYER_APPROVAL_NOT_VERIFIED/);
  await checkoutOutcome(pool,a,p.id,'cancel',id,provider);assert.equal((await checkoutStatus(pool,a,p.id)).buyerStatus,'CANCELED');
  await pool.end();pool=createPool();assert.equal((await createCheckout(pool,a,p.id,p.merchant_id,provider)).orderId,id);assert.equal(creates,1);
  status='APPROVED';wrongAmount=true;await assert.rejects(checkoutOutcome(pool,a,p.id,'verify',id,provider),/PROVIDER_BINDING_MISMATCH/);wrongAmount=false;
  await checkoutOutcome(pool,a,p.id,'verify',id,provider);assert.equal((await checkoutStatus(pool,a,p.id)).buyerStatus,'APPROVED');
  assert.equal((await checkoutOutcome(pool,a,p.id,'cancel',id,provider)).buyerStatus,'APPROVED');
  await assert.rejects(transition(pool,a,p.id,'capture'),/VERIFIED_EXTERNAL_AUTHORITY_REQUIRED/);
  const unknown=await createPurchase(pool,a,'keyboard');await transition(pool,a,unknown.id,'review');let tries=0;
  const timeout={async createOrder(){tries++;throw new Error('timeout');}};
  await assert.rejects(createCheckout(pool,a,unknown.id,unknown.merchant_id,timeout));await assert.rejects(createCheckout(pool,a,unknown.id,unknown.merchant_id,timeout),/ORDER_CREATION_UNKNOWN/);assert.equal(tries,1);
 }finally{await pool.end();}
});
