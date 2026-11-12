'use client';
import {useEffect,useState} from 'react';
export default function AuthorityStatus({purchaseId}:{purchaseId:string}){
 const [label,setLabel]=useState('Checking authorization');const[reason,setReason]=useState('');const[busy,setBusy]=useState(false);
 async function read(method='GET'){
  setBusy(true);if(method==='POST')setLabel('Authorization requested');
  try{const r=await fetch(`/api/authority/${purchaseId}`,{method,cache:'no-store'});const body=await r.json();if(!r.ok)throw new Error('Authority unavailable');setLabel(body.label);setReason(body.reason??'');}
  catch{setLabel('Authority unavailable');setReason('Authority verification is unavailable. Payment capture is disabled.');}finally{setBusy(false);}
 }
 useEffect(()=>{void read();},[purchaseId]);
 return <section className="mt-4 rounded-lg border p-4"><h3 className="font-semibold">2AYE authorization</h3><p role="status" aria-live="polite">{label}</p><p className="my-2 text-sm">Approve the exact purchase on your enrolled 2AYE device, then refresh. This application cannot sign on your behalf.</p>{reason&&<p className="my-2 text-sm">{reason}</p>}<div className="actions"><button disabled={busy} onClick={()=>void read('POST')}>Request 2AYE authorization</button><button className="secondary" disabled={busy} onClick={()=>void read()}>Refresh authorization</button></div></section>;
}
