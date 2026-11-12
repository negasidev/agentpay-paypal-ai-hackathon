import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,generateKeyPairSync,sign} from 'node:crypto';
import {createPool} from '../../src/server/persistence/db.mjs';
import {provision,reauthenticateActor} from '../../src/server/auth.mjs';
import {createPurchase,transition} from '../../src/server/workflow.mjs';
import {checkoutOutcome} from '../../src/server/paypal/checkout.mjs';
import {browserSandboxPolicy,browserApprovalChallenge,approveBrowserChallenge,revokeBrowserApproval,captureBrowserSandbox,browserSandboxStatus} from '../../src/server/authorization/browser-sandbox.mjs';

const password='dedicated-fixture-password';
async function scenario(pool){
 const user=await provision(pool,'browser-'+randomUUID()+'@example.test',password);
 const actor={tenant_id:user.tenantId,user_id:user.id,session_hash:randomBytes(32).toString('hex')};
 const purchase=await createPurchase(pool,actor,'keyboard');await transition(pool,actor,purchase.id,'review');await transition(pool,actor,purchase.id,'submit');
 const env={NODE_ENV:'test',APP_ORIGIN:'http://localhost:3006',AGENTPAY_EDITION:'hackathon',PAYPAL_ENVIRONMENT:'sandbox',AGENTPAY_APPROVAL_MODE:'sandbox-browser-software',AGENTPAY_PROTECTED_CAPTURE_ENABLED:'false',AGENTPAY_BROWSER_SANDBOX_APPROVER_ID:user.id,AGENTPAY_BROWSER_SANDBOX_TENANT_ID:user.tenantId,AGENTPAY_BROWSER_SANDBOX_MAX_AMOUNT:'150.00',AGENTPAY_BROWSER_SANDBOX_CAPTURE_ENABLED:'true',PAYPAL_SANDBOX_MERCHANT_ID:purchase.merchant_id};
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),exported=keys.publicKey.export({format:'jwk'});
 const publicKey={kty:exported.kty,crv:exported.crv,x:exported.x,y:exported.y};
 let state='CREATED',captures=0,creates=0,lostResponse=false;
 const provider={async createOrder(){creates++;return {id:'FIXTURE-'+randomUUID()};},async getOrder(id){return {id,intent:'CAPTURE',status:state,purchase_units:[{amount:{value:purchase.amount,currency_code:purchase.currency},payee:{merchant_id:purchase.merchant_id},...(state==='COMPLETED'?{payments:{captures:[{id:'FIXTURE-CAPTURE-'+purchase.id,status:'COMPLETED',amount:{value:purchase.amount,currency_code:purchase.currency},final_capture:true}]}}:{})}]};},async captureOrder(){captures++;state='COMPLETED';if(lostResponse)throw Error('simulated-lost-response');}};
 const challenge=()=>browserApprovalChallenge(pool,actor,purchase.id,{password,publicKey},provider,{env});
 const signed=c=>({challengeId:c.challengeId,signature:sign('sha256',Buffer.from(c.statement),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')});
 const approve=c=>approveBrowserChallenge(pool,actor,purchase.id,signed(c),{env});
 const buyer=async()=>{state='APPROVED';const status=await browserSandboxStatus(pool,actor,purchase.id,null,{env});const row=(await pool.query('SELECT provider_order_id FROM ap_orders WHERE purchase_id=$1',[purchase.id])).rows[0];await checkoutOutcome(pool,actor,purchase.id,'verify',row.provider_order_id,provider);return status;};
 return {actor,purchase,env,provider,publicKey,keys,challenge,signed,approve,buyer,counts:()=>({captures,creates}),loseResponse:()=>{lostResponse=true;}};
}
test('browser software mode is an explicit isolated Sandbox policy, never a canonical fallback',()=>{
 const actor={tenant_id:'tenant',user_id:'user',session_hash:'1'.repeat(64)};
 assert.equal(browserSandboxPolicy(actor,{}),null);
 const env={NODE_ENV:'production',APP_ORIGIN:'https://hackathon.agentpay.twoaye.com',AGENTPAY_EDITION:'hackathon',PAYPAL_ENVIRONMENT:'sandbox',AGENTPAY_APPROVAL_MODE:'sandbox-browser-software',AGENTPAY_PROTECTED_CAPTURE_ENABLED:'false',AGENTPAY_BROWSER_SANDBOX_APPROVER_ID:'user',AGENTPAY_BROWSER_SANDBOX_TENANT_ID:'tenant',AGENTPAY_BROWSER_SANDBOX_MAX_AMOUNT:'150.00',PAYPAL_SANDBOX_MERCHANT_ID:'FIXTURE-MERCHANT'};
 assert(browserSandboxPolicy(actor,env));
 for(const patch of [{PAYPAL_ENVIRONMENT:'live'},{APP_ORIGIN:'https://agentpay.twoaye.com'},{AGENTPAY_EDITION:'main'},{AGENTPAY_PROTECTED_CAPTURE_ENABLED:'true'},{AGENTPAY_APPROVAL_MODE:'twoaye-device'},{AGENTPAY_BROWSER_SANDBOX_MAX_AMOUNT:'1500.00'},{AGENTPAY_BROWSER_SANDBOX_APPROVER_ID:'foreign'}])assert.equal(browserSandboxPolicy(actor,{...env,...patch}),null);
});
test('fresh password confirmation shares durable account lockout and issues no payment authority by itself',async()=>{
 const pool=createPool();try{const s=await scenario(pool);for(let n=0;n<5;n++)await assert.rejects(reauthenticateActor(pool,s.actor,'wrong-fixture-password'),/INVALID_LOGIN/);await assert.rejects(s.challenge(),/INVALID_LOGIN/);assert.equal((await pool.query('SELECT count(*)::int AS count FROM ap_browser_sandbox_approvals WHERE user_id=$1',[s.actor.user_id])).rows[0].count,0);assert.deepEqual(s.counts(),{captures:0,creates:0});}finally{await pool.end();}
});
test('software signature is exact, session-bound, challenge-specific and single-use',async()=>{
 const pool=createPool();try{const s=await scenario(pool),c=await s.challenge();assert.equal(JSON.parse(c.statement).assurance,'software');assert.equal(JSON.parse(c.statement).amount,'119.00');
 await assert.rejects(approveBrowserChallenge(pool,{...s.actor,session_hash:'f'.repeat(64)},s.purchase.id,s.signed(c),{env:s.env}),/BROWSER_APPROVAL_NOT_FOUND/);
 const wrong=generateKeyPairSync('ec',{namedCurve:'prime256v1'});await assert.rejects(approveBrowserChallenge(pool,s.actor,s.purchase.id,{challengeId:c.challengeId,signature:sign('sha256',Buffer.from(c.statement),{key:wrong.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url')},{env:s.env}),/INVALID_BROWSER_SIGNATURE/);
 const c2=await s.challenge();await assert.rejects(approveBrowserChallenge(pool,s.actor,s.purchase.id,{challengeId:c2.challengeId,signature:s.signed(c).signature},{env:s.env}),/INVALID_BROWSER_SIGNATURE/);
 await s.approve(c);await assert.rejects(s.approve(c),/BROWSER_APPROVAL_ALREADY_USED/);assert.equal(s.counts().captures,0);
 }finally{await pool.end();}
});
test('expired, revoked and changed-term approvals cannot dispatch even when Sandbox capture is enabled',async()=>{
 const pool=createPool();try{
  const expired=await scenario(pool),c=await expired.challenge();await pool.query("UPDATE ap_browser_sandbox_approvals SET challenge_expires_at=now()-interval '1 second' WHERE id=$1",[c.challengeId]);await assert.rejects(expired.approve(c),/BROWSER_APPROVAL_EXPIRED/);
  const revoked=await scenario(pool),r=await revoked.challenge(),approved=await revoked.approve(r);await revoked.buyer();await revokeBrowserApproval(pool,revoked.actor,revoked.purchase.id,approved.approvalId,{env:revoked.env});await assert.rejects(captureBrowserSandbox(pool,revoked.actor,revoked.purchase.id,{approvalId:approved.approvalId},revoked.provider,{env:revoked.env}),/BROWSER_APPROVAL_REQUIRED/);
  const changed=await scenario(pool),t=await changed.challenge(),a=await changed.approve(t);await changed.buyer();await pool.query("UPDATE ap_purchases SET amount='119.01' WHERE id=$1",[changed.purchase.id]);await assert.rejects(captureBrowserSandbox(pool,changed.actor,changed.purchase.id,{approvalId:a.approvalId},changed.provider,{env:changed.env}),/BROWSER_APPROVAL_TERMS_CHANGED/);
  assert.equal(revoked.counts().captures+changed.counts().captures,0);
 }finally{await pool.end();}
});
test('fixture software approval and separately verified buyer consent admit one exact capture; tampering and replay refuse',async()=>{
 const pool=createPool();try{const s=await scenario(pool),challenge=await s.challenge(),approval=await s.approve(challenge),input={approvalId:approval.approvalId};
 await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,input,s.provider,{env:s.env}),/PAYPAL_BUYER_CONSENT_REQUIRED/);
 await s.buyer();await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,{...input,amount:'1190.00'},s.provider,{env:s.env}),/UNEXPECTED_CAPTURE_TERMS/);
 const outcomes=await Promise.allSettled(Array.from({length:12},()=>captureBrowserSandbox(pool,s.actor,s.purchase.id,input,s.provider,{env:s.env})));
 assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);assert.equal(s.counts().captures,1);
 const status=await browserSandboxStatus(pool,s.actor,s.purchase.id,s.provider,{env:s.env});assert.equal(status.providerVerified,true);assert.equal(status.executionState,'COMPLETED');assert.equal(status.receipt.assurance,'software');assert.equal(status.receipt.hardwareAttested,false);assert.equal(status.receipt.amount,'119.00');
 await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,input,s.provider,{env:s.env}),/SANDBOX_EXECUTION_ALREADY_RESERVED/);assert.equal(s.counts().captures,1);
 }finally{await pool.end();}
});
test('lost capture response reconciles the original order without another dispatch and outage never shows a verified receipt',async()=>{
 const pool=createPool();try{const s=await scenario(pool),approval=await s.approve(await s.challenge());await s.buyer();s.loseResponse();const result=await captureBrowserSandbox(pool,s.actor,s.purchase.id,{approvalId:approval.approvalId},s.provider,{env:s.env});assert.equal(result.state,'UNKNOWN');
 const outage=await browserSandboxStatus(pool,s.actor,s.purchase.id,{getOrder(){throw Error('outage');}},{env:s.env});assert.equal(outage.providerVerified,false);assert.equal(outage.receipt,null);
 const recovered=await browserSandboxStatus(pool,s.actor,s.purchase.id,s.provider,{env:s.env});assert.equal(recovered.providerVerified,true);assert.equal(recovered.executionState,'COMPLETED');assert.equal(s.counts().captures,1);
 }finally{await pool.end();}
});
