import test from 'node:test';
import assert from 'node:assert/strict';
import {browserSoftwareOutcome} from '../../src/shared/purchase-outcome.mjs';
test('software success requires fresh provider verification, purchase binding and honest assurance',()=>{
 const detail={mode:'sandbox-browser-software',providerVerified:true,executionState:'COMPLETED',receipt:{format:'agentpay.browser-software-sandbox.receipt.v1',purchaseId:'purchase',assurance:'software',hardwareAttested:false,providerCaptureId:'fixture-capture'}};
 assert.equal(browserSoftwareOutcome(detail,'purchase').title,'PayPal Sandbox payment confirmed');
 for(const changed of [{...detail,providerVerified:false},{...detail,executionState:'UNKNOWN'},{...detail,mode:'twoaye-device'},{...detail,receipt:{...detail.receipt,purchaseId:'other'}},{...detail,receipt:{...detail.receipt,hardwareAttested:true}},{...detail,receipt:{...detail.receipt,providerCaptureId:''}}])assert.notEqual(browserSoftwareOutcome(changed,'purchase').title,'PayPal Sandbox payment confirmed');
 assert.notEqual(browserSoftwareOutcome(null,'purchase').title,'PayPal Sandbox payment confirmed');
});
