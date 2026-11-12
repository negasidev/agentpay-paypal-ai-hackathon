import {createCipheriv,createDecipheriv,randomBytes,randomUUID,createHash} from 'node:crypto';
import {transaction} from '../persistence/db.mjs';
import {identityConfiguration,verifiedIdentity} from './link.mjs';
import {canonicalAuthorityToken} from './authority-context.mjs';

export const tokenHash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{throw new Error(code);};
const sessionIdentity=(identity,config,context)=>{try{return verifiedIdentity(identity,config,context);}catch{fail('CANONICAL_REAUTH_REQUIRED');}};
function key(){const value=process.env.AGENTPAY_IDENTITY_SESSION_KEY_HEX;if(!/^[a-f0-9]{64}$/i.test(value??''))fail('CANONICAL_IDENTITY_NOT_CONFIGURED');return Buffer.from(value,'hex');}
export function sealTokens(tokens,aad){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(aad));
 const bytes=Buffer.concat([cipher.update(JSON.stringify(tokens),'utf8'),cipher.final()]);
 return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64url');}
export function openTokens(value,aad){try{const bytes=Buffer.from(value,'base64url');const decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(0,12));
 decipher.setAuthTag(bytes.subarray(12,28));decipher.setAAD(Buffer.from(aad));return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString());
 }catch{fail('CANONICAL_REAUTH_REQUIRED');}}
export async function canonicalCall(config,path,options={},fetcher=fetch){
 let response;try{response=await fetcher(config.api+path,{...options,cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});}catch{fail('CANONICAL_IDENTITY_UNAVAILABLE');}
 if(!response.ok)fail(response.status===401||response.status===400?'CANONICAL_REAUTH_REQUIRED':'CANONICAL_IDENTITY_UNAVAILABLE');
 return response.status===204?null:response.json();
}
export function tokenPair(value){if(typeof value?.accessToken!=='string'||!/^[A-Za-z0-9_.-]{1,3800}$/.test(value.accessToken)||
 typeof value.refreshToken!=='string'||value.refreshToken.length<16||value.refreshToken.length>2048||value.tokenType!=='Bearer')fail('CANONICAL_REAUTH_REQUIRED');return value;}
export async function establishCanonicalSession(pool,tokens,context,{config=identityConfiguration(),fetcher=fetch}={}){
 tokens=tokenPair(tokens);
 const identity=await canonicalCall(config,'/v1/auth/me',{headers:{Authorization:`Bearer ${tokens.accessToken}`}},fetcher);
 const proof=sessionIdentity(identity,config,context);
 if(identity.claims.scope!=='openid profile')fail('CANONICAL_REAUTH_REQUIRED');
 const token=randomBytes(32).toString('hex'),hash=tokenHash(token),cipher=sealTokens(tokens,hash);
 return transaction(pool,async db=>{
  // A subject lock covers first-login races before a commerce profile exists.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,31))',[JSON.stringify(proof)]);
  let link=(await db.query('SELECT * FROM ap_identity_links WHERE issuer=$1 AND canonical_tenant_id=$2 AND canonical_subject_id=$3',
   [proof.issuer,proof.canonicalTenantId,proof.canonicalSubjectId])).rows[0];
  if(!link){
   const user=randomUUID(),tenant=randomUUID(),id=randomUUID();
   // No email claim can select or take over an existing commerce account.
   await db.query('INSERT INTO ap_users(id,tenant_id,email,password_hash) VALUES($1,$2,$3,$4)',
    [user,tenant,`${id}@canonical.invalid`,'canonical-only:no-local-password']);
   link=(await db.query(`INSERT INTO ap_identity_links(id,tenant_id,user_id,issuer,canonical_tenant_id,canonical_subject_id,context_kind)
    VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,tenant,user,proof.issuer,proof.canonicalTenantId,proof.canonicalSubjectId,context])).rows[0];
  }
  const count=(await db.query('SELECT count(*) FROM ap_identity_links WHERE tenant_id=$1 AND user_id=$2',[link.tenant_id,link.user_id])).rows[0].count;
  if(link.context_kind!==context||count!=='1')fail('CANONICAL_CONTEXT_AMBIGUOUS');
  await db.query("INSERT INTO ap_sessions(token_hash,tenant_id,user_id,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[hash,link.tenant_id,link.user_id]);
  await db.query("INSERT INTO ap_canonical_sessions VALUES($1,$2,$3,'ACTIVE')",[hash,link.id,cipher]);
  return {token,context,tenantId:link.tenant_id,userId:link.user_id,purchasingAuthorityGranted:false};
 });
}
export async function requireCanonicalSession(pool,token,actor,{config,fetcher=fetch}={}){
 const hash=tokenHash(token);
 let row=(await pool.query(`SELECT c.*,l.issuer,l.canonical_tenant_id,l.canonical_subject_id,l.context_kind,l.tenant_id AS owner_tenant_id,l.user_id AS owner_user_id
  FROM ap_canonical_sessions c JOIN ap_identity_links l ON l.id=c.link_id
  WHERE c.token_hash=$1`,[hash])).rows[0];
 if(!row){if(process.env.AGENTPAY_CANONICAL_REQUIRED==='true')fail('CANONICAL_REAUTH_REQUIRED');return actor;}
 if(row.owner_tenant_id!==actor.tenant_id||row.owner_user_id!==actor.user_id)fail('CANONICAL_REAUTH_REQUIRED');
 config??=identityConfiguration();
 if(row.state!=='ACTIVE')fail(row.state==='REFRESHING'?'CANONICAL_IDENTITY_UNAVAILABLE':'CANONICAL_REAUTH_REQUIRED');
 let tokens=openTokens(row.tokens_ciphertext,hash),identity;
 try{identity=await canonicalCall(config,'/v1/auth/me',{headers:{Authorization:`Bearer ${tokens.accessToken}`}},fetcher);}
 catch(error){
  if(error.message!=='CANONICAL_REAUTH_REQUIRED')throw error;
  const lease=await pool.query("UPDATE ap_canonical_sessions SET state='REFRESHING' WHERE token_hash=$1 AND state='ACTIVE' AND tokens_ciphertext=$2",[hash,row.tokens_ciphertext]);
  if(lease.rowCount!==1)fail('CANONICAL_IDENTITY_UNAVAILABLE');
  try{
   tokens=tokenPair(await canonicalCall(config,'/oauth/token',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({grantType:'refresh_token',tenantId:config.tenantId,clientId:config.clientId,refreshToken:tokens.refreshToken})},fetcher));
   identity=await canonicalCall(config,'/v1/auth/me',{headers:{Authorization:`Bearer ${tokens.accessToken}`}},fetcher);
   const proof=sessionIdentity(identity,config,row.context_kind);
   if(proof.canonicalSubjectId!==row.canonical_subject_id||proof.canonicalTenantId!==row.canonical_tenant_id||identity.claims.scope!=='openid profile')fail('CANONICAL_REAUTH_REQUIRED');
   await pool.query("UPDATE ap_canonical_sessions SET tokens_ciphertext=$2,state='ACTIVE' WHERE token_hash=$1 AND state='REFRESHING'",[hash,sealTokens(tokens,hash)]);
  }catch{await pool.query("UPDATE ap_canonical_sessions SET state='REAUTH_REQUIRED' WHERE token_hash=$1",[hash]);fail('CANONICAL_REAUTH_REQUIRED');}
 }
 const proof=sessionIdentity(identity,config,row.context_kind);
 if(proof.issuer!==row.issuer||proof.canonicalTenantId!==row.canonical_tenant_id||proof.canonicalSubjectId!==row.canonical_subject_id||identity.claims.scope!=='openid profile')fail('CANONICAL_REAUTH_REQUIRED');
 const verified={...actor,canonical_subject_id:proof.canonicalSubjectId,canonical_tenant_id:proof.canonicalTenantId,purchasing_context:proof.context};
 Object.defineProperty(verified,canonicalAuthorityToken,{value:tokens.accessToken});
 return verified;
}
export async function canonicalLogout(pool,token,{config,fetcher=fetch}={}){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return;
 const hash=tokenHash(token),row=(await pool.query('SELECT * FROM ap_canonical_sessions WHERE token_hash=$1',[hash])).rows[0];
 if(row){config??=identityConfiguration();const tokens=openTokens(row.tokens_ciphertext,hash);
  await canonicalCall(config,'/oauth/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tenantId:config.tenantId,refreshToken:tokens.refreshToken})},fetcher);}
 await pool.query('DELETE FROM ap_sessions WHERE token_hash=$1',[hash]);
}
