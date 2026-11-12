import {randomBytes,createHash} from 'node:crypto';
import {transaction} from '../persistence/db.mjs';
import {identityConfiguration} from './link.mjs';
import {canonicalCall,establishCanonicalSession,tokenHash} from './session.mjs';
import {safeApplicationDestination} from '../../shared/navigation.mjs';
export function applicationOrigin(){return new URL(process.env.APP_ORIGIN||'http://localhost:3006');}
export function browserCookieName(){return applicationOrigin().protocol==='https:'?'__Host-agentpay_browser':'agentpay_browser';}
export const safeContinuation=value=>safeApplicationDestination(value);
export function loginConfiguration(){
 if(process.env.AGENTPAY_CANONICAL_LOGIN_ENABLED!=='true'||!/^[a-f0-9]{64}$/i.test(process.env.AGENTPAY_IDENTITY_SESSION_KEY_HEX??''))throw new Error('CANONICAL_IDENTITY_NOT_CONFIGURED');
 const config=identityConfiguration();
 const login=new URL(process.env.AGENTPAY_UNIVERSAL_LOGIN_URL),consoleUrl=new URL(process.env.AGENTPAY_CONSOLE_URL);
 const app=applicationOrigin();
 for(const url of [login,consoleUrl,app])if(url.username||url.password||url.search||url.hash||
  (url.protocol!=='https:'&&!(process.env.NODE_ENV!=='production'&&['127.0.0.1','localhost'].includes(url.hostname))&&
   !(url===app&&process.env.AGENTPAY_ACCEPTANCE_LOOPBACK_ENABLED==='true'&&url.origin==='http://127.0.0.1:3516'&&url.pathname==='/')))throw new Error('CANONICAL_IDENTITY_NOT_CONFIGURED');
 if(login.pathname!=='/'||consoleUrl.pathname!=='/')throw new Error('CANONICAL_IDENTITY_NOT_CONFIGURED');
 return {...config,login:login.origin,console:consoleUrl.origin,callback:applicationOrigin().origin+'/api/identity/callback'};
}
export async function beginCanonicalLogin(pool,{context,next,browserNonce},{config=loginConfiguration()}={}){
 if(!['personal','organization'].includes(context))throw new Error('CANONICAL_CONTEXT_REQUIRED');
 const nonce=/^[a-f0-9]{64}$/.test(browserNonce??'')?browserNonce:randomBytes(32).toString('hex');
 const state=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 await transaction(pool,async db=>{
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,32))',[tokenHash(nonce)]);
  await db.query('DELETE FROM ap_canonical_login_flows WHERE browser_hash=$1 AND (expires_at<=now() OR consumed=true)',[tokenHash(nonce)]);
  const count=(await db.query('SELECT count(*) FROM ap_canonical_login_flows WHERE browser_hash=$1',[tokenHash(nonce)])).rows[0].count;
  if(Number(count)>=8)throw new Error('CANONICAL_LOGIN_BUSY');
  await db.query(`INSERT INTO ap_canonical_login_flows(state_hash,browser_hash,code_verifier,context_kind,return_path,expires_at)
   VALUES($1,$2,$3,$4,$5,now()+interval '5 minutes')`,[tokenHash(state),tokenHash(nonce),verifier,context,safeContinuation(next)]);
 });
 const continuation=new URL('/applications/agentpay',config.console);continuation.searchParams.set('state',state);continuation.searchParams.set('challenge',challenge);
 const login=new URL('/',config.login);login.searchParams.set('returnTo',continuation.href);
 return {browserNonce:nonce,redirect:login.href,state,codeChallenge:challenge};
}
export async function finishCanonicalLogin(pool,{state,code,browserNonce},{config=loginConfiguration(),fetcher=fetch}={}){
 if(!/^[a-f0-9]{64}$/.test(state??'')||!/^[a-f0-9]{64}$/.test(browserNonce??'')||typeof code!=='string'||code.length>2048||code.length<1)throw new Error('CANONICAL_REAUTH_REQUIRED');
 const flow=await transaction(pool,async db=>{
  const row=(await db.query(`SELECT * FROM ap_canonical_login_flows WHERE state_hash=$1 AND browser_hash=$2
   AND consumed=false AND expires_at>now() FOR UPDATE`,[tokenHash(state),tokenHash(browserNonce)])).rows[0];
  if(!row)throw new Error('CANONICAL_REAUTH_REQUIRED');
  await db.query('UPDATE ap_canonical_login_flows SET consumed=true,code_verifier=NULL WHERE state_hash=$1',[tokenHash(state)]);return row;
 });
 const tokens=await canonicalCall(config,'/oauth/token',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({grantType:'authorization_code',tenantId:config.tenantId,clientId:config.clientId,code,codeVerifier:flow.code_verifier})},fetcher);
 try{
  const session=await establishCanonicalSession(pool,tokens,flow.context_kind,{config,fetcher});
  return {...session,returnPath:flow.return_path};
 }catch(error){
  if(typeof tokens?.refreshToken==='string')try{await canonicalCall(config,'/oauth/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({tenantId:config.tenantId,refreshToken:tokens.refreshToken})},fetcher);}catch{}
  throw error;
 }
}
