import test from 'node:test';import assert from 'node:assert/strict';import{verifiedCapture}from'../../src/shared/trust-presentation.mjs';
test('capture celebration requires provider re-verification and matched issuer evidence, never an order or purchase label',()=>{
 for(const value of[{}, {purchase:{state:'COMPLETED'}},{orders:[{provider_status:'CREATED',buyer_status:'APPROVED'}]},{attempts:[{state:'COMPLETED'}],receipts:[{provider_capture_id:'FIXTURE',verification:{status:'INCOMPLETE'}}]}])assert.equal(verifiedCapture(value),false);
 const evidence={attempts:[{state:'COMPLETED'}],receipts:[{provider_capture_id:'FIXTURE',verification:{status:'VERIFIED',providerReverified:true,issuerGrantSignatureVerified:true,canonicalReceiptMatched:true}}]};assert.equal(verifiedCapture(evidence),true);
 for(const field of['providerReverified','issuerGrantSignatureVerified','canonicalReceiptMatched'])assert.equal(verifiedCapture({...evidence,receipts:[{...evidence.receipts[0],verification:{...evidence.receipts[0].verification,[field]:false}}]}),false);
});
