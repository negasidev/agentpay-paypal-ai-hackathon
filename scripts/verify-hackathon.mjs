import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {createPool} from '../src/server/persistence/db.mjs';
import {provision} from '../src/server/auth.mjs';
import {proposePurchase,listProposals} from '../src/server/ai/proposals.mjs';
import {transition} from '../src/server/workflow.mjs';
import {PayPalSandboxClient} from '../src/server/paypal/client.mjs';
import {probeSandboxOrder,verifySandboxOrder} from '../src/server/paypal/order-probe.mjs';

// A provider demonstration must never turn an absent approval integration into permission.
if(!process.argv.includes('--providers'))throw Error('EXPLICIT_PROVIDERS_FLAG_REQUIRED');
const database=new URL(process.env.DATABASE_URL??'');
if(!/^\/agentpay_hackathon_[a-z0-9_]+$/.test(database.pathname))throw Error('ISOLATED_HACKATHON_DATABASE_REQUIRED');
if(process.env.AGENTPAY_PROTECTED_CAPTURE_ENABLED==='true')throw Error('CAPTURE_MUST_REMAIN_DISABLED');
for(const name of ['PAYPAL_SANDBOX_CLIENT_ID','PAYPAL_SANDBOX_CLIENT_SECRET','PAYPAL_SANDBOX_MERCHANT_ID'])if(!process.env[name])throw Error('MISSING_'+name);
let pool=createPool();
try{
 const user=await provision(pool,`judge-${randomUUID()}@example.test`,randomUUID());
 const actor={tenant_id:user.tenantId,user_id:user.id};
 const proposal=await proposePurchase(pool,actor,{requestId:randomUUID(),instruction:'Find a wireless ergonomic keyboard under $150.',maximumBudget:'150.00'});
 const provider=new PayPalSandboxClient({clientId:process.env.PAYPAL_SANDBOX_CLIENT_ID,clientSecret:process.env.PAYPAL_SANDBOX_CLIENT_SECRET});
 const order=await probeSandboxOrder(pool,actor,proposal.purchaseId,process.env.PAYPAL_SANDBOX_MERCHANT_ID,provider);
 const retrieved=await provider.getOrder(order.orderId);
 const trusted={amount:proposal.total,currency:'USD',merchantId:process.env.PAYPAL_SANDBOX_MERCHANT_ID};
 verifySandboxOrder(retrieved,order.orderId,trusted);
 assert.throws(()=>verifySandboxOrder(retrieved,order.orderId,{...trusted,amount:'999.00'}));
 await assert.rejects(transition(pool,actor,proposal.purchaseId,'capture'),/VERIFIED_EXTERNAL_AUTHORITY_REQUIRED/);
 await pool.end();pool=createPool();
 const recovered=(await listProposals(pool,actor)).find(row=>row.id===proposal.id);assert.equal(recovered?.purchaseId,proposal.purchaseId);
 const purchase=(await pool.query('SELECT state,amount FROM ap_purchases WHERE id=$1 AND tenant_id=$2 AND user_id=$3',[proposal.purchaseId,actor.tenant_id,actor.user_id])).rows[0];
 assert.equal(purchase.state,'DRAFT');assert.equal(purchase.amount,proposal.total);
 const attempts=await pool.query('SELECT count(*)::int AS count FROM ap_attempts WHERE purchase_id=$1',[proposal.purchaseId]);assert.equal(attempts.rows[0].count,0);
 const result={verifiedAt:new Date().toISOString(),passed:true,scope:'Real AI proposal and PayPal sandbox order creation/retrieval; no buyer approval, capture or signed-device acceptance',ai:proposal.provenance,productId:proposal.product.id,purchaseId:proposal.purchaseId,order,checks:{exactProviderTerms:true,amountTamperingRejected:true,unapprovedCaptureRejected:true,recoveredAfterPoolRestart:true,noExecutionAttempts:true},paymentExecuted:false,hardwareAttested:false};
 const output=resolve('data/hackathon-provider-evidence.json');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result,null,2));
}catch(error){console.error('HACKATHON_VERIFICATION_FAILED: '+(/^[A-Z0-9_]+$/.test(error.code??error.message)?error.code??error.message:'See provider configuration and isolated database setup'));process.exitCode=1;}
finally{await pool.end();}
