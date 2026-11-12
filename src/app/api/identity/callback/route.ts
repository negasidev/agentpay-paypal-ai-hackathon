import {cookies} from 'next/headers';
import {database} from '../../../../server/persistence/db.mjs';
import {sessionCookieName} from '../../../../server/auth.mjs';
import {applicationOrigin,browserCookieName,finishCanonicalLogin} from '../../../../server/identity/login.mjs';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){
 const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
 try{
  const query=new URL(request.url).searchParams;
  if(query.getAll('state').length!==1||query.getAll('code').length!==1)throw new Error();
  const jar=await cookies(),result=await finishCanonicalLogin(database(),{state:query.get('state'),code:query.get('code'),browserNonce:jar.get(browserCookieName())?.value});
  jar.set(sessionCookieName(),result.token,{httpOnly:true,secure:applicationOrigin().protocol==='https:',sameSite:'lax',path:'/',maxAge:28800});
  return new Response(null,{status:303,headers:{...headers,Location:new URL(result.returnPath,applicationOrigin()).href}});
 }catch{return new Response(null,{status:303,headers:{...headers,Location:new URL('/sign-in?error=canonical',applicationOrigin()).href}});}
}
