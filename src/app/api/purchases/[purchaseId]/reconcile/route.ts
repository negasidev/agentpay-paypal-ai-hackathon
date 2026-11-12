import {cookies} from 'next/headers';
import {database} from '../../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../../server/auth.mjs';
import {PayPalSandboxClient} from '../../../../../server/paypal/client.mjs';
import {reconcileAttempt} from '../../../../../server/paypal/reconcile.mjs';
import {recordPlatformReceipt} from '../../../../../server/paypal/platform-receipt.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request,ctx:{params:Promise<{purchaseId:string}>}){
 if(request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403});
 try{
  const pool=database(),actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value),id=(await ctx.params).purchaseId;
  if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:'NOT_FOUND'},{status:404});
  const attempt=(await pool.query('SELECT id FROM ap_attempts WHERE purchase_id=$1 AND tenant_id=$2 AND user_id=$3',[id,actor.tenant_id,actor.user_id])).rows[0];
  if(!attempt)return Response.json({error:'NOT_FOUND'},{status:404});
  const provider=new PayPalSandboxClient({clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,clientSecret:process.env.PAYPAL_SANDBOX_CLIENT_SECRET});
  const result=await reconcileAttempt(pool,actor,attempt.id,provider);
  let platformReceipt='PENDING';
  if(result.state==='COMPLETED')try{await recordPlatformReceipt(pool,actor,attempt.id);platformReceipt='RECORDED';}catch{}
  return Response.json({...result,platformReceipt},{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){const code=['UNAUTHENTICATED','READ_ONLY_EVALUATION_ACCOUNT','NOT_FOUND','INVALID_TRANSITION'].includes(error.message)?error.message:'RECONCILIATION_UNAVAILABLE';return Response.json({error:code},{status:code==='UNAUTHENTICATED'?401:code==='NOT_FOUND'?404:409});}
}
