import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aiDatabase} from '../fixtures/ai-database.mjs';
import {provision} from '../../src/server/auth.mjs';
import {shoppingRequest} from '../../src/server/shopping/requests.mjs';
import {listProposals} from '../../src/server/ai/proposals.mjs';

test('shopping shares durable spend reservations, scopes request identity and creates no authority or payments',async()=>{
 const database=await aiDatabase();const pool=database.connect();
 try{
  const user=await provision(pool,`shopping-${randomUUID()}@example.test`,'shopping-fixture-password');
  const other=await provision(pool,`shopping-other-${randomUUID()}@example.test`,'shopping-fixture-password');
  const actor={tenant_id:user.tenantId,user_id:user.id};
  const input={requestId:randomUUID(),instruction:'Gaming chair',maximumBudget:'200.00'};
  let calls=0;const dependencies={configuration:()=>({provider:'fixture',model:'fixture/model'}),discovery:async()=>{calls++;return {kind:'shopping',status:'NOT_CONFIGURED',offers:[],receipt:null};}};
  const results=await Promise.all(Array.from({length:10},()=>shoppingRequest(pool,actor,input,dependencies)));
  assert.equal(calls,1);assert.ok(results.every(r=>r.kind==='shopping'));
  assert.deepEqual(await listProposals(pool,actor),[]);
  await assert.rejects(shoppingRequest(pool,actor,{...input,maximumBudget:'300.00'},dependencies),/AI_REQUEST_CONFLICT/);
  await shoppingRequest(pool,{tenant_id:other.tenantId,user_id:other.id},input,dependencies);assert.equal(calls,2);
  for(const table of ['ap_purchases','ap_orders','ap_attempts','ap_receipts','ap_approvals'])assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
  await pool.query("INSERT INTO ap_ai_proposals(id,tenant_id,user_id,request_id,input_hash,instruction,budget,state,provider,model) VALUES($1,$2,$3,$4,'fixture','fixture','1.00','GENERATING','fixture','fixture')",[randomUUID(),user.tenantId,user.id,randomUUID()]);
  await assert.rejects(shoppingRequest(pool,actor,{...input,requestId:randomUUID()},dependencies),/AI_BUSY/);assert.equal(calls,2);
 }finally{await pool.end();await database.close();}
});
