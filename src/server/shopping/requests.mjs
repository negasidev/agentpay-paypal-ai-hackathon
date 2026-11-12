import {requireSandboxWriter} from '../sandbox-membership.mjs';
import {randomUUID} from 'node:crypto';
import {AIError,aiConfiguration} from '../ai/agent.mjs';
import {aiLimits,admitAiRequest} from '../ai/limits.mjs';
import {discover,shoppingInput,publicLink,unavailableDiscovery} from './discovery.mjs';
import {effectiveBudget} from '../ai/catalog.mjs';
import {referenceDiscovery} from './reference-merchant.mjs';
import {ensureTask,findTask,publicTask,shoppingInputHash,equalDigest} from './tasks.mjs';

export async function shoppingRequest(pool,actor,input,{configuration=aiConfiguration,discovery=discover}={}){
 await requireSandboxWriter(pool,actor);
 const parsed=shoppingInput.safeParse(input);
 if(!parsed.success||(parsed.data.sourceUrl&&!publicLink(parsed.data.sourceUrl)))throw new AIError('INVALID_SHOPPING_REQUEST',400);
 const body=parsed.data;const digest=shoppingInputHash(body);
 try{effectiveBudget(body.instruction,body.maximumBudget);}catch{throw new AIError('INVALID_BUDGET',400);}
 const db=await pool.connect();let locked=false;
 const scope=`${actor.tenant_id}/${actor.user_id}/${body.requestId}`;
 try{
  await db.query('SELECT pg_advisory_lock(hashtextextended($1,7))',[scope]);locked=true;
  const saved=await findTask(db,actor,body.requestId);
  if(saved){if(!equalDigest(saved.input_hash,digest))throw new AIError('AI_REQUEST_CONFLICT',409);return {...saved.discovery,task:publicTask(saved)};}
  const previous=(await db.query('SELECT * FROM ap_ai_proposals WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[actor.tenant_id,actor.user_id,body.requestId])).rows[0];
  if(previous){if(!equalDigest(previous.input_hash,digest))throw new AIError('AI_REQUEST_CONFLICT',409);
   if(previous.state==='READY'&&previous.proposal?.kind==='shopping'){
    await db.query('BEGIN');const row=await ensureTask(db,actor,body,previous.proposal);await db.query('COMMIT');
    return {...previous.proposal,task:publicTask(row)};
   }
   throw new AIError(previous.state==='GENERATING'?'AI_REQUEST_UNCERTAIN':'AI_REQUEST_FAILED',409);}
  let config;
  try{config=configuration();}catch(error){
   if(error.message!=='AI_NOT_CONFIGURED')throw error;
   await db.query('BEGIN');const result=body.catalogMode==='reference'?referenceDiscovery(body):unavailableDiscovery(body);const row=await ensureTask(db,actor,body,result);await db.query('COMMIT');
   return {...result,task:publicTask(row)};
  }
  const limits=aiLimits();
  await db.query('BEGIN');await admitAiRequest(db,actor,limits);
  const id=randomUUID();
  // The existing durable AI reservation counts shopping and sandbox proposals
  // together. A second budget would double the permitted provider spend.
  await db.query(`INSERT INTO ap_ai_proposals(id,tenant_id,user_id,request_id,input_hash,instruction,budget,state,provider,model,workflow_id)
   VALUES($1,$2,$3,$4,$5,$6,$7,'GENERATING',$8,$9,'social-shopping')`,[id,actor.tenant_id,actor.user_id,body.requestId,digest,body.instruction,body.maximumBudget,config.provider,config.model]);
  await db.query('COMMIT');
  try{
   const signal=AbortSignal.timeout(30000);
   const result=await Promise.race([discovery(body,{configuration:()=>config,signal}),new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(new AIError('AI_TIMEOUT')),{once:true});})]);
   await db.query('BEGIN');
   await db.query("UPDATE ap_ai_proposals SET state='READY',proposal=$2 WHERE id=$1",[id,JSON.stringify(result)]);
   const task=await ensureTask(db,actor,body,result);await db.query('COMMIT');
   return {...result,task:publicTask(task)};
  }catch(error){await db.query('ROLLBACK');await db.query("UPDATE ap_ai_proposals SET state='FAILED' WHERE id=$1 AND state='GENERATING'",[id]);throw error;}
 }catch(error){await db.query('ROLLBACK');throw error;}
 finally{try{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,7))',[scope]);}finally{db.release();}}
}
