import {database} from '../../../../server/persistence/db.mjs';
import {PayPalSandboxClient} from '../../../../server/paypal/client.mjs';
import {ingestWebhook} from '../../../../server/paypal/webhooks.mjs';
export async function POST(request:Request){
 if(!process.env.PAYPAL_SANDBOX_WEBHOOK_ID)return Response.json({error:'WEBHOOK_UNAVAILABLE'},{status:503});
 const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
 const chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536){await reader.cancel();return new Response(null,{status:413});}chunks.push(value);}
  const provider=new PayPalSandboxClient({clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,clientSecret:process.env.PAYPAL_SANDBOX_CLIENT_SECRET});
  const result=await ingestWebhook(database(),Buffer.concat(chunks).toString('utf8'),request.headers,provider,process.env.PAYPAL_SANDBOX_WEBHOOK_ID);
  return Response.json(result);
 }catch{return Response.json({error:'WEBHOOK_REFUSED'},{status:400});}
}
