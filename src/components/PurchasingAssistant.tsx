'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';
type Product={id:string;name:string;amount:string;currency:string};
type Proposal={id:string;purchaseId:string;product:Product;quantity:number;total:string;budget:string;remaining:string;reason:string;alternatives:Product[];provenance:{model:string}};
export default function PurchasingAssistant({onCreated}:{onCreated:()=>void}){
 const [instruction,setInstruction]=useState('Find a wireless ergonomic keyboard under $150.');
 const [budget,setBudget]=useState('150.00');const [proposal,setProposal]=useState<Proposal|null>(null);
 const [busy,setBusy]=useState(false);const [message,setMessage]=useState('');
 const [requestId,setRequestId]=useState<string|null>(null);
 useEffect(()=>{const controller=new AbortController();fetch('/api/ai/proposals',{cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)return;const rows=await response.json();setProposal(rows[0]??null);}).catch(()=>{});return ()=>controller.abort();},[]);
 async function submit(event:React.FormEvent){event.preventDefault();if(busy)return;setBusy(true);setMessage('Comparing catalog products…');
 const id=requestId??crypto.randomUUID();setRequestId(id);
 try{const response=await fetch('/api/ai/proposals',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({instruction,maximumBudget:budget,requestId:id})});const result=await response.json();
 if(!response.ok)throw new Error(result.error);setProposal(result);setMessage('Draft created. Review it before requesting authorization.');onCreated();
 }catch(error:any){const messages:Record<string,string>={AI_NOT_CONFIGURED:'AI provider is not configured. No AI purchase was created.',OVER_BUDGET:'The recommendation exceeds your budget.',AI_TIMEOUT:'The AI provider timed out. No payment was initiated.',AI_REQUEST_UNCERTAIN:'This request needs recovery. Check saved proposals before trying a new request.',AI_REQUEST_FAILED:'This request failed. Edit the request before trying again.',INVALID_AI_PROPOSAL:'The recommendation could not be validated against the catalog.',AI_RATE_LIMIT:'Live AI is temporarily at its limit. Open your saved proposal now, or try again later.',AI_BUSY:'Another request is in progress. Try again in a minute.'};setMessage(messages[error.message]??'Unable to create a validated AI proposal. No payment was initiated.');}
 finally{setBusy(false);}}
 return <section className={busy?"ai-workspace model-busy mb-8 space-y-5 rounded-xl border bg-white p-6":"ai-workspace mb-8 space-y-5 rounded-xl border bg-white p-6"}><h2 className="text-xl font-semibold">Find the right product</h2><p>AI recommends from our controlled evaluation catalog. Prices are verified by the server. A recommendation creates a draft and grants no payment authority.</p>
 <form onSubmit={submit} className="grid gap-4"><label className="grid gap-2">What do you need?<textarea className="rounded-lg border border-slate-300 p-3 focus:outline-2 focus:outline-blue-600" required maxLength={1200} value={instruction} disabled={busy} onChange={event=>{setInstruction(event.target.value);setRequestId(null);}} rows={3}/></label>
 <label className="grid gap-2">Maximum budget (USD)<input required inputMode="decimal" pattern="[0-9]+\.[0-9]{2}" value={budget} disabled={busy} onChange={event=>{setBudget(event.target.value);setRequestId(null);}}/></label>
 <button disabled={busy||!!requestId&&!!proposal} type="submit">{busy?'Finding a recommendation…':'Ask AI for a recommendation'}</button></form>
 <p role="status" aria-live="polite">{message}</p>
 {proposal&&<article className="proposal-ready space-y-3 rounded-xl border border-slate-200 p-5"><h3 className="text-xl font-semibold">{proposal.product.name}</h3><p>{proposal.quantity} × {proposal.product.amount} {proposal.product.currency} · Total {proposal.total} USD</p><p>AI explanation: {proposal.reason}</p><dl className="grid grid-cols-1 gap-3 sm:grid-cols-3"><div><dt>Budget</dt><dd>{proposal.budget} USD</dd></div><div><dt>Trusted total</dt><dd>{proposal.total} USD</dd></div><div><dt>Remaining</dt><dd>{proposal.remaining} USD</dd></div></dl>
 <p className="text-sm">Model: {proposal.provenance.model} · DRAFT · Payment not authorized</p>
 {proposal.alternatives.length>0&&<div><h4 className="font-semibold">Alternatives</h4><ul>{proposal.alternatives.map(product=><li key={product.id}>{product.name} · {product.amount} {product.currency} per item</li>)}</ul></div>}
 <Link className="inline-block underline" href={`/review?purchase=${proposal.purchaseId}`}>Review purchase</Link></article>}
 </section>;
}
