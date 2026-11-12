export function acceptanceClient(origin,{fetchImpl=fetch}={}){
 const base=new URL(origin);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/'||
   (base.protocol!=='https:'&&!(base.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(base.hostname))))throw new Error('INVALID_ACCEPTANCE_ORIGIN');
 let cookie;
 async function request(method,path,body,{anonymous=false,requestOrigin=base.origin}={}){
  if(!path.startsWith('/api/')||path.includes('..')||path.includes('\\'))throw new Error('INVALID_ACCEPTANCE_PATH');
  const response=await fetchImpl(base.origin+path,{method,redirect:'error',signal:AbortSignal.timeout(45000),
   headers:{origin:requestOrigin,'content-type':'application/json',...(!anonymous&&cookie?{cookie}:{})},
   body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json();
  if(path==='/api/session'&&method==='POST'&&response.ok){
   cookie=response.headers.getSetCookie().find(value=>value.startsWith('agentpay_session='))?.split(';')[0];
   if(!cookie)throw new Error('SESSION_COOKIE_MISSING');
  }
  return {status:response.status,data};
 }
 async function call(method,path,body){const result=await request(method,path,body);if(result.status<200||result.status>=300)throw new Error(`ACCEPTANCE_HTTP_${result.status}`);return result.data;}
 return {request,call};
}

export function assertPaymentEvidence(detail,proposal){
 const fail=()=>{throw new Error('PAYMENT_EVIDENCE_INCOMPLETE');};
 const {purchase,orders,attempts,receipts,authority}=detail;
 if(!purchase||purchase.id!==proposal.purchaseId||purchase.state!=='COMPLETED'||purchase.amount!==proposal.total||purchase.currency!=='USD'||
  proposal.state!=='READY'||proposal.provenance?.provider!=='vercel-ai-gateway'||!proposal.provenance?.model||
  authority?.state!=='VERIFIED'||orders?.length!==1||attempts?.length!==1||receipts?.length!==1)fail();
 const order=orders[0],attempt=attempts[0],receipt=receipts[0],e=receipt.evidence,r=receipt.platform_receipt;
 if(attempt.state!=='COMPLETED'||order.buyer_status!=='APPROVED'||!e||!r||
  !e.authorizationId||!e.intentHash||!Number.isInteger(e.intentVersion)||e.intentVersion<1||
  e.purchaseId!==purchase.id||e.attemptId!==attempt.id||e.orderId!==order.provider_order_id||e.captureId!==receipt.provider_capture_id||
  e.amount!==purchase.amount||e.currency!==purchase.currency||e.merchantId!==purchase.merchant_id||e.status!=='COMPLETED'||
  r.authorizationId!==e.authorizationId||r.externalReference!==e.captureId||r.intentVersion!==e.intentVersion||r.status!=='Succeeded'||r.comparison!=='Matched')fail();
 return {purchaseId:purchase.id,orderId:e.orderId,captureId:e.captureId,attemptId:attempt.id,
  amount:e.amount,currency:e.currency,platformReceipt:'RECORDED',signedReceiverEffectEvidence:false};
}
