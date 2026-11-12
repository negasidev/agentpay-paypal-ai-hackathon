import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createHash,sign} from 'node:crypto';
import {canonicalizeEnvelope} from '@verid/agent-sdk';
import {canonicalGrant} from '../../vendor/agent-sdk/src/verify.js';
import {createPool} from '../../src/server/persistence/db.mjs';
import {provision} from '../../src/server/auth.mjs';
import {createPurchase,transition} from '../../src/server/workflow.mjs';
import {createCheckout,checkoutOutcome} from '../../src/server/paypal/checkout.mjs';
import {requestAuthority,refreshAuthority} from '../../src/server/authorization/requests.mjs';
import {protectedCapture,assertExecutionBinding} from '../../src/server/paypal/capture.mjs';
import {reconcileAttempt} from '../../src/server/paypal/reconcile.mjs';
import {verifyStoredReceipt} from '../../src/server/paypal/evidence.mjs';
import {transactionDetail} from '../../src/server/transaction-detail.mjs';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Real ES256 verification with a fixture issuer and provider. This is not
// live 2AYE device approval or a PayPal sandbox acceptance transaction.
async function scenario(pool){
 const user=await provision(pool,`capture-${randomUUID()}@example.test`,'protected-test-password');
 const actor={tenant_id:user.tenantId,user_id:user.id};
 const purchase=await createPurchase(pool,actor,'keyboard');await transition(pool,actor,purchase.id,'review');await transition(pool,actor,purchase.id,'submit');
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const jwk={...keys.publicKey.export({format:'jwk'}),kid:'capture-fixture',alg:'ES256',use:'sig'};
 const ids={approval:randomUUID(),grant:randomUUID(),device:randomUUID()};let envelope,grant,receipt,consumed=false,approvalStatus='Pending',providerStatus='CREATED',captures=0,consumeCalls=0,lost=false;
 const config={baseUrl:'https://issuer.example.test',tenantId:randomUUID(),agentId:randomUUID(),principalId:randomUUID(),intentId:randomUUID(),intentVersion:1,tool:'paypal',action:'capture',accessToken:'explicit-fixture'};
 const approval=()=>({id:ids.approval,tenantId:config.tenantId,agentId:config.agentId,intentId:config.intentId,status:approvalStatus,authorizationId:ids.grant,decidedBy:config.principalId,decidedByDeviceId:ids.device,confirmationMethod:'biometric',actionHash:grant?.actionHash});
 config.fetchImpl=async(url,init={})=>{
  const path=new URL(url).pathname;
  if(path==='/.well-known/verid-grant-keys')return Response.json({keys:[jwk],ephemeral:false});
  if(path==='/v1/runtime/evaluations'){
   const body=JSON.parse(init.body);envelope=Object.fromEntries(Object.entries(body).filter(([k])=>!['tenantId','intentId'].includes(k)));
   grant={id:ids.grant,tenantId:config.tenantId,agentId:config.agentId,intentId:config.intentId,intentVersion:1,approvalId:ids.approval,actionHash:createHash('sha256').update(canonicalizeEnvelope(envelope)).digest('hex').toUpperCase(),expiresAt:new Date(Date.now()+120000).toISOString(),signingKeyId:jwk.kid,consumed:false,revoked:false};
   grant.signature=sign('sha256',Buffer.from(canonicalGrant(grant)),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
   return Response.json({decision:'REQUIRE_APPROVAL',approvalRequestId:ids.approval});
  }
  if(path===`/v1/runtime/approvals/${ids.approval}`)return Response.json(approval());
  if(path===`/v1/runtime/authorizations/${ids.grant}`)return Response.json({...grant,consumed});
  if(path===`/v1/runtime/authorizations/${ids.grant}/consume`){consumeCalls++;if(consumed)return Response.json({}, {status:409});assert.equal(canonicalizeEnvelope(JSON.parse(init.body).envelope),canonicalizeEnvelope(envelope));consumed=true;return Response.json({...grant,consumed});}
  if(path===`/v1/intents/${config.intentId}/receipts`)return Response.json(receipt?[receipt]:[]);
  if(path===`/v1/runtime/authorizations/${ids.grant}/receipt`){const b=JSON.parse(init.body);receipt={tenantId:config.tenantId,authorizationId:grant.id,intentId:config.intentId,intentVersion:grant.intentVersion,status:'Succeeded',comparison:'Matched',externalReference:b.externalReference,evidenceHash:createHash('sha256').update(b.evidence).digest('hex').toUpperCase()};return Response.json(receipt);}
  assert.fail('Unexpected issuer path '+path);
 };
 const orderId='FIXTURE-'+randomUUID();
 const provider={async createOrder(){return {id:orderId};},async getOrder(){return {id:orderId,intent:'CAPTURE',status:providerStatus,purchase_units:[{amount:{value:purchase.amount,currency_code:purchase.currency},payee:{merchant_id:purchase.merchant_id},...(providerStatus==='COMPLETED'?{payments:{captures:[{id:'CAPTURE-'+purchase.id,status:'COMPLETED',amount:{value:purchase.amount,currency_code:purchase.currency},final_capture:true}]}}:{})}]};},async captureOrder(id,requestId){assert.equal(id,orderId);assert.match(requestId,/^[a-f0-9-]{36}$/);captures++;providerStatus='COMPLETED';if(lost)throw new Error('response lost');return this.getOrder();}};
 await createCheckout(pool,actor,purchase.id,purchase.merchant_id,provider);
 assert.equal((await requestAuthority(pool,actor,purchase.id,config)).state,'WAITING_HUMAN');
 assert.equal((await refreshAuthority(pool,actor,purchase.id,config)).state,'WAITING_HUMAN');
 approvalStatus='Approved';assert.equal((await refreshAuthority(pool,actor,purchase.id,config)).state,'VERIFIED');
 providerStatus='APPROVED';await checkoutOutcome(pool,actor,purchase.id,'verify',orderId,provider);
 return {actor,purchase,config,provider,get captures(){return captures;},get consumeCalls(){return consumeCalls;},loseResponse(){lost=true;},revoke(){grant.revoked=true;},breakSignature(){grant.signature='A'.repeat(86);},removeConsent(){providerStatus='CREATED';},expire(){grant.expiresAt=new Date(Date.now()-1000).toISOString();},removeDevice(){ids.device=null;}};
}
test('signed authority and independent consent admit one capture under concurrency; retries never execute twice',async()=>{
 const pool=createPool();try{
  const s=await scenario(pool);
  await assert.rejects(protectedCapture(pool,{...s.actor,user_id:randomUUID()},s.purchase.id,s.provider,{enabled:true,config:s.config}),/NOT_FOUND/);
  await assert.rejects(protectedCapture(pool,s.actor,s.purchase.id,s.provider,{enabled:false,config:s.config}),/VERIFIED_EXTERNAL_AUTHORITY_REQUIRED/);
  const outcomes=await Promise.all(Array.from({length:12},()=>protectedCapture(pool,s.actor,s.purchase.id,s.provider,{enabled:true,config:s.config})));
  assert.ok(outcomes.every(x=>x.state==='COMPLETED'));assert.equal(s.captures,1);assert.equal(s.consumeCalls,1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ap_receipts WHERE purchase_id=$1',[s.purchase.id])).rows[0].n,1);
 }finally{await pool.end();}
});

test('stored receiver proof verifies only with signed exact authority, provider read-back and matching canonical receipt',async()=>{
 const pool=createPool(),dir=mkdtempSync(join(tmpdir(),'agentpay-proof-'));
 const names=['AGENTPAY_RECEIVER_SIGNING_KEY_FILE','AGENTPAY_RECEIVER_PUBLIC_KEY_FILE','AGENTPAY_RECEIVER_KEY_ID'];
 const prior=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 try{
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const privatePath=join(dir,'private.pem'),publicPath=join(dir,'public.pem');
  writeFileSync(privatePath,keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
  writeFileSync(publicPath,keys.publicKey.export({format:'pem',type:'spki'}));
  Object.assign(process.env,{AGENTPAY_RECEIVER_SIGNING_KEY_FILE:privatePath,AGENTPAY_RECEIVER_PUBLIC_KEY_FILE:publicPath,AGENTPAY_RECEIVER_KEY_ID:'fixture-receiver'});
  const s=await scenario(pool);
  assert.equal((await protectedCapture(pool,s.actor,s.purchase.id,s.provider,{enabled:true,config:s.config})).state,'COMPLETED');
  const row=(await pool.query('SELECT id,evidence FROM ap_receipts WHERE purchase_id=$1',[s.purchase.id])).rows[0];
  assert.equal((await verifyStoredReceipt(pool,s.actor,row.id,s.provider,{config:s.config})).status,'VERIFIED');
  assert.equal((await transactionDetail(pool,s.actor,s.purchase.id,{provider:s.provider,config:s.config})).receipts[0].verification.status,'VERIFIED');
  await pool.query("UPDATE ap_receipts SET evidence=jsonb_set(evidence,'{receiverEffect,signature}',to_jsonb($2::text)) WHERE id=$1",[row.id,'A'.repeat(86)]);
  assert.notEqual((await verifyStoredReceipt(pool,s.actor,row.id,s.provider,{config:s.config})).status,'VERIFIED');
  await pool.query('UPDATE ap_receipts SET evidence=$2 WHERE id=$1',[row.id,JSON.stringify(row.evidence)]);
  s.breakSignature();
  const attempt=(await pool.query('SELECT id,authority_grant FROM ap_attempts WHERE purchase_id=$1',[s.purchase.id])).rows[0];
  await pool.query('UPDATE ap_attempts SET authority_grant=$2 WHERE id=$1',[attempt.id,JSON.stringify({...attempt.authority_grant,signature:'A'.repeat(86)})]);
  assert.notEqual((await verifyStoredReceipt(pool,s.actor,row.id,s.provider,{config:s.config})).status,'VERIFIED');
  await assert.rejects(verifyStoredReceipt(pool,{...s.actor,user_id:randomUUID()},row.id,s.provider,{config:s.config}),/NOT_FOUND/);
 }finally{for(const n of names){if(prior[n]===undefined)delete process.env[n];else process.env[n]=prior[n];}rmSync(dir,{recursive:true,force:true});await pool.end();}
});
test('changed terms, owner, agent, version and order cannot match persisted signed authority',async()=>{
 const pool=createPool();try{
  const s=await scenario(pool);const p=(await pool.query('SELECT * FROM ap_purchases WHERE id=$1',[s.purchase.id])).rows[0];
  const o=(await pool.query('SELECT * FROM ap_orders WHERE purchase_id=$1',[p.id])).rows[0];const r=(await pool.query('SELECT * FROM ap_authority_requests WHERE purchase_id=$1',[p.id])).rows[0];
  assert.doesNotThrow(()=>assertExecutionBinding(p,o,r,s.config));
  for(const changed of [{amount:'119.01'},{currency:'EUR'},{merchant_id:'OTHER'},{id:randomUUID()},{tenant_id:randomUUID()},{user_id:randomUUID()},{version:4}])assert.throws(()=>assertExecutionBinding({...p,...changed},o,r,s.config));
  assert.throws(()=>assertExecutionBinding(p,{...o,provider_order_id:'OTHER'},r,s.config));
  assert.throws(()=>assertExecutionBinding(p,o,r,{...s.config,agentId:randomUUID()}));
  assert.throws(()=>assertExecutionBinding(p,{...o,buyer_status:'NOT_APPROVED'},r,s.config));
  s.revoke();const result=await protectedCapture(pool,s.actor,p.id,s.provider,{enabled:true,config:s.config});assert.equal(result.state,'REFUSED');assert.equal(s.captures,0);assert.equal(s.consumeCalls,0);
 }finally{await pool.end();}
});
test('lost provider response leaves UNKNOWN with original durable request identity and no redispatch',async()=>{
 const pool=createPool();try{
  const s=await scenario(pool);s.loseResponse();const first=await protectedCapture(pool,s.actor,s.purchase.id,s.provider,{enabled:true,config:s.config});
  assert.equal(first.state,'UNKNOWN');const before=(await pool.query('SELECT * FROM ap_attempts WHERE purchase_id=$1',[s.purchase.id])).rows[0];assert.ok(before.authority_consumed_at);assert.ok(before.dispatched_at);
  await protectedCapture(pool,s.actor,s.purchase.id,s.provider,{enabled:true,config:s.config});
  assert.equal(s.captures,1);assert.equal(s.consumeCalls,1);assert.equal((await pool.query('SELECT request_id FROM ap_attempts WHERE id=$1',[before.id])).rows[0].request_id,before.request_id);
  const recovered=await reconcileAttempt(pool,s.actor,before.id,s.provider,{authority:s.config});
  assert.equal(recovered.receiptVerification,'PROVIDER_CONFIRMED');assert.equal((await pool.query('SELECT state FROM ap_purchases WHERE id=$1',[s.purchase.id])).rows[0].state,'COMPLETED');assert.equal(s.captures,1);
 }finally{await pool.end();}
});
test('missing provider consent, absent device, invalid signature and elapsed expiry refuse before redemption or dispatch',async()=>{
 const pool=createPool();try{
  for(const mutate of ['removeConsent','removeDevice','breakSignature','expire']){
   const s=await scenario(pool);s[mutate]();
   const result=await protectedCapture(pool,s.actor,s.purchase.id,s.provider,{enabled:true,config:s.config});
   assert.equal(result.state,'REFUSED',mutate);assert.equal(s.consumeCalls,0,mutate);assert.equal(s.captures,0,mutate);
  }
 }finally{await pool.end();}
});
