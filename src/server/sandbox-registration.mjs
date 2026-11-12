import {randomUUID,randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {transaction} from './persistence/db.mjs';
import {passwordHash} from './auth.mjs';
import {WorkflowError} from './workflow.mjs';
import {mailConfiguration,sendSandboxMail} from './sandbox-mail.mjs';
const fail=(code,status=400)=>{throw new WorkflowError(code,status);};
const hash=value=>createHash('sha256').update(value).digest('hex');
export function registrationConfiguration(env=process.env){
 if(env.AGENTPAY_SANDBOX_REGISTRATION_ENABLED!=='true'||env.AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE!=='true'||env.AGENTPAY_APPROVAL_MODE!=='sandbox-browser-software'||env.AGENTPAY_EDITION!=='hackathon'||env.PAYPAL_ENVIRONMENT!=='sandbox'||env.AGENTPAY_PROTECTED_CAPTURE_ENABLED!=='false')fail('SANDBOX_REGISTRATION_UNAVAILABLE',503);
 let origin;try{origin=new URL(env.APP_ORIGIN);}catch{fail('SANDBOX_REGISTRATION_UNAVAILABLE',503);}
 if(origin.origin!==env.APP_ORIGIN||!(origin.origin==='https://hackathon.agentpay.twoaye.com'||env.NODE_ENV!=='production'&&origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname)))fail('SANDBOX_REGISTRATION_UNAVAILABLE',503);
 return origin.origin;
}
const closed=(input,keys)=>input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===keys.length&&Object.keys(input).every(x=>keys.includes(x));
export async function registerSandbox(pool,input,{env=process.env,send=sendSandboxMail}={}){
 const origin=registrationConfiguration(env);if(send===sendSandboxMail)mailConfiguration(env);
 if(!closed(input,['name','email','password'])||typeof input.name!=='string'||input.name.trim().length<2||input.name.length>120||/[\r\n\x00-\x1f]/.test(input.name)||typeof input.email!=='string'||input.email.length>254||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.email))fail('INVALID_REGISTRATION');
 const email=input.email.toLowerCase().trim(),password=passwordHash(input.password),id=randomUUID(),token=randomBytes(32).toString('hex');
 await transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(1942019)');
  const recent=(await db.query("SELECT count(*) FILTER(WHERE created_at>now()-interval '1 day')::int AS daily,count(*) FILTER(WHERE email=$1 AND created_at>now()-interval '1 hour')::int AS hourly,count(*) FILTER(WHERE email=$1 AND created_at>now()-interval '1 minute')::int AS minute FROM ap_sandbox_registrations",[email])).rows[0];
  if(recent.daily>=50||recent.hourly>=3||recent.minute>=1)fail('REGISTRATION_RATE_LIMIT',429);
  await db.query("INSERT INTO ap_sandbox_registrations(id,email,full_name,password_hash,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '15 minutes')",[id,email,input.name.trim(),password,hash(token)]);
 });
 let state='FAILED';try{const sent=await send(email,'Verify your AgentPay Sandbox email',`Verify your email within 15 minutes:\n${origin}/register#verification=${id}.${token}\n\nThis verifies your address only. It does not grant payment approval or approve a purchase. Ignore this message if you did not request it.`,{env});state=sent.state==='SUBMITTED'?'SUBMITTED':'FAILED';}catch{}
 await pool.query('UPDATE ap_sandbox_registrations SET delivery_state=$2 WHERE id=$1',[id,state]);
 return {registrationId:id,deliveryState:state,message:state==='SUBMITTED'?'Verification email submitted to the mail provider. Check your inbox.':'Email could not be submitted. You may retry after one minute.'};
}
export async function verifySandboxEmail(pool,input,{env=process.env}={}){
 registrationConfiguration(env);if(!closed(input,['id','token'])||!/^[-a-f0-9]{36}$/.test(input.id??'')||!/^[a-f0-9]{64}$/.test(input.token??''))fail('INVALID_VERIFICATION');
 const result=await transaction(pool,async db=>{
  const row=(await db.query('SELECT * FROM ap_sandbox_registrations WHERE id=$1 FOR UPDATE',[input.id])).rows[0];
  if(!row||row.used_at||row.attempts>=5||new Date(row.expires_at)<=new Date()||row.delivery_state!=='SUBMITTED')return null;
  if(!timingSafeEqual(Buffer.from(row.token_hash,'hex'),Buffer.from(hash(input.token),'hex'))){await db.query('UPDATE ap_sandbox_registrations SET attempts=attempts+1 WHERE id=$1',[row.id]);return null;}
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1942020))',[row.email]);
  if((await db.query('SELECT 1 FROM ap_users WHERE email=$1',[row.email])).rowCount)return null;
  const user=randomUUID(),tenant=randomUUID();
  await db.query('INSERT INTO ap_users(id,tenant_id,email,password_hash) VALUES($1,$2,$3,$4)',[user,tenant,row.email,row.password_hash]);
  await db.query('INSERT INTO ap_sandbox_profiles(user_id,tenant_id,full_name,email_verified_at) VALUES($1,$2,$3,now())',[user,tenant,row.full_name]);
  await db.query('UPDATE ap_sandbox_registrations SET used_at=now() WHERE email=$1 AND used_at IS NULL',[row.email]);
  return {emailVerified:true,workspaceCreated:false,paymentAuthorityGranted:false};
 });if(!result)fail('VERIFICATION_EXPIRED_OR_INVALID',403);return result;
}
export async function createSandboxWorkspace(pool,actor,{env=process.env}={}){
 registrationConfiguration(env);
 return transaction(pool,async db=>{
  const user=(await db.query('SELECT * FROM ap_sandbox_profiles WHERE user_id=$1 AND tenant_id=$2 FOR UPDATE',[actor.user_id,actor.tenant_id])).rows[0];if(!user)fail('VERIFIED_TESTER_REQUIRED',403);
  await db.query('INSERT INTO ap_sandbox_workspaces(tenant_id,owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[actor.tenant_id,actor.user_id]);
  await db.query("INSERT INTO ap_browser_sandbox_approvers(tenant_id,user_id,display_name,permission,identity_kind) VALUES($1,$2,$3,'approve-own-sandbox-purchase','verified-workspace-owner') ON CONFLICT DO NOTHING",[actor.tenant_id,actor.user_id,user.full_name]);
  return {workspaceCreated:true,approvalScope:'own-isolated-sandbox-workspace',productionAuthority:false};
 });
}
export async function notifySandboxApprover(pool,actor,id,{env=process.env,send=sendSandboxMail,resend=false}={}){
 const origin=registrationConfiguration(env);if(send===sendSandboxMail)mailConfiguration(env);
 const reserved=await transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(1942021)');
  if(!resend&&(await db.query("SELECT 1 FROM ap_sandbox_mail_events WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3 AND state='SUBMITTED'",[id,actor.tenant_id,actor.user_id])).rowCount)return {alreadySent:true};
  if((await db.query("SELECT 1 FROM ap_sandbox_mail_events WHERE created_at>now()-interval '1 day' OFFSET 49 LIMIT 1")).rowCount)fail('NOTIFICATION_RATE_LIMIT',429);
  const row=(await db.query("SELECT p.*,u.email,a.display_name FROM ap_purchases p JOIN ap_users u ON u.id=p.user_id AND u.tenant_id=p.tenant_id JOIN ap_sandbox_workspaces w ON w.tenant_id=p.tenant_id AND w.owner_id=p.user_id JOIN ap_browser_sandbox_approvers a ON a.tenant_id=p.tenant_id AND a.user_id=p.user_id AND a.revoked_at IS NULL WHERE p.id=$1 AND p.tenant_id=$2 AND p.user_id=$3 AND p.state='AUTHORIZATION_PENDING' FOR UPDATE OF p",[id,actor.tenant_id,actor.user_id])).rows[0];if(!row)fail('NOT_FOUND',404);
  const count=(await db.query("SELECT count(*)::int AS count FROM ap_sandbox_mail_events WHERE purchase_id=$1 AND created_at>now()-interval '1 hour'",[id])).rows[0].count;if(count>=3)fail('NOTIFICATION_RATE_LIMIT',429);
  if((await db.query("SELECT 1 FROM ap_sandbox_mail_events WHERE user_id=$1 AND created_at>now()-interval '1 minute'",[actor.user_id])).rowCount)fail('NOTIFICATION_RATE_LIMIT',429);
  const event=randomUUID();await db.query("INSERT INTO ap_sandbox_mail_events(id,tenant_id,user_id,purchase_id,kind,state) VALUES($1,$2,$3,$4,'approval-request','PENDING')",[event,actor.tenant_id,actor.user_id,id]);return {row,event};
 });if(reserved.alreadySent)return {deliveryState:'SUBMITTED',alreadySubmitted:true,approvalGranted:false,paymentExecuted:false};let state='FAILED',providerId=null;
 try{const sent=await send(reserved.row.email,'Review your AgentPay Sandbox purchase',`A Sandbox purchase awaits your review.\nAmount: ${reserved.row.amount} ${reserved.row.currency}\nMerchant reference: ${reserved.row.merchant_id}\n\nSign in to review: ${origin}/sign-in?next=/approvals\n\nThis email is a notification only. Opening this link does not approve or pay. Review the current terms in AgentPay.`,{env});state=sent.state==='SUBMITTED'?'SUBMITTED':'FAILED';providerId=sent.providerId??null;}catch{}
 await transaction(pool,async db=>{await db.query('UPDATE ap_sandbox_mail_events SET state=$2,provider_id=$3 WHERE id=$1',[reserved.event,state,providerId]);await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[actor.tenant_id,actor.user_id,id,'sandbox-approval-notification.'+state.toLowerCase()]);});
 return {deliveryState:state,approvalGranted:false,paymentExecuted:false};
}
