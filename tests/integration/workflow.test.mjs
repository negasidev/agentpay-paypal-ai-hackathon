import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool} from '../../src/server/persistence/db.mjs';
import {provision,login,authenticate} from '../../src/server/auth.mjs';
import {createPurchase,listPurchases,transition,reserveCapture,markUnknown} from '../../src/server/workflow.mjs';
import {reconcileAttempt} from '../../src/server/paypal/reconcile.mjs';
test('PostgreSQL: sessions, restart recovery, isolation and transition races',async()=>{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL required; persistence verification cannot skip');
  let pool=createPool();
  try {
    const email=`test-${randomUUID()}@example.test`;const password='evaluation-password-123';
    await provision(pool,email,password);const token=await login(pool,email,password);const actor=await authenticate(pool,token);
    const otherEmail=`test-${randomUUID()}@example.test`;await provision(pool,otherEmail,password);const other=await authenticate(pool,await login(pool,otherEmail,password));
    await assert.rejects(login(pool,email,'incorrect-password'),/INVALID_LOGIN/);
    const purchase=await createPurchase(pool,actor,'keyboard');
    assert.equal((await listPurchases(pool,other)).length,0);
    await assert.rejects(transition(pool,other,purchase.id,'review'),/NOT_FOUND/);
    await assert.rejects(transition(pool,actor,purchase.id,'submit'),/INVALID_TRANSITION/);
    const results=await Promise.allSettled(Array.from({length:20},()=>transition(pool,actor,purchase.id,'review')));
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    for(const result of results.filter(result=>result.status==='rejected'))assert.match(result.reason.message,/INVALID_TRANSITION/);
    await transition(pool,actor,purchase.id,'submit');await pool.end();pool=createPool();
    assert.deepEqual(await authenticate(pool,token),actor);
    const recovered=(await listPurchases(pool,actor)).find(row=>row.id===purchase.id);
    assert.equal(recovered.state,'AUTHORIZATION_PENDING');assert.equal(recovered.version,3);
    await assert.rejects(transition(pool,actor,purchase.id,'capture'),/VERIFIED_EXTERNAL_AUTHORITY_REQUIRED/);
    assert.equal((await pool.query('SELECT count(*) FROM ap_attempts WHERE purchase_id=$1',[purchase.id])).rows[0].count,'0');
    await transition(pool,actor,purchase.id,'reject');await assert.rejects(transition(pool,actor,purchase.id,'review'),/INVALID_TRANSITION/);
    const cancelled=await createPurchase(pool,actor,'keyboard');await transition(pool,actor,cancelled.id,'cancel');await assert.rejects(transition(pool,actor,cancelled.id,'submit'),/INVALID_TRANSITION/);
    // Direct database fixtures test reservation, not externally signed authority.
    const pending=await createPurchase(pool,actor,'keyboard');
    await pool.query("UPDATE ap_purchases SET state='PAYER_APPROVED' WHERE id=$1",[pending.id]);
    await assert.rejects(reserveCapture(pool,actor,pending.id),/VERIFIED_EXTERNAL_AUTHORITY_REQUIRED/);
    await pool.query('INSERT INTO ap_approvals(id,tenant_id,user_id,purchase_id,authority_id,action_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval \'5 minutes\')',[randomUUID(),actor.tenant_id,actor.user_id,pending.id,'STORAGE-FIXTURE-NOT-AUTHORITY','fixture']);
    await pool.query('INSERT INTO ap_orders(id,tenant_id,user_id,purchase_id,provider_order_id,request_id) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor.tenant_id,actor.user_id,pending.id,`FIXTURE-${randomUUID()}`,randomUUID()]);
    const attempts=await Promise.allSettled(Array.from({length:20},()=>reserveCapture(pool,actor,pending.id)));
    assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
    const winner=attempts.find(result=>result.status==='fulfilled').value;
    await markUnknown(pool,actor,winner);
    await pool.query('UPDATE ap_orders SET amount=$2,currency=$3,merchant_id=$4,purchase_version=$5 WHERE purchase_id=$1',[pending.id,pending.amount,pending.currency,pending.merchant_id,pending.version]);
    await assert.rejects(reserveCapture(pool,actor,pending.id),/INVALID_TRANSITION/);
    assert.equal((await pool.query('SELECT state FROM ap_attempts WHERE id=$1',[winner])).rows[0].state,'UNKNOWN');
    const providerOrder=(await pool.query('SELECT provider_order_id FROM ap_attempts WHERE id=$1',[winner])).rows[0].provider_order_id;
    let providerReads=0;
    const provider={async getOrder(){providerReads++;return {id:providerOrder,intent:'CAPTURE',status:'APPROVED',purchase_units:[{amount:{value:'119.00',currency_code:'USD'},payee:{merchant_id:pending.merchant_id}}]};},async captureOrder(){assert.fail('Reconciliation must never capture');}};
    await assert.rejects(reconcileAttempt(pool,other,winner,provider),/NOT_FOUND/);assert.equal(providerReads,0);
    assert.equal((await reconcileAttempt(pool,actor,winner,provider)).state,'UNKNOWN');
    const fixtureCaptureId=`FIXTURE-${randomUUID()}`;
    provider.getOrder=async()=>({id:providerOrder,intent:'CAPTURE',status:'COMPLETED',purchase_units:[{amount:{value:'119.00',currency_code:'USD'},payee:{merchant_id:pending.merchant_id},payments:{captures:[{id:fixtureCaptureId,status:'COMPLETED',final_capture:true,amount:{value:'119.00',currency_code:'USD'}}]}}]});
    // Operator override advances fixture time without bypassing provider binding checks.
    const reconciled=await Promise.all(Array.from({length:10},()=>reconcileAttempt(pool,actor,winner,provider,{force:true})));
    assert.ok(reconciled.every(result=>result.state==='COMPLETED'));
    assert.equal((await pool.query('SELECT count(*) FROM ap_receipts WHERE attempt_id=$1',[winner])).rows[0].count,'1');
  }finally{await pool.end();}
});
