import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../../src/server/persistence/db.mjs';
import {requireSandboxWriter} from '../../src/server/sandbox-membership.mjs';
import {login,authenticate,provision} from '../../src/server/auth.mjs';
import {registerSandbox,verifySandboxEmail,createSandboxWorkspace,notifySandboxApprover} from '../../src/server/sandbox-registration.mjs';
import {mailConfiguration,sendSandboxMail} from '../../src/server/sandbox-mail.mjs';
import {createPurchase,transition} from '../../src/server/workflow.mjs';
const env={NODE_ENV:'test',APP_ORIGIN:'http://localhost:3006',AGENTPAY_EDITION:'hackathon',PAYPAL_ENVIRONMENT:'sandbox',AGENTPAY_APPROVAL_MODE:'sandbox-browser-software',AGENTPAY_PROTECTED_CAPTURE_ENABLED:'false',AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE:'true',AGENTPAY_SANDBOX_REGISTRATION_ENABLED:'true'};
const password='fixture-registration-password';
async function registered(pool){let content;const email='fixture-'+randomUUID()+'@example.test';const result=await registerSandbox(pool,{name:'Fixture Operator',email,password},{env,send:async(to,subject,text)=>{content={to,subject,text};return {state:'SUBMITTED'};}});const match=content.text.match(/verification=([-a-f0-9]{36})\.([a-f0-9]{64})/);return {email,result,content,verification:{id:match[1],token:match[2]}};}
async function verified(pool){const r=await registered(pool);await verifySandboxEmail(pool,r.verification,{env});const token=await login(pool,r.email,password),actor=await authenticate(pool,token);return {...r,actor,token};}
test('email verification activates an account but grants no workspace or payment permission',async()=>{
 const pool=createPool();try{const r=await registered(pool);assert.equal(r.result.deliveryState,'SUBMITTED');assert(!JSON.stringify(r.result).includes(r.verification.token));
 await assert.rejects(login(pool,r.email,password),/INVALID_LOGIN/);assert.equal((await pool.query('SELECT 1 FROM ap_users WHERE email=$1',[r.email])).rowCount,0);
 await verifySandboxEmail(pool,r.verification,{env});const actor=await authenticate(pool,await login(pool,r.email,password));
 assert.equal((await pool.query('SELECT 1 FROM ap_browser_sandbox_approvers WHERE user_id=$1',[actor.user_id])).rowCount,0);
 assert.equal((await pool.query('SELECT 1 FROM ap_sandbox_workspaces WHERE owner_id=$1',[actor.user_id])).rowCount,0);
 await assert.rejects(verifySandboxEmail(pool,r.verification,{env}),/VERIFICATION_EXPIRED_OR_INVALID/);
 }finally{await pool.end();}
});
test('only verified owners explicitly create their own isolated workspace, never join another tenant',async()=>{
 const pool=createPool();try{const a=await verified(pool),b=await verified(pool);await createSandboxWorkspace(pool,a.actor,{env});await createSandboxWorkspace(pool,a.actor,{env});
 const permission=(await pool.query('SELECT * FROM ap_browser_sandbox_approvers WHERE user_id=$1',[a.actor.user_id])).rows[0];assert.equal(permission.identity_kind,'verified-workspace-owner');assert.equal(permission.tenant_id,a.actor.tenant_id);
 await assert.rejects(createSandboxWorkspace(pool,{...b.actor,tenant_id:a.actor.tenant_id},{env}),/VERIFIED_TESTER_REQUIRED/);
 const judge=await provision(pool,'fixture-judge-'+randomUUID()+'@example.test',password);await assert.rejects(createSandboxWorkspace(pool,{user_id:judge.id,tenant_id:judge.tenantId},{env}),/VERIFIED_TESTER_REQUIRED/);
 }finally{await pool.end();}
});
test('wrong, expired, used and undelivered verification codes cannot activate an account',async()=>{
 const pool=createPool();try{const wrong=await registered(pool);for(let i=0;i<5;i++)await assert.rejects(verifySandboxEmail(pool,{...wrong.verification,token:'0'.repeat(64)},{env}),/VERIFICATION_EXPIRED_OR_INVALID/);await assert.rejects(verifySandboxEmail(pool,wrong.verification,{env}),/VERIFICATION_EXPIRED_OR_INVALID/);
 const expired=await registered(pool);await pool.query("UPDATE ap_sandbox_registrations SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.result.registrationId]);await assert.rejects(verifySandboxEmail(pool,expired.verification,{env}),/VERIFICATION_EXPIRED_OR_INVALID/);
 const failed=await registerSandbox(pool,{name:'Fixture Operator',email:'fixture-'+randomUUID()+'@example.test',password},{env,send:async()=>{throw Error('fixture outage');}});assert.equal(failed.deliveryState,'FAILED');assert.equal((await pool.query('SELECT 1 FROM ap_users u JOIN ap_sandbox_registrations r ON r.email=u.email WHERE r.id=$1',[failed.registrationId])).rowCount,0);
 }finally{await pool.end();}
});
test('registration requires explicit Sandbox setup, closed inputs and durable resend throttles',async()=>{
 const pool=createPool();try{const r=await registered(pool);await assert.rejects(registerSandbox(pool,{name:'Fixture Operator',email:r.email,password},{env,send:async()=>({state:'SUBMITTED'})}),/REGISTRATION_RATE_LIMIT/);
 for(const patch of [{PAYPAL_ENVIRONMENT:'live'},{APP_ORIGIN:'https://agentpay.twoaye.com'},{AGENTPAY_PROTECTED_CAPTURE_ENABLED:'true'},{AGENTPAY_SANDBOX_REGISTRATION_ENABLED:'false'}])await assert.rejects(registerSandbox(pool,{name:'Fixture Operator',email:'fixture@example.test',password},{env:{...env,...patch},send:async()=>({state:'SUBMITTED'})}),/SANDBOX_REGISTRATION_UNAVAILABLE/);
 await assert.rejects(registerSandbox(pool,{name:'Fixture Operator',email:'fixture@example.test',password,tenantId:randomUUID()},{env,send:async()=>({state:'SUBMITTED'})}),/INVALID_REGISTRATION/);
 }finally{await pool.end();}
});
test('approval notification targets verified owner, never approves, records failure and refuses foreign purchases',async()=>{
 const pool=createPool();try{const a=await verified(pool),b=await verified(pool);await createSandboxWorkspace(pool,a.actor,{env});const purchase=await createPurchase(pool,a.actor,'keyboard');await transition(pool,a.actor,purchase.id,'review');await transition(pool,a.actor,purchase.id,'submit');let sent=0;
 const options={env,send:async(to,subject,text)=>{sent++;assert.equal(to,a.email);assert(text.includes(`/sign-in?next=/transactions/${purchase.id}`));assert(!text.includes('/capture'));return {state:'SUBMITTED',providerId:'FIXTURE-MAIL'};}};
 await assert.rejects(notifySandboxApprover(pool,b.actor,purchase.id,options),/NOT_FOUND/);
 const notice=await notifySandboxApprover(pool,a.actor,purchase.id,options);assert.equal(notice.approvalGranted,false);assert.equal(notice.paymentExecuted,false);assert.equal(notice.deliveryState,'SUBMITTED');
 await notifySandboxApprover(pool,a.actor,purchase.id,options);assert.equal(sent,1);assert.equal((await pool.query('SELECT 1 FROM ap_browser_sandbox_approvals WHERE purchase_id=$1',[purchase.id])).rowCount,0);
 await assert.rejects(notifySandboxApprover(pool,a.actor,purchase.id,{...options,resend:true}),/NOTIFICATION_RATE_LIMIT/);
 }finally{await pool.end();}
});
test('SMTP configuration pins TLS transport, bounds recipients and reports submission rather than inbox delivery',async()=>{
 assert.throws(()=>mailConfiguration({}),/SANDBOX_EMAIL_NOT_CONFIGURED/);
 const configured={...env,AGENTPAY_EMAIL_PROFILE:'isolated-sandbox',AGENTPAY_SANDBOX_SMTP_USER:'fixture-sender@example.test',AGENTPAY_SANDBOX_SMTP_PASSWORD:'fixture-only',AGENTPAY_EMAIL_ALLOWED_RECIPIENTS:'fixture-recipient@example.test'};let message;
 const createTransport=options=>{assert.equal(options.host,'smtp.hostinger.com');assert.equal(options.requireTLS,true);assert.equal(options.tls.rejectUnauthorized,true);return {async sendMail(mail){message=mail;return {accepted:[mail.to],rejected:[],messageId:'FIXTURE-MAIL'};},close(){}};};
 const result=await sendSandboxMail('fixture-recipient@example.test','Verify your AgentPay Sandbox email','fixture only',{env:configured,createTransport});assert.equal(result.state,'SUBMITTED');assert.equal(message.from,configured.AGENTPAY_SANDBOX_SMTP_USER);assert.equal(message.html,undefined);assert.equal(message.attachments,undefined);
 await assert.rejects(sendSandboxMail('other@example.test','Verify your AgentPay Sandbox email','fixture',{env:configured,createTransport}),/SANDBOX_EMAIL_REFUSED/);
});

test('notification outage records a failed submission without granting approval or touching another inbox',async()=>{
 const pool=createPool();try{const a=await verified(pool);await createSandboxWorkspace(pool,a.actor,{env});const purchase=await createPurchase(pool,a.actor,'keyboard');await transition(pool,a.actor,purchase.id,'review');await transition(pool,a.actor,purchase.id,'submit');
 const result=await notifySandboxApprover(pool,a.actor,purchase.id,{env,send:async to=>{assert.equal(to,a.email);throw Error('fixture-mail-outage');}});assert.equal(result.deliveryState,'FAILED');assert.equal(result.approvalGranted,false);
 assert.equal((await pool.query('SELECT state FROM ap_sandbox_mail_events WHERE purchase_id=$1',[purchase.id])).rows[0].state,'FAILED');assert.equal((await pool.query('SELECT 1 FROM ap_browser_sandbox_approvals WHERE purchase_id=$1',[purchase.id])).rowCount,0);
 }finally{await pool.end();}
});

test('shared evaluation and verified email alone remain read-only; only explicit workspace owner can mutate',async()=>{
 const pool=createPool();try{const a=await verified(pool);await assert.rejects(requireSandboxWriter(pool,a.actor,{env}),/READ_ONLY_EVALUATION_ACCOUNT/);await createSandboxWorkspace(pool,a.actor,{env});await requireSandboxWriter(pool,a.actor,{env});
 const judge=await provision(pool,'fixture-reader-'+randomUUID()+'@example.test',password);await assert.rejects(requireSandboxWriter(pool,{user_id:judge.id,tenant_id:judge.tenantId},{env}),/READ_ONLY_EVALUATION_ACCOUNT/);
 await assert.rejects(requireSandboxWriter(pool,{...a.actor,tenant_id:judge.tenantId},{env}),/READ_ONLY_EVALUATION_ACCOUNT/);
 }finally{await pool.end();}
});
