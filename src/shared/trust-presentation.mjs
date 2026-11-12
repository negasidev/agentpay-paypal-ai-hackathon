export function verifiedCapture(detail){
 return Boolean(detail?.attempts?.some(attempt=>attempt.state==='COMPLETED')&&detail?.receipts?.some(receipt=>receipt.provider_capture_id&&receipt.verification?.status==='VERIFIED'&&receipt.verification.providerReverified===true&&receipt.verification.issuerGrantSignatureVerified===true&&receipt.verification.canonicalReceiptMatched===true));
}
