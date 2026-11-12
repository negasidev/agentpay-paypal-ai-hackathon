import {cookies} from 'next/headers';
import {database} from '../../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../../server/auth.mjs';
import {readTask,taskAction} from '../../../../../server/shopping/tasks.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
async function handle(request:Request,context:{params:Promise<{taskId:string}>}){
 const headers={'Cache-Control':'no-store'};
 if(request.method==='POST'&&request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403,headers});
 try{
  const pool=database();const actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);const {taskId}=await context.params;
  if(request.method==='GET')return Response.json(await readTask(pool,actor,taskId),{headers});
  const reader=request.body?.getReader();if(!reader)return Response.json({error:'INVALID_TASK_ACTION'},{status:400,headers});
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048){await reader.cancel();return new Response(null,{status:413,headers});}chunks.push(value);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return Response.json({error:'INVALID_TASK_ACTION'},{status:400,headers});}
  return Response.json(await taskAction(pool,actor,taskId,body),{headers});
 }catch(error:any){const allowed=['UNAUTHENTICATED','READ_ONLY_EVALUATION_ACCOUNT','TASK_NOT_FOUND','INVALID_TASK_ACTION','INVALID_TASK_SELECTION','TASK_VERSION_CONFLICT','TASK_CANCELED','TASK_EXPIRED','HANDOFF_ALREADY_PREPARED','INVALID_TASK_STATE','REVIEW_MISMATCH','REFERENCE_MERCHANT_NOT_CONFIGURED','QUOTE_MISMATCH'];
  const code=allowed.includes(error.message)?error.message:'SHOPPING_UNAVAILABLE';
  return Response.json({error:code},{status:error.status??(code==='UNAUTHENTICATED'?401:503),headers});}
}
export const GET=handle;export const POST=handle;
