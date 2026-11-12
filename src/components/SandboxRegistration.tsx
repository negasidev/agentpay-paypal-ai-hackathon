'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';

const messages:Record<string,string>={SANDBOX_EMAIL_NOT_CONFIGURED:'Email verification is temporarily unavailable.',REGISTRATION_RATE_LIMIT:'Please wait before requesting another email. Repeated requests are limited to protect your account.',VERIFICATION_EXPIRED_OR_INVALID:'This verification link expired, was used, or is invalid. Request a new email.',INVALID_REGISTRATION:'Check your name, email and password.',PASSWORD_LENGTH:'Use a password between 12 and 128 characters.',UNAUTHENTICATED:'Sign in with your verified account first.',VERIFIED_TESTER_REQUIRED:'Sign in with the account whose email you verified. The shared judge account cannot create a workspace.'};

export default function SandboxRegistration({available}:{available:boolean}){
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[password,setPassword]=useState('');
 const [verification,setVerification]=useState(''),[requested,setRequested]=useState(false),[manualCode,setManualCode]=useState(false);
 const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[verified,setVerified]=useState(false);
 const [authenticated,setAuthenticated]=useState(false),[workspace,setWorkspace]=useState(false);
 useEffect(()=>{
  const controller=new AbortController();
  const consume=()=>{const value=new URLSearchParams(location.hash.slice(1)).get('verification');if(value){setVerification(value);setRequested(true);history.replaceState(null,'',location.pathname+location.search);}return !!value;};
  const fromEmail=consume();addEventListener('hashchange',consume);
  if(available)void Promise.all([fetch('/api/session',{cache:'no-store',signal:controller.signal}),fetch('/api/sandbox/config',{cache:'no-store',signal:controller.signal})]).then(async([sessionResponse,configResponse])=>{
   const session=sessionResponse.ok?await sessionResponse.json():null,config=configResponse.ok?await configResponse.json():null;
   if(!controller.signal.aborted&&!fromEmail){setAuthenticated(session?.authenticated===true);setWorkspace(session?.authenticated===true&&config?.readOnly===false);}
  }).catch(()=>{});
  return()=>{controller.abort();removeEventListener('hashchange',consume);};
 },[available]);
 async function call(action:string,body:unknown){const response=await fetch('/api/registration/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error);return data;}
 async function run(work:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await work();}catch(error){setMessage(messages[(error as Error).message]??'This step is temporarily unavailable. Nothing was approved or paid.');}finally{setBusy(false);}}
 const step=workspace?4:authenticated?3:verified?3:requested||verification?2:1;
 return <section className="card">
  <p className="eyebrow">YOUR OWN PAYPAL SANDBOX WORKSPACE</p><h1>Create your Sandbox account</h1>
  <p>Sign up, verify your email and open your own workspace. No administrator needs to approve your signup. Verifying an email never approves a payment. Sandbox only: no real goods or real money.</p>
  <ol aria-label="Account setup steps" className="status-list">{['Create account','Verify email','Sign in and create workspace','Prepare a purchase'].map((label,index)=><li key={label} aria-current={step===index+1?'step':undefined}>{index+1}. {label}{step===index+1?' - current step':''}</li>)}</ol>
  {!available?<p role="status">Email signup is temporarily unavailable. You can still inspect the saved judge demonstration.</p>:<>
   {!authenticated&&!verified&&!verification&&<form onSubmit={event=>{event.preventDefault();void run(async()=>{const result=await call('register',{name,email,password});setPassword('');if(result.deliveryState==='SUBMITTED'){setRequested(true);setMessage('Check your inbox and spam folder. Open the verification link to continue.');}else setMessage('The verification email could not be sent. Retry after one minute.');});}}>
    <h2>{requested?'Resend verification':'Create your account'}</h2>
    <label>Full name<input value={name} onChange={event=>setName(event.target.value)} autoComplete="name" minLength={2} maxLength={120} required disabled={busy}/></label>
    <label>Email address<input type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="email" maxLength={254} required disabled={busy}/></label>
    <label>Password<input type="password" value={password} onChange={event=>setPassword(event.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/></label>
    <button type="submit" disabled={busy}>{requested?'Resend verification email':'Send verification email'}</button><p>Links expire after 15 minutes. Wait at least one minute before resending.</p>
   </form>}
   {!verified&&(verification||requested)&&<form onSubmit={event=>{event.preventDefault();void run(async()=>{const [id,token]=verification.split('.');const result=await call('verify',{id,token});if(result.emailVerified!==true)throw Error('VERIFICATION_EXPIRED_OR_INVALID');setVerification('');setVerified(true);setAuthenticated(false);setMessage('Email verified. Sign in to continue.');});}}>
    <h2>Verify your email</h2><p>{verification&&!manualCode?'Your email link is ready. Confirm below to verify your address.':'Open the link in your email. It fills in the verification code automatically.'}</p>
    <details onToggle={event=>setManualCode(event.currentTarget.open)}><summary>Paste a verification code instead</summary><label>Verification code from email<input value={manualCode?verification:''} onChange={event=>setVerification(event.target.value)} autoComplete="off" disabled={busy}/></label></details>
    <button type="submit" disabled={busy||!verification}>Verify email</button>
    <button type="button" className="secondary" disabled={busy} onClick={()=>{setVerification('');setRequested(false);}}>Request a new link</button>
   </form>}
   {verified&&!authenticated&&<article><h2>Your email is verified</h2><p>Sign in with your new password to create your workspace.</p><Link className="button" href="/sign-in?next=/register">Sign in to continue</Link></article>}
   {authenticated&&!workspace&&!verification&&<article><h2>Create your isolated workspace</h2><p>You will be its initial owner and approver. Permissions apply only to your own Sandbox purchases.</p><button disabled={busy} onClick={()=>void run(async()=>{const result=await call('workspace',{});if(result.workspaceCreated!==true)throw Error('WORKSPACE_UNAVAILABLE');setWorkspace(true);setMessage('Your Sandbox workspace is ready.');})}>Create my Sandbox workspace</button></article>}
   {workspace&&!verification&&<article><h2>Your workspace is ready</h2><p>Ask for a recommendation, review its exact terms and approve only your own purchase.</p><Link className="button" href="/demo">Prepare a purchase</Link></article>}
   {!authenticated&&!verified&&!verification&&<p>Already verified? <Link href="/sign-in?next=/register">Sign in with your account</Link>.</p>}
  </>}
  <p role="status" aria-live="polite">{busy?'Checking your request...':message}</p>
  <details><summary>How purchase approval works</summary><p>A notification opens sign-in; it never approves a purchase. Review the exact terms and confirm your password before approving. PayPal buyer consent is a separate step. Browser approval uses a software key; it is not hardware-attested approval or production payment authority.</p></details>
 </section>;
}
