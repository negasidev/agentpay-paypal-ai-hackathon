'use client';
import {useState} from 'react';
export default function ApprovalNotification({purchaseId}:{purchaseId:string}){
 const[state,setState]=useState(''),[busy,setBusy]=useState(false);
 async function notify(){if(busy)return;setBusy(true);try{const response=await fetch('/api/registration/notify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({purchaseId})});const data=await response.json();setState(response.ok&&data.deliveryState==='SUBMITTED'?'Approval email submitted. Delivery is not yet confirmed.':data.error==='NOTIFICATION_RATE_LIMIT'?'Please wait before requesting another email.':'Email is unavailable. Review remains available here.');}catch{setState('Email is unavailable. No approval was granted.');}finally{setBusy(false);}}
 return <aside className="card"><h3>Review by email</h3><p>Send yourself a sign-in link to this purchase. Opening the email cannot approve or pay.</p><button className="secondary" disabled={busy} onClick={()=>void notify()}>Send purchase review email</button><p role="status">{state}</p></aside>;
}
