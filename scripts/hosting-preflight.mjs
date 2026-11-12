import {hostingIssues} from '../src/server/hackathon-hosting.mjs';
import {aiConfiguration} from '../src/server/ai/agent.mjs';
const issues=hostingIssues();
const missing=['PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_SANDBOX_CLIENT_SECRET','PAYPAL_SANDBOX_MERCHANT_ID'].filter(name=>!process.env[name]?.trim());
try{aiConfiguration();}catch{issues.push('AI_PROVIDER_CONFIGURATION_REQUIRED');}
console.log(JSON.stringify({target:'hackathon.agentpay.twoaye.com',configured:issues.length===0&&missing.length===0,issues,missing,boundary:'Configuration checks only; no credentials validated, DNS changed, deployment created, approval granted or payment dispatched',deploymentAccepted:false},null,2));
if(issues.length||missing.length)process.exitCode=1;
