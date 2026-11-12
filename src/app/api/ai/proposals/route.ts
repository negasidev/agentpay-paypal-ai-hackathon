import {cookies} from 'next/headers';
import {database} from '../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../server/auth.mjs';
import {proposePurchase,listProposals} from '../../../../server/ai/proposals.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(request:Request){
 if(request.method==='POST'&&request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403});
 try{const pool=database();const actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);
 if(request.method==='GET')return Response.json(await listProposals(pool,actor),{headers:{'Cache-Control':'no-store'}});
 const reader=request.body?.getReader();if(!reader)return Response.json({error:'INVALID_AI_REQUEST'},{status:400});
 const chunks:Uint8Array[]=[];let length=0;for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8192){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return Response.json({error:'INVALID_AI_REQUEST'},{status:400});}
 return Response.json(await proposePurchase(pool,actor,body),{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(error:any){const allowed=['UNAUTHENTICATED','INVALID_AI_REQUEST','INVALID_BUDGET','AI_NOT_CONFIGURED','AI_RATE_LIMIT','AI_BUSY','AI_REQUEST_CONFLICT','AI_REQUEST_UNCERTAIN','AI_REQUEST_FAILED','INVALID_AI_PROPOSAL','UNKNOWN_ITEM','OVER_BUDGET','AI_TIMEOUT'];
 return Response.json({error:allowed.includes(error.message)?error.message:'AI_PROVIDER_UNAVAILABLE'},{status:error.status??(error.message==='UNAUTHENTICATED'?401:503),headers:{'Cache-Control':'no-store'}});}
}
export const GET=handle;export const POST=handle;
