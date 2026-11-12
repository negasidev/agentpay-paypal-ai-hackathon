import {cookies} from 'next/headers';
import {database} from '../../../../server/persistence/db.mjs';
import {authenticate,sessionCookieName} from '../../../../server/auth.mjs';
import {beginIdentityLink,completeIdentityLink,identityConfiguration} from '../../../../server/identity/link.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
 if(request.headers.get('origin')!==new URL(process.env.APP_ORIGIN??'http://localhost:3006').origin)
  return Response.json({error:'ORIGIN_REFUSED'},{status:403,headers});
 try{
  const pool=database(),actor=await authenticate(pool,(await cookies()).get(sessionCookieName())?.value);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('IDENTITY_LINK_REFUSED');
  const reader=request.body?.getReader();if(!reader)throw new Error('IDENTITY_LINK_REFUSED');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
   if(size>4096){await reader.cancel();return Response.json({error:'BODY_TOO_LARGE'},{status:413,headers});}chunks.push(value);}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8')),config=identityConfiguration();
  if(input.action==='begin')return Response.json(await beginIdentityLink(pool,actor,input.context,config),{headers});
  if(input.action==='complete')return Response.json(await completeIdentityLink(pool,actor,input,{config}),{headers});
  throw new Error('IDENTITY_LINK_REFUSED');
 }catch(error:any){
  const code=error.message==='UNAUTHENTICATED'?'UNAUTHENTICATED':error.message==='CANONICAL_IDENTITY_NOT_CONFIGURED'?'CANONICAL_IDENTITY_NOT_CONFIGURED':'IDENTITY_LINK_REFUSED';
  return Response.json({error:code},{status:code==='UNAUTHENTICATED'?401:code==='CANONICAL_IDENTITY_NOT_CONFIGURED'?503:400,headers});
 }
}
