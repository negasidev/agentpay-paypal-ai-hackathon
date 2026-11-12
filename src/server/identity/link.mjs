import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {transaction} from '../persistence/db.mjs';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const hash=value=>createHash('sha256').update(value).digest('hex');
const refuse=()=>{throw new Error('IDENTITY_LINK_REFUSED');};
export function identityConfiguration(env=process.env){
 try{
  const base=new URL(env.AGENTPAY_IDENTITY_API_URL);
  const local=env.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(base.hostname)&&base.protocol==='http:';
  if((base.protocol!=='https:'&&!local)||base.username||base.password||base.search||base.hash||base.pathname!=='/'||
   !uuid(env.AGENTPAY_IDENTITY_TENANT_ID)||!uuid(env.AGENTPAY_IDENTITY_APPLICATION_ID)||
   !env.AGENTPAY_IDENTITY_CLIENT_ID)throw new Error();
  return {api:base.origin,tenantId:env.AGENTPAY_IDENTITY_TENANT_ID,applicationId:env.AGENTPAY_IDENTITY_APPLICATION_ID,
   clientId:env.AGENTPAY_IDENTITY_CLIENT_ID,issuer:'https://login.twoaye.com'};
 }catch{throw new Error('CANONICAL_IDENTITY_NOT_CONFIGURED');}
}

export function verifiedIdentity(identity,config,context){
 const {claims,principal,tenant}=identity??{};
 if(!claims||!principal||!tenant||!uuid(principal.id)||!uuid(tenant.id)||
  claims.issuer!==config.issuer||claims.audience!==config.applicationId||
  claims.tenantId!==config.tenantId||tenant.id!==config.tenantId||principal.tenantId!==tenant.id||
  claims.subject!==principal.id||principal.enabled!==true||!['Human','WorkforceUser'].includes(principal.type)||
  !Number.isSafeInteger(claims.expiresAt)||claims.expiresAt<=Math.floor(Date.now()/1000)||
  (context==='personal'?identity.accountKind!=='individual':context==='organization'?identity.accountKind!=='organization':true))refuse();
 return {issuer:claims.issuer,canonicalTenantId:tenant.id,canonicalSubjectId:principal.id,context};
}

export async function beginIdentityLink(pool,actor,context,config=identityConfiguration()){
 if(!['personal','organization'].includes(context))refuse();
 const token=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
 await transaction(pool,async db=>{
  const owner=await db.query('SELECT id FROM ap_users WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[actor.tenant_id,actor.user_id]);
  if(owner.rowCount!==1)refuse();
  await db.query('DELETE FROM ap_identity_link_flows WHERE tenant_id=$1 AND user_id=$2 AND (consumed=true OR expires_at<=now())',[actor.tenant_id,actor.user_id]);
  const pending=await db.query('SELECT count(*) AS count FROM ap_identity_link_flows WHERE tenant_id=$1 AND user_id=$2',[actor.tenant_id,actor.user_id]);
  if(Number(pending.rows[0].count)>=5)refuse();
  await db.query(`INSERT INTO ap_identity_link_flows(token_hash,tenant_id,user_id,context_kind,code_verifier,expires_at)
   VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')`,[hash(token),actor.tenant_id,actor.user_id,context,verifier]);
 });
 return {flowToken:token,tenantId:config.tenantId,clientId:config.clientId,
  codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256',expiresIn:300};
}

export async function completeIdentityLink(pool,actor,input,{config=identityConfiguration(),fetcher=fetch}={}){
 if(typeof input?.flowToken!=='string'||!/^[a-f0-9]{64}$/.test(input.flowToken)||
  typeof input.authorizationCode!=='string'||input.authorizationCode.length<1||input.authorizationCode.length>2048)refuse();
 // Consume before the remote exchange. A lost response requires a fresh flow,
 // never a second attempt to attach an identity using a partially spent proof.
 const flow=await transaction(pool,async db=>{
  const row=(await db.query(`SELECT * FROM ap_identity_link_flows WHERE token_hash=$1 AND tenant_id=$2 AND user_id=$3
   AND consumed=false AND expires_at>now() FOR UPDATE`,[hash(input.flowToken),actor.tenant_id,actor.user_id])).rows[0];
  if(!row)refuse();
  await db.query('UPDATE ap_identity_link_flows SET consumed=true,code_verifier=NULL WHERE token_hash=$1',[row.token_hash]);
  return row;
 });
 const call=async(path,options)=>{
  let response;
  try{response=await fetcher(config.api+path,{...options,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});}catch{refuse();}
  if(!response.ok)refuse();
  try{return await response.json();}catch{refuse();}
 };
 const tokens=await call('/oauth/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
  grantType:'authorization_code',tenantId:config.tenantId,clientId:config.clientId,
  code:input.authorizationCode,codeVerifier:flow.code_verifier})});
 try{
  if(typeof tokens.accessToken!=='string'||!/^[A-Za-z0-9_.-]{1,3800}$/.test(tokens.accessToken)||tokens.tokenType!=='Bearer')refuse();
  const identity=await call('/v1/auth/me',{headers:{Authorization:`Bearer ${tokens.accessToken}`}});
  const proof=verifiedIdentity(identity,config,flow.context_kind);
  return await transaction(pool,async db=>{
   const result=await db.query(`INSERT INTO ap_identity_links(id,tenant_id,user_id,issuer,canonical_tenant_id,canonical_subject_id,context_kind)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
    [randomUUID(),actor.tenant_id,actor.user_id,proof.issuer,proof.canonicalTenantId,proof.canonicalSubjectId,proof.context]);
   if(!result.rowCount){
    const existing=(await db.query(`SELECT id FROM ap_identity_links WHERE tenant_id=$1 AND user_id=$2 AND issuer=$3
     AND canonical_tenant_id=$4 AND canonical_subject_id=$5 AND context_kind=$6`,
     [actor.tenant_id,actor.user_id,proof.issuer,proof.canonicalTenantId,proof.canonicalSubjectId,proof.context])).rows[0];
    if(!existing)refuse();
   }
   return {linked:true,context:proof.context,canonicalTenantId:proof.canonicalTenantId,
    canonicalSubjectId:proof.canonicalSubjectId,purchasingAuthorityGranted:false};
  });
 }finally{
  // Migration needs identity proof, not a retained canonical refresh session.
  if(typeof tokens.refreshToken==='string'){
   try{await fetcher(config.api+'/oauth/revoke',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
    headers:{'content-type':'application/json'},body:JSON.stringify({tenantId:config.tenantId,refreshToken:tokens.refreshToken})});}catch{}
  }
 }
}
