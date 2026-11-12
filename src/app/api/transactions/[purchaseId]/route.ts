import {cookies} from 'next/headers';
import {database} from '../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName,hashToken} from '../../../../server/auth.mjs';
import {browserSandboxPolicy,browserSandboxStatus} from '../../../../server/authorization/browser-sandbox.mjs';
import {transactionDetail} from '../../../../server/transaction-detail.mjs';
import {sandboxProvider} from '../../../../server/paypal/buyer.mjs';
import {transactionFailure} from '../../../../server/transaction-errors.mjs';
export async function GET(request:Request,ctx:{params:Promise<{purchaseId:string}>}){
 try{const token=(await cookies()).get(sessionCookieName())?.value;const actor=await authenticate(database(),token);actor.session_hash=hashToken(token);const {purchaseId}=await ctx.params;
 if(!/^[a-f0-9-]{36}$/.test(purchaseId))return Response.json({error:'NOT_FOUND'},{status:404});
 const provider=process.env.PAYPAL_SANDBOX_CLIENT_ID&&process.env.PAYPAL_SANDBOX_CLIENT_SECRET?sandboxProvider():null;
 const detail=await transactionDetail(database(),actor,purchaseId,{provider});
 const browserSandbox=browserSandboxPolicy(actor,process.env)?await browserSandboxStatus(database(),actor,purchaseId,provider):null;
 return Response.json({...detail,browserSandbox},{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){const failure=transactionFailure(error);return Response.json(failure.body,{status:failure.status,headers:{'Cache-Control':'no-store'}});}
}
