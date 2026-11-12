import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createPool} from '../../src/server/persistence/db.mjs';
import {provision} from '../../src/server/auth.mjs';
import {createPurchase,transition} from '../../src/server/workflow.mjs';
import {reconcileAttempt} from '../../src/server/paypal/reconcile.mjs';
import {buildEvidence,verifyExecutionEvidence,evidenceHash} from '../../src/server/paypal/evidence.mjs';
import {ingestWebhook} from '../../src/server/paypal/webhooks.mjs';
import {PayPalSandboxClient} from '../../src/server/paypal/client.mjs';
import {transactionDetail} from '../../src/server/transaction-detail.mjs';

test('unsigned integrity evidence stays incomplete; tampering and wrong provider fail',async()=>{
 const capture={orderId:'ORDER-FIXTURE',captureId:'CAPTURE-FIXTURE',merchantId:'MERCHANT',amount:'119.00',currency:'USD',status:'COMPLETED'};
 const evidence=buildEvidence({tenant_id:'tenant',purchase_id:'purchase',id:'attempt',request_id:'request'},capture,new Date().toISOString());
 assert.equal((await verifyExecutionEvidence(evidence,{purchaseId:'purchase'},capture)).status,'INCOMPLETE');
 assert.equal((await verifyExecutionEvidence({...evidence,amount:'119.01'},{purchaseId:'purchase'},capture)).status,'INVALID');
 assert.equal((await verifyExecutionEvidence(evidence,{purchaseId:'other'},capture)).status,'INVALID');
 assert.equal((await verifyExecutionEvidence(evidence,{}, {...capture,captureId:'OTHER'})).status,'INVALID');
 const fake={...evidence,signature:'made-up',authorityReceiptVerified:true};fake.integrityHash=evidenceHash(fake);
 assert.notEqual((await verifyExecutionEvidence(fake,{},capture)).status,'VERIFIED');
});
test('forged and oversized webhooks never touch database',async()=>{
 const pool={query(){assert.fail('unverified event reached database');},connect(){assert.fail('unverified event reached database');}};
 const raw=JSON.stringify({id:'EVENT-FIXTURE',event_type:'PAYMENT.CAPTURE.COMPLETED'});
 await assert.rejects(ingestWebhook(pool,raw,new Headers(),{verifyWebhook:async()=>false},'WEBHOOK'),/UNVERIFIED_WEBHOOK/);
 await assert.rejects(ingestWebhook(pool,'x'.repeat(65537),new Headers(),{},'WEBHOOK'),/WEBHOOK_TOO_LARGE/);
});
test('PayPal webhook verification posts to fixed sandbox API, requires SUCCESS',async()=>{
 const paths=[];let verification='FAILURE';
 const client=new PayPalSandboxClient({clientId:'fixture',clientSecret:'fixture',fetchImpl:async(url,options)=>{
 paths.push(url);if(url.endsWith('/token'))return Response.json({access_token:'FIXTURE'});
 const body=JSON.parse(options.body);assert.equal(body.webhook_id,'WEBHOOK-FIXTURE');assert.equal(body.webhook_event.id,'EVENT-FIXTURE');
 return Response.json({verification_status:verification});}});
 const headers=new Headers(Object.fromEntries(['id','time','sig'].map(key=>[`paypal-transmission-${key}`,'fixture'])));
 headers.set('paypal-cert-url','https://example.invalid/not-fetched');headers.set('paypal-auth-algo','SHA256withRSA');
 await assert.rejects(client.verifyWebhook({id:'EVENT-FIXTURE'},headers,'WEBHOOK-FIXTURE'),/UNVERIFIED_WEBHOOK/);
 verification='SUCCESS';assert.equal(await client.verifyWebhook({id:'EVENT-FIXTURE'},headers,'WEBHOOK-FIXTURE'),true);
 assert.ok(paths.every(url=>url.startsWith('https://api-m.sandbox.paypal.com/')));
});
test('durable UNKNOWN recovery, bounded retries, webhook dedup and concurrent read-only reconciliation',async()=>{
 const pool=createPool();
 try{
 const user=await provision(pool,`recovery-${randomUUID()}@example.test`,'fixture-password-123');
 const actor={tenant_id:user.tenantId,user_id:user.id};const purchase=await createPurchase(pool,actor,'keyboard');
 const attemptId=randomUUID(),orderId=`ORDER-${randomUUID()}`;
 await pool.query(`INSERT INTO ap_orders(id,tenant_id,user_id,purchase_id,provider_order_id,request_id,purchase_version,amount,currency,merchant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[randomUUID(),actor.tenant_id,actor.user_id,purchase.id,orderId,randomUUID(),purchase.version,purchase.amount,purchase.currency,purchase.merchant_id]);
 await pool.query(`INSERT INTO ap_attempts(id,tenant_id,user_id,purchase_id,provider_order_id,request_id,state,created_at) VALUES($1,$2,$3,$4,$5,$6,'CAPTURE_PENDING',now()-interval '2 minutes')`,[attemptId,actor.tenant_id,actor.user_id,purchase.id,orderId,randomUUID()]);
 await pool.query("UPDATE ap_purchases SET state='UNKNOWN' WHERE id=$1",[purchase.id]);
 let reads=0;
 const provider={getOrder:async()=>{reads++;throw new Error('timeout');},captureOrder(){assert.fail('capture during recovery');},createOrder(){assert.fail('new order during recovery');},verifyWebhook:async()=>true};
 // Kill a worker after its durable STARTED record, while the provider read hangs.
 const worker=fork(new URL('../fixtures/reconciliation-worker.mjs',import.meta.url),[],{env:{...process.env,TEST_RECONCILIATION_ATTEMPT:attemptId},stdio:['ignore','ignore','ignore','ipc']});
 try{const message=await Promise.race([once(worker,'message'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('WORKER_TIMEOUT')),5000);timer.unref();})]);assert.equal(message[0],'provider-read-started');}
 finally{const stopped=once(worker,'exit');worker.kill();await stopped;}
 assert.equal((await pool.query("SELECT count(*) FROM ap_provider_observations WHERE attempt_id=$1 AND outcome='STARTED'",[attemptId])).rows[0].count,'1');
 assert.equal((await pool.query('SELECT state FROM ap_attempts WHERE id=$1',[attemptId])).rows[0].state,'UNKNOWN');
 await pool.query('UPDATE ap_attempts SET next_reconciliation_at=NULL WHERE id=$1',[attemptId]);
 assert.equal((await reconcileAttempt(pool,actor,attemptId,provider)).state,'UNKNOWN');
 assert.equal((await reconcileAttempt(pool,actor,attemptId,provider)).scheduled,true);assert.equal(reads,1);
 assert.equal((await pool.query('SELECT outcome FROM ap_provider_observations WHERE attempt_id=$1 ORDER BY observed_at',[attemptId])).rowCount,3);
 await pool.query('UPDATE ap_attempts SET reconciliation_count=8 WHERE id=$1',[attemptId]);
 assert.equal((await reconcileAttempt(pool,actor,attemptId,provider)).manualReview,true);assert.equal(reads,1);
 await pool.query('UPDATE ap_attempts SET reconciliation_count=2 WHERE id=$1',[attemptId]);
 const event={id:`EVENT-${randomUUID()}`,event_type:'PAYMENT.CAPTURE.COMPLETED',resource:{id:'CAPTURE-FIXTURE',supplementary_data:{related_ids:{order_id:orderId}},payer:{secret:'must-not-persist'}}};
 const raw=JSON.stringify(event);
 const events=await Promise.all(Array.from({length:5},()=>ingestWebhook(pool,raw,new Headers(),provider,'WEBHOOK')));
 assert.equal(events.filter(e=>!e.duplicate).length,1);
 await ingestWebhook(pool,JSON.stringify({...event,id:`EVENT-${randomUUID()}`,event_type:'PAYMENT.CAPTURE.PENDING'}),new Headers(),provider,'WEBHOOK');
 const stored=(await pool.query('SELECT * FROM ap_paypal_webhooks WHERE event_id=$1',[event.id])).rows[0];assert.equal(stored.processing_state,'QUEUED');assert.ok(!JSON.stringify(stored).includes('must-not-persist'));
 await assert.rejects(ingestWebhook(pool,JSON.stringify({...event,event_type:'PAYMENT.CAPTURE.PENDING'}),new Headers(),provider,'WEBHOOK'),/WEBHOOK_ID_CONFLICT/);
 assert.equal((await pool.query('SELECT count(*) FROM ap_receipts WHERE attempt_id=$1',[attemptId])).rows[0].count,'0');
 const unit={amount:{value:'119.00',currency_code:'USD'},payee:{merchant_id:purchase.merchant_id}};
 // Missing, pending, denied and mismatched results cannot prove non-execution.
 for(const status of ['APPROVED','PENDING','DENIED']){
 provider.getOrder=async()=>({id:orderId,intent:'CAPTURE',status,purchase_units:[unit]});
 assert.equal((await reconcileAttempt(pool,actor,attemptId,provider,{force:true})).state,'UNKNOWN');}
 provider.getOrder=async()=>({id:orderId,intent:'CAPTURE',status:'COMPLETED',purchase_units:[{...unit,payments:{captures:[{id:'WRONG',status:'COMPLETED',final_capture:true,amount:{value:'119.01',currency_code:'USD'}}]}}]});
 assert.equal((await reconcileAttempt(pool,actor,attemptId,provider,{force:true})).state,'UNKNOWN');
 const captureId=`CAPTURE-${randomUUID()}`;
 provider.getOrder=async()=>({id:orderId,intent:'CAPTURE',status:'COMPLETED',purchase_units:[{...unit,payments:{captures:[{id:captureId,status:'COMPLETED',final_capture:true,amount:unit.amount}]}}]});
 // A fresh connection pool models restart; the original IDs and request key survive.
 const restarted=createPool();try{const outcomes=await Promise.all(Array.from({length:12},()=>reconcileAttempt(restarted,actor,attemptId,provider,{force:true})));assert.ok(outcomes.every(row=>row.paymentOutcome==='CAPTURED'));}finally{await restarted.end();}
 assert.equal((await pool.query('SELECT count(*) FROM ap_receipts WHERE attempt_id=$1',[attemptId])).rows[0].count,'1');
 assert.equal((await pool.query('SELECT state FROM ap_purchases WHERE id=$1',[purchase.id])).rows[0].state,'UNKNOWN');
 const detail=await transactionDetail(pool,actor,purchase.id);assert.equal(detail.captureEnabled,false);assert.equal(detail.receipts[0].verification.status,'INCOMPLETE');
 await assert.rejects(transactionDetail(pool,{...actor,user_id:randomUUID()},purchase.id),/NOT_FOUND/);
 await assert.rejects(transition(pool,actor,purchase.id,'capture'),/VERIFIED_EXTERNAL_AUTHORITY_REQUIRED/);
 }finally{await pool.end();}
});
