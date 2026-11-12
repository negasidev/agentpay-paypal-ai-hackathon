import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {aiDatabase} from '../fixtures/ai-database.mjs';
import {beginCanonicalLogin,finishCanonicalLogin,safeContinuation,loginConfiguration} from '../../src/server/identity/login.mjs';
import {establishCanonicalSession,requireCanonicalSession,canonicalLogout,sealTokens,openTokens,tokenHash} from '../../src/server/identity/session.mjs';
import {authenticate} from '../../src/server/auth.mjs';
import {canonicalAuthorityToken} from '../../src/server/identity/authority-context.mjs';
import {authorityConfig} from '../../src/server/authorization/requests.mjs';
process.env.AGENTPAY_IDENTITY_SESSION_KEY_HEX=randomBytes(32).toString('hex');
const config={api:'https://canonical.invalid',issuer:'https://login.twoaye.com',tenantId:randomUUID(),applicationId:randomUUID(),clientId:'registered-agentpay',
 login:'https://login.twoaye.com',console:'https://console.twoaye.com',callback:'https://agentpay.twoaye.com/api/identity/callback'};
const subject=randomUUID();
const identity=()=>({tenant:{id:config.tenantId},principal:{id:subject,tenantId:config.tenantId,enabled:true,type:'Human'},accountKind:'individual',
 claims:{issuer:config.issuer,tenantId:config.tenantId,subject,audience:config.applicationId,scope:'openid profile',expiresAt:Math.floor(Date.now()/1000)+300}});
const tokens={accessToken:'canonical-access',refreshToken:'canonical-refresh-token',tokenType:'Bearer'};
const fixture=(value=identity(),calls=[])=>async(url,options)=>{
 calls.push({url,options});
 if(url.endsWith('/oauth/token'))return Response.json(tokens);
 if(url.endsWith('/v1/auth/me'))return Response.json(value);
 if(url.endsWith('/oauth/revoke'))return new Response(null,{status:204});
 throw new Error('Unexpected request');
};
async function scenario(work){const database=await aiDatabase(),pool=database.connect();try{await work(pool);}finally{await pool.end();await database.close();}}
test('tokens are encrypted and cannot move between application sessions',()=>{
 const cipher=sealTokens(tokens,'session-one');assert.ok(!cipher.includes(tokens.accessToken));assert.deepEqual(openTokens(cipher,'session-one'),tokens);
 assert.throws(()=>openTokens(cipher,'another-session'));assert.throws(()=>openTokens(cipher.slice(0,-5),'session-one'));
});
test('continuations cannot send credentials to another origin',()=>{
 assert.equal(safeContinuation('https://attacker.invalid'),'/shopping');assert.equal(safeContinuation('//attacker.invalid'),'/shopping');
 assert.equal(safeContinuation('/workflows'),'/workflows');assert.equal(safeContinuation('/api/purchases'),'/shopping');
});
test('browser-bound PKCE callback creates a fresh session and replays fail',()=>scenario(async pool=>{
 const started=await beginCanonicalLogin(pool,{context:'personal',next:'/shopping'},{config}),calls=[];
 const target=new URL(new URL(started.redirect).searchParams.get('returnTo'));
 assert.equal(target.origin,config.console);assert.equal(target.searchParams.get('state'),started.state);
 const input={state:started.state,code:'real-code-shape',browserNonce:started.browserNonce};
 await assert.rejects(finishCanonicalLogin(pool,{...input,browserNonce:randomBytes(32).toString('hex')},{config,fetcher:fixture()}));
 const session=await finishCanonicalLogin(pool,input,{config,fetcher:fixture(identity(),calls)});
 assert.equal(session.context,'personal');assert.equal(session.purchasingAuthorityGranted,false);
 const verifier=JSON.parse(calls[0].options.body).codeVerifier;
 assert.equal(createHash('sha256').update(verifier).digest('base64url'),started.codeChallenge);
 await assert.rejects(finishCanonicalLogin(pool,input,{config,fetcher:fixture()}));
 const actor=await requireCanonicalSession(pool,session.token,{tenant_id:session.tenantId,user_id:session.userId},{config,fetcher:fixture()});
 assert.equal(actor.canonical_subject_id,subject);
 assert.equal((await pool.query('SELECT * FROM ap_users')).rows[0].password_hash,'canonical-only:no-local-password');
 assert.equal((await pool.query('SELECT count(*) FROM ap_purchases')).rows[0].count,'0');
}));
test('multi-tab flows share browser binding but keep independent state and cannot fix the session token',()=>scenario(async pool=>{
 const a=await beginCanonicalLogin(pool,{context:'personal'},{config});
 const b=await beginCanonicalLogin(pool,{context:'personal',browserNonce:a.browserNonce},{config});
 assert.notEqual(a.state,b.state);assert.equal(a.browserNonce,b.browserNonce);
 const done=flow=>finishCanonicalLogin(pool,{state:flow.state,code:'code',browserNonce:flow.browserNonce},{config,fetcher:fixture()});
 const first=await done(a),second=await done(b);assert.notEqual(first.token,second.token);assert.equal(first.userId,second.userId);
}));
test('expired and interrupted callbacks require a fresh flow',()=>scenario(async pool=>{
 let started=await beginCanonicalLogin(pool,{context:'personal'},{config});
 await pool.query("UPDATE ap_canonical_login_flows SET expires_at=now()-interval '1 second'");
 await assert.rejects(finishCanonicalLogin(pool,{...started,code:'code'},{config,fetcher:fixture()}));
 started=await beginCanonicalLogin(pool,{context:'personal'},{config});const input={...started,code:'code'};
 await assert.rejects(finishCanonicalLogin(pool,input,{config,fetcher:async()=>{throw new Error('lost response');}}));
 await assert.rejects(finishCanonicalLogin(pool,input,{config,fetcher:fixture()}));
 assert.equal((await pool.query('SELECT count(*) FROM ap_sessions')).rows[0].count,'0');
}));
test('wrong application, tenant, disabled principal, scope and context never create sessions',()=>scenario(async pool=>{
 for(const change of [x=>x.claims.audience=randomUUID(),x=>x.claims.tenantId=randomUUID(),x=>x.principal.enabled=false,x=>x.claims.scope='admin',x=>x.accountKind='organization']){
  const value=identity();change(value);await assert.rejects(establishCanonicalSession(pool,tokens,'personal',{config,fetcher:fixture(value)}));
 }
 assert.equal((await pool.query('SELECT count(*) FROM ap_sessions')).rows[0].count,'0');
}));
test('refresh recovers expired access once and validates the same canonical subject',()=>scenario(async pool=>{
 const session=await establishCanonicalSession(pool,tokens,'personal',{config,fetcher:fixture()});let me=0,refresh=0;
 const fetcher=async(url)=>{
  if(url.endsWith('/v1/auth/me'))return ++me===1?new Response(null,{status:401}):Response.json(identity());
  refresh++;return Response.json({...tokens,accessToken:'rotated-access',refreshToken:'rotated-refresh-token'});
 };
 const actor=await requireCanonicalSession(pool,session.token,{tenant_id:session.tenantId,user_id:session.userId},{config,fetcher});
 assert.equal(actor.canonical_subject_id,subject);assert.equal(refresh,1);
 const row=(await pool.query('SELECT * FROM ap_canonical_sessions')).rows[0];assert.equal(row.state,'ACTIVE');
 assert.equal(openTokens(row.tokens_ciphertext,tokenHash(session.token)).accessToken,'rotated-access');
 const env={AUTHORITY_BASE_URL:config.api,AUTHORITY_TENANT_ID:config.tenantId,AUTHORITY_PRINCIPAL_ID:subject,
  AUTHORITY_AGENT_ID:randomUUID(),AUTHORITY_INTENT_ID:randomUUID(),AUTHORITY_INTENT_VERSION:'1',AUTHORITY_TOOL:'paypal',AUTHORITY_ACTION:'capture',
  AUTHORITY_LOCAL_TENANT_ID:actor.tenant_id,AUTHORITY_LOCAL_USER_ID:actor.user_id,AUTHORITY_ACCESS_TOKEN:'stale-environment-token'};
 assert.equal(actor[canonicalAuthorityToken],'rotated-access');
 assert.equal(authorityConfig(actor,env).accessToken,'rotated-access');
 assert.ok(!JSON.stringify(actor).includes('rotated-access'));
 assert.equal(authorityConfig({...actor,canonical_subject_id:randomUUID()},env),null);
 for(const change of [{canonical_subject_id:randomUUID()},{canonical_tenant_id:randomUUID()}]){
  const wrong=Object.defineProperty({...actor,...change},canonicalAuthorityToken,{value:actor[canonicalAuthorityToken]});
  assert.equal(authorityConfig(wrong,env),null);
 }
}));
test('canonical outage refuses without treating it as token expiry or refreshing blindly',()=>scenario(async pool=>{
 const session=await establishCanonicalSession(pool,tokens,'personal',{config,fetcher:fixture()});let calls=0;
 await assert.rejects(requireCanonicalSession(pool,session.token,{tenant_id:session.tenantId,user_id:session.userId},
  {config,fetcher:async()=>{calls++;return new Response(null,{status:503});}}),/UNAVAILABLE/);
 assert.equal(calls,1);assert.equal((await pool.query('SELECT state FROM ap_canonical_sessions')).rows[0].state,'ACTIVE');
}));
test('uncertain refresh becomes terminal reauthentication and never repeats the refresh token',()=>scenario(async pool=>{
 const session=await establishCanonicalSession(pool,tokens,'personal',{config,fetcher:fixture()});let refresh=0;
 const dependencies={config,fetcher:async url=>{if(url.endsWith('/v1/auth/me'))return new Response(null,{status:401});refresh++;throw new Error('lost refresh response');}};
 const actor={tenant_id:session.tenantId,user_id:session.userId};
 await assert.rejects(requireCanonicalSession(pool,session.token,actor,dependencies),/REAUTH/);
 await assert.rejects(requireCanonicalSession(pool,session.token,actor,dependencies),/REAUTH/);assert.equal(refresh,1);
}));
test('canonical logout revokes remotely before removing the local session and cookie cannot recover it',()=>scenario(async pool=>{
 const session=await establishCanonicalSession(pool,tokens,'personal',{config,fetcher:fixture()}),calls=[];
 await canonicalLogout(pool,session.token,{config,fetcher:fixture(identity(),calls)});
 assert.ok(calls[0].url.endsWith('/oauth/revoke'));assert.equal((await pool.query('SELECT count(*) FROM ap_sessions')).rows[0].count,'0');
 assert.equal((await pool.query('SELECT count(*) FROM ap_canonical_sessions')).rows[0].count,'0');
}));
test('revoked canonical authentication becomes 401 semantics; a storage/provider outage stays unavailable',()=>scenario(async pool=>{
 const session=await establishCanonicalSession(pool,tokens,'personal',{config,fetcher:fixture()});
 await assert.rejects(authenticate(pool,session.token,{config,fetcher:async()=>new Response(null,{status:503})}),/UNAVAILABLE/);
 await assert.rejects(authenticate(pool,session.token,{config,fetcher:async()=>new Response(null,{status:401})}),/^Error: UNAUTHENTICATED$/);
}));
test('canonical session cannot be used under a substituted local owner or canonical subject',()=>scenario(async pool=>{
 const session=await establishCanonicalSession(pool,tokens,'personal',{config,fetcher:fixture()});
 await assert.rejects(requireCanonicalSession(pool,session.token,{tenant_id:randomUUID(),user_id:session.userId},{config,fetcher:fixture()}),/REAUTH/);
 const value=identity();value.claims.subject=value.principal.id=randomUUID();
 await assert.rejects(requireCanonicalSession(pool,session.token,{tenant_id:session.tenantId,user_id:session.userId},{config,fetcher:fixture(value)}),/REAUTH/);
}));
test('expired application session requires sign-in even while canonical identity remains valid',()=>scenario(async pool=>{
 const session=await establishCanonicalSession(pool,tokens,'personal',{config,fetcher:fixture()});
 await pool.query("UPDATE ap_sessions SET expires_at=now()-interval '1 second'");let called=false;
 await assert.rejects(authenticate(pool,session.token,{config,fetcher:async()=>{called=true;return Response.json(identity());}}),/UNAUTHENTICATED/);
 assert.equal(called,false);
}));

// Missing deployment mapping must never create a fallback identity session.
test('required canonical login refuses incomplete deployment configuration',()=>{
 const names=['AGENTPAY_CANONICAL_LOGIN_ENABLED','AGENTPAY_IDENTITY_TENANT_ID'];
 const previous=names.map(name=>process.env[name]);
 try{process.env.AGENTPAY_CANONICAL_LOGIN_ENABLED='true';delete process.env.AGENTPAY_IDENTITY_TENANT_ID;
  assert.throws(()=>loginConfiguration(),/CANONICAL_IDENTITY_NOT_CONFIGURED/);
 }finally{names.forEach((name,i)=>{if(previous[i]===undefined)delete process.env[name];else process.env[name]=previous[i];});}
});
