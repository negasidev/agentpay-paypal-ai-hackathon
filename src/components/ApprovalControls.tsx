'use client';
import {useEffect,useState} from 'react';
import AuthorityStatus from './AuthorityStatus';
import ProtectedCapture from './ProtectedCapture';
import ApprovalNotification from './ApprovalNotification';
import BrowserSandboxApproval from './BrowserSandboxApproval';
export default function ApprovalControls({purchaseId,canonicalAvailable=true,onChange}:{purchaseId:string;canonicalAvailable?:boolean;onChange?:()=>void}){
 const[mode,setMode]=useState<string|null>(null),[available,setAvailable]=useState(false);
 useEffect(()=>{const controller=new AbortController();void fetch('/api/sandbox/config',{cache:'no-store',signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();const result=await response.json();setMode(result.approvalMode??'twoaye-device');setAvailable(result.browserApprovalAvailable===true);}).catch(()=>{if(!controller.signal.aborted)setMode('unavailable');});return()=>controller.abort();},[]);
 if(mode===null)return <p role="status">Checking the approval method...</p>;
 if(mode==='sandbox-browser-software')return available?<><ApprovalNotification purchaseId={purchaseId}/><BrowserSandboxApproval purchaseId={purchaseId} onChange={onChange}/></>:<p role="status">Browser Sandbox approval is not configured for this account. Payment remains blocked.</p>;
 if(mode!=='twoaye-device')return <p role="status">Approval configuration is unavailable. Payment remains blocked.</p>;
 return canonicalAvailable?<><AuthorityStatus purchaseId={purchaseId}/><ProtectedCapture purchaseId={purchaseId}/></>:null;
}
