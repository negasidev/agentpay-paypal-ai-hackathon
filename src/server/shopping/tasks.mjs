import {requireSandboxWriter} from '../sandbox-membership.mjs';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {transaction} from '../persistence/db.mjs';
import {AIError} from '../ai/agent.mjs';
import {cents} from '../ai/catalog.mjs';
import {merchantListing} from './discovery.mjs';
import {referenceSelection,referenceQuote,quoteDigest} from './reference-merchant.mjs';
import {createDraft} from '../workflow.mjs';
import {transactionDetail} from '../transaction-detail.mjs';
import catalog from '../../shared/workflow-catalog.json' with {type:'json'};
import {validateCatalog,preparationPath} from '../../shared/workflow-contract.mjs';

const workflow=validateCatalog(catalog).workflows.find(x=>x.id==='social-shopping');
if(preparationPath(workflow,'consumer')!=='/shopping')throw Error('SHOPPING_WORKFLOW_NOT_REGISTERED');
const uuid=z.string().uuid();
const command=z.discriminatedUnion('action',[
 z.object({action:z.literal('select'),expectedRevision:z.number().int().positive(),offerId:z.string().min(1).max(128)}).strict(),
 z.object({action:z.literal('handoff'),expectedRevision:z.number().int().positive(),reviewDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({action:z.literal('cancel'),expectedRevision:z.number().int().positive()}).strict(),
 z.object({action:z.literal('purchase'),expectedRevision:z.number().int().positive(),reviewDigest:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
]);
export function shoppingInputHash(input){return createHash('sha256').update(JSON.stringify(['shopping',input.instruction,input.maximumBudget,input.sourceUrl??null,...(input.catalogMode?[input.catalogMode]:[])])).digest('hex');}
const scope=(actor,id)=>[actor.tenant_id,actor.user_id,id];
export async function findTask(db,actor,id){return (await db.query('SELECT * FROM ap_workflow_tasks WHERE tenant_id=$1 AND user_id=$2 AND id=$3',scope(actor,id))).rows[0]??null;}
export function publicTask(row,now=new Date()){
 if(['REVIEW_READY','HANDOFF_READY','PURCHASE_PREPARED'].includes(row.state)&&(!row.selection||
  !equalDigest(selectionDigest(row,row,row.selection),row.review_digest)||
  (row.discovery.catalogMode==='reference'?row.selection.finalCosts!=='REFERENCE_SANDBOX_ONLY':merchantListing(row.selection.url)!==row.selection.url)||
  !Number.isFinite(Date.parse(row.selection.expiresAt))))throw new AIError('REVIEW_MISMATCH',409);
 const expired=+new Date(row.expires_at)<=+now||(row.selection?.expiresAt&&Date.parse(row.selection.expiresAt)<=+now);
 return {id:row.id,workflowId:row.workflow_id,workflowVersion:row.workflow_version,revision:row.revision,
  state:row.state==='PURCHASE_PREPARED'?'PURCHASE_PREPARED':row.state==='CANCELED'?'CANCELED':expired?'EXPIRED':row.state,
  createdAt:new Date(row.created_at).toISOString(),expiresAt:new Date(row.expires_at).toISOString(),
  discovery:row.discovery,selection:row.selection??null,reviewDigest:row.review_digest??null,
  providerOutcome:'NOT_OBSERVED',receipt:null,evidenceLevel:'LOCAL_OBSERVATIONS_ONLY'};
}
export async function ensureTask(db,actor,input,result){
 const inputHash=shoppingInputHash(input);
 const inserted=(await db.query(`INSERT INTO ap_workflow_tasks(tenant_id,user_id,id,workflow_id,workflow_version,input_hash,state,discovery,expires_at)
  VALUES($1,$2,$3,$4,$5,$6,'OPTIONS_READY',$7,now()+interval '30 minutes') ON CONFLICT DO NOTHING RETURNING *`,
 [...scope(actor,input.requestId),workflow.id,workflow.version,inputHash,JSON.stringify(result)])).rows[0];
 if(inserted){await db.query('INSERT INTO ap_workflow_task_events(tenant_id,user_id,task_id,revision,event) VALUES($1,$2,$3,1,$4)',[...scope(actor,input.requestId),'options_recorded']);return inserted;}
 const current=await findTask(db,actor,input.requestId);
 if(!current||!equalDigest(current.input_hash,inputHash))throw new AIError('AI_REQUEST_CONFLICT',409);
 return current;
}
export async function readTask(pool,actor,id){
 if(!uuid.safeParse(id).success)throw new AIError('TASK_NOT_FOUND',404);
 const row=await findTask(pool,actor,id);if(!row)throw new AIError('TASK_NOT_FOUND',404);
 const events=(await pool.query('SELECT revision,event,observed_at AS "observedAt" FROM ap_workflow_task_events WHERE tenant_id=$1 AND user_id=$2 AND task_id=$3 ORDER BY revision',scope(actor,id))).rows;
 const link=(await pool.query('SELECT purchase_id FROM ap_task_purchases WHERE tenant_id=$1 AND user_id=$2 AND task_id=$3',scope(actor,id))).rows[0];
 return {...publicTask(row),events,purchase:link?{id:link.purchase_id,...await transactionDetail(pool,actor,link.purchase_id)}:null};
}
export async function listTasks(pool,actor){
 const [saved,pending]=await Promise.all([
  pool.query('SELECT * FROM ap_workflow_tasks WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 20',[actor.tenant_id,actor.user_id]),
  pool.query(`SELECT request_id,instruction,state,created_at FROM ap_ai_proposals p WHERE tenant_id=$1 AND user_id=$2 AND workflow_id='social-shopping'
   AND state IN ('GENERATING','FAILED') AND NOT EXISTS(SELECT 1 FROM ap_workflow_tasks t WHERE t.tenant_id=p.tenant_id AND t.user_id=p.user_id AND t.id=p.request_id)
   ORDER BY created_at DESC LIMIT 20`,[actor.tenant_id,actor.user_id]),
 ]);
 const ready=saved.rows.map(row=>{
  const task=publicTask(row);return {id:task.id,workflowId:task.workflowId,revision:task.revision,state:task.state,createdAt:task.createdAt,
   title:task.selection?.title??task.discovery.query,providerOutcome:task.providerOutcome,resumable:true};
 });
 const unresolved=pending.rows.map(row=>({id:row.request_id,workflowId:'social-shopping',revision:0,
  state:row.state==='GENERATING'?'DISCOVERY_UNCERTAIN':'DISCOVERY_FAILED',createdAt:new Date(row.created_at).toISOString(),
  title:row.instruction,providerOutcome:'NOT_OBSERVED',resumable:false}));
 return [...ready,...unresolved].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,20);
}
export const equalDigest=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
function choose(row,id){
 if(row.discovery.catalogMode==='reference')return referenceSelection(row,id);
 const source=id==='original'?{id:'original',title:'Original shared listing',seller:'Confirm at merchant',amount:null,currency:'USD',url:row.discovery.sourceListing,expiresAt:new Date(row.expires_at).toISOString()}
  :row.discovery.offers?.find(offer=>offer.id===id);
 const url=source&&merchantListing(source.url);
 if(!source||!url||typeof source.title!=='string'||typeof source.seller!=='string'||source.currency!=='USD'||
  (source.amount!==null&&(typeof source.amount!=='string'||! /^(?:0|[1-9]\d{0,6})\.\d{2}$/.test(source.amount)||cents(source.amount)>cents(row.discovery.budget)))||
  !Number.isFinite(Date.parse(source.expiresAt)))throw new AIError('INVALID_TASK_SELECTION',400);
 return {offerId:id,title:source.title,seller:source.seller,quantity:1,currency:'USD',amount:source.amount,url,
  shipping:null,tax:null,total:null,finalCosts:'MERCHANT_CONFIRMATION_REQUIRED',expiresAt:source.expiresAt};
}

function selectionDigest(actor,row,selection){
 return createHash('sha256').update(JSON.stringify([actor.tenant_id,actor.user_id,row.id,row.workflow_id,row.workflow_version,
  selection.offerId,selection.title,selection.seller,selection.quantity,selection.currency,selection.amount,selection.url,
  selection.shipping,selection.tax,selection.total,selection.finalCosts,selection.expiresAt,
  ...(selection.productId?[selection.productId]:[])])).digest('hex');
}

export async function taskAction(pool,actor,id,input,options={}){
 await requireSandboxWriter(pool,actor);
 if(!uuid.safeParse(id).success)throw new AIError('TASK_NOT_FOUND',404);
 const parsed=command.safeParse(input);if(!parsed.success)throw new AIError('INVALID_TASK_ACTION',400);
 const action=parsed.data;
 return transaction(pool,async db=>{
  const row=(await db.query('SELECT * FROM ap_workflow_tasks WHERE tenant_id=$1 AND user_id=$2 AND id=$3 FOR UPDATE',scope(actor,id))).rows[0];
  if(!row)throw new AIError('TASK_NOT_FOUND',404);
  const now=options.now??new Date();
  if(row.state==='PURCHASE_PREPARED'){
   if(action.action!=='purchase'||!equalDigest(action.reviewDigest,row.review_digest)||![row.revision,row.revision-1].includes(action.expectedRevision))throw new AIError('INVALID_TASK_STATE',409);
   const link=(await db.query('SELECT purchase_id FROM ap_task_purchases WHERE tenant_id=$1 AND user_id=$2 AND task_id=$3',scope(actor,id))).rows[0];
   if(!link)throw new AIError('REVIEW_MISMATCH',409);
   return {...publicTask(row,now),purchase:{id:link.purchase_id}};
  }
  if(row.state==='CANCELED'){
   if(action.action==='cancel')return publicTask(row,now);
   throw new AIError('TASK_CANCELED',409);
  }
  if(publicTask(row,now).state==='EXPIRED')throw new AIError('TASK_EXPIRED',409);
  if(action.action==='handoff'&&row.state==='HANDOFF_READY'&&row.selection&&equalDigest(selectionDigest(actor,row,row.selection),row.review_digest)&&equalDigest(action.reviewDigest,row.review_digest)&&
   [row.revision,row.revision-1].includes(action.expectedRevision))return publicTask(row,now);
  if(action.expectedRevision!==row.revision)throw new AIError('TASK_VERSION_CONFLICT',409);
  if(action.action==='purchase'){
   if(row.state!=='REVIEW_READY'||row.discovery.catalogMode!=='reference'||!row.selection||
    !equalDigest(action.reviewDigest,row.review_digest)||!equalDigest(selectionDigest(actor,row,row.selection),row.review_digest))throw new AIError('REVIEW_MISMATCH',409);
   const purchase=await createDraft(db,actor,row.selection.productId);
   const quote=referenceQuote(actor,row,row.selection,purchase.id,now);
   if(purchase.amount!==quote.total||purchase.merchant_id!==quote.merchantId)throw new AIError('QUOTE_MISMATCH',409);
   await db.query('UPDATE ap_purchases SET quote=$2,quote_digest=$3 WHERE id=$1',[purchase.id,JSON.stringify(quote),quoteDigest(quote)]);
   await db.query('INSERT INTO ap_task_purchases(tenant_id,user_id,task_id,purchase_id,review_digest) VALUES($1,$2,$3,$4,$5)',[...scope(actor,id),purchase.id,row.review_digest]);
   await db.query('INSERT INTO ap_reference_merchant_orders(id,tenant_id,user_id,purchase_id,quote_digest) VALUES($1,$2,$3,$4,$5)',[randomUUID(),actor.tenant_id,actor.user_id,purchase.id,quoteDigest(quote)]);
   const changed=(await db.query("UPDATE ap_workflow_tasks SET revision=revision+1,state='PURCHASE_PREPARED' WHERE tenant_id=$1 AND user_id=$2 AND id=$3 RETURNING *",scope(actor,id))).rows[0];
   await db.query("INSERT INTO ap_workflow_task_events(tenant_id,user_id,task_id,revision,event) VALUES($1,$2,$3,$4,'reference_purchase_prepared')",[...scope(actor,id),changed.revision]);
   return {...publicTask(changed,now),purchase:{id:purchase.id,quote,quoteDigest:quoteDigest(quote)}};
  }
  let state,selection=row.selection,digest=row.review_digest,event;
  if(action.action==='cancel'){
   if(row.state==='HANDOFF_READY')throw new AIError('HANDOFF_ALREADY_PREPARED',409);
   state='CANCELED';event='task_canceled';selection=null;digest=null;
  }else if(action.action==='select'){
   if(!['OPTIONS_READY','REVIEW_READY'].includes(row.state))throw new AIError('INVALID_TASK_STATE',409);
   selection=choose(row,action.offerId);
   if(Date.parse(selection.expiresAt)<=+now)throw new AIError('TASK_EXPIRED',409);
   // This digest binds a local review, not an execution grant or human signature.
   digest=selectionDigest(actor,row,selection);
   state='REVIEW_READY';event='selection_prepared';
  }else{
   if(row.discovery.catalogMode==='reference')throw new AIError('INVALID_TASK_ACTION',400);
   if(row.state!=='REVIEW_READY'||!selection||!equalDigest(action.reviewDigest,digest)||!equalDigest(selectionDigest(actor,row,selection),digest))throw new AIError('REVIEW_MISMATCH',409);
   if(merchantListing(selection.url)!==selection.url)throw new AIError('INVALID_TASK_SELECTION',400);
   state='HANDOFF_READY';event='merchant_link_prepared';
  }
  const changed=(await db.query(`UPDATE ap_workflow_tasks SET revision=revision+1,state=$4,selection=$5,review_digest=$6
   WHERE tenant_id=$1 AND user_id=$2 AND id=$3 RETURNING *`,[...scope(actor,id),state,selection?JSON.stringify(selection):null,digest])).rows[0];
  await db.query('INSERT INTO ap_workflow_task_events(tenant_id,user_id,task_id,revision,event) VALUES($1,$2,$3,$4,$5)',[...scope(actor,id),changed.revision,event]);
  return publicTask(changed,now);
 });
}
