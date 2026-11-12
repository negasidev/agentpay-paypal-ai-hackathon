import {cookies} from 'next/headers';
import {authenticate,sessionCookieName,hashToken} from '../../../../server/auth.mjs';
import {database} from '../../../../server/persistence/db.mjs';
import {browserSandboxPolicy} from '../../../../server/authorization/browser-sandbox.mjs';
export const dynamic='force-dynamic';
export async function GET(){
  try{const token=(await cookies()).get(sessionCookieName())?.value;const actor=await authenticate(database(),token);const policy=browserSandboxPolicy({...actor,session_hash:hashToken(token)});
    if(process.env.AGENTPAY_SANDBOX_CHECKOUT_ENABLED!=='true'||!process.env.PAYPAL_SANDBOX_CLIENT_ID)return Response.json({enabled:false});
    return Response.json({enabled:true,clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,currency:'USD',captureEnabled:false,approvalMode:process.env.AGENTPAY_APPROVAL_MODE??'twoaye-device',browserApprovalAvailable:!!policy,browserCaptureConfigured:policy?.captureEnabled===true},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'UNAUTHENTICATED'},{status:401});}
}
