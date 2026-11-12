import test from 'node:test';import assert from 'node:assert/strict';import {refreshBuyerConsent} from '../../src/shared/buyer-consent-refresh.mjs';
const response=(body,ok=true)=>({ok,json:async()=>body});
test('explicit buyer refresh verifies the existing provider-approved order without creating or capturing',async()=>{
 const calls=[];const result=await refreshBuyerConsent('fixture',async(path,options)=>{calls.push({path,options});return response(calls.length===1?{orderId:'FIXTURE-ORDER',providerStatus:'APPROVED',buyerStatus:'NOT_APPROVED'}:{buyerStatus:'APPROVED'});});
 assert.equal(result.buyerApproved,true);assert.deepEqual(calls.map(x=>x.path),['/api/sandbox/fixture/status','/api/sandbox/fixture/verify']);assert.deepEqual(JSON.parse(calls[1].options.body),{orderId:'FIXTURE-ORDER'});
 for(const status of ['CREATED','COMPLETED','UNKNOWN']){let count=0;assert.equal((await refreshBuyerConsent('fixture',async()=>{count++;return response({orderId:'FIXTURE-ORDER',providerStatus:status,buyerStatus:'NOT_APPROVED'});})).buyerApproved,false);assert.equal(count,1);}
 await assert.rejects(refreshBuyerConsent('fixture',async()=>response({},false)),/BUYER_CONSENT_UNAVAILABLE/);
 let reads=0;await assert.rejects(refreshBuyerConsent('fixture',async()=>{reads++;return reads===1?response({orderId:'FIXTURE-ORDER',providerStatus:'APPROVED'}):response({buyerStatus:'NOT_APPROVED'},false);}),/BUYER_CONSENT_UNAVAILABLE/);
});
