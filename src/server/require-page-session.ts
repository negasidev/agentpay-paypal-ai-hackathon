import {cookies} from 'next/headers';
import {redirect} from 'next/navigation';
import {sessionCookieName} from './auth.mjs';
import {verifyPageSession} from './page-session.mjs';

export type PageQuery=Promise<Record<string,string|string[]|undefined>>;
export async function requirePageSession(destination:string,query?:PageQuery){
 const jar=await cookies();
 const name=process.env.AGENTPAY_SESSION_API_URL?'__Host-agentpay_session':sessionCookieName();
 if(!await verifyPageSession(jar.get(name)?.value)){
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(await query??{})){for(const item of Array.isArray(value)?value:value===undefined?[]:[value])params.append(key,item);}
  const target=destination+(params.size?`?${params}`:'');
  redirect(`/sign-in?next=${encodeURIComponent(target)}`);
 }
}
