import test from 'node:test';
import assert from 'node:assert/strict';
import {purchaseOutcome} from '../../src/shared/purchase-outcome.mjs';

test('browser outcome never calls an order, buyer consent, readiness or an unsigned capture a completed purchase',()=>{
 for(const detail of [null,{}, {purchase:{state:'COMPLETED'}}, {orders:[{provider_status:'CREATED'}]}, {orders:[{buyer_status:'APPROVED'}]}, {captureEnabled:true}, {attempts:[{state:'COMPLETED'}],receipts:[{provider_capture_id:'fixture',verification:{status:'INCOMPLETE'}}]}])assert.notEqual(purchaseOutcome(detail).title,'Purchase paid and verified');
 assert.equal(purchaseOutcome({attempts:[{state:'UNKNOWN'}]}).title,'Check the existing payment attempt');
 const verification={status:'VERIFIED',providerReverified:true,issuerGrantSignatureVerified:true,canonicalReceiptMatched:true};
 const detail={attempts:[{state:'COMPLETED'}],receipts:[{provider_capture_id:'fixture',verification}]};
 assert.equal(purchaseOutcome(detail).title,'Purchase paid and verified');
 for(const field of ['providerReverified','issuerGrantSignatureVerified','canonicalReceiptMatched'])assert.notEqual(purchaseOutcome({...detail,receipts:[{...detail.receipts[0],verification:{...verification,[field]:false}}]}).title,'Purchase paid and verified');
});
