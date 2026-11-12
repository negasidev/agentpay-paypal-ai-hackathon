import test from 'node:test';
import assert from 'node:assert/strict';
import {loginConfiguration} from '../../src/server/identity/login.mjs';
test('production acceptance permits only the explicit loopback application tunnel, keeping canonical services on HTTPS',()=>{
 const before={...process.env};
 try{
  Object.assign(process.env,{NODE_ENV:'production',AGENTPAY_CANONICAL_LOGIN_ENABLED:'true',AGENTPAY_IDENTITY_SESSION_KEY_HEX:'1'.repeat(64),
   AGENTPAY_IDENTITY_API_URL:'https://api.example.test',AGENTPAY_IDENTITY_TENANT_ID:'11111111-1111-1111-1111-111111111111',AGENTPAY_IDENTITY_APPLICATION_ID:'22222222-2222-2222-2222-222222222222',AGENTPAY_IDENTITY_CLIENT_ID:'test-client',
   AGENTPAY_UNIVERSAL_LOGIN_URL:'https://login.example.test',AGENTPAY_CONSOLE_URL:'https://console.example.test',APP_ORIGIN:'http://127.0.0.1:3516'});
  delete process.env.AGENTPAY_ACCEPTANCE_LOOPBACK_ENABLED;
  assert.throws(()=>loginConfiguration(),/NOT_CONFIGURED/);
  process.env.AGENTPAY_ACCEPTANCE_LOOPBACK_ENABLED='true';assert.equal(loginConfiguration().callback,'http://127.0.0.1:3516/api/identity/callback');
  for(const origin of ['http://127.0.0.1:3006','http://localhost:3516','http://0.0.0.0:3516','http://agentpay.example.test','http://127.0.0.1:3516/path']){
   process.env.APP_ORIGIN=origin;assert.throws(()=>loginConfiguration(),/NOT_CONFIGURED/);
  }
  process.env.APP_ORIGIN='http://127.0.0.1:3516';
  for(const key of ['AGENTPAY_UNIVERSAL_LOGIN_URL','AGENTPAY_CONSOLE_URL','AGENTPAY_IDENTITY_API_URL']){
   const value=process.env[key];process.env[key]='http://127.0.0.1:3516';assert.throws(()=>loginConfiguration(),/NOT_CONFIGURED/);process.env[key]=value;
  }
 }finally{for(const key of Object.keys(process.env))if(!(key in before))delete process.env[key];Object.assign(process.env,before);}
});
