import {cookies} from 'next/headers';
import {authenticate,sessionCookieName} from '../../../../server/auth.mjs';
import {database} from '../../../../server/persistence/db.mjs';
export const dynamic='force-dynamic';
export async function GET(){
  try{await authenticate(database(),(await cookies()).get(sessionCookieName())?.value);
    if(process.env.AGENTPAY_SANDBOX_CHECKOUT_ENABLED!=='true'||!process.env.PAYPAL_SANDBOX_CLIENT_ID)return Response.json({enabled:false});
    return Response.json({enabled:true,clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,currency:'USD',captureEnabled:false},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'UNAUTHENTICATED'},{status:401});}
}
