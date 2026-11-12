import {cookies} from 'next/headers';
import {database} from '../../../../server/persistence/db.mjs';
import {applicationOrigin,browserCookieName,beginCanonicalLogin} from '../../../../server/identity/login.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
 if(request.headers.get('origin')!==applicationOrigin().origin)return Response.json({error:'ORIGIN_REFUSED'},{status:403,headers});
 try{
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error();
  const reader=request.body?.getReader();if(!reader)throw new Error();const chunks:Uint8Array[]=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
   if(size>1024){await reader.cancel();return Response.json({error:'BODY_TOO_LARGE'},{status:413,headers});}chunks.push(value);}
  const raw=Buffer.concat(chunks).toString('utf8');
  const input=JSON.parse(raw),jar=await cookies();
  const result=await beginCanonicalLogin(database(),{context:input.context,next:input.next,browserNonce:jar.get(browserCookieName())?.value});
  jar.set(browserCookieName(),result.browserNonce,{httpOnly:true,secure:applicationOrigin().protocol==='https:',sameSite:'lax',path:'/',maxAge:600});
  return Response.json({redirect:result.redirect},{headers});
 }catch{return Response.json({error:'CANONICAL_LOGIN_UNAVAILABLE'},{status:503,headers});}
}
