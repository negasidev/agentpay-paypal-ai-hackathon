import {cookies} from 'next/headers';
import {database} from '../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../server/auth.mjs';
import {transactionDetail} from '../../../../server/transaction-detail.mjs';
import {sandboxProvider} from '../../../../server/paypal/buyer.mjs';
export async function GET(request:Request,ctx:{params:Promise<{purchaseId:string}>}){
 try{const actor=await authenticate(database(),(await cookies()).get(sessionCookieName())?.value);const {purchaseId}=await ctx.params;
 if(!/^[a-f0-9-]{36}$/.test(purchaseId))return Response.json({error:'NOT_FOUND'},{status:404});
 const provider=process.env.PAYPAL_SANDBOX_CLIENT_ID&&process.env.PAYPAL_SANDBOX_CLIENT_SECRET?sandboxProvider():null;
 return Response.json(await transactionDetail(database(),actor,purchaseId,{provider}),{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){const code=error.code??error.message;return Response.json({error:code==='UNAUTHENTICATED'?'Sign in required':'Transaction unavailable'},{status:code==='UNAUTHENTICATED'?401:404});}
}
