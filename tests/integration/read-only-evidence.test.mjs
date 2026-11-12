import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID,generateKeyPairSync} from 'node:crypto';
import {createPool} from '../../src/server/persistence/db.mjs';
import {provision} from '../../src/server/auth.mjs';
import {createPurchase,transition} from '../../src/server/workflow.mjs';
import {verifyRecordedOrder,createCheckout} from '../../src/server/paypal/checkout.mjs';
import {inspectStoredBinding,probeStoredBinding} from '../../src/server/trust-replay.mjs';
import {browserSandboxStatus,browserApprovalChallenge,captureBrowserSandbox} from '../../src/server/authorization/browser-sandbox.mjs';

async function reader(pool){
 const user=await provision(pool,`reader-${randomUUID()}@example.test`,'reader-fixture-password');
 const actor={tenant_id:user.tenantId,user_id:user.id,session_hash:randomBytes(32).toString('hex')};
 await pool.query("INSERT INTO ap_sessions VALUES($1,$2,$3,now()+interval '8 hours')",[actor.session_hash,actor.tenant_id,actor.user_id]);
 const purchase=await createPurchase(pool,actor,'keyboard');
 const env={NODE_ENV:'test',APP_ORIGIN:'http://localhost:3006',AGENTPAY_EDITION:'hackathon',PAYPAL_ENVIRONMENT:'sandbox',AGENTPAY_APPROVAL_MODE:'sandbox-browser-software',AGENTPAY_PROTECTED_CAPTURE_ENABLED:'false',AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE:'true',AGENTPAY_BROWSER_SANDBOX_MAX_AMOUNT:'150.00',AGENTPAY_BROWSER_SANDBOX_CAPTURE_ENABLED:'true',PAYPAL_SANDBOX_MERCHANT_ID:purchase.merchant_id};
 return {actor,purchase,env};
}

test('owned evidence remains readable without approval permission, while challenge and capture still refuse',async()=>{
 const pool=createPool();try{
  const s=await reader(pool);let providerCalls=0;
  const forbidden=()=>{providerCalls++;throw Error('provider must not be called');};
  const provider={getOrder:forbidden,createOrder:forbidden,captureOrder:forbidden};
  const status=await browserSandboxStatus(pool,s.actor,s.purchase.id,provider,{env:s.env});
  assert.equal(status.readOnly,true);assert.equal(status.approverEligible,false);
  assert.equal(status.approvalState,'INELIGIBLE');assert.equal(status.captureEnabled,false);
  assert.equal(status.providerVerified,false);assert.equal(status.receipt,null);
  const exported=generateKeyPairSync('ec',{namedCurve:'prime256v1'}).publicKey.export({format:'jwk'});
  const publicKey={kty:exported.kty,crv:exported.crv,x:exported.x,y:exported.y};
  const ineligible=error=>error.message==='BROWSER_APPROVER_INELIGIBLE'&&error.status===403;
  await assert.rejects(browserApprovalChallenge(pool,s.actor,s.purchase.id,{password:'reader-fixture-password',publicKey},provider,{env:s.env}),ineligible);
  await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,{approvalId:randomUUID()},provider,{env:s.env}),ineligible);
  assert.equal(providerCalls,0);
  for(const table of ['ap_browser_sandbox_approvals','ap_browser_sandbox_executions'])assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE user_id=$1`,[s.actor.user_id])).rows[0].count,0);
 }finally{await pool.end();}
});

test('read-only evidence never crosses ownership or masks an expired session or storage failure',async()=>{
 const pool=createPool();try{
  const s=await reader(pool),other=await reader(pool);
  await assert.rejects(browserSandboxStatus(pool,s.actor,other.purchase.id,null,{env:s.env}),error=>error.message==='NOT_FOUND'&&error.status===404);
  const unavailable={query:pool.query.bind(pool),connect:async()=>{throw Error('storage unavailable');}};
  await assert.rejects(browserSandboxStatus(unavailable,s.actor,s.purchase.id,null,{env:s.env}),/storage unavailable/);
  await pool.query('DELETE FROM ap_sessions WHERE token_hash=$1',[s.actor.session_hash]);
  await assert.rejects(browserSandboxStatus(pool,s.actor,s.purchase.id,null,{env:s.env}),error=>error.message==='UNAUTHENTICATED'&&error.status===401);
 }finally{await pool.end();}
});

test('read-only provider verification and term inspection cannot create orders, authority or audit mutations',async()=>{
 const pool=createPool(),previous=process.env.AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE;
 try{
  const s=await reader(pool),other=await reader(pool);
  await transition(pool,s.actor,s.purchase.id,'review');await transition(pool,s.actor,s.purchase.id,'submit');
  const purchase=(await pool.query('SELECT * FROM ap_purchases WHERE id=$1',[s.purchase.id])).rows[0],orderId='FIXTURE-'+randomUUID();
  await pool.query('INSERT INTO ap_orders(id,tenant_id,user_id,purchase_id,provider_order_id,request_id,purchase_version,amount,currency,merchant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),s.actor.tenant_id,s.actor.user_id,purchase.id,orderId,randomUUID(),purchase.version,purchase.amount,purchase.currency,purchase.merchant_id]);
  const before=(await pool.query('SELECT count(*)::int AS count FROM ap_audit WHERE user_id=$1',[s.actor.user_id])).rows[0].count;
  let reads=0,writes=0;
  const actual={id:orderId,intent:'CAPTURE',status:'CREATED',purchase_units:[{amount:{value:purchase.amount,currency_code:purchase.currency},payee:{merchant_id:purchase.merchant_id}}]};
  const provider={getOrder:async id=>{reads++;assert.equal(id,orderId);return actual;},createOrder:()=>{writes++;throw Error('forbidden');},captureOrder:()=>{writes++;throw Error('forbidden');}};
  process.env.AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE='true';
  const verified=await verifyRecordedOrder(pool,s.actor,purchase.id,purchase.merchant_id,provider);
  assert.equal(verified.orderId,orderId);assert.equal(verified.retrievalVerified,true);assert.equal(verified.captureEnabled,false);
  await assert.rejects(verifyRecordedOrder(pool,other.actor,purchase.id,purchase.merchant_id,provider),/NOT_FOUND/);
  await assert.rejects(verifyRecordedOrder(pool,other.actor,other.purchase.id,purchase.merchant_id,provider),/RECORDED_PROVIDER_ORDER_REQUIRED/);
  assert.equal(reads,1);assert.equal(writes,0);
  const input={requestId:randomUUID(),amount:'1190.00',merchantId:purchase.merchant_id,currency:purchase.currency,purchaseVersion:purchase.version};
  const result=await inspectStoredBinding(pool,s.actor,purchase.id,input);
  assert.equal(result.decision,'TERMS_MISMATCH');assert.equal(result.inspectionOnly,true);assert.equal(result.executionAllowed,false);assert.equal(result.providerDispatched,false);
  await assert.rejects(inspectStoredBinding(pool,other.actor,purchase.id,input),/NOT_FOUND/);
  await assert.rejects(probeStoredBinding(pool,s.actor,purchase.id,input),/READ_ONLY_EVALUATION_ACCOUNT/);
  await assert.rejects(createCheckout(pool,s.actor,purchase.id,purchase.merchant_id,provider),/READ_ONLY_EVALUATION_ACCOUNT/);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM ap_audit WHERE user_id=$1',[s.actor.user_id])).rows[0].count,before);
  for(const table of ['ap_trust_replay_probes','ap_attempts','ap_browser_sandbox_approvals','ap_browser_sandbox_executions'])assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${table} WHERE user_id=$1`,[s.actor.user_id])).rows[0].count,0);
  assert.equal(writes,0);
  await assert.rejects(verifyRecordedOrder(pool,s.actor,purchase.id,purchase.merchant_id,{getOrder:async()=>{throw {code:'PROVIDER_REJECTED',status:404};},createOrder:provider.createOrder}),/RECORDED_PROVIDER_ORDER_UNAVAILABLE/);
  assert.equal(writes,0);
  actual.purchase_units[0].amount.value='1190.00';
  await assert.rejects(verifyRecordedOrder(pool,s.actor,purchase.id,purchase.merchant_id,provider),/PROVIDER_BINDING_MISMATCH/);
  await pool.query("UPDATE ap_purchases SET version=version+1 WHERE id=$1",[purchase.id]);
  await assert.rejects(verifyRecordedOrder(pool,s.actor,purchase.id,purchase.merchant_id,provider),/INTENT_CHANGED/);
 }finally{if(previous===undefined)delete process.env.AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE;else process.env.AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE=previous;await pool.end();}
});
