import {cookies} from 'next/headers';
import {authenticate,sessionCookieName} from '../../../../../server/auth.mjs';
import {database} from '../../../../../server/persistence/db.mjs';
import {createCheckout,checkoutOutcome,checkoutStatus,verifyRecordedOrder} from '../../../../../server/paypal/checkout.mjs';
import {sandboxProvider} from '../../../../../server/paypal/buyer.mjs';
export const dynamic='force-dynamic';
export async function GET(request:Request,context:{params:Promise<{purchaseId:string;action:string}>}){
 try{
  const {purchaseId,action}=await context.params;
  if(action!=='status'||!/^[a-f0-9-]{36}$/.test(purchaseId))return Response.json({error:'NOT_FOUND'},{status:404});
  const pool=database(),actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);
  const result=await verifyRecordedOrder(pool,actor,purchaseId,process.env.PAYPAL_SANDBOX_MERCHANT_ID,sandboxProvider());
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){
  const code=error.code??error.message;
  const exposed=['NOT_FOUND','UNAUTHENTICATED','RECORDED_PROVIDER_ORDER_REQUIRED','RECORDED_PROVIDER_ORDER_UNAVAILABLE','INTENT_CHANGED','PROVIDER_BINDING_MISMATCH'];
  return Response.json({error:exposed.includes(code)?code:'SANDBOX_UNAVAILABLE'},{status:code==='UNAUTHENTICATED'?401:code==='NOT_FOUND'?404:['RECORDED_PROVIDER_ORDER_REQUIRED','RECORDED_PROVIDER_ORDER_UNAVAILABLE','INTENT_CHANGED','PROVIDER_BINDING_MISMATCH'].includes(code)?409:503,headers:{'Cache-Control':'no-store'}});
 }
}
export async function POST(request:Request,context:{params:Promise<{purchaseId:string;action:string}>}){
  if(request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403});
  try{
    const pool=database();const actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);
    const {purchaseId,action}=await context.params;
    if(!/^[a-f0-9-]{36}$/.test(purchaseId)||!['order','verify','cancel','status'].includes(action))return Response.json({error:'NOT_FOUND'},{status:404});
    const purchase=(await pool.query('SELECT state FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3',[purchaseId,actor.tenant_id,actor.user_id])).rows[0];
    if(!purchase)return Response.json({error:'NOT_FOUND'},{status:404});
    if(action==='order'&&!['REVIEWED','AUTHORIZATION_PENDING'].includes(purchase.state))return Response.json({error:'INVALID_TRANSITION'},{status:409});
    const provider=sandboxProvider();
    let orderId;
    if(['verify','cancel'].includes(action)){
      if(Number(request.headers.get('content-length')??0)>256)return Response.json({error:'BODY_TOO_LARGE'},{status:413});
      const reader=request.body?.getReader();let text='';let bytes=0;
      if(reader){while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.length;if(bytes>256){await reader.cancel();return Response.json({error:'BODY_TOO_LARGE'},{status:413});}text+=new TextDecoder().decode(chunk.value);}}
      orderId=JSON.parse(text||'{}').orderId;
      if(typeof orderId!=='string'||!/^[A-Za-z0-9-]{1,64}$/.test(orderId))return Response.json({error:'ORDER_ID_MISMATCH'},{status:400});
    }
    const result=action==='order'?await createCheckout(pool,actor,purchaseId,process.env.PAYPAL_SANDBOX_MERCHANT_ID,provider):action==='status'?await checkoutStatus(pool,actor,purchaseId):await checkoutOutcome(pool,actor,purchaseId,action,orderId,provider);
    return Response.json(result,{headers:{'Cache-Control':'no-store'}});
  }catch(error:any){const code=error.code??error.message;
    const allowed=['NOT_FOUND','UNAUTHENTICATED','READ_ONLY_EVALUATION_ACCOUNT','SANDBOX_CHECKOUT_DISABLED','BUYER_APPROVAL_NOT_VERIFIED','ORDER_CREATION_UNKNOWN','PROVIDER_BINDING_MISMATCH','ORDER_ID_MISMATCH','INTENT_CHANGED','ALREADY_APPROVED','PROVIDER_STATUS_UNCERTAIN','QUOTE_EXPIRED','QUOTE_MISMATCH'];
    return Response.json({error:allowed.includes(code)?code:'SANDBOX_UNAVAILABLE'},{status:code==='NOT_FOUND'?404:code==='UNAUTHENTICATED'?401:['QUOTE_EXPIRED','QUOTE_MISMATCH'].includes(code)?409:503});
  }
}
