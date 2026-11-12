import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {products,productById,cents,effectiveBudget} from '../ai/catalog.mjs';
import {AIError} from '../ai/agent.mjs';

export function referenceDiscovery(input,{query=input.instruction,aiUsed=false,now=new Date()}={}){
 const budget=effectiveBudget(input.instruction,input.maximumBudget);
 const words=query.toLowerCase().split(/\s+/).filter(word=>word.length>3);
 return {kind:'shopping',catalogMode:'reference',query,identityUncertain:true,budget,status:'REFERENCE_CATALOG',aiUsed,
  message:'2AYE reference merchant with PayPal Sandbox. No real goods are sold or shipped. These products are not verified matches for an external shared listing. '+(aiUsed?'AI assisted the search query.':'No AI discovery was performed; results use catalog text matching.'),
  offers:products.filter(p=>p.available&&cents(p.amount)<=cents(budget)&&words.some(word=>`${p.name} ${p.description}`.toLowerCase().includes(word)))
   .map(p=>({id:`reference:${p.id}`,title:p.name,seller:'2AYE reference merchant',amount:p.amount,currency:p.currency,url:null,
    source:'Reference catalog / PayPal Sandbox',observedAt:now.toISOString(),expiresAt:new Date(+now+300000).toISOString()})),
  sourceListing:null,checkoutMode:'REFERENCE_SANDBOX',authorizationStatus:'NOT_REQUESTED',providerOutcome:'NOT_OBSERVED',receipt:null};
}

export function referenceSelection(row,id){
 const offer=row.discovery.offers?.find(x=>x.id===id);
 const product=productById(id?.replace(/^reference:/,''));
 if(row.discovery.catalogMode!=='reference'||!id?.startsWith('reference:')||!offer||!product||
  offer.amount!==product.amount||offer.title!==product.name||cents(offer.amount)>cents(row.discovery.budget))throw new AIError('INVALID_TASK_SELECTION',400);
 return {offerId:id,productId:product.id,title:product.name,seller:'2AYE reference merchant',quantity:1,currency:'USD',amount:product.amount,url:null,
  shipping:'0.00',tax:'0.00',total:product.amount,finalCosts:'REFERENCE_SANDBOX_ONLY',expiresAt:offer.expiresAt};
}

const fields=['format','id','tenantId','userId','taskId','purchaseId','reviewDigest','productId','title','quantity','merchantId','amount','currency','shipping','tax','total','expiresAt'];
export const quoteDigest=quote=>createHash('sha256').update(JSON.stringify(fields.map(key=>[key,quote[key]]))).digest('hex');
export function referenceQuote(actor,row,selection,purchaseId,now=new Date()){
 const merchantId=process.env.PAYPAL_SANDBOX_MERCHANT_ID;
 if(!/^[A-Za-z0-9-]{1,64}$/.test(merchantId??''))throw new AIError('REFERENCE_MERCHANT_NOT_CONFIGURED',503);
 const current=referenceSelection(row,selection.offerId);
 if(Object.keys(current).length!==Object.keys(selection).length||Object.entries(current).some(([key,value])=>selection[key]!==value))throw new AIError('REVIEW_MISMATCH',409);
 const expiresAt=new Date(Math.min(Date.parse(row.expires_at),Date.parse(selection.expiresAt))).toISOString();
 if(Date.parse(expiresAt)<=+now)throw new AIError('TASK_EXPIRED',409);
 return {format:'agentpay.reference-quote.v1',id:randomUUID(),tenantId:actor.tenant_id,userId:actor.user_id,taskId:row.id,
  purchaseId,reviewDigest:row.review_digest,productId:selection.productId,title:selection.title,quantity:1,merchantId,amount:selection.amount,
  currency:'USD',shipping:'0.00',tax:'0.00',total:selection.amount,expiresAt};
}

export function assertReferenceQuote(p,now=new Date()){
 if(p.quote_digest==null&&p.quote==null)return;
 const q=p.quote;
 const expected={tenantId:p.tenant_id,userId:p.user_id,purchaseId:p.id,productId:p.item_id,quantity:p.quantity,merchantId:p.merchant_id,
  amount:p.amount,total:p.amount,currency:p.currency,shipping:'0.00',tax:'0.00'};
 if(!q||typeof p.quote_digest!=='string'||!/^[a-f0-9]{64}$/.test(p.quote_digest)||q.format!=='agentpay.reference-quote.v1'||
  Object.keys(q).sort().join(',')!==[...fields].sort().join(',')||Object.entries(expected).some(([key,value])=>q[key]!==value)||
  !timingSafeEqual(Buffer.from(quoteDigest(q),'hex'),Buffer.from(p.quote_digest,'hex')))throw new AIError('QUOTE_MISMATCH',409);
 if(!Number.isFinite(Date.parse(q.expiresAt))||Date.parse(q.expiresAt)<=+now)throw new AIError('QUOTE_EXPIRED',409);
}
