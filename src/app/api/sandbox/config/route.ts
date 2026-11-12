import {cookies} from 'next/headers';
import {authenticate,sessionCookieName,hashToken} from '../../../../server/auth.mjs';
import {database} from '../../../../server/persistence/db.mjs';
import {browserSandboxPolicy} from '../../../../server/authorization/browser-sandbox.mjs';
import {sandboxWriteAllowed} from '../../../../server/sandbox-membership.mjs';
export const dynamic='force-dynamic';
export async function GET(){
  try{const token=(await cookies()).get(sessionCookieName())?.value;const actor=await authenticate(database(),token);let policy=browserSandboxPolicy({...actor,session_hash:hashToken(token)});
    if(policy&&!(await database().query("SELECT 1 FROM ap_browser_sandbox_approvers WHERE tenant_id=$1 AND user_id=$2 AND revoked_at IS NULL AND identity_kind<>'shared-evaluation'",[actor.tenant_id,actor.user_id])).rowCount)policy=null;
    const readOnly=!await sandboxWriteAllowed(database(),actor);
    if(process.env.AGENTPAY_SANDBOX_CHECKOUT_ENABLED!=='true'||!process.env.PAYPAL_SANDBOX_CLIENT_ID)return Response.json({enabled:false,readOnly});
    return Response.json({enabled:true,readOnly,clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,currency:'USD',captureEnabled:false,approvalMode:process.env.AGENTPAY_APPROVAL_MODE??'twoaye-device',browserApprovalAvailable:!!policy,browserCaptureConfigured:policy?.captureEnabled===true},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'UNAUTHENTICATED'},{status:401});}
}
