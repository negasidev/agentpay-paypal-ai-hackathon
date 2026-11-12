import test from 'node:test';import assert from 'node:assert/strict';import{randomUUID}from'node:crypto';
import{aiDatabase}from'../fixtures/ai-database.mjs';import{provision}from'../../src/server/auth.mjs';import{createPurchase,transition}from'../../src/server/workflow.mjs';import{createCheckout}from'../../src/server/paypal/checkout.mjs';import{probeStoredBinding}from'../../src/server/trust-replay.mjs';
test('stored binding inspection rejects altered amount, merchant, currency and version without granting authority or dispatching payment',async()=>{
 const fixture=await aiDatabase(),pool=fixture.connect();try{
  const user=await provision(pool,`replay-${randomUUID()}@example.test`,randomUUID()),actor={tenant_id:user.tenantId,user_id:user.id};let p=await createPurchase(pool,actor,'keyboard');p=await transition(pool,actor,p.id,'review');p=await transition(pool,actor,p.id,'submit');let creates=0;
  const provider={async createOrder(){creates++;return{id:'REPLAYORDER1'};},async getOrder(){return{id:'REPLAYORDER1',intent:'CAPTURE',status:'CREATED',purchase_units:[{amount:{value:p.amount,currency_code:p.currency},payee:{merchant_id:p.merchant_id}}]};}};
  await createCheckout(pool,actor,p.id,p.merchant_id,provider);const input={requestId:randomUUID(),amount:p.amount,merchantId:p.merchant_id,currency:p.currency,purchaseVersion:p.version};
  const match=await probeStoredBinding(pool,actor,p.id,input);assert.equal(match.decision,'TERMS_MATCH_INSPECTION_ONLY');assert.equal(match.executionAllowed,false);assert.equal(match.canonicalAuthorizationEvaluated,false);
  for(const override of[{amount:'1190.00'},{amount:'119.0'},{merchantId:'another-merchant'},{currency:'EUR'},{purchaseVersion:p.version+1}]){if(override.amount==='119.0'){await assert.rejects(probeStoredBinding(pool,actor,p.id,{...input,...override,requestId:randomUUID()}),/INVALID_BINDING_PROBE/);continue;}const denied=await probeStoredBinding(pool,actor,p.id,{...input,...override,requestId:randomUUID()});assert.equal(denied.decision,'TERMS_MISMATCH');assert.equal(denied.providerDispatched,false);}
  assert.equal(creates,1);assert.equal((await pool.query('SELECT count(*)::int AS count FROM ap_attempts WHERE purchase_id=$1',[p.id])).rows[0].count,0);
 }finally{await pool.end();await fixture.close();}
});
test('binding probes retain actor isolation, closed inputs and idempotent immutable observations',async()=>{
 const fixture=await aiDatabase(),pool=fixture.connect();try{
  const user=await provision(pool,`replay-${randomUUID()}@example.test`,randomUUID()),actor={tenant_id:user.tenantId,user_id:user.id};let p=await createPurchase(pool,actor,'keyboard');p=await transition(pool,actor,p.id,'review');
  const input={requestId:randomUUID(),amount:p.amount,merchantId:p.merchant_id,currency:p.currency,purchaseVersion:p.version};await assert.rejects(probeStoredBinding(pool,actor,p.id,input),/RECORDED_PROVIDER_ORDER_REQUIRED/);
  await assert.rejects(probeStoredBinding(pool,actor,p.id,{...input,approved:true}),/INVALID_BINDING_PROBE/);await assert.rejects(probeStoredBinding(pool,{tenant_id:randomUUID(),user_id:randomUUID()},p.id,input),/NOT_FOUND/);
  const provider={async createOrder(){return{id:'REPLAYORDER2'};},async getOrder(){return{id:'REPLAYORDER2',intent:'CAPTURE',status:'CREATED',purchase_units:[{amount:{value:p.amount,currency_code:p.currency},payee:{merchant_id:p.merchant_id}}]};}};await createCheckout(pool,actor,p.id,p.merchant_id,provider);
  const first=await probeStoredBinding(pool,actor,p.id,input),again=await probeStoredBinding(pool,actor,p.id,input);assert.equal(first.id,again.id);assert.equal((await pool.query('SELECT count(*)::int AS count FROM ap_trust_replay_probes WHERE purchase_id=$1',[p.id])).rows[0].count,1);
  await assert.rejects(probeStoredBinding(pool,actor,p.id,{...input,amount:'1190.00'}),/PROBE_IDEMPOTENCY_CONFLICT/);
 }finally{await pool.end();await fixture.close();}
});
