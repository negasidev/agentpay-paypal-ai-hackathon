import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('staging plan never treats proposed identities or offline validation as authority',async()=>{
 const plan=JSON.parse(await readFile(new URL('../../config/staging-authority-plan.json',import.meta.url),'utf8'));
 const folder=await mkdtemp(join(tmpdir(),'agentpay-plan-'));
 const run=async()=>{const file=join(folder,'plan.json');await writeFile(file,JSON.stringify(plan));const result=spawnSync(process.execPath,['scripts/staging-mapping-preflight.mjs',file],{encoding:'utf8'});return {status:result.status,...JSON.parse(result.stdout)};};
 try{
  const proposed=await run();assert.equal(proposed.status,1);assert.equal(proposed.configurationComplete,false);assert(proposed.missing.includes('ids.clientId'));
  for(const key of Object.keys(plan.ids))plan.ids[key]='11111111-1111-4111-8111-111111111111';
  plan.ids.clientId='vyr_0123456789abcdef01234567';plan.registrationOperationId=plan.ids.tenantId;plan.intentVersion=1;plan.canonicalOrigin='https://staging.example.test';plan.approver.protocol='DisplayedApproval';plan.constraints.approvedCounterparties=['synthetic-test-merchant'];plan.constraints.notBefore=new Date(Date.now()-1000).toISOString();plan.constraints.expiresAt=new Date(Date.now()+60000).toISOString();
  const shape=await run();assert.equal(shape.status,0);assert.equal(shape.configurationComplete,true);
  for(const name of ['resourcesLookedUp','approvalProven','payerConsentProven','captureMayBeEnabled','mutationsPerformed'])assert.equal(shape[name],false);
  plan.approver.tenantRole='PaymentApprover';assert((await run()).invalid.includes('unsupported_approver_role_mapping'));
  plan.approver.tenantRole='Member';plan.canonicalOrigin='https://api.twoaye.com';assert((await run()).invalid.includes('canonicalOrigin'));
 }finally{await rm(folder,{recursive:true,force:true});}
});
