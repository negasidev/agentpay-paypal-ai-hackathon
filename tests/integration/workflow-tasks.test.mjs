import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aiDatabase} from '../fixtures/ai-database.mjs';
import {provision} from '../../src/server/auth.mjs';
import {AIError} from '../../src/server/ai/agent.mjs';
import {shoppingRequest} from '../../src/server/shopping/requests.mjs';
import {readTask,listTasks,taskAction,shoppingInputHash} from '../../src/server/shopping/tasks.mjs';
import {sourceProvenance,unavailableDiscovery,discover} from '../../src/server/shopping/discovery.mjs';

async function scenario(work){const database=await aiDatabase();let pool=database.connect();try{
 const user=await provision(pool,`task-${randomUUID()}@example.test`,'workflow-task-fixture-password');
 const actor={tenant_id:user.tenantId,user_id:user.id};
 const input={requestId:randomUUID(),instruction:'A gaming chair',maximumBudget:'200.00',sourceUrl:'https://www.ebay.com/itm/123456789?tracking=remove'};
 const expiresAt=new Date(Date.now()+300000).toISOString();
 const result={...unavailableDiscovery(input),status:'AVAILABLE',query:'gaming chair',offers:[
  {id:'chair-a',title:'Chair A',seller:'Seller A',amount:'129.90',currency:'USD',url:'https://www.ebay.com/itm/123456789',expiresAt},
  {id:'chair-b',title:'Chair B',seller:'Seller B',amount:'149.00',currency:'USD',url:'https://www.ebay.com/itm/987654321',expiresAt},
 ]};
 const dependencies={configuration:()=>({provider:'fixture',model:'fixture/model'}),discovery:async()=>result};
 await work({pool,actor,input,result,dependencies,reconnect:async()=>{await pool.end();pool=database.connect();return pool;}});
 }finally{await pool.end();await database.close();}}

test('source provenance extracts only URL identity and never claims a verified product or social-account access',()=>{
 const origin=sourceProvenance({sourceUrl:'https://www.amazon.com/dp/B000123456?token=private'});
 assert.equal(origin.productReference,'B000123456');assert.equal(origin.sourceUrl,'https://www.amazon.com/dp/B000123456');assert.match(origin.verification,/NOT_PROVIDER_VERIFIED/);
 const social=sourceProvenance({sourceUrl:'https://www.tiktok.com/@fixture/video/123'});assert.equal(social.productReference,null);assert.equal(social.method,'shared_link');
 assert.equal(sourceProvenance({instruction:'chair'}).sourceUrl,null);
});
test('provider outage retains an honest assisted fallback without exposing errors or pretending offers were found',async()=>{
 const result=await discover({requestId:randomUUID(),instruction:'Gaming chair',maximumBudget:'200.00'},{prepare:async()=>({query:'chair',identityUncertain:true}),search:async()=>{throw Error('private-provider-token');}});
 assert.equal(result.status,'PROVIDER_UNAVAILABLE');assert.deepEqual(result.offers,[]);assert.equal(result.receipt,null);assert.ok(!JSON.stringify(result).includes('private-provider-token'));
});
test('unconfigured AI creates a scoped, durable assisted task without spending a model reservation',()=>scenario(async({pool,actor,input,reconnect})=>{
 const dependencies={configuration:()=>{throw new AIError('AI_NOT_CONFIGURED');}};
 const first=await shoppingRequest(pool,actor,input,dependencies);assert.equal(first.status,'AI_UNAVAILABLE');assert.equal(first.task.state,'OPTIONS_READY');
 assert.equal((await pool.query('SELECT count(*) FROM ap_ai_proposals')).rows[0].count,'0');
 pool=await reconnect();const saved=await readTask(pool,actor,input.requestId);assert.equal(saved.discovery.provenance.productReference,'123456789');
 const again=await shoppingRequest(pool,actor,input,{configuration:()=>{throw Error('must-not-call');}});assert.equal(again.task.id,first.task.id);
 assert.equal((await listTasks(pool,actor)).length,1);assert.equal(saved.receipt,null);
}));
test('exact review cannot be substituted through client seller, amount, URL, stale version or a different selection digest',()=>scenario(async({pool,actor,input,dependencies})=>{
 const created=await shoppingRequest(pool,actor,input,dependencies);
 for(const action of ['execute','capture','approve','succeed','reconcile'])await assert.rejects(taskAction(pool,actor,input.requestId,{action,expectedRevision:1}),/INVALID_TASK_ACTION/);
 for(const field of ['seller','amount','url','tenantId','workflowId','authorityId'])await assert.rejects(taskAction(pool,actor,input.requestId,
  {action:'select',expectedRevision:1,offerId:'chair-a',[field]:'forged'}),/INVALID_TASK_ACTION/);
 await assert.rejects(taskAction(pool,actor,input.requestId,{action:'select',expectedRevision:1,offerId:'invented'}),/INVALID_TASK_SELECTION/);
 const reviewed=await taskAction(pool,actor,created.task.id,{action:'select',expectedRevision:1,offerId:'chair-a'});
 assert.equal(reviewed.selection.amount,'129.90');assert.equal(reviewed.selection.total,null);assert.equal(reviewed.selection.finalCosts,'MERCHANT_CONFIRMATION_REQUIRED');
 const changed=await taskAction(pool,actor,input.requestId,{action:'select',expectedRevision:reviewed.revision,offerId:'chair-b'});
 assert.equal(changed.selection.seller,'Seller B');assert.notEqual(changed.reviewDigest,reviewed.reviewDigest);
 await assert.rejects(taskAction(pool,actor,input.requestId,{action:'handoff',expectedRevision:changed.revision,reviewDigest:reviewed.reviewDigest}),/REVIEW_MISMATCH/);
 await assert.rejects(taskAction(pool,actor,input.requestId,{action:'handoff',expectedRevision:reviewed.revision,reviewDigest:changed.reviewDigest}),/TASK_VERSION_CONFLICT/);
 assert.equal((await readTask(pool,actor,input.requestId)).state,'REVIEW_READY');
}));
test('concurrent selections admit one revision; handoff retries recover the same link and never create payment records',()=>scenario(async({pool,actor,input,dependencies,reconnect})=>{
 await shoppingRequest(pool,actor,input,dependencies);
 const race=await Promise.allSettled(['chair-a','chair-b'].map(offerId=>taskAction(pool,actor,input.requestId,{action:'select',expectedRevision:1,offerId})));
 assert.equal(race.filter(x=>x.status==='fulfilled').length,1);assert.equal(race.filter(x=>x.status==='rejected').length,1);
 const reviewed=await readTask(pool,actor,input.requestId);
 const action={action:'handoff',expectedRevision:reviewed.revision,reviewDigest:reviewed.reviewDigest};
 const replies=await Promise.all(Array.from({length:8},()=>taskAction(pool,actor,input.requestId,action)));
 assert.equal(new Set(replies.map(x=>x.revision)).size,1);assert.ok(replies.every(x=>x.state==='HANDOFF_READY'));
 // Discard the response and reconnect instead of starting a second action.
 pool=await reconnect();const restored=await readTask(pool,actor,input.requestId);assert.equal(restored.events.length,3);
 assert.equal((await taskAction(pool,actor,input.requestId,action)).selection.url,restored.selection.url);
 assert.equal(restored.providerOutcome,'NOT_OBSERVED');assert.equal(restored.receipt,null);
 for(const table of ['ap_purchases','ap_orders','ap_attempts','ap_receipts','ap_approvals'])assert.equal((await pool.query(`SELECT count(*) FROM ${table}`)).rows[0].count,'0');
 await assert.rejects(taskAction(pool,actor,input.requestId,{action:'cancel',expectedRevision:restored.revision}),/HANDOFF_ALREADY_PREPARED/);
}));
test('cancellation and expiry refuse all later selection and checkout preparation',()=>scenario(async({pool,actor,input,dependencies})=>{
 await shoppingRequest(pool,actor,input,dependencies);
 const canceled=await taskAction(pool,actor,input.requestId,{action:'cancel',expectedRevision:1});assert.equal(canceled.state,'CANCELED');
 await assert.rejects(taskAction(pool,actor,input.requestId,{action:'select',expectedRevision:canceled.revision,offerId:'chair-a'}),/TASK_CANCELED/);
 const next={...input,requestId:randomUUID()};await shoppingRequest(pool,actor,next,dependencies);
 const reviewed=await taskAction(pool,actor,next.requestId,{action:'select',expectedRevision:1,offerId:'chair-a'});
 await assert.rejects(taskAction(pool,actor,next.requestId,{action:'handoff',expectedRevision:reviewed.revision,reviewDigest:reviewed.reviewDigest},
  {now:new Date(Date.now()+360000)}),/TASK_EXPIRED/);
 await pool.query("UPDATE ap_workflow_tasks SET expires_at=now()-interval '1 minute' WHERE id=$1",[next.requestId]);
 assert.equal((await readTask(pool,actor,next.requestId)).state,'EXPIRED');
}));
test('task history, exact review and observations remain isolated across users and tenants',()=>scenario(async({pool,actor,input,dependencies})=>{
 await shoppingRequest(pool,actor,input,dependencies);
 const user=await provision(pool,`other-task-${randomUUID()}@example.test`,'workflow-task-fixture-password');
 const other={tenant_id:user.tenantId,user_id:user.id};assert.deepEqual(await listTasks(pool,other),[]);
 await assert.rejects(readTask(pool,other,input.requestId),/TASK_NOT_FOUND/);
 await assert.rejects(taskAction(pool,other,input.requestId,{action:'cancel',expectedRevision:1}),/TASK_NOT_FOUND/);
 const owned=await shoppingRequest(pool,other,input,dependencies);assert.equal(owned.task.revision,1);
 assert.equal((await readTask(pool,actor,input.requestId)).events.length,1);
 const unresolved={...input,requestId:randomUUID()};
 await pool.query("INSERT INTO ap_ai_proposals(id,tenant_id,user_id,request_id,input_hash,instruction,budget,state,provider,model,workflow_id) VALUES($1,$2,$3,$4,$5,$6,'200.00','GENERATING','fixture','fixture','social-shopping')",
  [randomUUID(),actor.tenant_id,actor.user_id,unresolved.requestId,shoppingInputHash(unresolved),unresolved.instruction]);
 const history=await listTasks(pool,actor);assert.equal(history.find(x=>x.id===unresolved.requestId).state,'DISCOVERY_UNCERTAIN');assert.equal(history.find(x=>x.id===unresolved.requestId).resumable,false);
 assert.ok(!(await listTasks(pool,other)).some(x=>x.id===unresolved.requestId));
 await assert.rejects(shoppingRequest(pool,actor,unresolved,dependencies),/AI_REQUEST_UNCERTAIN/);
}));
test('material selection is recomputed from the stored snapshot at handoff, including decimal spelling',()=>scenario(async({pool,actor,input,dependencies})=>{
 await shoppingRequest(pool,actor,input,dependencies);
 const reviewed=await taskAction(pool,actor,input.requestId,{action:'select',expectedRevision:1,offerId:'chair-a'});
 await pool.query("UPDATE ap_workflow_tasks SET selection=jsonb_set(selection,'{amount}','\"129.9\"') WHERE id=$1",[input.requestId]);
 await assert.rejects(taskAction(pool,actor,input.requestId,{action:'handoff',expectedRevision:reviewed.revision,reviewDigest:reviewed.reviewDigest}),/REVIEW_MISMATCH/);
 await assert.rejects(readTask(pool,actor,input.requestId),/REVIEW_MISMATCH/);
}));
