import test from 'node:test';import assert from 'node:assert/strict';
import {verifiedBrowserCapture,verifiedCapture} from '../../src/shared/trust-presentation.mjs';
const detail=()=>({purchase:{id:'fixture-purchase',amount:'119.00',currency:'USD',merchant_id:'fixture-merchant'},orders:[{provider_order_id:'fixture-order'}],browserSandbox:{mode:'sandbox-browser-software',providerVerified:true,executionState:'COMPLETED',receipt:{format:'agentpay.browser-software-sandbox.receipt.v1',assurance:'software',hardwareAttested:false,signatureVerified:true,purchaseId:'fixture-purchase',amount:'119.00',currency:'USD',merchantId:'fixture-merchant',providerOrderId:'fixture-order',providerCaptureId:'fixture-capture'}}});
test('Sandbox receipt presentation requires current provider verification and the exact owned purchase',()=>{
 assert.equal(verifiedBrowserCapture(detail()),true);assert.equal(verifiedCapture(detail()),false);
 for(const patch of [{providerVerified:false},{executionState:'UNKNOWN'},{mode:'twoaye-device'},{receipt:null}])assert.equal(verifiedBrowserCapture({...detail(),browserSandbox:{...detail().browserSandbox,...patch}}),false);
 for(const patch of [{amount:'1190.00'},{amount:'119'},{currency:'EUR'},{merchantId:'foreign'},{purchaseId:'foreign'},{providerOrderId:'foreign'},{providerCaptureId:''},{signatureVerified:false},{hardwareAttested:true},{assurance:'hardware'},{format:'unsigned-observation'}]){const value=detail();Object.assign(value.browserSandbox.receipt,patch);assert.equal(verifiedBrowserCapture(value),false);}
 assert.equal(verifiedBrowserCapture(null),false);
});
