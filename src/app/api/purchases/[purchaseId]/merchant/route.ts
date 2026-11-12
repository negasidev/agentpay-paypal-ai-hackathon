import {cookies} from 'next/headers';
import {database} from '../../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../../server/auth.mjs';
import {sandboxProvider} from '../../../../../server/paypal/buyer.mjs';
import {acceptReferenceOrder} from '../../../../../server/shopping/merchant-order.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request,ctx:{params:Promise<{purchaseId:string}>}){
 if(request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403});
 try{
  const pool=database(),actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value),id=(await ctx.params).purchaseId;
  if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:'NOT_FOUND'},{status:404});
  return Response.json(await acceptReferenceOrder(pool,actor,id,sandboxProvider()),{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){const code=error.code??error.message;const status=code==='UNAUTHENTICATED'?401:code==='NOT_FOUND'?404:409;
  return Response.json({error:status===401?'UNAUTHENTICATED':status===404?'NOT_FOUND':'MERCHANT_ACCEPTANCE_UNAVAILABLE'},{status});}
}
