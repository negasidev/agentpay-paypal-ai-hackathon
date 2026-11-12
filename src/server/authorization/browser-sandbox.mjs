import {randomUUID,randomBytes,createHash,createPublicKey,verify,timingSafeEqual} from 'node:crypto';
import {transaction} from '../persistence/db.mjs';
import {reauthenticateActor} from '../auth.mjs';
import {WorkflowError} from '../workflow.mjs';
import {assertApprovedOrder,completedCapture} from '../paypal/client.mjs';
import {verifySandboxOrder} from '../paypal/order-probe.mjs';
import {createCheckout} from '../paypal/checkout.mjs';
import {productById} from '../ai/catalog.mjs';
import {assertReferenceQuote} from '../shopping/reference-merchant.mjs';

const scope=' WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3';
const args=(actor,id)=>[id,actor.tenant_id,actor.user_id];
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
const refuse=(code,status=409)=>{throw new WorkflowError(code,status);};
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&Object.keys(value).every(k=>keys.includes(k));
export function browserSandboxPolicy(actor,env=process.env){
 let origin;try{origin=new URL(env.APP_ORIGIN);}catch{return null;}
 const allowedOrigin=origin.origin==='https://hackathon.agentpay.twoaye.com'||env.NODE_ENV!=='production'&&origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname);
 if(env.AGENTPAY_APPROVAL_MODE!=='sandbox-browser-software'||env.AGENTPAY_EDITION!=='hackathon'||env.PAYPAL_ENVIRONMENT!=='sandbox'||!allowedOrigin||origin.origin!==env.APP_ORIGIN||
 env.AGENTPAY_PROTECTED_CAPTURE_ENABLED!=='false'||!(env.AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE==='true'||env.AGENTPAY_BROWSER_SANDBOX_APPROVER_ID===actor.user_id&&env.AGENTPAY_BROWSER_SANDBOX_TENANT_ID===actor.tenant_id)||
 !/^[a-f0-9]{64}$/.test(actor.session_hash??'')||!/^[A-Za-z0-9-]{1,64}$/.test(env.PAYPAL_SANDBOX_MERCHANT_ID??'')||env.AGENTPAY_BROWSER_SANDBOX_MAX_AMOUNT!=='150.00')return null;
 return {origin:origin.origin,merchantId:env.PAYPAL_SANDBOX_MERCHANT_ID,captureEnabled:env.AGENTPAY_BROWSER_SANDBOX_CAPTURE_ENABLED==='true',maximumAmount:'150.00'};
}
function requirePolicy(actor,env){const policy=browserSandboxPolicy(actor,env);if(!policy)refuse('BROWSER_SANDBOX_NOT_CONFIGURED',503);return policy;}
async function eligibleApprover(db,actor,env=process.env){
 // Shared locks serialize revocation/logout with authorization reservation.
 const session=(await db.query('SELECT token_hash FROM ap_sessions WHERE token_hash=$1 AND tenant_id=$2 AND user_id=$3 AND expires_at>now() FOR SHARE',[actor.session_hash,actor.tenant_id,actor.user_id])).rows[0];
 if(!session)refuse('UNAUTHENTICATED',401);
 const user=(await db.query('SELECT password_hash,locked_until FROM ap_users WHERE id=$1 AND tenant_id=$2 FOR SHARE',[actor.user_id,actor.tenant_id])).rows[0];
 if(!user||user.locked_until&&new Date(user.locked_until)>new Date())refuse('BROWSER_APPROVER_INELIGIBLE',403);
 const permission=(await db.query("SELECT display_name,authorization_version,identity_kind FROM ap_browser_sandbox_approvers WHERE tenant_id=$1 AND user_id=$2 AND permission='approve-own-sandbox-purchase' AND revoked_at IS NULL FOR SHARE",[actor.tenant_id,actor.user_id])).rows[0];
 if(permission?.identity_kind==='shared-evaluation')refuse('BROWSER_APPROVER_INELIGIBLE',403);
 if(!permission)refuse('BROWSER_APPROVER_INELIGIBLE',403);
 if(permission.identity_kind==='verified-workspace-owner'){
  const workspace=(await db.query('SELECT 1 FROM ap_sandbox_workspaces w JOIN ap_sandbox_profiles p ON p.tenant_id=w.tenant_id AND p.user_id=w.owner_id WHERE w.tenant_id=$1 AND w.owner_id=$2',[actor.tenant_id,actor.user_id])).rowCount;
  if(env.AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE!=='true'||!workspace)refuse('BROWSER_APPROVER_INELIGIBLE',403);
 }else if(env.AGENTPAY_BROWSER_SANDBOX_APPROVER_ID!==actor.user_id||env.AGENTPAY_BROWSER_SANDBOX_TENANT_ID!==actor.tenant_id)refuse('BROWSER_APPROVER_INELIGIBLE',403);
 return {identityKind:permission.identity_kind,version:permission.authorization_version,name:permission.display_name,credentialFingerprint:hash(user.password_hash)};
}
async function purchaseAndOrder(db,actor,id,policy){
 const purchase=(await db.query('SELECT * FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE',args(actor,id))).rows[0];
 if(!purchase)refuse('NOT_FOUND',404);
 assertReferenceQuote(purchase);
 const order=(await db.query('SELECT * FROM ap_orders'+scope,args(actor,id))).rows[0];
 if(!order||order.purchase_version!==purchase.version||order.amount!==purchase.amount||order.currency!==purchase.currency||order.merchant_id!==purchase.merchant_id||purchase.merchant_id!==policy.merchantId||purchase.currency!=='USD'||!/^\d+\.\d{2}$/.test(purchase.amount)||BigInt(purchase.amount.replace('.',''))>15000n)refuse('BROWSER_APPROVAL_TERMS_CHANGED');
 return {purchase,order,terms:{amount:purchase.amount,currency:purchase.currency,merchantId:purchase.merchant_id}};
}
function termsHash(p,order,policy){return hash(JSON.stringify(['agentpay.browser-software-sandbox.v1',policy.origin,p.tenant_id,p.user_id,p.id,p.version,p.item_id,p.quantity,p.amount,p.currency,p.merchant_id,order.provider_order_id,p.quote_digest??null]));}
function publicKey(jwk){
 if(!exactKeys(jwk,['kty','crv','x','y'])||jwk.kty!=='EC'||jwk.crv!=='P-256'||!['x','y'].every(k=>/^[A-Za-z0-9_-]{43}$/.test(jwk[k]??'')))refuse('INVALID_BROWSER_KEY',400);
 try{return createPublicKey({key:jwk,format:'jwk'});}catch{refuse('INVALID_BROWSER_KEY',400);}
}
async function audit(db,actor,id,event){await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[...args(actor,id).slice(1),id,event]);}
export async function browserApprovalChallenge(pool,actor,id,input,provider,{env=process.env}={}){
 const policy=requirePolicy(actor,env);
 if(!exactKeys(input,['password','publicKey']))refuse('INVALID_BROWSER_APPROVAL_REQUEST',400);
 publicKey(input.publicKey);
 await transaction(pool,db=>eligibleApprover(db,actor,env));
 await reauthenticateActor(pool,actor,input.password);
 await createCheckout(pool,actor,id,policy.merchantId,provider);
 return transaction(pool,async db=>{
  const identity=await eligibleApprover(db,actor,env);
  const {purchase,order,terms}=await purchaseAndOrder(db,actor,id,policy);
  if(purchase.state!=='AUTHORIZATION_PENDING')refuse('INVALID_TRANSITION');
  const actual=await provider.getOrder(order.provider_order_id);verifySandboxOrder(actual,order.provider_order_id,terms);
  if((await db.query('SELECT 1 FROM ap_browser_sandbox_executions'+scope,args(actor,id))).rowCount)refuse('SANDBOX_EXECUTION_ALREADY_RESERVED');
  const challengeId=randomUUID(),now=Date.now(),challengeExpiresAt=new Date(now+120000).toISOString(),approvalExpiresAt=new Date(now+300000).toISOString();
  const keyThumbprint=hash(JSON.stringify([input.publicKey.kty,input.publicKey.crv,input.publicKey.x,input.publicKey.y]));
  const binding=termsHash(purchase,order,policy);
  const statement=JSON.stringify({purpose:'agentpay.paypal-sandbox.purchase-approval.v1',assurance:'software',origin:policy.origin,challengeId,nonce:randomBytes(32).toString('base64url'),purchaseId:id,purchaseVersion:purchase.version,purchaseItem:purchase.item_id,purchaseName:productById(purchase.item_id)?.name??purchase.item_id,merchantName:'2AYE reference merchant',quantity:purchase.quantity,providerOrderId:order.provider_order_id,amount:purchase.amount,currency:purchase.currency,merchantId:purchase.merchant_id,tenantId:actor.tenant_id,userId:actor.user_id,sessionHash:actor.session_hash,approverName:identity.name,identityKind:identity.identityKind,approverVersion:identity.version,keyThumbprint,termsHash:binding,challengeExpiresAt,approvalExpiresAt});
  await db.query('INSERT INTO ap_browser_sandbox_approvals(id,tenant_id,user_id,purchase_id,session_hash,statement,terms_hash,public_key,key_thumbprint,challenge_expires_at,approval_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[challengeId,actor.tenant_id,actor.user_id,id,actor.session_hash,statement,binding,JSON.stringify(input.publicKey),keyThumbprint,challengeExpiresAt,approvalExpiresAt]);
  await db.query('UPDATE ap_browser_sandbox_approvals SET credential_fingerprint=$2,approver_name=$3,approver_version=$4 WHERE id=$1',[challengeId,identity.credentialFingerprint,identity.name,identity.version]);
  await audit(db,actor,id,'browser-software-approval.challenge');
  return {challengeId,statement,assurance:'software',challengeExpiresAt,approvalExpiresAt,terms:{purchase:productById(purchase.item_id)?.name??purchase.item_id,merchantName:'2AYE reference merchant',approverName:identity.name,amount:purchase.amount,currency:purchase.currency,merchantId:purchase.merchant_id,providerOrderId:order.provider_order_id}};
 });
}
export async function approveBrowserChallenge(pool,actor,id,input,{env=process.env}={}){
 const policy=requirePolicy(actor,env);
 if(!exactKeys(input,['challengeId','signature'])||!/^[A-Za-z0-9_-]{86}$/.test(input.signature??''))refuse('INVALID_BROWSER_SIGNATURE',400);
 return transaction(pool,async db=>{
  const identity=await eligibleApprover(db,actor,env);
  const {purchase,order}=await purchaseAndOrder(db,actor,id,policy);
  const row=(await db.query('SELECT * FROM ap_browser_sandbox_approvals WHERE id=$4 AND purchase_id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE',[...args(actor,id),input.challengeId])).rows[0];
  if(!row||row.session_hash!==actor.session_hash)refuse('BROWSER_APPROVAL_NOT_FOUND',404);
  if(!equal(row.credential_fingerprint,identity.credentialFingerprint)||row.approver_version!==identity.version)refuse('BROWSER_APPROVER_INELIGIBLE',403);
  if(row.approved_at||row.consumed_at||row.revoked_at)refuse('BROWSER_APPROVAL_ALREADY_USED');
  if(new Date(row.challenge_expires_at)<=new Date())refuse('BROWSER_APPROVAL_EXPIRED');
  if(purchase.state!=='AUTHORIZATION_PENDING'||!equal(termsHash(purchase,order,policy),row.terms_hash))refuse('BROWSER_APPROVAL_TERMS_CHANGED');
  if(!verify('sha256',Buffer.from(row.statement),{key:publicKey(row.public_key),dsaEncoding:'ieee-p1363'},Buffer.from(input.signature,'base64url')))refuse('INVALID_BROWSER_SIGNATURE',400);
  await db.query('UPDATE ap_browser_sandbox_approvals SET signature=$2,approved_at=now() WHERE id=$1',[row.id,input.signature]);
  await audit(db,actor,id,'browser-software-approval.approved');
  return {approvalId:row.id,assurance:'software',expiresAt:row.approval_expires_at,paymentExecuted:false};
 });
}
export async function revokeBrowserApproval(pool,actor,id,approvalId,{env=process.env}={}){
 requirePolicy(actor,env);
 return transaction(pool,async db=>{
  await eligibleApprover(db,actor,env);
  const changed=await db.query('UPDATE ap_browser_sandbox_approvals SET revoked_at=now() WHERE id=$4 AND purchase_id=$1 AND tenant_id=$2 AND user_id=$3 AND consumed_at IS NULL RETURNING id',[...args(actor,id),approvalId]);
  if(!changed.rowCount)refuse('BROWSER_APPROVAL_NOT_REVOCABLE');
  await audit(db,actor,id,'browser-software-approval.revoked');return {state:'REVOKED',paymentExecuted:false};
 });
}
function receiptFor(execution,row,capture){return {format:'agentpay.browser-software-sandbox.receipt.v1',assurance:'software',purchaseId:row.purchase_id,approvalId:row.id,approverName:row.approver_name,identityKind:JSON.parse(row.statement).identityKind,approvedAt:row.approved_at,signatureVerified:true,termsHash:row.terms_hash,keyThumbprint:row.key_thumbprint,executionId:execution.id,providerOrderId:capture.orderId,providerCaptureId:capture.captureId,amount:capture.amount,currency:capture.currency,merchantId:capture.merchantId,providerVerifiedAt:new Date().toISOString(),hardwareAttested:false};}
export async function captureBrowserSandbox(pool,actor,id,input,provider,{env=process.env}={}){
 const policy=requirePolicy(actor,env);
 if(!exactKeys(input,['approvalId']))refuse('UNEXPECTED_CAPTURE_TERMS',400);
 if(!policy.captureEnabled)refuse('BROWSER_SANDBOX_CAPTURE_DISABLED',503);
 const reserved=await transaction(pool,async db=>{
  const identity=await eligibleApprover(db,actor,env);
  const {purchase,order,terms}=await purchaseAndOrder(db,actor,id,policy);
  if((await db.query('SELECT 1 FROM ap_browser_sandbox_executions'+scope,args(actor,id))).rowCount)refuse('SANDBOX_EXECUTION_ALREADY_RESERVED');
  const row=(await db.query('SELECT * FROM ap_browser_sandbox_approvals WHERE id=$4 AND purchase_id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE',[...args(actor,id),input.approvalId])).rows[0];
  if(!row||row.session_hash!==actor.session_hash||!row.approved_at||!row.signature||row.consumed_at||row.revoked_at)refuse('BROWSER_APPROVAL_REQUIRED');
  if(!equal(row.credential_fingerprint,identity.credentialFingerprint)||row.approver_version!==identity.version)refuse('BROWSER_APPROVER_INELIGIBLE',403);
  if(new Date(row.approval_expires_at)<=new Date())refuse('BROWSER_APPROVAL_EXPIRED');
  if(purchase.state!=='AUTHORIZATION_PENDING'||!equal(termsHash(purchase,order,policy),row.terms_hash)||!verify('sha256',Buffer.from(row.statement),{key:publicKey(row.public_key),dsaEncoding:'ieee-p1363'},Buffer.from(row.signature,'base64url')))refuse('BROWSER_APPROVAL_TERMS_CHANGED');
  if(order.buyer_status!=='APPROVED')refuse('PAYPAL_BUYER_CONSENT_REQUIRED');
  assertApprovedOrder(await provider.getOrder(order.provider_order_id),order.provider_order_id,terms);
  const execution={id:randomUUID(),requestId:randomUUID(),providerOrderId:order.provider_order_id};
  await db.query("INSERT INTO ap_browser_sandbox_executions(id,tenant_id,user_id,purchase_id,approval_id,provider_order_id,provider_request_id,state) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING')",[execution.id,actor.tenant_id,actor.user_id,id,row.id,order.provider_order_id,execution.requestId]);
  await db.query('UPDATE ap_browser_sandbox_approvals SET consumed_at=now() WHERE id=$1',[row.id]);
  await db.query("UPDATE ap_purchases SET state='CAPTURE_PENDING' WHERE id=$1",[id]);await audit(db,actor,id,'browser-software-capture.reserved');
  return {execution,row,terms};
 });
 const {execution,row,terms}=reserved;
 // The committed reservation is never dispatched a second time after a crash
 // or uncertain response; recovery only retrieves the original provider order.
 try{
  await pool.query('UPDATE ap_browser_sandbox_executions SET dispatched_at=now() WHERE id=$1',[execution.id]);
  await provider.captureOrder(execution.providerOrderId,execution.requestId);
  const actual=await provider.getOrder(execution.providerOrderId);if(actual.intent!=='CAPTURE')refuse('PROVIDER_BINDING_MISMATCH');
  const capture=completedCapture(actual,execution.providerOrderId,terms);if(!capture)refuse('CAPTURE_UNKNOWN');
  const receipt=receiptFor(execution,row,capture);
  await transaction(pool,async db=>{await db.query("UPDATE ap_browser_sandbox_executions SET state='COMPLETED',receipt=$2 WHERE id=$1",[execution.id,JSON.stringify(receipt)]);await db.query("UPDATE ap_purchases SET state='COMPLETED' WHERE id=$1",[id]);await audit(db,actor,id,'browser-software-capture.provider-confirmed');});
  return {state:'COMPLETED',providerVerified:true,receipt};
 }catch{
  await transaction(pool,async db=>{await db.query("UPDATE ap_browser_sandbox_executions SET state='UNKNOWN' WHERE id=$1",[execution.id]);await db.query("UPDATE ap_purchases SET state='UNKNOWN' WHERE id=$1",[id]);await audit(db,actor,id,'browser-software-capture.unknown');});
  return {state:'UNKNOWN',providerVerified:false,reconciliationRequired:true};
 }
}
export async function browserSandboxStatus(pool,actor,id,provider,{env=process.env}={}){
 const policy=requirePolicy(actor,env);
 const purchase=(await pool.query('SELECT * FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3',args(actor,id))).rows[0];if(!purchase)refuse('NOT_FOUND',404);
 let identity;
 try{identity=await transaction(pool,db=>eligibleApprover(db,actor,env));}
 catch(error){
  // An authenticated owner may read evidence without holding approval rights.
  // Only this known eligibility refusal becomes a read-only view; storage and
  // session failures still propagate, and all mutation paths keep their gates.
  if(error.message!=='BROWSER_APPROVER_INELIGIBLE')throw error;
  return {mode:'sandbox-browser-software',assurance:'software',hardwareAttested:false,
   approverEligible:false,readOnly:true,purchaseState:purchase.state,approvalId:null,
   approvalState:'INELIGIBLE',expiresAt:null,buyerApproved:false,captureEnabled:false,
   executionState:null,providerVerified:false,receipt:null};
 }
 const approval=(await pool.query('SELECT * FROM ap_browser_sandbox_approvals'+scope+' AND session_hash=$4 ORDER BY created_at DESC LIMIT 1',[...args(actor,id),actor.session_hash])).rows[0];
 const execution=(await pool.query('SELECT * FROM ap_browser_sandbox_executions'+scope,args(actor,id))).rows[0];
 const order=(await pool.query('SELECT * FROM ap_orders'+scope,args(actor,id))).rows[0];
 let providerVerified=false,receipt=null;
 if(execution&&provider){
  try{
   const actual=await provider.getOrder(execution.provider_order_id);if(actual.intent!=='CAPTURE')refuse('PROVIDER_BINDING_MISMATCH');
   const capture=completedCapture(actual,execution.provider_order_id,{amount:purchase.amount,currency:purchase.currency,merchantId:purchase.merchant_id});
   if(capture){
    const signed=(await pool.query('SELECT * FROM ap_browser_sandbox_approvals WHERE id=$1',[execution.approval_id])).rows[0];
    if(!signed?.consumed_at||!equal(termsHash(purchase,order,policy),signed.terms_hash)||!verify('sha256',Buffer.from(signed.statement),{key:publicKey(signed.public_key),dsaEncoding:'ieee-p1363'},Buffer.from(signed.signature,'base64url')))refuse('BROWSER_APPROVAL_TERMS_CHANGED');
    receipt=receiptFor(execution,signed,capture);providerVerified=true;
    await transaction(pool,async db=>{await db.query("UPDATE ap_browser_sandbox_executions SET state='COMPLETED',receipt=$2 WHERE id=$1",[execution.id,JSON.stringify(receipt)]);await db.query("UPDATE ap_purchases SET state='COMPLETED' WHERE id=$1",[id]);if(execution.state!=='COMPLETED')await audit(db,actor,id,'browser-software-capture.reconciled');});
   }
  }catch{providerVerified=false;receipt=null;}
 }
 const invalidated=approval&&(!equal(approval.credential_fingerprint,identity.credentialFingerprint)||approval.approver_version!==identity.version||!order||!equal(approval.terms_hash,termsHash(purchase,order,policy))||purchase.state!=='AUTHORIZATION_PENDING');
 const state=approval?.revoked_at?'REVOKED':approval?.consumed_at?'CONSUMED':invalidated?'INVALIDATED':approval&&new Date(approval.approval_expires_at)<=new Date()?'EXPIRED':approval?.approved_at?'APPROVED':'REQUIRED';
 return {approverName:identity.name,identityKind:identity.identityKind,mode:'sandbox-browser-software',assurance:'software',hardwareAttested:false,approverEligible:true,readOnly:false,purchaseState:providerVerified?'COMPLETED':purchase.state,approvalId:approval?.id??null,approvalState:state,expiresAt:approval?.approval_expires_at??null,buyerApproved:order?.buyer_status==='APPROVED',captureEnabled:policy.captureEnabled&&purchase.state==='AUTHORIZATION_PENDING'&&state==='APPROVED'&&order?.buyer_status==='APPROVED'&&!execution,executionState:providerVerified?'COMPLETED':execution?.state??null,providerVerified,receipt};
}

export async function recordBrowserRefusal(pool,actor,id,action,code){
 const allowedActions=['challenge','approve','revoke','capture'];
 if(!allowedActions.includes(action))return;
 const category=['INVALID_LOGIN','INVALID_BROWSER_SIGNATURE','BROWSER_APPROVAL_EXPIRED','BROWSER_APPROVAL_TERMS_CHANGED','BROWSER_APPROVAL_ALREADY_USED','BROWSER_APPROVAL_REQUIRED','PAYPAL_BUYER_CONSENT_REQUIRED','SANDBOX_EXECUTION_ALREADY_RESERVED','BROWSER_SANDBOX_CAPTURE_DISABLED','UNEXPECTED_CAPTURE_TERMS'].includes(code)?code:'REQUEST_REFUSED';
 await pool.query("INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) SELECT tenant_id,user_id,id,$4 FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3",[...args(actor,id),`browser-software-${action}.refused.${category.toLowerCase()}`]);
}
