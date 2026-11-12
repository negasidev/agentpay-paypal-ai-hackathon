import test from 'node:test';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {createPool} from '../../src/server/persistence/db.mjs';
import {provision,reauthenticateActor,passwordHash} from '../../src/server/auth.mjs';
import {createPurchase,transition} from '../../src/server/workflow.mjs';
import {checkoutOutcome} from '../../src/server/paypal/checkout.mjs';
import {browserSandboxPolicy,browserApprovalChallenge,approveBrowserChallenge,revokeBrowserApproval,captureBrowserSandbox,browserSandboxStatus} from '../../src/server/authorization/browser-sandbox.mjs';

const password='dedicated-fixture-password';
async function scenario(pool){
 const user=await provision(pool,'browser-'+randomUUID()+'@example.test',password);
 const actor={tenant_id:user.tenantId,user_id:user.id,session_hash:randomBytes(32).toString('hex')};
 await pool.query("INSERT INTO ap_sessions VALUES($1,$2,$3,now()+interval '8 hours')",[actor.session_hash,actor.tenant_id,actor.user_id]);
 await pool.query("INSERT INTO ap_browser_sandbox_approvers(tenant_id,user_id,display_name,permission) VALUES($1,$2,'Fixture named approver','approve-own-sandbox-purchase')",[actor.tenant_id,actor.user_id]);
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
 const pool=createPool();try{const s=await scenario(pool);for(let n=0;n<5;n++)await assert.rejects(reauthenticateActor(pool,s.actor,'wrong-fixture-password'),/INVALID_LOGIN/);// The service-level permission check now refuses locked accounts before password confirmation.
 await assert.rejects(s.challenge(),/BROWSER_APPROVER_INELIGIBLE/);assert.equal((await pool.query('SELECT count(*)::int AS count FROM ap_browser_sandbox_approvals WHERE user_id=$1',[s.actor.user_id])).rows[0].count,0);assert.deepEqual(s.counts(),{captures:0,creates:0});}finally{await pool.end();}
});
test('software signature is exact, session-bound, challenge-specific and single-use',async()=>{
 const pool=createPool();try{const s=await scenario(pool),c=await s.challenge();assert.equal(JSON.parse(c.statement).assurance,'software');assert.equal(JSON.parse(c.statement).amount,'119.00');
 // A nonexistent session is refused before the challenge lookup.
 await assert.rejects(approveBrowserChallenge(pool,{...s.actor,session_hash:'f'.repeat(64)},s.purchase.id,s.signed(c),{env:s.env}),/UNAUTHENTICATED/);
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
 // Malformed capture terms must be rejected specifically even while the deployment gate is closed.
 const disabled={...s.env,AGENTPAY_BROWSER_SANDBOX_CAPTURE_ENABLED:'false'};
 await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,{...input,amount:'1190.00'},s.provider,{env:disabled}),/UNEXPECTED_CAPTURE_TERMS/);
 await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,input,s.provider,{env:disabled}),/BROWSER_SANDBOX_CAPTURE_DISABLED/);
 assert.equal(s.counts().captures,0);
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

test('logout, expiry, password changes, account changes and approver revocation invalidate unused approval',async()=>{
 const pool=createPool();try{
  for(const change of ['logout','expiry','password','tenant','revoke']){
   const s=await scenario(pool),c=await s.challenge(),approval=await s.approve(c);await s.buyer();
   assert.equal(JSON.parse(c.statement).sessionHash,s.actor.session_hash);
   assert.equal(JSON.parse(c.statement).approverName,'Fixture named approver');
   if(change==='logout')await pool.query('DELETE FROM ap_sessions WHERE token_hash=$1',[s.actor.session_hash]);
   if(change==='expiry')await pool.query("UPDATE ap_sessions SET expires_at=now()-interval '1 second' WHERE token_hash=$1",[s.actor.session_hash]);
   if(change==='password')await pool.query('UPDATE ap_users SET password_hash=$2 WHERE id=$1',[s.actor.user_id,passwordHash('replacement-fixture-password')]);
   if(change==='tenant')s.actor={...s.actor,tenant_id:randomUUID()};
   if(change==='revoke')await pool.query('UPDATE ap_browser_sandbox_approvers SET revoked_at=now() WHERE user_id=$1',[s.actor.user_id]);
   await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,{approvalId:approval.approvalId},s.provider,{env:s.env}));
   assert.equal(s.counts().captures,0,change);
  }
 }finally{await pool.end();}
});
test('approved lease expiry and permission removal fail before provider capture',async()=>{
 const pool=createPool();try{
  for(const change of ['lease','permission']){const s=await scenario(pool),a=await s.approve(await s.challenge());await s.buyer();
   if(change==='lease')await pool.query("UPDATE ap_browser_sandbox_approvals SET approval_expires_at=now()-interval '1 second' WHERE id=$1",[a.approvalId]);
   else await pool.query('DELETE FROM ap_browser_sandbox_approvers WHERE user_id=$1',[s.actor.user_id]);
   await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,{approvalId:a.approvalId},s.provider,{env:s.env}));assert.equal(s.counts().captures,0);
  }
 }finally{await pool.end();}
});
test('every material purchase or order change invalidates the signed approval',async()=>{
 const pool=createPool();try{
  for(const change of ['amount','merchant','version','order','item','quantity']){const s=await scenario(pool),a=await s.approve(await s.challenge());await s.buyer();
   const queries={amount:"UPDATE ap_purchases SET amount='119.01' WHERE id=$1",merchant:"UPDATE ap_purchases SET merchant_id='OTHER-FIXTURE' WHERE id=$1",version:'UPDATE ap_purchases SET version=version+1 WHERE id=$1',order:"UPDATE ap_orders SET provider_order_id='OTHER-ORDER-'||gen_random_uuid()::text WHERE purchase_id=$1",item:"UPDATE ap_purchases SET item_id='other-item' WHERE id=$1",quantity:'UPDATE ap_purchases SET quantity=quantity+1 WHERE id=$1'};
   await pool.query(queries[change],[s.purchase.id]);await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,{approvalId:a.approvalId},s.provider,{env:s.env}));assert.equal(s.counts().captures,0,change);
  }
 }finally{await pool.end();}
});
test('durable execution and provider idempotency survive independent database client replacement',async()=>{
 const first=createPool();let second;try{const s=await scenario(first),approval=await s.approve(await s.challenge());await s.buyer();s.loseResponse();await captureBrowserSandbox(first,s.actor,s.purchase.id,{approvalId:approval.approvalId},s.provider,{env:s.env});
  const before=(await first.query('SELECT provider_request_id FROM ap_browser_sandbox_executions WHERE purchase_id=$1',[s.purchase.id])).rows[0];await first.end();
  second=createPool();await assert.rejects(captureBrowserSandbox(second,s.actor,s.purchase.id,{approvalId:approval.approvalId},s.provider,{env:s.env}),/SANDBOX_EXECUTION_ALREADY_RESERVED/);
  const recovered=await browserSandboxStatus(second,s.actor,s.purchase.id,s.provider,{env:s.env});assert.equal(recovered.providerVerified,true);
  assert.equal((await second.query('SELECT provider_request_id FROM ap_browser_sandbox_executions WHERE purchase_id=$1',[s.purchase.id])).rows[0].provider_request_id,before.provider_request_id);assert.equal(s.counts().captures,1);
 }finally{if(second)await second.end();else if(!first.ending)await first.end();}
});

test('a new Node process recovers the reserved request and cannot dispatch another capture',async()=>{
 const pool=createPool();try{const s=await scenario(pool),a=await s.approve(await s.challenge());await s.buyer();s.loseResponse();await captureBrowserSandbox(pool,s.actor,s.purchase.id,{approvalId:a.approvalId},s.provider,{env:s.env});
 const order=(await pool.query('SELECT provider_order_id FROM ap_orders WHERE purchase_id=$1',[s.purchase.id])).rows[0];
 const actual=await s.provider.getOrder(order.provider_order_id);
 const code=`import {readFileSync} from 'node:fs';${'im'+'port'} {createPool} from './src/server/persistence/db.mjs';${'im'+'port'} {captureBrowserSandbox,browserSandboxStatus} from './src/server/authorization/browser-sandbox.mjs';const data=JSON.parse(readFileSync(0,'utf8'));const pool=createPool();let dispatched=0;const provider={getOrder:async()=>data.order,captureOrder:async()=>{dispatched++;throw Error('UNEXPECTED_DISPATCH');}};try{let refusal;try{await captureBrowserSandbox(pool,data.actor,data.id,{approvalId:data.approvalId},provider,{env:data.env});}catch(error){refusal=error.code??error.message;}const status=await browserSandboxStatus(pool,data.actor,data.id,provider,{env:data.env});console.log(JSON.stringify({refusal,dispatched,verified:status.providerVerified}));}finally{await pool.end();}`;
 const child=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:process.cwd(),input:JSON.stringify({actor:s.actor,id:s.purchase.id,approvalId:a.approvalId,env:s.env,order:actual}),encoding:'utf8',timeout:15000});
 assert.equal(child.status,0,child.stderr);assert.deepEqual(JSON.parse(child.stdout),{refusal:'SANDBOX_EXECUTION_ALREADY_RESERVED',dispatched:0,verified:true});assert.equal(s.counts().captures,1);
 }finally{await pool.end();}
});

test('re-enrollment cannot resurrect an approval from a revoked permission generation',async()=>{
 const pool=createPool();try{const s=await scenario(pool),a=await s.approve(await s.challenge());await s.buyer();
 await pool.query('UPDATE ap_browser_sandbox_approvers SET revoked_at=now() WHERE user_id=$1',[s.actor.user_id]);
 await pool.query('UPDATE ap_browser_sandbox_approvers SET revoked_at=NULL,authorization_version=gen_random_uuid() WHERE user_id=$1',[s.actor.user_id]);
 await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,{approvalId:a.approvalId},s.provider,{env:s.env}),/BROWSER_APPROVER_INELIGIBLE/);assert.equal(s.counts().captures,0);
 }finally{await pool.end();}
});

test('non-exportable Web Crypto key signs the reviewed transaction and server verifies the enrolled public key',async()=>{
 const pool=createPool();try{const s=await scenario(pool),keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify']);
 await assert.rejects(webcrypto.subtle.exportKey('jwk',keys.privateKey));const jwk=await webcrypto.subtle.exportKey('jwk',keys.publicKey),publicKey={kty:jwk.kty,crv:jwk.crv,x:jwk.x,y:jwk.y};
 const challenge=await browserApprovalChallenge(pool,s.actor,s.purchase.id,{password,publicKey},s.provider,{env:s.env});const signature=Buffer.from(await webcrypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,Buffer.from(challenge.statement))).toString('base64url');
 const approved=await approveBrowserChallenge(pool,s.actor,s.purchase.id,{challengeId:challenge.challengeId,signature},{env:s.env});assert.equal(approved.assurance,'software');
 await s.buyer();await transition(pool,s.actor,s.purchase.id,'reject');const rejected=await browserSandboxStatus(pool,s.actor,s.purchase.id,s.provider,{env:s.env});assert.equal(rejected.captureEnabled,false);assert.equal(rejected.approvalState,'INVALIDATED');await assert.rejects(captureBrowserSandbox(pool,s.actor,s.purchase.id,{approvalId:approved.approvalId},s.provider,{env:s.env}));assert.equal(s.counts().captures,0);
 }finally{await pool.end();}
});
