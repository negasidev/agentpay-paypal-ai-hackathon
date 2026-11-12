import {cookies} from 'next/headers';
import {authenticate,sessionCookieName,hashToken} from '../../../../../server/auth.mjs';
import {database} from '../../../../../server/persistence/db.mjs';
import {sandboxProvider} from '../../../../../server/paypal/buyer.mjs';
import {browserApprovalChallenge,approveBrowserChallenge,revokeBrowserApproval,captureBrowserSandbox,browserSandboxStatus,recordBrowserRefusal} from '../../../../../server/authorization/browser-sandbox.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
const uuid=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
async function handle(request:Request,context:{params:Promise<{purchaseId:string;action:string}>}){
 if(request.method==='POST'&&request.headers.get('origin')!==process.env.APP_ORIGIN)return Response.json({error:'ORIGIN_REFUSED',providerDispatched:false},{status:403});
 let auditContext:any=null;
 try{
  const {purchaseId,action}=await context.params;if(!uuid(purchaseId)||!['status','challenge','approve','revoke','capture'].includes(action)||request.method==='GET'&&action!=='status'||request.method==='POST'&&action==='status')return Response.json({error:'NOT_FOUND'},{status:404});
  const token=(await cookies()).get(sessionCookieName())?.value;if(!token||!/^[a-f0-9]{64}$/.test(token))return Response.json({error:'UNAUTHENTICATED'},{status:401,headers:{'Cache-Control':'no-store'}});const pool=database();const authenticated=await authenticate(pool,token);const actor={...authenticated,session_hash:hashToken(token)};auditContext={pool,actor,purchaseId,action};
  if(action==='status')return Response.json(await browserSandboxStatus(pool,actor,purchaseId,sandboxProvider()),{headers:{'Cache-Control':'no-store'}});
  const reader=request.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
  if(reader)for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>4096){await reader.cancel();return Response.json({error:'BODY_TOO_LARGE',providerDispatched:false},{status:413});}chunks.push(next.value);}
  let input;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return Response.json({error:'INVALID_BROWSER_APPROVAL_REQUEST',providerDispatched:false},{status:400});}
  if(!input||typeof input!=='object'||Array.isArray(input))return Response.json({error:'INVALID_BROWSER_APPROVAL_REQUEST',providerDispatched:false},{status:400});
  if(['revoke','capture'].includes(action)&&!uuid(input.approvalId)||action==='approve'&&!uuid(input.challengeId))return Response.json({error:'INVALID_BROWSER_APPROVAL_REQUEST',providerDispatched:false},{status:400});
  let result;
  if(action==='challenge')result=await browserApprovalChallenge(pool,actor,purchaseId,input,sandboxProvider());
  else if(action==='approve')result=await approveBrowserChallenge(pool,actor,purchaseId,input);
  else if(action==='capture')result=await captureBrowserSandbox(pool,actor,purchaseId,input,sandboxProvider());
  else{if(Object.keys(input).length!==1)return Response.json({error:'INVALID_BROWSER_APPROVAL_REQUEST',providerDispatched:false},{status:400});result=await revokeBrowserApproval(pool,actor,purchaseId,input.approvalId);}
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){
  const code=error.code??error.message;
  if(auditContext)try{await recordBrowserRefusal(auditContext.pool,auditContext.actor,auditContext.purchaseId,auditContext.action,code);}catch{return Response.json({error:'BROWSER_SANDBOX_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});}
  const exposed=['UNAUTHENTICATED','INVALID_LOGIN','NOT_FOUND','INVALID_TRANSITION','BROWSER_SANDBOX_NOT_CONFIGURED','INVALID_BROWSER_APPROVAL_REQUEST','INVALID_BROWSER_KEY','INVALID_BROWSER_SIGNATURE','BROWSER_APPROVAL_NOT_FOUND','BROWSER_APPROVAL_ALREADY_USED','BROWSER_APPROVAL_EXPIRED','BROWSER_APPROVAL_TERMS_CHANGED','BROWSER_APPROVAL_NOT_REVOCABLE','BROWSER_APPROVAL_REQUIRED','PAYPAL_BUYER_CONSENT_REQUIRED','SANDBOX_EXECUTION_ALREADY_RESERVED','BROWSER_SANDBOX_CAPTURE_DISABLED','UNEXPECTED_CAPTURE_TERMS','QUOTE_EXPIRED','QUOTE_MISMATCH'];
  return Response.json({error:exposed.includes(code)?code:'BROWSER_SANDBOX_UNAVAILABLE',...(code==='UNEXPECTED_CAPTURE_TERMS'?{providerDispatched:false}:{})},{status:code==='UNAUTHENTICATED'||code==='INVALID_LOGIN'?401:error.status??503,headers:{'Cache-Control':'no-store'}});
 }
}
export const GET=handle;export const POST=handle;
