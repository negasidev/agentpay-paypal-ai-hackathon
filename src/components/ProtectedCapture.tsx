'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
export default function ProtectedCapture({purchaseId}:{purchaseId:string}){
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('The server will verify signed 2AYE authority and separate PayPal consent before capture.');
 const [ready,setReady]=useState(false);const [checking,setChecking]=useState(true);
 async function refresh(){
  setReady(false);setChecking(true);
  try{
   const response=await fetch(`/api/transactions/${purchaseId}`,{cache:'no-store'});
   const result=await response.json();
   if(!response.ok)throw new Error('unavailable');
   setReady(result.captureEnabled===true);
   const reasons:Record<string,string>={CAPTURE_NOT_CONFIGURED:'Protected capture is not configured for this account.',EXISTING_ATTEMPT:'An execution attempt already exists. Review its evidence before taking further action.',PURCHASE_NOT_PENDING:'Submit the reviewed purchase for authorization first.',AUTHORITY_NOT_VERIFIED:'Obtain and refresh signed 2AYE authorization first.',AUTHORITY_EXPIRED:'The recorded authorization has expired.',BUYER_CONSENT_REQUIRED:'Complete and verify PayPal sandbox buyer consent first.'};
   setMessage(result.captureEnabled===true?'Recorded prerequisites are ready. Capture will recheck live authority and PayPal consent.':reasons[result.reason]??'Execution readiness is unavailable.');
  }catch{setMessage('Unable to check execution readiness. Refresh to try again.');}
  finally{setChecking(false);}
 }
 useEffect(()=>{void refresh();},[purchaseId]);
 async function capture(){
  if(busy||!ready)return;setBusy(true);setReady(false);
  try{
   const response=await fetch(`/api/purchases/${purchaseId}/capture`,{method:'POST'});const result=await response.json();
   if(!response.ok){setMessage(result.error==='VERIFIED_EXTERNAL_AUTHORITY_REQUIRED'?'Capture blocked: verified external authorization is required. No payment was initiated.':'Capture refused. Review authorization, buyer consent and purchase state.');return;}
   setMessage(result.state==='COMPLETED'?'PayPal capture confirmed. Open transaction evidence to inspect the recorded result.':result.state==='UNKNOWN'?'Payment outcome uncertain. Do not start another payment; the original attempt requires reconciliation.':['REFUSED','FAILED'].includes(result.state)?'Execution refused. No new capture was dispatched. Review the authorization evidence.':'Execution is already reserved. Open transaction evidence for its current state.');
  }catch{setMessage('Response unavailable. Inspect the existing transaction before retrying; do not create another purchase.');}
  finally{setBusy(false);}
 }
 return <section className="mt-4 rounded-lg border p-4"><h3 className="font-semibold">Protected payment execution</h3><p role="status" aria-live="polite" className="my-2">{checking?'Checking execution readiness...':message}</p><div className="actions"><button disabled={busy||checking||!ready} onClick={()=>void capture()}>{busy?'Verifying execution gates...':'Verify gates and capture'}</button><button className="secondary" disabled={busy||checking} onClick={()=>void refresh()}>Refresh execution readiness</button><Link className="button secondary" href={`/transactions/${purchaseId}`}>View transaction evidence</Link></div></section>;
}
