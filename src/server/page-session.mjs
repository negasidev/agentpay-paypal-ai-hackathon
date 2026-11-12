import {authenticate} from './auth.mjs';
import {database} from './persistence/db.mjs';

// A cookie is only a bearer candidate; the existing session service decides
// whether it is still valid, including canonical reauthentication checks.
export async function verifyPageSession(token,{endpoint=process.env.AGENTPAY_SESSION_API_URL,fetcher=fetch,localAuthenticate=()=>authenticate(database(),token)}={}){
 if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))return false;
 if(!endpoint){try{await localAuthenticate();return true;}catch(error){if(error.message==='UNAUTHENTICATED')return false;throw error;}}
 const url=new URL(endpoint);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('SESSION_SERVICE_CONFIGURATION');
 const response=await fetcher(url,{headers:{cookie:`__Host-agentpay_session=${token}`},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
 if(response.status===401)return false;
 if(!response.ok)throw Error('SESSION_SERVICE_UNAVAILABLE');
 const session=await response.json();
 if(session?.authenticated!==true)throw Error('SESSION_SERVICE_INVALID_RESPONSE');
 return true;
}
