import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {aiDatabase} from '../fixtures/ai-database.mjs';
import {provision} from '../../src/server/auth.mjs';
import {identityConfiguration,verifiedIdentity,beginIdentityLink,completeIdentityLink} from '../../src/server/identity/link.mjs';

const config={api:'https://api.identity.test',issuer:'https://login.twoaye.com',tenantId:randomUUID(),applicationId:randomUUID(),clientId:'agentpay-client'};
const identity=()=>({tenant:{id:config.tenantId},principal:{id:subject,tenantId:config.tenantId,enabled:true,type:'Human'},
 claims:{issuer:config.issuer,subject,audience:config.applicationId,tenantId:config.tenantId,expiresAt:Math.floor(Date.now()/1000)+300},accountKind:'individual'});
const subject=randomUUID();
test('canonical identity is based on verified IDs, never an email match or purchasing permission',()=>{
 assert.deepEqual(verifiedIdentity({...identity(),email:'unrelated@example.test'},config,'personal'),{
  issuer:config.issuer,canonicalTenantId:config.tenantId,canonicalSubjectId:subject,context:'personal'});
});
for(const [name,mutate]of [
 ['wrong tenant',x=>x.claims.tenantId=randomUUID()],['wrong audience',x=>x.claims.audience=randomUUID()],
 ['wrong issuer',x=>x.claims.issuer='https://attacker.test'],['wrong subject',x=>x.claims.subject=randomUUID()],
 ['disabled user',x=>x.principal.enabled=false],['machine principal',x=>x.principal.type='ServiceAccount'],
 ['expired session',x=>x.claims.expiresAt=1],['organization substituted for personal',x=>x.accountKind='organization'],
 ['unknown account kind',x=>x.accountKind=null],
])test(`canonical linkage refuses ${name}`,()=>{const value=identity();mutate(value);assert.throws(()=>verifiedIdentity(value,config,'personal'));});
test('organization context is explicit and cannot be inferred from membership',()=>{
 assert.throws(()=>verifiedIdentity(identity(),config,'organization'));
 assert.equal(verifiedIdentity({...identity(),accountKind:'organization'},config,'organization').context,'organization');
});
test('identity API configuration rejects unsafe origins and incomplete application identity',()=>{
 const env={NODE_ENV:'production',AGENTPAY_IDENTITY_API_URL:config.api,AGENTPAY_IDENTITY_TENANT_ID:config.tenantId,
  AGENTPAY_IDENTITY_APPLICATION_ID:config.applicationId,AGENTPAY_IDENTITY_CLIENT_ID:config.clientId};
 assert.equal(identityConfiguration(env).api,config.api);
 for(const value of ['http://api.identity.test','https://user:password@api.identity.test','https://api.identity.test/?token=x'])
  assert.throws(()=>identityConfiguration({...env,AGENTPAY_IDENTITY_API_URL:value}));
 assert.throws(()=>identityConfiguration({...env,AGENTPAY_IDENTITY_APPLICATION_ID:''}));
});

async function scenario(work){const database=await aiDatabase();const pool=database.connect();try{
 const local=await provision(pool,`link-${randomUUID()}@example.test`,'identity-link-test-password');
 const actor={tenant_id:local.tenantId,user_id:local.id};await work({pool,actor});
}finally{await pool.end();await database.close();}}
const backchannel=(value=identity(),calls=[])=>async(url,options)=>{
 calls.push({url,options});
 if(url.endsWith('/oauth/token'))return Response.json({accessToken:'server-only-access',refreshToken:'server-only-refresh',tokenType:'Bearer'});
 if(url.endsWith('/v1/auth/me'))return Response.json(value);
 if(url.endsWith('/oauth/revoke'))return new Response(null,{status:204});
 throw new Error('Unexpected provider request');
};
test('authenticated migration consumes PKCE flow, records IDs and discards tokens without issuing authority',()=>scenario(async({pool,actor})=>{
 const flow=await beginIdentityLink(pool,actor,'personal',config),calls=[];
 const result=await completeIdentityLink(pool,actor,{flowToken:flow.flowToken,authorizationCode:'canonical-code'},{config,fetcher:backchannel(identity(),calls)});
 assert.equal(result.linked,true);assert.equal(result.purchasingAuthorityGranted,false);
 const verifier=JSON.parse(calls[0].options.body).codeVerifier;
 assert.equal(createHash('sha256').update(verifier).digest('base64url'),flow.codeChallenge);
 assert.equal(calls[1].options.headers.Authorization,'Bearer server-only-access');
 assert.ok(calls.at(-1).url.endsWith('/oauth/revoke'));
 const row=(await pool.query('SELECT * FROM ap_identity_links')).rows[0];
 assert.equal(row.canonical_subject_id,subject);assert.equal(row.user_id,actor.user_id);
 const saved=(await pool.query('SELECT * FROM ap_identity_link_flows')).rows[0];
 assert.equal(saved.consumed,true);assert.equal(saved.code_verifier,null);
 assert.ok(!JSON.stringify(result).includes('server-only'));
 await assert.rejects(completeIdentityLink(pool,actor,{flowToken:flow.flowToken,authorizationCode:'canonical-code'},{config,fetcher:backchannel()}));
}));
test('flow theft by another local account refuses before calling canonical token exchange',()=>scenario(async({pool,actor})=>{
 const flow=await beginIdentityLink(pool,actor,'personal',config);let called=false;
 await assert.rejects(completeIdentityLink(pool,{...actor,user_id:randomUUID()},{flowToken:flow.flowToken,authorizationCode:'code'},
  {config,fetcher:async()=>{called=true;throw new Error();}}));assert.equal(called,false);
}));
test('expired flows and uncertain exchange cannot be replayed',()=>scenario(async({pool,actor})=>{
 const expired=await beginIdentityLink(pool,actor,'personal',config);
 await pool.query("UPDATE ap_identity_link_flows SET expires_at=now()-interval '1 second'");
 await assert.rejects(completeIdentityLink(pool,actor,{flowToken:expired.flowToken,authorizationCode:'code'},{config,fetcher:backchannel()}));
 const flow=await beginIdentityLink(pool,actor,'personal',config),input={flowToken:flow.flowToken,authorizationCode:'code'};
 await assert.rejects(completeIdentityLink(pool,actor,input,{config,fetcher:async()=>{throw new Error('lost response');}}));
 await assert.rejects(completeIdentityLink(pool,actor,input,{config,fetcher:backchannel()}));
 assert.equal((await pool.query('SELECT count(*) FROM ap_identity_links')).rows[0].count,'0');
}));
test('one canonical subject cannot attach to two local owners, even with the same email claim',()=>scenario(async({pool,actor})=>{
 const link=async owner=>{const flow=await beginIdentityLink(pool,owner,'personal',config);
  return completeIdentityLink(pool,owner,{flowToken:flow.flowToken,authorizationCode:'code'},{config,fetcher:backchannel({...identity(),email:'same@example.test'})});};
 await link(actor);
 const other=await provision(pool,`second-${randomUUID()}@example.test`,'identity-link-test-password');
 await assert.rejects(link({tenant_id:other.tenantId,user_id:other.id}));
 assert.equal((await pool.query('SELECT count(*) FROM ap_identity_links')).rows[0].count,'1');
}));
test('concurrent completion of one flow performs exactly one exchange',()=>scenario(async({pool,actor})=>{
 const flow=await beginIdentityLink(pool,actor,'personal',config),calls=[];
 const complete=()=>completeIdentityLink(pool,actor,{flowToken:flow.flowToken,authorizationCode:'code'},{config,fetcher:backchannel(identity(),calls)});
 const results=await Promise.allSettled([complete(),complete()]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(calls.filter(x=>x.url.endsWith('/oauth/token')).length,1);
}));
test('pending link flows are bounded and expired verifier state is cleaned up',()=>scenario(async({pool,actor})=>{
 for(let i=0;i<5;i++)await beginIdentityLink(pool,actor,'personal',config);
 await assert.rejects(beginIdentityLink(pool,actor,'personal',config));
 await pool.query("UPDATE ap_identity_link_flows SET expires_at=now()-interval '1 second'");
 await beginIdentityLink(pool,actor,'personal',config);
 assert.equal((await pool.query('SELECT count(*) FROM ap_identity_link_flows')).rows[0].count,'1');
}));
