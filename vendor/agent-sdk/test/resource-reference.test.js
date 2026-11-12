import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{generateKeyPairSync,sign,createHash}from'node:crypto';
import{canonicalizeEnvelope,VeridGrantVerifier}from'../src/index.js';import{canonicalGrant}from'../src/verify.js';
const vectors=JSON.parse(readFileSync(new URL('./fixtures/resource-reference-vectors.json',import.meta.url)));
for(const vector of vectors)test('published resource canonical bytes: '+vector.name,()=>{const canonical=canonicalizeEnvelope(vector.envelope);for(const predicate of vector.predicates)assert.ok(canonical.includes(predicate));});
const envelope={schemaVersion:'1.0',agentId:'agent-1',tool:'paypal',action:'capture',environment:'development',predicates:[{type:'amount',currency:'USD',value:'119.00'},{type:'counterparty_reference',value:'merchant-1'},...['purchase-1','order-1','attempt-1'].map((id,index)=>({type:'resource_reference',resourceType:'commerce.order',namespace:['agentpay/purchase','paypal/sandbox','agentpay/execution'][index],resourceId:id}))]};
const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const jwk={...keys.publicKey.export({format:'jwk'}),kid:'test-resource-key',alg:'ES256',use:'sig'};
const grant={id:'grant-1',tenantId:'tenant-1',agentId:'agent-1',intentId:'intent-1',intentVersion:7,actionHash:createHash('sha256').update(canonicalizeEnvelope(envelope)).digest('hex').toUpperCase(),expiresAt:'2099-01-01T00:00:00.000Z',signingKeyId:jwk.kid,consumed:false,revoked:false};grant.signature=sign('sha256',Buffer.from(canonicalGrant(grant)),{key:keys.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64url');
const verifier=()=>new VeridGrantVerifier({baseUrl:'https://issuer.example',fetchImpl:async()=>Response.json({keys:[jwk],ephemeral:false})});
test('existing verifier validates resource-bound signature and rejects substitutions',async()=>{assert.equal((await verifier().verify(grant,{envelope,tenantId:'tenant-1',agentId:'agent-1',intentId:'intent-1'})).valid,true);for(let index=2;index<5;index++){const changed=structuredClone(envelope);changed.predicates[index].resourceId+='-changed';await assert.rejects(verifier().verify(grant,{envelope:changed}),error=>error.code==='action_mismatch');}await assert.rejects(verifier().verify({...grant,intentVersion:8},{envelope}),error=>error.code==='invalid_signature');await assert.rejects(verifier().verify({...grant,revoked:true},{envelope}),error=>error.code==='revoked_grant');});
test('unknown predicates, schemas and malformed references refuse',()=>{assert.throws(()=>canonicalizeEnvelope({...envelope,schemaVersion:'2.0'}));assert.throws(()=>canonicalizeEnvelope({...envelope,predicates:[{type:'unknown'}]}));assert.throws(()=>canonicalizeEnvelope({...envelope,predicates:[{type:'resource_reference',resourceType:'commerce.order',namespace:'../bad',resourceId:'x'}]}));});

test("platform-emitted AgentPay canonical bytes and hash agree",()=>{const platform=JSON.parse(readFileSync(new URL("./fixtures/platform-agentpay-vector.json",import.meta.url)));assert.equal(canonicalizeEnvelope(envelope),platform.canonical);assert.equal(createHash("sha256").update(platform.canonical).digest("hex").toUpperCase(),platform.hash);});

test('cross-runtime edge matrix agrees on admission, canonical UTF-8 bytes and hash',()=>{
 const inputs=JSON.parse(readFileSync(new URL('./fixtures/edge-inputs.json',import.meta.url)));
 const results=JSON.parse(readFileSync(new URL('./fixtures/edge-results.json',import.meta.url)));
 for(let i=0;i<inputs.length;i++){
   const envelope={schemaVersion:'1.0',agentId:'agent-1',tool:'paypal',action:'capture',environment:'development',predicates:[inputs[i].reference]};
   if(!results[i].accepted){assert.throws(()=>canonicalizeEnvelope(envelope),inputs[i].name);continue;}
   const canonical=canonicalizeEnvelope(envelope);
   assert.equal(Buffer.from(canonical).toString('base64'),results[i].bytes,inputs[i].name);
   assert.equal(createHash('sha256').update(canonical).digest('hex').toUpperCase(),results[i].hash,inputs[i].name);
 }
});
test('conflicting schema and resource aliases refuse',()=>{
 assert.throws(()=>canonicalizeEnvelope({...envelope,schema_version:'2.0'}));
 const e=structuredClone(envelope);e.predicates[2].resource_id='other';assert.throws(()=>canonicalizeEnvelope(e));
});
