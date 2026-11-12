'use client';
import {useEffect,useRef,useState} from 'react';
let sdkLoading:Promise<void>|undefined;
function loadSdk(){
  if((window as any).paypal?.createInstance)return Promise.resolve();
  return sdkLoading??=new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://www.sandbox.paypal.com/web-sdk/v6/core';
    const timer=setTimeout(()=>{script.remove();sdkLoading=undefined;reject(new Error('SDK_LOAD_FAILED'));},15000);
    script.onload=()=>{clearTimeout(timer);resolve();};script.onerror=()=>{clearTimeout(timer);script.remove();sdkLoading=undefined;reject(new Error('SDK_LOAD_FAILED'));};document.head.appendChild(script);
  });
}
export default function SandboxCheckout({purchaseId}:{purchaseId:string}){
  const session=useRef<any>(null);const lastOrder=useRef<string|null>(null);
  const [ready,setReady]=useState(false);const[busy,setBusy]=useState(false);const[approved,setApproved]=useState(false);
  const [message,setMessage]=useState('Checking checkout availability...');
  async function request(action:string,orderId?:string){const r=await fetch(`/api/sandbox/${purchaseId}/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:orderId?JSON.stringify({orderId}):undefined});const result=await r.json();if(!r.ok)throw new Error(result.error);return result;}
  useEffect(()=>{let disposed=false;
    async function load(){try{
      const r=await fetch('/api/sandbox/config',{cache:'no-store'});const config=await r.json();
      if(r.ok&&config.readOnly===true){if(!disposed)setMessage('Read-only evaluation. Buyer checkout and payment actions are unavailable for this account.');return;}
      if(!r.ok||!config.enabled){if(!disposed)setMessage('Sandbox checkout unavailable. Capture disabled.');return;}
      const stored=await request('status');lastOrder.current=stored.orderId;
      if(stored.buyerStatus==='APPROVED'){if(!disposed){setApproved(true);setMessage('Buyer approved - waiting for 2AYE. No payment captured.');}return;}
      await loadSdk();const sdk=await (window as any).paypal.createInstance({clientId:config.clientId,components:['paypal-payments'],pageType:'checkout'});
      const eligible=await sdk.findEligibleMethods({currencyCode:'USD'});if(!eligible.isEligible('paypal'))throw new Error('INELIGIBLE');
      if(disposed)return;
      session.current=sdk.createPayPalOneTimePaymentSession({commit:false,
        onApprove:async(data:{orderId:string})=>{try{await request('verify',data.orderId);if(!disposed){setApproved(true);setMessage('Buyer approved - waiting for 2AYE. No payment captured.');}}catch{if(!disposed)setMessage('Verification failed. Capture disabled.');}finally{if(!disposed)setBusy(false);}},
        onCancel:async(data:{orderId?:string})=>{try{const id=data?.orderId??lastOrder.current;if(id){const result=await request('cancel',id);if(result.buyerStatus==='APPROVED'){if(!disposed){setApproved(true);setMessage('Buyer approved - waiting for 2AYE. No payment captured.');}return;}}if(!disposed)setMessage('Buyer canceled checkout. No payment captured.');}catch{if(!disposed)setMessage('Provider status uncertain. No capture requested.');}finally{if(!disposed)setBusy(false);}},
        onError:()=>{if(!disposed){setMessage('Provider status uncertain. No capture requested.');setBusy(false);}}});
      setReady(true);setMessage(stored.buyerStatus==='CANCELED'?'Buyer canceled checkout. Resume the existing order only.':'Ready for PayPal Sandbox checkout');
    }catch{if(!disposed)setMessage('Provider status uncertain. Capture disabled.');}}
    void load();return()=>{disposed=true;session.current=null;};
  },[purchaseId]);
  async function start(){if(!session.current||busy||approved)return;setBusy(true);setMessage('Opening PayPal Sandbox');
    const promise=request('order').then(result=>{lastOrder.current=result.orderId;setMessage('Awaiting buyer approval');return {orderId:result.orderId};});
    try{await session.current.start({presentationMode:'auto'},promise);}catch{setMessage('Provider status uncertain. No capture requested.');setBusy(false);}
  }
  return <section className="mt-5 rounded-lg border border-amber-200 p-4"><h3 className="font-semibold">PayPal sandbox buyer checkout</h3><p className="my-2 text-sm">PayPal Sandbox only. In the PayPal window, use a Sandbox Personal test account, not your real PayPal account. No real money is involved. Buyer approval does not authorize 2AYE execution or complete payment.</p><button disabled={!ready||busy||approved} onClick={()=>void start()}>Continue with PayPal sandbox</button><p role="status" aria-live="polite">{message}</p></section>;
}
