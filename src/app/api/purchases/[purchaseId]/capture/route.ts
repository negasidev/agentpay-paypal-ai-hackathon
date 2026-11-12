import {cookies} from 'next/headers';
import {database} from '../../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../../server/auth.mjs';
import {protectedCapture} from '../../../../../server/paypal/capture.mjs';
import {PayPalSandboxClient} from '../../../../../server/paypal/client.mjs';
export const dynamic='force-dynamic';
export async function POST(request:Request,ctx:{params:Promise<{purchaseId:string}>}){
 if(request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403});
 try{
  const pool=database();const actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);
  const id=(await ctx.params).purchaseId;
  if(!/^[a-f0-9-]{36}$/.test(id))return Response.json({error:'NOT_FOUND'},{status:404});
  if(!(await pool.query('SELECT id FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3',[id,actor.tenant_id,actor.user_id])).rows.length)return Response.json({error:'NOT_FOUND'},{status:404});
  if(process.env.AGENTPAY_PROTECTED_CAPTURE_ENABLED!=='true')return Response.json({error:'VERIFIED_EXTERNAL_AUTHORITY_REQUIRED'},{status:503});
  const provider=new PayPalSandboxClient({clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,clientSecret:process.env.PAYPAL_SANDBOX_CLIENT_SECRET});
  return Response.json(await protectedCapture(pool,actor,id,provider),{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){const code=['UNAUTHENTICATED','READ_ONLY_EVALUATION_ACCOUNT','NOT_FOUND','INVALID_TRANSITION','INVALID_AUTHORITY_BINDING','VERIFIED_EXTERNAL_AUTHORITY_REQUIRED','QUOTE_EXPIRED','QUOTE_MISMATCH'].includes(error.message)?error.message:'SERVICE_UNAVAILABLE';return Response.json({error:code},{status:code==='UNAUTHENTICATED'?401:code==='NOT_FOUND'?404:error.status??409});}
}
