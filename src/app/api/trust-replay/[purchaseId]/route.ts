import {cookies} from 'next/headers';
import {database} from '../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../server/auth.mjs';
import {probeStoredBinding} from '../../../../server/trust-replay.mjs';
export const runtime='nodejs';
export async function POST(request:Request,context:{params:Promise<{purchaseId:string}>}){
 if(request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403});
 try{
  const pool=database(),actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value),{purchaseId}=await context.params;
  const reader=request.body?.getReader();if(!reader)return Response.json({error:'INVALID_BINDING_PROBE'},{status:400});let bytes=0;const chunks:Uint8Array[]=[];
  for(;;){const{done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024){await reader.cancel();return Response.json({error:'BODY_TOO_LARGE'},{status:413});}chunks.push(value);}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return Response.json({error:'INVALID_BINDING_PROBE'},{status:400});}
  const result=await probeStoredBinding(pool,actor,purchaseId,body);return Response.json(result,{status:result.decision==='TERMS_MISMATCH'?409:200,headers:{'Cache-Control':'no-store'}});
 }catch(error:any){const code=['UNAUTHENTICATED','READ_ONLY_EVALUATION_ACCOUNT','NOT_FOUND','INVALID_BINDING_PROBE','RECORDED_PROVIDER_ORDER_REQUIRED','ORDER_SNAPSHOT_CHANGED','PROBE_IDEMPOTENCY_CONFLICT'].includes(error.message)?error.message:'BINDING_INSPECTION_UNAVAILABLE';return Response.json({error:code},{status:error.status??(code==='UNAUTHENTICATED'?401:503),headers:{'Cache-Control':'no-store'}});}
}
