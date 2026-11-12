import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aiDatabase} from '../fixtures/ai-database.mjs';
import {provision} from '../../src/server/auth.mjs';
import {proposePurchase} from '../../src/server/ai/proposals.mjs';
import {aiLimits} from '../../src/server/ai/limits.mjs';

const configuration=()=>({provider:'fixture-only',model:'fixture/model'});
const input=()=>({requestId:randomUUID(),instruction:'Find a keyboard.',maximumBudget:'150.00'});
const result=()=>({output:{recommendedProductId:'keyboard',quantity:1,reason:'Fits the budget.',alternatives:[],requiresUserApproval:true},provenance:{provider:'fixture-only',model:'fixture/model'}});
async function actor(pool){const u=await provision(pool,`limit-${randomUUID()}@example.test`,'fixture-limit-password');return {tenant_id:u.tenantId,user_id:u.id};}

test('AI ceilings cannot be increased or disabled through malformed server configuration',()=>{
 assert.deepEqual(aiLimits({}),{userHour:3,globalHour:10,globalDay:25});
 assert.equal(aiLimits({AGENTPAY_AI_USER_HOURLY_LIMIT:'1'}).userHour,1);
 for(const value of ['0','-1','4','NaN','1.5','Infinity',' 1','01'])assert.throws(()=>aiLimits({AGENTPAY_AI_USER_HOURLY_LIMIT:value}),/AI_LIMITS_INVALID/);
 assert.throws(()=>aiLimits({AGENTPAY_AI_GLOBAL_HOURLY_LIMIT:'11'}));
 assert.throws(()=>aiLimits({AGENTPAY_AI_GLOBAL_DAILY_LIMIT:'26'}));
});

test('failed generations count toward account quota; ready retries are free after quota and reconnect',async()=>{
 const database=await aiDatabase();let pool=database.connect();
 try{
  const owner=await actor(pool);let calls=0;
  const generate=async()=>{calls++;return result();};const first=input();
  const ready=await proposePurchase(pool,owner,first,{configuration,generate});
  for(let i=0;i<2;i++)await assert.rejects(proposePurchase(pool,owner,input(),{configuration,generate:async()=>{calls++;throw new Error('fixture failure');}}),/AI_PROVIDER_UNAVAILABLE/);
  await pool.end();pool=database.connect();
  await assert.rejects(proposePurchase(pool,owner,input(),{configuration,generate}),e=>e.message==='AI_RATE_LIMIT'&&e.status===429);
  assert.equal((await proposePurchase(pool,owner,first,{configuration,generate})).purchaseId,ready.purchaseId);
  assert.equal(calls,3);
 }finally{await pool.end();await database.close();}
});

test('independent replicas and accounts cannot generate concurrently; unresolved reservation survives reconnect',async()=>{
 const database=await aiDatabase();const left=database.connect(),right=database.connect();let release;
 try{
  const a=await actor(left),b=await actor(right);let started;const entered=new Promise(resolve=>{started=resolve;});
  const pending=proposePurchase(left,a,input(),{configuration,generate:async()=>{started();return new Promise(resolve=>{release=()=>resolve(result());});}});
  try{await entered;await assert.rejects(proposePurchase(right,b,input(),{configuration,generate:async()=>assert.fail('Busy admission must not call the model')}),e=>e.message==='AI_BUSY'&&e.status===429);}
  finally{release();await pending;}
  const uncertain=input();
  await left.query(`INSERT INTO ap_ai_proposals(id,tenant_id,user_id,request_id,input_hash,instruction,budget,state,provider,model,created_at) VALUES($1,$2,$3,$4,'hash','fixture','150.00','GENERATING','fixture-only','fixture/model',now()-interval '2 days')`,[randomUUID(),a.tenant_id,a.user_id,uncertain.requestId]);
  const reconnect=database.connect();try{await assert.rejects(proposePurchase(reconnect,b,input(),{configuration,generate:async()=>assert.fail('Unresolved generation cannot be reset by age or restart')}),/AI_BUSY/);}finally{await reconnect.end();}
 }finally{await left.end();await right.end();await database.close();}
});

test('global hourly and rolling daily quotas include other accounts and refuse before model I/O',async()=>{
 const database=await aiDatabase();const pool=database.connect();
 try{
  const a=await actor(pool),b=await actor(pool);
  const seed=async(count,age)=>pool.query(`INSERT INTO ap_ai_proposals(id,tenant_id,user_id,request_id,input_hash,instruction,budget,state,provider,model,created_at)
   SELECT gen_random_uuid(),$1,$2,gen_random_uuid(),'hash','fixture','150.00','FAILED','fixture-only','fixture/model',now()-($4::text)::interval FROM generate_series(1,$3::int)`,[a.tenant_id,a.user_id,count,age]);
  await seed(10,'1 minute');
  const refuse=()=>proposePurchase(pool,b,input(),{configuration,generate:async()=>assert.fail('Global quota must stop cross-account spending')});
  await assert.rejects(refuse(),/AI_RATE_LIMIT/);
  await pool.query("UPDATE ap_ai_proposals SET created_at=now()-interval '2 hours'");
  await seed(15,'2 hours');await assert.rejects(refuse(),/AI_RATE_LIMIT/);
  await pool.query("UPDATE ap_ai_proposals SET created_at=now()-interval '25 hours'");
  assert.equal((await proposePurchase(pool,b,input(),{configuration,generate:async()=>result()})).state,'READY');
 }finally{await pool.end();await database.close();}
});
