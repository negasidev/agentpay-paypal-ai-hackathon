export function requestBindingInspection(purchase,amount,readOnly){
 const terms={amount,merchantId:purchase.merchant_id,currency:purchase.currency,purchaseVersion:purchase.version};
 const path='/api/trust-replay/'+encodeURIComponent(purchase.id);
 if(readOnly){const query=new URLSearchParams({...terms,purchaseVersion:String(terms.purchaseVersion)});return fetch(path+'?'+query,{cache:'no-store'});}
 return fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),...terms})});
}
