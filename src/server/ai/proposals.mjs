import {createHash,randomUUID} from 'node:crypto';
import {createDraft} from '../workflow.mjs';
import {generateProposal,aiConfiguration,proposalSchema,AIError} from './agent.mjs';
import {products,productById,cents,decimal,effectiveBudget} from './catalog.mjs';
import {aiLimits,admitAiRequest} from './limits.mjs';
export function validateProposal(output,budget){
 const parsed=proposalSchema.safeParse(output);if(!parsed.success)throw new AIError('INVALID_AI_PROPOSAL',422);
 const proposal=parsed.data;const product=productById(proposal.recommendedProductId);
 if(!product)throw new AIError('UNKNOWN_ITEM',422);
 const total=cents(product.amount)*proposal.quantity;if(total>cents(budget))throw new AIError('OVER_BUDGET',422);
 if(new Set(proposal.alternatives).size!==proposal.alternatives.length||proposal.alternatives.includes(product.id))throw new AIError('INVALID_AI_PROPOSAL',422);
 for(const id of proposal.alternatives){const alternative=productById(id);if(!alternative||cents(alternative.amount)*proposal.quantity>cents(budget))throw new AIError('INVALID_AI_PROPOSAL',422);}
 if(/https?:\/\/|<[^>]+>/.test(proposal.reason))throw new AIError('INVALID_AI_PROPOSAL',422);
 return {...proposal,product,total:decimal(total),alternatives:proposal.alternatives.map(id=>productById(id))};
}
export async function proposePurchase(pool,actor,input,{generate=generateProposal,configuration=aiConfiguration,timeoutMs=30000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new AIError('INVALID_AI_REQUEST',400);
 if(!input||Object.keys(input).some(key=>!['requestId','instruction','maximumBudget'].includes(key))||
 typeof input.instruction!=='string'||!input.instruction.trim()||input.instruction.length>1200||
 !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(input.requestId??''))throw new AIError('INVALID_AI_REQUEST',400);
 let budget;try{budget=effectiveBudget(input.instruction,input.maximumBudget);}catch{throw new AIError('INVALID_BUDGET',400);}
 const instruction=input.instruction.trim();const inputHash=createHash('sha256').update(JSON.stringify([instruction,budget])).digest('hex');
 const db=await pool.connect();let locked=false;
 try{
 // Caller request identity is scoped; it cannot address another user's proposal.
 const lock=`${actor.tenant_id}/${actor.user_id}/${input.requestId}`;
 await db.query('SELECT pg_advisory_lock(hashtextextended($1,7))',[lock]);locked=true;
 const existing=(await db.query('SELECT * FROM ap_ai_proposals WHERE tenant_id=$1 AND user_id=$2 AND request_id=$3',[actor.tenant_id,actor.user_id,input.requestId])).rows[0];
 if(existing){if(existing.input_hash!==inputHash)throw new AIError('AI_REQUEST_CONFLICT',409);if(existing.state==='READY')return publicProposal(existing);
 throw new AIError(existing.state==='GENERATING'?'AI_REQUEST_UNCERTAIN':'AI_REQUEST_FAILED',409);}
 const config=configuration();
 const limits=aiLimits();
 await db.query('BEGIN');
 await admitAiRequest(db,actor,limits);
 const proposalId=randomUUID();
 await db.query(`INSERT INTO ap_ai_proposals(id,tenant_id,user_id,request_id,input_hash,instruction,budget,state,provider,model) VALUES($1,$2,$3,$4,$5,$6,$7,'GENERATING',$8,$9)`,[proposalId,actor.tenant_id,actor.user_id,input.requestId,inputHash,instruction,budget,config.provider,config.model]);
 await db.query('COMMIT');
 try{
 const signal=AbortSignal.timeout(timeoutMs);
 const result=await Promise.race([generate({instruction,budget,products,signal}),new Promise((_,reject)=>{signal.addEventListener('abort',()=>reject(new AIError('AI_TIMEOUT')),{once:true});})]);
 const validated=validateProposal(result.output,budget);
 if(!result.provenance||result.provenance.provider!==config.provider||result.provenance.model!==config.model||Buffer.byteLength(JSON.stringify(result.provenance))>4096)throw new AIError('INVALID_AI_PROPOSAL',422);
 await db.query('BEGIN');
 const purchase=await createDraft(db,actor,validated.product.id,validated.quantity);
 const publicData={...validated,budget,remaining:decimal(cents(budget)-cents(validated.total)),purchaseId:purchase.id,provenance:result.provenance};
 const stored=(await db.query("UPDATE ap_ai_proposals SET state='READY',proposal=$2,provenance=$3,purchase_id=$4 WHERE id=$1 RETURNING *",[proposalId,JSON.stringify(publicData),JSON.stringify(result.provenance),purchase.id])).rows[0];
 await db.query("INSERT INTO ap_audit(tenant_id,user_id,purchase_id,event) VALUES($1,$2,$3,'purchase.ai-proposed')",[actor.tenant_id,actor.user_id,purchase.id]);await db.query('COMMIT');
 return publicProposal(stored);
 }catch(error){await db.query('ROLLBACK');await db.query("UPDATE ap_ai_proposals SET state='FAILED' WHERE id=$1 AND state='GENERATING'",[proposalId]);if(error instanceof AIError)throw error;throw new AIError('AI_PROVIDER_UNAVAILABLE');}
 }catch(error){await db.query('ROLLBACK');throw error;}finally{try{if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,7))',[`${actor.tenant_id}/${actor.user_id}/${input.requestId}`]);}finally{db.release();}}
}
function publicProposal(row){return {id:row.id,state:row.state,...row.proposal,captureEnabled:false};}
export async function listProposals(pool,actor){return (await pool.query("SELECT * FROM ap_ai_proposals WHERE tenant_id=$1 AND user_id=$2 AND state='READY' AND purchase_id IS NOT NULL ORDER BY created_at DESC LIMIT 10",[actor.tenant_id,actor.user_id])).rows.map(publicProposal);}
