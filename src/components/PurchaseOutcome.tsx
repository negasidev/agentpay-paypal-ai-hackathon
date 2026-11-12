'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {purchaseOutcome,browserSoftwareOutcome} from '../shared/purchase-outcome.mjs';

export default function PurchaseOutcome({purchaseId}:{purchaseId:string}){
 const [result,setResult]=useState<ReturnType<typeof purchaseOutcome>|null>(null);
 const [revision,setRevision]=useState(0),[loading,setLoading]=useState(true);
 useEffect(()=>{
  const controller=new AbortController();setLoading(true);setResult(null);
  void fetch('/api/sandbox/config',{cache:'no-store',signal:controller.signal}).then(async configResponse=>{
   if(!configResponse.ok)throw Error('unavailable');const config=await configResponse.json();
   const browserMode=config.approvalMode==='sandbox-browser-software';
   const response=await fetch(browserMode?`/api/browser-sandbox/${purchaseId}/status`:`/api/transactions/${purchaseId}`,{cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error('unavailable');
   const detail=await response.json();if(!controller.signal.aborted)setResult(browserMode?browserSoftwareOutcome(detail,purchaseId):purchaseOutcome(detail));
  }).catch(error=>{if(error.name!=='AbortError')setResult(purchaseOutcome(null));}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[purchaseId,revision]);
 return <aside className="card policy-note"><h2>{loading?'Checking the purchase outcome':result?.title}</h2><p role="status" aria-live="polite">{loading?'Reading the backend transaction evidence.':result?.message}</p><div className="actions"><button className="secondary" disabled={loading} onClick={()=>setRevision(value=>value+1)}>Refresh purchase outcome</button><Link href={`/transactions/${purchaseId}`}>Inspect payment evidence</Link></div></aside>;
}
