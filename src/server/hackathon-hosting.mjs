const demoOrigin='https://hackathon.agentpay.twoaye.com';
export function hostingIssues(env=process.env){
 const issues=[];
 if(env.AGENTPAY_EDITION!=='hackathon')issues.push('HACKATHON_EDITION_REQUIRED');
 if(env.APP_ORIGIN!==demoOrigin)issues.push('DEDICATED_DEMO_ORIGIN_REQUIRED');
 if(env.PAYPAL_ENVIRONMENT!=='sandbox')issues.push('PAYPAL_SANDBOX_REQUIRED');
 if(env.AGENTPAY_PROTECTED_CAPTURE_ENABLED!=='false')issues.push('CAPTURE_RELEASE_GATE_CLOSED');
 if(env.AGENTPAY_APPROVAL_MODE&&!['twoaye-device','sandbox-browser-software'].includes(env.AGENTPAY_APPROVAL_MODE))issues.push('UNKNOWN_APPROVAL_MODE');
 if(env.AGENTPAY_BROWSER_SANDBOX_CAPTURE_ENABLED==='true'&&env.AGENTPAY_APPROVAL_MODE!=='sandbox-browser-software')issues.push('EXPLICIT_BROWSER_SANDBOX_MODE_REQUIRED');
 if(env.AGENTPAY_APPROVAL_MODE==='sandbox-browser-software'&&env.AGENTPAY_BROWSER_SANDBOX_SELF_SERVICE!=='true'&&(!/^[a-f0-9-]{36}$/.test(env.AGENTPAY_BROWSER_SANDBOX_APPROVER_ID??'')||!/^[a-f0-9-]{36}$/.test(env.AGENTPAY_BROWSER_SANDBOX_TENANT_ID??'')||env.AGENTPAY_BROWSER_SANDBOX_MAX_AMOUNT!=='150.00'))issues.push('EXPLICIT_BROWSER_SANDBOX_POLICY_REQUIRED');
 if(env.AGENTPAY_SESSION_API_URL)issues.push('SHARED_PRODUCT_SESSION_SERVICE_REFUSED');
 try{const db=new URL(env.DATABASE_URL);if(!['postgres:','postgresql:'].includes(db.protocol)||!/^\/agentpay_hackathon_[a-z0-9_]+$/.test(db.pathname)||!db.username||!db.password)issues.push('DEDICATED_HACKATHON_DATABASE_REQUIRED');if(!['require','verify-full'].includes(db.searchParams.get('sslmode')))issues.push('HOSTED_DATABASE_TLS_REQUIRED');}catch{issues.push('DEDICATED_HACKATHON_DATABASE_REQUIRED');}
 if(env.AUTHORITY_BASE_URL){
  try{const authority=new URL(env.AUTHORITY_BASE_URL);const approved=new URL(env.AGENTPAY_HACKATHON_CANONICAL_ORIGIN);const hostname=authority.hostname.replace(/\.+$/,'');if(authority.origin!==approved.origin||authority.protocol!=='https:'||authority.username||authority.password||authority.search||authority.hash||authority.pathname!=='/'||approved.username||approved.password||approved.search||approved.hash||approved.pathname!=='/'||['api.twoaye.com','api.agentpay.twoaye.com','agentpay.twoaye.com'].includes(hostname))issues.push('DEDICATED_CANONICAL_SANDBOX_REQUIRED');}catch{issues.push('DEDICATED_CANONICAL_SANDBOX_REQUIRED');}
 }
 for(const name of Object.keys(env)){if(name.startsWith('NEXT_PUBLIC_')&&/(SECRET|PASSWORD|PRIVATE|TOKEN|API_KEY|DATABASE_URL)/.test(name)&&env[name])issues.push('BROWSER_SECRET_CONFIGURATION_REFUSED');}
 return [...new Set(issues)];
}
export function assertHostingIsolation(env=process.env){
 if(env.VERCEL!=='1'&&env.AGENTPAY_HOSTING_PROFILE!=='isolated-hackathon')return;
 if(hostingIssues(env).length)throw Error('HACKATHON_HOSTING_CONFIGURATION_REFUSED');
}
