import {cookies} from 'next/headers';
import {database} from '../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../server/auth.mjs';
import {shoppingRequest} from '../../../server/shopping/requests.mjs';
import {listTasks} from '../../../server/shopping/tasks.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(){
 try{const pool=database();const actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);
  return Response.json(await listTasks(pool,actor),{headers:{'Cache-Control':'no-store'}});
 }catch(error:any){return Response.json({error:error.message==='UNAUTHENTICATED'?'UNAUTHENTICATED':'SHOPPING_UNAVAILABLE'},
  {status:error.message==='UNAUTHENTICATED'?401:503,headers:{'Cache-Control':'no-store'}});}
}
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403,headers});
 try{
  const pool=database();const actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);
  const reader=request.body?.getReader();if(!reader)return Response.json({error:'INVALID_SHOPPING_REQUEST'},{status:400,headers});
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();return new Response(null,{status:413,headers});}chunks.push(value);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return Response.json({error:'INVALID_SHOPPING_REQUEST'},{status:400,headers});}
  return Response.json(await shoppingRequest(pool,actor,body),{headers});
 }catch(error:any){const allowed=['UNAUTHENTICATED','READ_ONLY_EVALUATION_ACCOUNT','INVALID_SHOPPING_REQUEST','INVALID_BUDGET','AI_NOT_CONFIGURED','AI_RATE_LIMIT','AI_BUSY','AI_REQUEST_CONFLICT','AI_REQUEST_UNCERTAIN','AI_REQUEST_FAILED','AI_TIMEOUT'];
  const code=allowed.includes(error.message)?error.message:'SHOPPING_UNAVAILABLE';
  return Response.json({error:code},{status:error.status??(code==='UNAUTHENTICATED'?401:503),headers});}
}
