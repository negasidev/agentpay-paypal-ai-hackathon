import {createPool} from '../../src/server/persistence/db.mjs';
import {reconcileAttempt} from '../../src/server/paypal/reconcile.mjs';
const pool=createPool();
const row=(await pool.query('SELECT id,tenant_id,user_id FROM ap_attempts WHERE id=$1',[process.env.TEST_RECONCILIATION_ATTEMPT])).rows[0];
await reconcileAttempt(pool,row,row.id,{getOrder:async()=>{process.send?.('provider-read-started');return new Promise(()=>{});}},{force:true});
