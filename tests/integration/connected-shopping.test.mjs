import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aiDatabase} from '../fixtures/ai-database.mjs';
import {provision} from '../../src/server/auth.mjs';
import {shoppingRequest} from '../../src/server/shopping/requests.mjs';
import {taskAction,readTask,shoppingInputHash} from '../../src/server/shopping/tasks.mjs';
import {assertReferenceQuote,quoteDigest} from '../../src/server/shopping/reference-merchant.mjs';
import {transition} from '../../src/server/workflow.mjs';
import {createCheckout} from '../../src/server/paypal/checkout.mjs';
import {purchaseEnvelope} from '../../src/server/authorization/twoaye.mjs';
import {acceptReferenceOrder} from '../../src/server/shopping/merchant-order.mjs';

async function scenario(work){
 const database=await aiDatabase(),pool=database.connect();const previous=process.env.PAYPAL_SANDBOX_MERCHANT_ID;
 process.env.PAYPAL_SANDBOX_MERCHANT_ID='REFERENCE-MERCHANT';
 try{
  const user=await provision(pool,`connected-${randomUUID()}@example.test`,'connected-test-password');
  const actor={tenant_id:user.tenantId,user_id:user.id};
  const input={requestId:randomUUID(),instruction:'An ergonomic keyboard',maximumBudget:'200.00',catalogMode:'reference'};
  const created=await shoppingRequest(pool,actor,input,{configuration:()=>{throw Error('AI_NOT_CONFIGURED');}});
  const reviewed=await taskAction(pool,actor,created.task.id,{action:'select',expectedRevision:1,offerId:'reference:keyboard'});
  const action={action:'purchase',expectedRevision:reviewed.revision,reviewDigest:reviewed.reviewDigest};
  await work({pool,actor,input,created,reviewed,action});
 }finally{if(previous===undefined)delete process.env.PAYPAL_SANDBOX_MERCHANT_ID;else process.env.PAYPAL_SANDBOX_MERCHANT_ID=previous;await pool.end();await database.close();}
}

test('explicit reference catalog has no external-listing equivalence or fabricated AI/provider evidence',()=>scenario(async({pool,actor,input,created})=>{
 assert.equal(created.catalogMode,'reference');assert.equal(created.aiUsed,false);assert.equal(created.providerOutcome,'NOT_OBSERVED');
 assert.ok(created.offers.every(x=>x.url===null&&x.id.startsWith('reference:')));
 assert.notEqual(shoppingInputHash(input),shoppingInputHash({...input,catalogMode:undefined}));
 assert.equal((await pool.query('SELECT count(*) FROM ap_ai_proposals')).rows[0].count,'0');
 await assert.rejects(shoppingRequest(pool,actor,{...input,catalogMode:undefined},{configuration:()=>{throw Error('must-not-run');}}),/AI_REQUEST_CONFLICT/);
}));

test('concurrent purchase preparation and lost-response recovery retain one exact quote and purchase',()=>scenario(async({pool,actor,input,action})=>{
 const replies=await Promise.all(Array.from({length:12},()=>taskAction(pool,actor,input.requestId,action)));
 assert.equal(new Set(replies.map(x=>x.purchase.id)).size,1);
 assert.equal((await pool.query('SELECT count(*) FROM ap_purchases')).rows[0].count,'1');
 const restored=await readTask(pool,actor,input.requestId);
 assert.equal(restored.state,'PURCHASE_PREPARED');assert.equal(restored.purchase.id,replies[0].purchase.id);
 assert.equal(restored.purchase.taskId,input.requestId);assert.equal(restored.purchase.purchase.quote.total,'119.00');
 assert.equal(restored.purchase.merchantOrder.state,'AWAITING_PAYMENT');
 assert.equal((await pool.query('SELECT count(*) FROM ap_reference_merchant_orders')).rows[0].count,'1');
 await assert.rejects(acceptReferenceOrder(pool,actor,replies[0].purchase.id,{getOrder(){assert.fail('No evidence must not contact provider');}}),/VERIFIED_PAYMENT_REQUIRED/);
 assert.deepEqual(restored.events.map(x=>x.event),['options_recorded','selection_prepared','reference_purchase_prepared']);
 const p=(await pool.query('SELECT * FROM ap_purchases')).rows[0];assertReferenceQuote(p);
 assert.equal(p.quote_digest,quoteDigest(p.quote));assert.equal(p.quote.shipping,'0.00');assert.equal(p.quote.tax,'0.00');
 for(const table of ['ap_orders','ap_authority_requests','ap_attempts','ap_receipts'])assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
 await assert.rejects(taskAction(pool,actor,input.requestId,{action:'select',expectedRevision:restored.revision,offerId:'reference:compact-keyboard'}),/INVALID_TASK_STATE/);
}));

test('forged terms, review substitution and another account cannot prepare a reference purchase',()=>scenario(async({pool,actor,input,action})=>{
 for(const extra of ['amount','merchantId','productId','tenantId','quote'])await assert.rejects(taskAction(pool,actor,input.requestId,{...action,[extra]:'forged'}),/INVALID_TASK_ACTION/);
 await assert.rejects(taskAction(pool,actor,input.requestId,{...action,reviewDigest:'0'.repeat(64)}),/REVIEW_MISMATCH/);
 const other=await provision(pool,`other-${randomUUID()}@example.test`,'connected-test-password');
 await assert.rejects(taskAction(pool,{tenant_id:other.tenantId,user_id:other.id},input.requestId,action),/TASK_NOT_FOUND/);
 assert.equal((await pool.query('SELECT count(*) FROM ap_purchases')).rows[0].count,'0');
}));

test('reference quote mismatch and actual expiry refuse before provider order creation while history stays readable',()=>scenario(async({pool,actor,input,action})=>{
 const prepared=await taskAction(pool,actor,input.requestId,action),id=prepared.purchase.id;
 await transition(pool,actor,id,'review');const p=(await pool.query('SELECT * FROM ap_purchases WHERE id=$1',[id])).rows[0];
 for(const [key,value] of [['amount','0.01'],['merchant_id','OTHER'],['quote_digest','0'.repeat(64)]])assert.throws(()=>assertReferenceQuote({...p,[key]:value}),/QUOTE_MISMATCH/);
 const expired={...p.quote,expiresAt:new Date(Date.now()-1000).toISOString()};
 await pool.query('UPDATE ap_purchases SET quote=$2,quote_digest=$3 WHERE id=$1',[id,JSON.stringify(expired),quoteDigest(expired)]);
 await assert.rejects(createCheckout(pool,actor,id,p.merchant_id,{createOrder(){assert.fail('Expired quote must not call PayPal');}}),/QUOTE_EXPIRED/);
 assert.equal((await readTask(pool,actor,input.requestId)).purchase.id,id);
 assert.equal((await pool.query('SELECT count(*) FROM ap_orders')).rows[0].count,'0');
}));

test('missing merchant configuration rolls back both the draft and task transition',()=>scenario(async({pool,actor,input,action})=>{
 delete process.env.PAYPAL_SANDBOX_MERCHANT_ID;
 await assert.rejects(taskAction(pool,actor,input.requestId,action),/REFERENCE_MERCHANT_NOT_CONFIGURED/);
 assert.equal((await readTask(pool,actor,input.requestId)).state,'REVIEW_READY');
 assert.equal((await pool.query('SELECT count(*) FROM ap_purchases')).rows[0].count,'0');
}));

test('quote digest is a registered exact resource and cannot be substituted in the action hash',()=>{
 const config={tenantId:'tenant',agentId:'agent',tool:'paypal',action:'capture'};
 const binding={tenantId:'tenant',localTenantId:'local',principalId:'owner',purchaseVersion:3,purchaseId:'purchase',providerOrderId:'order',executionId:'execution',merchantId:'merchant',amount:'119.00',currency:'USD',quoteDigest:'a'.repeat(64)};
 const envelope=purchaseEnvelope(binding,config);
 assert.deepEqual(envelope.predicates.at(-1),{type:'resource_reference',resourceType:'commerce.quote',namespace:'agentpay/quote',resourceId:binding.quoteDigest});
 assert.throws(()=>purchaseEnvelope({...binding,quoteDigest:'not-a-digest'},config),/INVALID_AUTHORITY_BINDING/);
});
