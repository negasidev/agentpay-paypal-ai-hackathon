import {randomUUID} from 'node:crypto';
import {transaction} from '../persistence/db.mjs';
import {purchaseEnvelope,TwoayeAuthorityAdapter,AuthorityUnavailable} from './twoaye.mjs';
import {assertReferenceQuote} from '../shopping/reference-merchant.mjs';
import {canonicalAuthorityToken} from '../identity/authority-context.mjs';
export function authorityConfig(actor,env=process.env){
 const fields={baseUrl:'AUTHORITY_BASE_URL',tenantId:'AUTHORITY_TENANT_ID',principalId:'AUTHORITY_PRINCIPAL_ID',agentId:'AUTHORITY_AGENT_ID',intentId:'AUTHORITY_INTENT_ID',tool:'AUTHORITY_TOOL',action:'AUTHORITY_ACTION',accessToken:'AUTHORITY_ACCESS_TOKEN'};
 if(env.AUTHORITY_LOCAL_TENANT_ID!==actor.tenant_id||env.AUTHORITY_LOCAL_USER_ID!==actor.user_id)return null;
 const config=Object.fromEntries(Object.entries(fields).map(([key,name])=>[key,env[name]]));
 if(actor.canonical_subject_id){
  if(actor.canonical_subject_id!==config.principalId||actor.canonical_tenant_id!==config.tenantId||!actor[canonicalAuthorityToken])return null;
  config.accessToken=actor[canonicalAuthorityToken];
 }
 config.intentVersion=Number(env.AUTHORITY_INTENT_VERSION);
 if(Object.values(config).some(value=>!value)||!Number.isInteger(config.intentVersion)||config.intentVersion<1)return null;
 return config;
}
const publicStates={REQUESTED:'Authorization requested',WAITING_HUMAN:'Waiting for human approval',SIGNED:'Approval signed',VERIFIED:'Authorization verified',REJECTED:'Authorization rejected',EXPIRED:'Authorization expired',REVOKED:'Authorization revoked',UNAVAILABLE:'Authority unavailable'};
export function publicAuthority(row){return row?{state:row.state,label:publicStates[row.state],reason:row.state==='UNAVAILABLE'?'Authority verification is unavailable. Payment capture is disabled.':row.state==='REJECTED'?'The purchase was not authorized.':null,captureEnabled:false}:{state:null,label:'Authorization not requested',captureEnabled:false};}
export async function authorityStatus(pool,a,id){
 const owned=(await pool.query('SELECT id FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3',[id,a.tenant_id,a.user_id])).rows[0];if(!owned)throw new AuthorityUnavailable('NOT_FOUND');
 const row=(await pool.query('SELECT * FROM ap_authority_requests WHERE purchase_id=$1',[id])).rows[0];return publicAuthority(row);
}
export async function requestAuthority(pool,a,id,config=authorityConfig(a)){
 const reserved=await transaction(pool,async db=>{
  const p=(await db.query('SELECT * FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3 FOR UPDATE',[id,a.tenant_id,a.user_id])).rows[0];if(!p)throw new AuthorityUnavailable('NOT_FOUND');
  if(p.state!=='AUTHORIZATION_PENDING')throw new AuthorityUnavailable('INVALID_TRANSITION');
  assertReferenceQuote(p);
  const order=(await db.query('SELECT * FROM ap_orders WHERE purchase_id=$1',[id])).rows[0];if(!order||order.purchase_version!==p.version||order.amount!==p.amount||order.currency!==p.currency||order.merchant_id!==p.merchant_id)throw new AuthorityUnavailable('INVALID_AUTHORITY_BINDING');
  if(p.quote_digest&&order.buyer_status!=='APPROVED')throw new AuthorityUnavailable('BUYER_CONSENT_REQUIRED');
  const existing=(await db.query('SELECT * FROM ap_authority_requests WHERE purchase_id=$1',[id])).rows[0];
  if(existing){
   if(existing.purchase_version!==p.version||existing.provider_order_id!==order.provider_order_id)throw new AuthorityUnavailable('INVALID_AUTHORITY_BINDING');
   // Configuration absence never contacted an issuer. Recover that specific
   // state without discarding identity or retrying an uncertain issuer call.
   if(config&&existing.state==='UNAVAILABLE'&&existing.reason_code==='AUTHORITY_NOT_CONFIGURED'&&
      existing.envelope===null&&existing.platform_intent_id===null&&existing.approval_request_id===null&&existing.grant_id===null){
    const envelope=purchaseEnvelope({tenantId:config.tenantId,localTenantId:a.tenant_id,principalId:a.user_id,purchaseVersion:p.version,purchaseId:id,providerOrderId:order.provider_order_id,executionId:existing.execution_id,merchantId:p.merchant_id,amount:p.amount,currency:p.currency,quoteDigest:p.quote_digest},config);
    const row=(await db.query("UPDATE ap_authority_requests SET platform_intent_id=$2,platform_intent_version=$3,envelope=$4,state='REQUESTED',reason_code=NULL WHERE id=$1 RETURNING *",[existing.id,config.intentId,config.intentVersion,JSON.stringify(envelope)])).rows[0];
    await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[a.tenant_id,a.user_id,id,'authority.configuration-recovered']);
    return {row,fresh:true};
   }
   return {row:existing,fresh:false};
  }
  const executionId=randomUUID();const envelope=config?purchaseEnvelope({tenantId:config.tenantId,localTenantId:a.tenant_id,principalId:a.user_id,purchaseVersion:p.version,purchaseId:id,providerOrderId:order.provider_order_id,executionId,merchantId:p.merchant_id,amount:p.amount,currency:p.currency,quoteDigest:p.quote_digest},config):null;
  const row=(await db.query("INSERT INTO ap_authority_requests(id,tenant_id,user_id,purchase_id,purchase_version,execution_id,provider_order_id,platform_intent_id,platform_intent_version,envelope,state,reason_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *",[randomUUID(),a.tenant_id,a.user_id,id,p.version,executionId,order.provider_order_id,config?.intentId??null,config?.intentVersion??null,envelope?JSON.stringify(envelope):null,config?'REQUESTED':'UNAVAILABLE',config?null:'AUTHORITY_NOT_CONFIGURED'])).rows[0];
  await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[a.tenant_id,a.user_id,id,'authority.requested']);return {row,fresh:true};
 });
 if(!reserved.fresh||!config)return publicAuthority(reserved.row);
 try{
  const adapter=new TwoayeAuthorityAdapter(config);const decision=await adapter.evaluateEnvelope(reserved.row.envelope);
  // Every payment requires a separate device decision, even when a standing
  // contract would otherwise permit autonomous spending.
  const waiting=decision.decision==='REQUIRE_APPROVAL'&&typeof decision.approvalRequestId==='string';
  const state=waiting?'WAITING_HUMAN':'REJECTED';
  await transaction(pool,async db=>{
   await db.query('UPDATE ap_authority_requests SET state=$2,approval_request_id=$3,reason_code=$4 WHERE id=$1 AND state=\'REQUESTED\'',[reserved.row.id,state,waiting?decision.approvalRequestId:null,waiting?null:'PER_PURCHASE_DEVICE_APPROVAL_REQUIRED']);
   await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[a.tenant_id,a.user_id,id,waiting?'authority.waiting-human':'authority.rejected']);
  });
  return authorityStatus(pool,a,id);
 }catch(error){
  const code=['SDK_RESOURCE_BINDING_UNSUPPORTED','AUTHORITY_ISSUANCE_GATE_UNRELEASED'].includes(error.code)?error.code:'AUTHORITY_UNAVAILABLE';
  await transaction(pool,async db=>{await db.query("UPDATE ap_authority_requests SET state='UNAVAILABLE',reason_code=$2 WHERE id=$1 AND state='REQUESTED'",[reserved.row.id,code]);await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[a.tenant_id,a.user_id,id,'authority.unavailable']);});
  return authorityStatus(pool,a,id);
 }
}

export async function refreshAuthority(pool,a,id,config=authorityConfig(a)){
 const db=await pool.connect();let locked=false;
 try{
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,9))',[id]);locked=true;
  const p=(await db.query('SELECT * FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3',[id,a.tenant_id,a.user_id])).rows[0];
  if(!p)throw new AuthorityUnavailable('NOT_FOUND');
  const row=(await db.query('SELECT * FROM ap_authority_requests WHERE purchase_id=$1',[id])).rows[0];
  if(!row||!['WAITING_HUMAN','VERIFIED'].includes(row.state))return publicAuthority(row);
  if(!config||row.platform_intent_id!==config.intentId||row.platform_intent_version!==config.intentVersion||row.purchase_version!==p.version||p.state!=='AUTHORIZATION_PENDING')throw new AuthorityUnavailable('INVALID_AUTHORITY_BINDING');
  const adapter=new TwoayeAuthorityAdapter(config);const approval=await adapter.approval(row.approval_request_id);
  let state=row.state,grant;
  if(approval.status==='Pending')return publicAuthority(row);
  if(approval.status!=='Approved')state=approval.status==='Expired'?'EXPIRED':'REJECTED';
  else{
   if(approval.id!==row.approval_request_id||approval.tenantId!==config.tenantId||approval.intentId!==config.intentId||approval.agentId!==config.agentId||approval.decidedBy!==config.principalId||!approval.decidedByDeviceId||!approval.confirmationMethod||!approval.authorizationId)throw new AuthorityUnavailable('DEVICE_APPROVAL_REQUIRED');
   ({grant}=await adapter.verifyEnvelope(row.envelope,approval.authorizationId,row.platform_intent_version));
   if(grant.approvalId!==approval.id||grant.actionHash!==approval.actionHash)throw new AuthorityUnavailable('APPROVAL_GRANT_MISMATCH');
   state='VERIFIED';
  }
  await db.query('BEGIN');
  // The network round trip cannot make a canceled or changed purchase eligible.
  const current=(await db.query('SELECT * FROM ap_purchases WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(current.version!==row.purchase_version||current.state!=='AUTHORIZATION_PENDING')throw new AuthorityUnavailable('INVALID_AUTHORITY_BINDING');
  await db.query('UPDATE ap_authority_requests SET state=$2,grant_id=$3,expires_at=$4 WHERE id=$1',[row.id,state,grant?.id??row.grant_id,grant?.expiresAt??row.expires_at]);
  if(grant)await db.query('INSERT INTO ap_approvals(id,tenant_id,user_id,purchase_id,authority_id,action_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(purchase_id) DO UPDATE SET authority_id=EXCLUDED.authority_id,action_hash=EXCLUDED.action_hash,expires_at=EXCLUDED.expires_at WHERE ap_approvals.reserved_attempt_id IS NULL AND ap_approvals.authority_id=EXCLUDED.authority_id',[randomUUID(),a.tenant_id,a.user_id,id,grant.id,grant.actionHash,grant.expiresAt]);
  await db.query('INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,$4)',[a.tenant_id,a.user_id,id,'authority.'+state.toLowerCase()]);
  await db.query('COMMIT');return publicAuthority({...row,state});
 }catch(error){await db.query('ROLLBACK');throw error;}
 finally{try{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,9))',[id]);}finally{db.release();}}
}
