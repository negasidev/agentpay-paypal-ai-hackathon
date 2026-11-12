import {createHash} from 'node:crypto';
import {transaction} from '../persistence/db.mjs';
import {ProviderError} from './client.mjs';
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9-]{1,64}$/.test(value);
export async function ingestWebhook(pool,raw,headers,provider,webhookId){
 if(Buffer.byteLength(raw)>65536)throw new ProviderError('WEBHOOK_TOO_LARGE');
 let event;try{event=JSON.parse(raw);}catch{throw new ProviderError('INVALID_WEBHOOK');}
 if(!identifier(event?.id)||typeof event.event_type!=='string'||!/^[A-Z._]{1,100}$/.test(event.event_type))throw new ProviderError('INVALID_WEBHOOK');
 if(await provider.verifyWebhook(event,headers,webhookId)!==true)throw new ProviderError('UNVERIFIED_WEBHOOK');
 const payloadHash=createHash('sha256').update(raw).digest('hex');
 const orderId=event.resource?.supplementary_data?.related_ids?.order_id;
 const captureId=event.event_type.startsWith('PAYMENT.CAPTURE.')?event.resource?.id:null;
 return transaction(pool,async db=>{
   const inserted=await db.query(`INSERT INTO ap_paypal_webhooks(event_id,payload_hash,event_type,order_id,capture_id,processing_state)
    VALUES($1,$2,$3,$4,$5,'UNMATCHED') ON CONFLICT DO NOTHING RETURNING event_id`,[event.id,payloadHash,event.event_type,identifier(orderId)?orderId:null,identifier(captureId)?captureId:null]);
   const stored=(await db.query('SELECT * FROM ap_paypal_webhooks WHERE event_id=$1 FOR UPDATE',[event.id])).rows[0];
   if(stored.payload_hash!==payloadHash)throw new ProviderError('WEBHOOK_ID_CONFLICT');
   // Signed notifications wake a read-only worker. They never establish authority
   // or issue receipts; amount, payee and capture are read directly from PayPal.
   const queued=await db.query(`UPDATE ap_attempts SET next_reconciliation_at=now()
     WHERE provider_order_id=$1 AND state='UNKNOWN' RETURNING id`,[stored.order_id]);
   if(queued.rowCount)await db.query("UPDATE ap_paypal_webhooks SET processing_state='QUEUED' WHERE event_id=$1",[event.id]);
   return {accepted:true,duplicate:!inserted.rowCount,queued:queued.rowCount>0};
 });
}
