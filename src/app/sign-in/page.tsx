import EvaluationSignIn from '../../components/EvaluationSignIn';
import CanonicalSignIn from '../../components/CanonicalSignIn';
import {loginConfiguration} from '../../server/identity/login.mjs';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{next?:string;error?:string}>}){
 const {next,error}=await searchParams;
 const canonical=process.env.AGENTPAY_CANONICAL_LOGIN_ENABLED==='true';
 let available=false;
 if(canonical)try{loginConfiguration();available=true;}catch{}
 return <><h1 className="page-title">Sign in</h1>
  {(canonical||process.env.AGENTPAY_CANONICAL_REQUIRED==='true')&&<CanonicalSignIn next={next} failed={error==='canonical'} available={available}/>}
  {process.env.AGENTPAY_CANONICAL_REQUIRED!=='true'&&<EvaluationSignIn next={next}/>}</>;
}
