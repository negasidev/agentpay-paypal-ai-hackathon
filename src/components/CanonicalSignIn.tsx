'use client';
import {useState} from 'react';
import useSharedDraft from './useSharedDraft';
export default function CanonicalSignIn({next='/shopping',failed=false,available=true}:{next?:string;failed?:boolean;available?:boolean}){
 useSharedDraft();
 const[context,setContext]=useState(next.startsWith('/enterprise/')?'organization':'personal'),[busy,setBusy]=useState(false),[error,setError]=useState(failed?'Sign-in could not be completed. Start a new sign-in to continue.':'');
 return <div className="ap-design"><section className="signin-page"><div className="signin-intro"><p className="section-label">ONE IDENTITY. EXPLICIT AUTHORITY.</p><h2>Continue with your 2AYE account</h2><p>Your saved work follows your account. Every consequential action still requires its own authorization.</p></div><div className="signin-panel"><h2>Sign in with 2AYE</h2><p>Choose who you are shopping for. Sign-in does not approve purchases or grant company spending permission.</p>
  <label>Purchasing context<select value={context} onChange={event=>setContext(event.target.value)} disabled={busy}>
   <option value="personal">Personal</option><option value="organization">Organization</option></select></label>
  <p>Your account must match the selected context. Switching requires a new sign-in; existing purchases and grants are not transferred.</p>
  <button disabled={busy||!available} onClick={async()=>{setBusy(true);setError('');try{
   const response=await fetch('/api/identity/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({context,next})});
   if(!response.ok)throw new Error();const result=await response.json();location.assign(result.redirect);
  }catch{setBusy(false);setError('2AYE sign-in is unavailable. Try again later.');}}}>{!available?'Sign-in setup pending':busy?'Opening 2AYE...':'Continue with 2AYE'}</button>
  {!available&&<p role="status">Sign-in is not ready for this environment. The administrator must finish connecting this application to 2AYE Login. Your destination is preserved; reload this page after setup is complete.</p>}
  {error&&<p role="alert">{error}</p>}</div></section></div>;
}
