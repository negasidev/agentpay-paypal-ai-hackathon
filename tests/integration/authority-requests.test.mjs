import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createPool} from '../../src/server/persistence/db.mjs';import {provision} from '../../src/server/auth.mjs';
import {createPurchase,transition} from '../../src/server/workflow.mjs';
import {requestAuthority,authorityStatus} from '../../src/server/authorization/requests.mjs';
test('authority request is durable, scoped, exactly bound and fails closed on service outage',async()=>{
 let pool=createPool();try{
  const u=await provision(pool,`authority-${randomUUID()}@example.test`,'authority-test-password');const a={tenant_id:u.tenantId,user_id:u.id};
  const p=await createPurchase(pool,a,'keyboard');await transition(pool,a,p.id,'review');await transition(pool,a,p.id,'submit');
  const orderId='FIXTURE-'+randomUUID();await pool.query('INSERT INTO ap_orders(id,tenant_id,user_id,purchase_id,provider_order_id,request_id,purchase_version,amount,currency,merchant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),a.tenant_id,a.user_id,p.id,orderId,randomUUID(),3,p.amount,p.currency,p.merchant_id]);
  let calls=0;const config={baseUrl:'https://authority.example.test',tenantId:'platform-tenant',agentId:'agent-1',intentId:'intent-1',intentVersion:7,tool:'paypal',action:'capture',accessToken:'fixture-not-live',fetchImpl:()=>{calls++;throw new Error('must not contact service');}};
  await assert.rejects(requestAuthority(pool,{...a,user_id:randomUUID()},p.id,config),/NOT_FOUND/);
  await Promise.all(Array.from({length:10},()=>requestAuthority(pool,a,p.id,config)));
  const before=(await pool.query('SELECT * FROM ap_authority_requests WHERE purchase_id=$1',[p.id])).rows[0];
  assert.equal(before.state,'UNAVAILABLE');assert.equal(before.reason_code,'AUTHORITY_UNAVAILABLE');assert.equal(before.platform_intent_version,7);assert.equal(calls,1);
  assert.deepEqual(before.envelope.predicates.filter(x=>x.type==='resource_reference').map(x=>x.resourceId),[orderId,p.id,before.execution_id,a.user_id,a.tenant_id]);
  assert.equal(before.grant_id,null);await pool.end();pool=createPool();await requestAuthority(pool,a,p.id,config);
  const after=(await pool.query('SELECT * FROM ap_authority_requests WHERE purchase_id=$1',[p.id])).rows[0];assert.deepEqual(after.envelope,before.envelope);assert.equal(after.execution_id,before.execution_id);
  assert.equal((await authorityStatus(pool,a,p.id)).label,'Authority unavailable');
  await assert.rejects(transition(pool,a,p.id,'capture'),/VERIFIED_EXTERNAL_AUTHORITY_REQUIRED/);
  await pool.query('UPDATE ap_purchases SET amount=$1 WHERE id=$2',['119.01',p.id]);await assert.rejects(requestAuthority(pool,a,p.id,config),/INVALID_AUTHORITY_BINDING/);
 }finally{await pool.end();}
});

test('a request made before configuration can be bound once, but an uncertain issuer call is never replayed',async()=>{
 const pool=createPool();try{for(const issuerAvailable of [false,true]){
  const user=await provision(pool,`authority-recovery-${randomUUID()}@example.test`,'authority-fixture-password');const actor={tenant_id:user.tenantId,user_id:user.id};
  const purchase=await createPurchase(pool,actor,'keyboard');await transition(pool,actor,purchase.id,'review');await transition(pool,actor,purchase.id,'submit');
  const orderId='FIXTURE-'+randomUUID();await pool.query('INSERT INTO ap_orders(id,tenant_id,user_id,purchase_id,provider_order_id,request_id,purchase_version,amount,currency,merchant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),actor.tenant_id,actor.user_id,purchase.id,orderId,randomUUID(),3,purchase.amount,purchase.currency,purchase.merchant_id]);
  await requestAuthority(pool,actor,purchase.id,null);
  const before=(await pool.query('SELECT * FROM ap_authority_requests WHERE purchase_id=$1',[purchase.id])).rows[0];assert.equal(before.reason_code,'AUTHORITY_NOT_CONFIGURED');
  let calls=0;const config={baseUrl:'https://authority.example.test',tenantId:'platform-tenant',agentId:'agent-1',intentId:'intent-1',intentVersion:1,tool:'paypal',action:'capture',accessToken:'fixture-not-live',fetchImpl:async()=>{calls++;if(!issuerAvailable)throw Error('uncertain issuer outcome');return new Response(JSON.stringify({decision:'REQUIRE_APPROVAL',approvalRequestId:'fixture-approval'}),{headers:{'content-type':'application/json'}});}};
  await Promise.all(Array.from({length:10},()=>requestAuthority(pool,actor,purchase.id,config)));
  const after=(await pool.query('SELECT * FROM ap_authority_requests WHERE purchase_id=$1',[purchase.id])).rows[0];
  assert.equal(calls,1);assert.equal(after.id,before.id);assert.equal(after.execution_id,before.execution_id);assert.equal(after.state,issuerAvailable?'WAITING_HUMAN':'UNAVAILABLE');assert.equal(after.reason_code,issuerAvailable?null:'AUTHORITY_UNAVAILABLE');assert.equal(after.platform_intent_id,'intent-1');
  assert.ok(after.envelope.predicates.some(predicate=>predicate.type==='resource_reference'&&predicate.namespace==='paypal/sandbox'&&predicate.resourceId===orderId));
  await requestAuthority(pool,actor,purchase.id,config);assert.equal(calls,1);assert.equal(after.grant_id,null);
  await assert.rejects(transition(pool,actor,purchase.id,'capture'),/VERIFIED_EXTERNAL_AUTHORITY_REQUIRED/);
 }}finally{await pool.end();}
});
