import {authorityConfig} from './authorization/requests.mjs';
import {assertReferenceQuote} from './shopping/reference-merchant.mjs';

// Readiness is a current-record observation. Capture rechecks live authority
// and provider consent; no response from this helper grants permission.
export function executionReadiness(actor,purchase,orders,authority,attempts,env=process.env,now=Date.now()){
 const captureConfigured=env.AGENTPAY_PROTECTED_CAPTURE_ENABLED==='true'&&
   env.AGENTPAY_SANDBOX_CHECKOUT_ENABLED==='true'&&
   Boolean(env.PAYPAL_SANDBOX_CLIENT_ID&&env.PAYPAL_SANDBOX_CLIENT_SECRET&&env.PAYPAL_SANDBOX_MERCHANT_ID)&&
   Boolean(authorityConfig(actor,env));
 let reason=null;
 if(!captureConfigured)reason='CAPTURE_NOT_CONFIGURED';
 else if(attempts.length)reason='EXISTING_ATTEMPT';
 else if(purchase.state!=='AUTHORIZATION_PENDING')reason='PURCHASE_NOT_PENDING';
 else if(authority?.state!=='VERIFIED')reason='AUTHORITY_NOT_VERIFIED';
 else if(!authority.expires_at||!Number.isFinite(Date.parse(authority.expires_at))||Date.parse(authority.expires_at)<=now)reason='AUTHORITY_EXPIRED';
 else if(orders.length!==1||orders[0].buyer_status!=='APPROVED')reason='BUYER_CONSENT_REQUIRED';
 if(reason===null){try{assertReferenceQuote(purchase,new Date(now));}catch(error){reason=error.message==='QUOTE_EXPIRED'?'QUOTE_EXPIRED':'QUOTE_MISMATCH';}}
 return {captureConfigured,captureEnabled:reason===null,reason,liveChecksRequired:true};
}
