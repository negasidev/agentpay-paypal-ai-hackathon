import {WorkflowError} from './workflow.mjs';
export async function requireSandboxWriter(db,actor,{env=process.env}={}){
 if(env.AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE!=='true')return;
 const allowed=(await db.query("SELECT 1 FROM ap_sandbox_workspaces w JOIN ap_sandbox_profiles p ON p.tenant_id=w.tenant_id AND p.user_id=w.owner_id JOIN ap_browser_sandbox_approvers a ON a.tenant_id=w.tenant_id AND a.user_id=w.owner_id AND a.identity_kind='verified-workspace-owner' AND a.revoked_at IS NULL WHERE w.tenant_id=$1 AND w.owner_id=$2",[actor.tenant_id,actor.user_id])).rowCount;
 if(!allowed)throw new WorkflowError('READ_ONLY_EVALUATION_ACCOUNT',403);
}
