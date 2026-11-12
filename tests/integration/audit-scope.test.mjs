import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {aiDatabase} from '../fixtures/ai-database.mjs';
import {provision} from '../../src/server/auth.mjs';
import {createPurchase,transition} from '../../src/server/workflow.mjs';
import {transactionDetail} from '../../src/server/transaction-detail.mjs';

test('evidence timeline reads recorded events for the authenticated purchase owner only',async()=>{
 const fixture=await aiDatabase(),pool=fixture.connect();
 try{
  const user=await provision(pool,`audit-${randomUUID()}@example.test`,randomUUID());
  const actor={tenant_id:user.tenantId,user_id:user.id};
  const purchase=await createPurchase(pool,actor,'keyboard');await transition(pool,actor,purchase.id,'review');
  const detail=await transactionDetail(pool,actor,purchase.id);
  assert.equal(detail.audit.length,2);assert.equal(detail.audit[0].event,'purchase.created');assert(detail.audit.every(event=>event.occurred_at));
  await assert.rejects(transactionDetail(pool,{tenant_id:randomUUID(),user_id:randomUUID()},purchase.id),/NOT_FOUND/);
  await assert.rejects(transactionDetail(pool,{...actor,user_id:randomUUID()},purchase.id),/NOT_FOUND/);
 }finally{await pool.end();await fixture.close();}
});
