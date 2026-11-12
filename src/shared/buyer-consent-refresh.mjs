export async function refreshBuyerConsent(purchaseId,request=fetch){
 const base='/api/sandbox/'+encodeURIComponent(purchaseId);
 const response=await request(base+'/status',{cache:'no-store'}),order=await response.json();
 if(!response.ok)throw Error('BUYER_CONSENT_UNAVAILABLE');
 if(order.buyerStatus==='APPROVED')return {buyerApproved:true};
 if(order.providerStatus!=='APPROVED'||!order.orderId)return {buyerApproved:false};
 const verified=await request(base+'/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({orderId:order.orderId})}),result=await verified.json();
 if(!verified.ok||result.buyerStatus!=='APPROVED')throw Error('BUYER_CONSENT_UNAVAILABLE');
 return {buyerApproved:true};
}
