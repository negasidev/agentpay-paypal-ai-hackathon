import pg from 'pg';
import {aiConfiguration} from '../src/server/ai/agent.mjs';
import {loginConfiguration} from '../src/server/identity/login.mjs';
const canonical=process.env.AGENTPAY_CANONICAL_REQUIRED==='true';
const reference=process.argv.includes('--reference');
const groups={
 ai:reference?[]:[process.env.AGENTPAY_AI_PROVIDER==='anthropic'?'ANTHROPIC_API_KEY':(process.env.AGENTPAY_AI_PROVIDER==='openai'||(!process.env.AGENTPAY_AI_PROVIDER&&process.env.OPENAI_API_KEY&&!process.env.AI_GATEWAY_API_KEY))?'OPENAI_API_KEY':'AI_GATEWAY_API_KEY','AGENTPAY_AI_MODEL'],
 paypal:['PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_SANDBOX_CLIENT_SECRET','PAYPAL_SANDBOX_MERCHANT_ID'],
 authority:['AUTHORITY_LOCAL_TENANT_ID','AUTHORITY_LOCAL_USER_ID','AUTHORITY_PRINCIPAL_ID','AUTHORITY_BASE_URL','AUTHORITY_TENANT_ID','AUTHORITY_AGENT_ID','AUTHORITY_INTENT_ID','AUTHORITY_INTENT_VERSION','AUTHORITY_TOOL','AUTHORITY_ACTION',...(!canonical?['AUTHORITY_ACCESS_TOKEN']:[])],
 database:['DATABASE_URL'],
};
const report={boundary:'Configuration and local account mapping only; no model request, authority issuance or payment',missing:{},invalid:[],mapping:'NOT_CHECKED',captureEnabled:process.env.AGENTPAY_PROTECTED_CAPTURE_ENABLED==='true'};
report.authorityCredential=canonical?'VALIDATED_CANONICAL_SESSION_REQUIRED':'STATIC_EVALUATION_TOKEN';
report.discovery=reference?'REFERENCE_CATALOG_NO_AI_REQUIRED':'AI_PROVIDER_REQUIRED';
if(canonical){try{loginConfiguration();if(process.env.AGENTPAY_IDENTITY_TENANT_ID!==process.env.AUTHORITY_TENANT_ID||process.env.AGENTPAY_IDENTITY_API_URL!==process.env.AUTHORITY_BASE_URL)throw Error();}catch{report.invalid.push('CANONICAL_IDENTITY_CONFIGURATION');}}
for(const [group,names] of Object.entries(groups))report.missing[group]=names.filter(name=>!process.env[name]?.trim());
if(!report.missing.authority.length){
 try{const url=new URL(process.env.AUTHORITY_BASE_URL);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)report.invalid.push('AUTHORITY_BASE_URL');}catch{report.invalid.push('AUTHORITY_BASE_URL');}
 if(!/^[1-9]\d*$/.test(process.env.AUTHORITY_INTENT_VERSION))report.invalid.push('AUTHORITY_INTENT_VERSION');
 if(process.env.AUTHORITY_TOOL!=='paypal'||process.env.AUTHORITY_ACTION!=='capture')report.invalid.push('AUTHORITY_TOOL_OR_ACTION');
}
if(!reference&&!report.missing.ai.length){try{aiConfiguration();}catch{report.invalid.push('AGENTPAY_AI_PROVIDER_OR_MODEL');}}
if(!report.missing.database.length&&!report.missing.authority.includes('AUTHORITY_LOCAL_USER_ID')&&!report.missing.authority.includes('AUTHORITY_LOCAL_TENANT_ID')){
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
 try{const result=await pool.query('SELECT id FROM ap_users WHERE id=$1 AND tenant_id=$2',[process.env.AUTHORITY_LOCAL_USER_ID,process.env.AUTHORITY_LOCAL_TENANT_ID]);report.mapping=result.rowCount===1?'MATCHED':'NOT_FOUND';}catch{report.mapping='CHECK_FAILED';}finally{await pool.end();}
}
report.configured=Object.values(report.missing).every(names=>names.length===0)&&report.invalid.length===0&&report.mapping==='MATCHED';
console.log(JSON.stringify(report,null,2));
if(!report.configured)process.exitCode=1;
