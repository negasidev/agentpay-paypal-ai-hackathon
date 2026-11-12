import{readFile}from'node:fs/promises';
const path=process.argv[2]??new URL('../config/staging-authority-plan.json',import.meta.url);const plan=JSON.parse(await readFile(path,'utf8'));const missing=[],invalid=[];
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)&&value!=='00000000-0000-0000-0000-000000000000';
for(const name of['tenantId','organizationId','applicationId','agentId','intentId','principalId','deviceId','localTenantId','localUserId'])if(!uuid(plan.ids?.[name]))missing.push('ids.'+name);
if(!/^vyr_[a-f0-9]{24}$/.test(plan.ids?.clientId??''))missing.push('ids.clientId');
if(!uuid(plan.registrationOperationId))missing.push('registrationOperationId');
if(!Number.isSafeInteger(plan.intentVersion)||plan.intentVersion<1)missing.push('intentVersion');
try{const url=new URL(plan.canonicalOrigin);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||['api.twoaye.com','api.agentpay.twoaye.com','agentpay.twoaye.com'].includes(url.hostname.replace(/\.+$/,'')))invalid.push('canonicalOrigin');}catch{missing.push('canonicalOrigin');}
if(plan.deploymentEnvironment!=='staging'||plan.captureEnabled!==false)invalid.push('staging_or_capture_boundary');
if(plan.approver?.tenantRole!=='Member'||plan.approver?.agentAdministratorRequired!==true||plan.approver?.builtInPaymentApproverRoleExists!==false)invalid.push('unsupported_approver_role_mapping');
if(!['DisplayedApproval','PresenceApproval'].includes(plan.approver?.protocol))missing.push('reviewed_approval_protocol');
if(plan.constraints?.requireHumanApproval!==true||plan.constraints?.delegationDepth!==0||plan.constraints?.currency!=='USD'||plan.constraints?.approvalThreshold!=='0.00')invalid.push('per_transaction_constraints');
if(!plan.constraints?.approvedCounterparties?.length)missing.push('verified_sandbox_merchant');
const start=Date.parse(plan.constraints?.notBefore),end=Date.parse(plan.constraints?.expiresAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end<=Date.now())missing.push('explicit_current_contract_window');
console.log(JSON.stringify({configurationComplete:!missing.length&&!invalid.length,missing,invalid,resourcesLookedUp:false,approvalProven:false,payerConsentProven:false,captureMayBeEnabled:false,mutationsPerformed:false,boundary:'Offline configuration validation only; IDs and role names never establish payment authority'},null,2));if(missing.length||invalid.length)process.exitCode=1;
