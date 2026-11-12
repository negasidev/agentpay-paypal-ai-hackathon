export function verifiedCapture(detail){
 return Boolean(detail?.attempts?.some(attempt=>attempt.state==='COMPLETED')&&detail?.receipts?.some(receipt=>receipt.provider_capture_id&&receipt.verification?.status==='VERIFIED'&&receipt.verification.providerReverified===true&&receipt.verification.issuerGrantSignatureVerified===true&&receipt.verification.canonicalReceiptMatched===true));
}
export function verifiedBrowserCapture(detail){
 const status=detail?.browserSandbox,receipt=status?.receipt,purchase=detail?.purchase;
 return Boolean(status?.mode==='sandbox-browser-software'&&status.providerVerified===true&&status.executionState==='COMPLETED'&&
  receipt?.format==='agentpay.browser-software-sandbox.receipt.v1'&&receipt.assurance==='software'&&receipt.hardwareAttested===false&&
  receipt.signatureVerified===true&&receipt.purchaseId===purchase?.id&&receipt.amount===purchase?.amount&&receipt.currency===purchase?.currency&&receipt.merchantId===purchase?.merchant_id&&
  typeof receipt.providerCaptureId==='string'&&receipt.providerCaptureId.length>0&&detail.orders?.some(order=>order.provider_order_id===receipt.providerOrderId));
}
