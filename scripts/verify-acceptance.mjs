import {readFileSync,writeFileSync} from 'node:fs';
import {PayPalSandboxClient,completedCapture} from '../src/server/paypal/client.mjs';
import {verifyReceiverEffect} from '../src/server/paypal/receiver-effect.mjs';

const [purchaseId,output]=process.argv.slice(2),observations=[];
let providerEffect='NOT_OBSERVED';
async function check(name,work){try{const result=await work();observations.push({name,result:'PASS'});return result;}catch{observations.push({name,result:'FAIL'});throw Error(name);}}
try{
 if(!/^[a-f0-9-]{36}$/.test(purchaseId??'')||!output)throw Error('PURCHASE_AND_NEW_PRIVATE_OUTPUT_REQUIRED');
 const origin=new URL(process.env.APP_ORIGIN??'');
 if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(origin.hostname)))throw Error('INVALID_ACCEPTANCE_ORIGIN');
 const cookie=readFileSync(process.env.AGENTPAY_ACCEPTANCE_SESSION_FILE,'utf8').trim();
 if(!/^(?:__Host-)?agentpay_session=[A-Za-z0-9_-]+$/.test(cookie))throw Error('CANONICAL_BROWSER_SESSION_FILE_REQUIRED');
 async function request(method,path,{anonymous=false,requestOrigin=origin.origin}={}){
  return fetch(origin.origin+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{origin:requestOrigin,...(!anonymous?{cookie}:{})}});
 }
 const detail=await check('authenticated_owned_purchase',async()=>{
  const response=await request('GET',`/api/transactions/${purchaseId}`);if(response.status!==200)throw Error();
  const d=await response.json();if(d.purchase?.id!==purchaseId||!d.purchase.quote||d.taskId!==d.purchase.quote.taskId)throw Error();return d;
 });
 await check('anonymous_read_refused',async()=>{if((await request('GET',`/api/transactions/${purchaseId}`,{anonymous:true})).status!==401)throw Error();});
 await check('wrong_origin_capture_refused',async()=>{if((await request('POST',`/api/purchases/${purchaseId}/capture`,{requestOrigin:'https://acceptance.invalid'})).status!==403)throw Error();});
 const {purchase,orders,attempts,receipts,merchantOrder}=detail;
 const capture=await check('independent_paypal_readback',async()=>{
  if(orders?.length!==1||attempts?.length!==1||!process.env.PAYPAL_SANDBOX_MERCHANT_ID||purchase.merchant_id!==process.env.PAYPAL_SANDBOX_MERCHANT_ID)throw Error();
  const provider=new PayPalSandboxClient({clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,clientSecret:process.env.PAYPAL_SANDBOX_CLIENT_SECRET});
  const order=await provider.getOrder(orders[0].provider_order_id);
  if(order.intent!=='CAPTURE')throw Error();
  const value=completedCapture(order,orders[0].provider_order_id,{amount:purchase.amount,currency:purchase.currency,merchantId:purchase.merchant_id});
  if(!value)throw Error();providerEffect='CAPTURED';return value;
 });
 await check('receiver_signature_and_canonical_record',async()=>{
  if(receipts?.length!==1||purchase.state!=='COMPLETED'||attempts[0].state!=='COMPLETED'||orders[0].buyer_status!=='APPROVED')throw Error();
  const r=receipts[0],e=r.evidence,v=r.verification,c=r.platform_receipt;
  if(v?.status!=='VERIFIED'||!v.issuerGrantSignatureVerified||!v.canonicalReceiptMatched||!v.providerReverified||!verifyReceiverEffect(e)||
   e.purchaseId!==purchaseId||e.attemptId!==attempts[0].id||e.captureId!==capture.captureId||r.provider_capture_id!==capture.captureId||e.orderId!==capture.orderId||
   e.merchantId!==capture.merchantId||e.amount!==capture.amount||e.currency!==capture.currency||!c||c.authorizationId!==e.authorizationId||c.externalReference!==capture.captureId||c.status!=='Succeeded'||c.comparison!=='Matched')throw Error();
 });
 await check('distinct_merchant_acceptance',async()=>{if(!merchantOrder||merchantOrder.state!=='ACCEPTED_SANDBOX'||merchantOrder.receipt_id!==receipts[0].id||merchantOrder.quote_digest!==purchase.quote_digest)throw Error();});
}catch(error){if(!observations.some(x=>x.result==='FAIL'))observations.push({name:'prerequisites',result:'FAIL'});process.exitCode=1;}
finally{
 const report={scope:'read_only_configured_sandbox_purchase_no_capture_or_enrollment',purchaseId,providerEffect,observations,
  passed:observations.length===6&&observations.every(x=>x.result==='PASS'),physicalPresenceIndependentlyVerified:false,
  canonicalReceipt:'authenticated_record_not_independently_signed_issuer_receipt'};
 if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({passed:report.passed,providerEffect,checks:observations}));
}
