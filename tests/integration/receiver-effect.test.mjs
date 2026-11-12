import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {signReceiverEffect,verifyReceiverEffect} from '../../src/server/paypal/receiver-effect.mjs';

test('receiver effect requires pinned key and binds exact provider and authority fields',()=>{
 const dir=mkdtempSync(join(tmpdir(),'agentpay-receiver-'));
 try{
  const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const foreign=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  const privatePath=join(dir,'private.pem'),publicPath=join(dir,'public.pem'),foreignPath=join(dir,'foreign.pem');
  writeFileSync(privatePath,keys.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
  writeFileSync(publicPath,keys.publicKey.export({format:'pem',type:'spki'}));
  writeFileSync(foreignPath,foreign.publicKey.export({format:'pem',type:'spki'}));
  const env={AGENTPAY_RECEIVER_SIGNING_KEY_FILE:privatePath,AGENTPAY_RECEIVER_PUBLIC_KEY_FILE:publicPath,AGENTPAY_RECEIVER_KEY_ID:'fixture-receiver'};
  const evidence={format:'agentpay-provider-observation-v1',tenantId:'tenant',purchaseId:'purchase',intentVersion:1,intentHash:'hash',authorizationId:'grant',attemptId:'attempt',requestId:'request',orderId:'order',captureId:'capture',merchantId:'merchant',amount:'119.00',currency:'USD',status:'COMPLETED',verifiedAt:new Date().toISOString()};
  const signed=signReceiverEffect(evidence,env);
  assert.equal(verifyReceiverEffect(signed,env),true);
  assert.equal(verifyReceiverEffect(evidence,env),false);
  assert.equal(verifyReceiverEffect(signed,{...env,AGENTPAY_RECEIVER_PUBLIC_KEY_FILE:foreignPath}),false);
  for(const key of Object.keys(evidence))assert.equal(verifyReceiverEffect({...signed,[key]:key==='intentVersion'?2:'altered'},env),false,key);
  assert.equal(verifyReceiverEffect({...signed,receiverEffect:{...signed.receiverEffect,keyId:'foreign'}},env),false);
  assert.throws(()=>signReceiverEffect({...evidence,authorizationId:null},env),/RECEIVER_BINDING_REQUIRED/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
