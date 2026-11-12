import {cookies} from 'next/headers';
import {database} from '../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../server/auth.mjs';
import {refreshAuthority,requestAuthority,authorityConfig} from '../../../../server/authorization/requests.mjs';
import {createCheckout} from '../../../../server/paypal/checkout.mjs';
import {PayPalSandboxClient} from '../../../../server/paypal/client.mjs';
export const dynamic='force-dynamic';
async function handle(request:Request,ctx:{params:Promise<{purchaseId:string}>}){
 if(request.method==='POST'&&request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403});
 try{const pool=database();const actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);const id=(await ctx.params).purchaseId;
  if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:'NOT_FOUND'},{status:404});
  const config=authorityConfig(actor);
  if(request.method==='POST'&&config&&process.env.AGENTPAY_SANDBOX_CHECKOUT_ENABLED==='true'&&!(await pool.query('SELECT id FROM ap_orders WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3',[id,actor.tenant_id,actor.user_id])).rows.length)await createCheckout(pool,actor,id,process.env.PAYPAL_SANDBOX_MERCHANT_ID,new PayPalSandboxClient({clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,clientSecret:process.env.PAYPAL_SANDBOX_CLIENT_SECRET}));
  const result=request.method==='POST'?await requestAuthority(pool,actor,id):await refreshAuthority(pool,actor,id);
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){const code=error.code??error.message;return Response.json({error:['NOT_FOUND','UNAUTHENTICATED','INVALID_TRANSITION','BUYER_CONSENT_REQUIRED','QUOTE_EXPIRED','QUOTE_MISMATCH'].includes(code)?code:'Authority unavailable'},{status:code==='NOT_FOUND'?404:code==='UNAUTHENTICATED'?401:409});}
}
export const GET=handle;export const POST=handle;
