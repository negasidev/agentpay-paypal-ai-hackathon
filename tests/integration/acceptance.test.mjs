import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceClient,assertPaymentEvidence} from '../../scripts/acceptance-http.mjs';

test('acceptance never follows credential redirects and separates anonymous/origin refusal requests',async()=>{
 const calls=[];
 const client=acceptanceClient('https://agentpay.example.test',{fetchImpl:async(url,options)=>{
  calls.push({url,...options});
  return Response.json({}, {headers:url.endsWith('/session')?{'set-cookie':'agentpay_session=private-token; HttpOnly; Secure'}:{}});
 }});
 await client.call('POST','/api/session',{email:'test@example.test',password:'private-password'});
 await client.request('POST','/api/purchases/id/capture',undefined,{anonymous:true});
 await client.request('POST','/api/purchases/id/capture',undefined,{requestOrigin:'https://acceptance.invalid'});
 assert.ok(calls.every(call=>call.redirect==='error'));
 assert.equal(calls[1].headers.cookie,undefined);
 assert.equal(calls[2].headers.cookie,'agentpay_session=private-token');
 assert.equal(calls[2].headers.origin,'https://acceptance.invalid');
 for(const origin of ['http://public.example.test','https://user:secret@example.test','https://example.test/path','https://example.test/?token=secret'])assert.throws(()=>acceptanceClient(origin));
 await assert.rejects(client.call('GET','/api/../outside'),/INVALID_ACCEPTANCE_PATH/);
});

test('acceptance refuses completed-looking payments without exact AI, provider and canonical receipt bindings',()=>{
 const proposal={state:'READY',purchaseId:'purchase',total:'119.00',provenance:{provider:'vercel-ai-gateway',model:'configured/model'}};
 const detail={purchase:{id:'purchase',state:'COMPLETED',amount:'119.00',currency:'USD',merchant_id:'merchant'},
  authority:{state:'VERIFIED'},orders:[{provider_order_id:'order',buyer_status:'APPROVED'}],attempts:[{id:'attempt',state:'COMPLETED'}],
  receipts:[{provider_capture_id:'capture',evidence:{authorizationId:'grant',intentHash:'hash',intentVersion:1,purchaseId:'purchase',attemptId:'attempt',orderId:'order',captureId:'capture',amount:'119.00',currency:'USD',merchantId:'merchant',status:'COMPLETED'},
   platform_receipt:{authorizationId:'grant',externalReference:'capture',intentVersion:1,status:'Succeeded',comparison:'Matched'}}]};
 assert.equal(assertPaymentEvidence(detail,proposal).signedReceiverEffectEvidence,false);
 for(const mutate of [d=>d.receipts=[],d=>d.attempts.push(d.attempts[0]),d=>d.authority.state='WAITING_HUMAN',d=>d.orders[0].buyer_status='NOT_APPROVED',d=>d.receipts[0].evidence.amount='118.00',d=>d.receipts[0].evidence.orderId='other',d=>d.receipts[0].platform_receipt.authorizationId='other',d=>d.receipts[0].platform_receipt=null]){
  const changed=structuredClone(detail);mutate(changed);assert.throws(()=>assertPaymentEvidence(changed,proposal),/PAYMENT_EVIDENCE_INCOMPLETE/);
 }
 assert.throws(()=>assertPaymentEvidence(detail,{...proposal,provenance:{provider:'fixture-only',model:'fixture/model'}}));
});
