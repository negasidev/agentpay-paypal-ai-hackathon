import {verifiedCapture} from './trust-presentation.mjs';

export function browserSoftwareOutcome(detail,purchaseId){
 const receipt=detail?.receipt;
 if(detail?.mode==='sandbox-browser-software'&&detail.providerVerified===true&&detail.executionState==='COMPLETED'&&receipt?.format==='agentpay.browser-software-sandbox.receipt.v1'&&receipt.purchaseId===purchaseId&&receipt.assurance==='software'&&receipt.hardwareAttested===false&&typeof receipt.providerCaptureId==='string'&&receipt.providerCaptureId.length>0)
  return {title:'PayPal Sandbox payment confirmed',message:'PayPal confirmed the exact payment and the backend matched its browser software-key approval. This is Sandbox only, without a hardware-attestation claim.'};
 if(detail?.executionState)return {title:'Check the existing Sandbox payment',message:'An execution attempt exists. Refresh its provider evidence before continuing; do not create or dispatch another payment.'};
 return {title:'Sandbox purchase awaiting approval',message:'Confirm sign-in, sign only the exact Sandbox terms and complete separate PayPal buyer consent. Capture rechecks both before any payment.'};
}

export function purchaseOutcome(detail){
 if(!detail)return {title:'Purchase status unavailable',message:'Refresh the evidence before continuing. No payment success can be confirmed.'};
 if(verifiedCapture(detail))return {title:'Purchase paid and verified',message:'PayPal capture and the matching signed authorization receipt have been verified. Open the evidence for the recorded result.'};
 if(detail.attempts?.length)return {title:'Check the existing payment attempt',message:'An execution attempt exists. Inspect its outcome and receipt before taking further action; do not start another payment.'};
 if(detail.purchase?.state==='REJECTED')return {title:'Purchase rejected',message:'This purchase was rejected. No verified payment completion is recorded.'};
 if(detail.purchase?.state==='CANCELED')return {title:'Purchase canceled',message:'This purchase was canceled. No verified payment completion is recorded.'};
 if(detail.captureEnabled===true)return {title:'Ready for final payment verification',message:'Recorded prerequisites are present. The capture endpoint must still recheck live authorization and PayPal buyer consent.'};
 const buyerApproved=detail.orders?.some(order=>order.buyer_status==='APPROVED');
 return {title:buyerApproved?'Buyer consent recorded; payment not completed':'Purchase prepared; payment not completed',message:buyerApproved?'PayPal buyer consent is recorded. Verified, current 2AYE authority and an enabled sandbox capture boundary are still required.':'Review the exact terms, prepare the sandbox order and complete PayPal buyer consent. Signed 2AYE authority remains a separate requirement before capture.'};
}
