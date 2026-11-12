import test from 'node:test';
import assert from 'node:assert/strict';
import {executionReadiness} from '../../src/server/execution-readiness.mjs';

test('capture availability requires configuration, exact account and current prerequisites',()=>{
 const actor={tenant_id:'local-tenant',user_id:'buyer'};
 const env={AGENTPAY_PROTECTED_CAPTURE_ENABLED:'true',AGENTPAY_SANDBOX_CHECKOUT_ENABLED:'true',
  PAYPAL_SANDBOX_CLIENT_ID:'fixture',PAYPAL_SANDBOX_CLIENT_SECRET:'fixture',PAYPAL_SANDBOX_MERCHANT_ID:'merchant',
  AUTHORITY_LOCAL_TENANT_ID:'local-tenant',AUTHORITY_LOCAL_USER_ID:'buyer',AUTHORITY_BASE_URL:'https://issuer.example.test',
  AUTHORITY_TENANT_ID:'tenant',AUTHORITY_PRINCIPAL_ID:'principal',AUTHORITY_AGENT_ID:'agent',AUTHORITY_INTENT_ID:'intent',
  AUTHORITY_INTENT_VERSION:'1',AUTHORITY_TOOL:'paypal',AUTHORITY_ACTION:'capture',AUTHORITY_ACCESS_TOKEN:'fixture'};
 const purchase={state:'AUTHORIZATION_PENDING'},orders=[{buyer_status:'APPROVED'}];
 const authority={state:'VERIFIED',expires_at:new Date(20000).toISOString()};
 const read=(a=actor,p=purchase,o=orders,r=authority,attempts=[],config=env)=>executionReadiness(a,p,o,r,attempts,config,10000);
 assert.equal(read().captureEnabled,true);
 for(const config of [{...env,AGENTPAY_PROTECTED_CAPTURE_ENABLED:'false'},{...env,PAYPAL_SANDBOX_CLIENT_SECRET:''}])assert.equal(read(actor,purchase,orders,authority,[],config).captureEnabled,false);
 assert.equal(read({...actor,user_id:'other'}).captureConfigured,false);
 assert.equal(read(actor,{state:'COMPLETED'}).captureEnabled,false);
 for(const r of [null,{...authority,state:'WAITING_HUMAN'},{...authority,expires_at:null},{...authority,expires_at:'invalid'},{...authority,expires_at:new Date(10000).toISOString()}])assert.equal(read(actor,purchase,orders,r).captureEnabled,false);
 assert.equal(read(actor,purchase,[]).captureEnabled,false);
 assert.equal(read(actor,purchase,[{buyer_status:'CREATED'}]).captureEnabled,false);
 assert.equal(read(actor,purchase,orders,authority,[{state:'UNKNOWN'}]).captureEnabled,false);
 assert.equal(read().liveChecksRequired,true);
});
