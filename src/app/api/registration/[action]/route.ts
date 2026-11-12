import {cookies} from 'next/headers';
import {database} from '../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../server/auth.mjs';
import {registerSandbox,verifySandboxEmail,createSandboxWorkspace,notifySandboxApprover} from '../../../../server/sandbox-registration.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request,ctx:{params:Promise<{action:string}>}){
 if(request.headers.get('origin')!==process.env.APP_ORIGIN)return Response.json({error:'ORIGIN_REFUSED'},{status:403});
 try{const action=(await ctx.params).action;if(!['register','verify','workspace','notify','resend-notification'].includes(action))return Response.json({error:'NOT_FOUND'},{status:404});
 const reader=request.body?.getReader();let size=0;const chunks:Uint8Array[]=[];if(reader)for(;;){const row=await reader.read();if(row.done)break;size+=row.value.length;if(size>2048){await reader.cancel();return Response.json({error:'BODY_TOO_LARGE'},{status:413});}chunks.push(row.value);}
 let input:any;try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return Response.json({error:'INVALID_REGISTRATION'},{status:400});}
 const pool=database();let result;
 if(action==='register')result=await registerSandbox(pool,input);
 else if(action==='verify')result=await verifySandboxEmail(pool,input);
 else{const actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);
 if(action==='workspace'){if(!input||Object.keys(input).length)throw Error('INVALID_REGISTRATION');result=await createSandboxWorkspace(pool,actor);}
 else{if(!input||Object.keys(input).length!==1||!/^[-a-f0-9]{36}$/.test(input.purchaseId??''))throw Error('INVALID_REGISTRATION');result=await notifySandboxApprover(pool,actor,input.purchaseId,{resend:action==='resend-notification'});}}
 return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){const known=['UNAUTHENTICATED','READ_ONLY_EVALUATION_ACCOUNT','INVALID_REGISTRATION','PASSWORD_LENGTH','SANDBOX_EMAIL_NOT_CONFIGURED','SANDBOX_EMAIL_REFUSED','SANDBOX_REGISTRATION_UNAVAILABLE','REGISTRATION_RATE_LIMIT','NOTIFICATION_RATE_LIMIT','INVALID_VERIFICATION','VERIFICATION_EXPIRED_OR_INVALID','VERIFIED_TESTER_REQUIRED','NOT_FOUND'];const code=known.includes(error.message)?error.message:'REGISTRATION_UNAVAILABLE';return Response.json({error:code},{status:error.message==='UNAUTHENTICATED'?401:error.status??503,headers:{'Cache-Control':'no-store'}});}
}
